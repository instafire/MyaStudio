const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildPublishedPlayerHtml } = require('../lib/published-player');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function previewFnBody() {
    const start = indexHtml.indexOf('loadPreviewClip(id, forceTime=0) {');
    const end = indexHtml.indexOf('onPreviewTimeUpdate() {', start);
    assert.ok(start !== -1 && end !== -1, 'loadPreviewClip / onPreviewTimeUpdate anchors found');
    return indexHtml.slice(start, end);
}

function countMatches(haystack, re) {
    return (haystack.match(re) || []).length;
}

// --- (a) loadPreviewClip duplication ---

test('preview loadPreviewClip sets the video src exactly once', () => {
    const body = previewFnBody();
    assert.equal(countMatches(body, /v\.src = nextClip\.filepath/g), 1);
    // The logic-block list is built once too (it was duplicated alongside the setup).
    assert.equal(countMatches(body, /this\.previewActiveBlocks = Object\.values\(blocks\)/g), 1);
    assert.equal(countMatches(body, /this\.previewActiveBlocks = this\.previewActiveBlocks\.filter\(b => b\.time > forceTime\)/g), 1);
});

test('preview loadPreviewClip keeps the delayed setup copy that clears the fade flag', () => {
    const body = previewFnBody();
    // The single setup runs 200 ms after load (fade-out window), like the
    // published player's 220 ms delayed setup — and it is the copy that
    // clears previewFading; without it the preview stage stays opacity 0.
    assert.match(body, /setTimeout\(\(\) => \{\s*this\.\$nextTick\(\(\) => \{/);
    assert.match(body, /\}, 200\);/);
    assert.match(body, /setTimeout\(\(\) => \{ this\.previewFading = false; \}, 60\);/);
    // No immediate $nextTick setup copy remains outside the delayed timer.
    assert.equal(countMatches(body, /this\.\$nextTick\(\(\) => \{/g), 1);
    // Setup still loads the clip, seeks, and starts BGM.
    assert.match(body, /v\.currentTime = forceTime;/);
    assert.match(body, /v\.muted = !!nextClip\.mute_audio;/);
    assert.match(body, /v\.play\(\)\.catch\(\(\) => \{\}\);/);
    assert.match(body, /if\(nextClip\.bg_music\)\{/);
});

function makePlayer(clips) {
    return buildPublishedPlayerHtml({
        safeTitle: 'Clip Timeout Test',
        themeColor: '#2563eb',
        clips,
        logicBlocks: [],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 42
    });
}

const clipsWithTimeout = [
    { unique_id: 'main', name: 'Main story', filepath: 'clips/main.mp4', thumbnail: 'clips/main.jpg', duration: 12, mute_audio: 0, is_event_clip: 0, bg_music: null, timeout_to_id: 'branch-b', timeout_seconds: 5 },
    { unique_id: 'branch-a', name: 'Branch A', filepath: 'clips/a.mp4', duration: 4, mute_audio: 0, is_event_clip: 0 },
    { unique_id: 'branch-b', name: 'Branch B', filepath: 'clips/b.mp4', duration: 4, mute_audio: 0, is_event_clip: 0 }
];

// --- (b) clip timeout in the preview engine ---

test('preview arms a clip timeout from timeout_seconds/timeout_to_id and auto-advances', () => {
    const body = previewFnBody();
    assert.match(body, /this\.clearPreviewClipTimeout\(\);/);
    assert.match(body, /this\.startPreviewClipTimeout\(nextClip\);/);
    assert.match(indexHtml, /startPreviewClipTimeout\(clip\) \{/);
    // Same 100 ms interval countdown shape as the choice timer.
    assert.match(indexHtml, /this\.previewClipTimeoutId = setInterval\(\(\) => \{/);
    assert.match(indexHtml, /this\.previewClipTimeLeft = Math\.max\(0, \(this\.previewClipTimeLeft \|\| 0\) - 0\.1\);/);
    // No timeout configured (or no valid target) means no timer.
    assert.match(indexHtml, /if \(seconds <= 0 \|\| !targetId\) \{ this\.previewClipTimeLeft = null; return; \}/);
    assert.match(indexHtml, /if \(!this\.clips\.some\(c => c\.unique_id === targetId\)\) \{ this\.previewClipTimeLeft = null; return; \}/);
    // On expiry with no choice made, jump to the timeout target.
    // (Compared by unique_id: Vue wraps currentClip in a reactive proxy,
    // so object identity against the raw clip never matches.)
    assert.match(indexHtml, /if \(!this\.previewClip \|\| this\.previewClip\.unique_id !== clip\.unique_id \|\| this\._previewTimeoutFired\) return;/);
    assert.match(indexHtml, /this\.loadPreviewClip\(targetId, 0\);/);
    // A stale choice countdown is cleared before the jump.
    assert.match(indexHtml, /this\.clearPreviewChoiceTimer\(\);\s*this\.loadPreviewClip\(targetId, 0\);/);
    // State fields exist next to the choice-timer fields.
    assert.match(indexHtml, /previewClipTimeoutId: null, previewClipTimeLeft: null,/);
    // Closing the preview clears the clip timer so it cannot fire afterwards.
    const closeStart = indexHtml.indexOf('closePreview() {');
    const closeBody = indexHtml.slice(closeStart, indexHtml.indexOf('loadPreviewClip(id, forceTime=0) {', closeStart));
    assert.match(closeBody, /this\.clearPreviewClipTimeout\(\);/);
});

test('preview clip timeout does not arm for clips without a timeout', () => {
    // startPreviewClipTimeout returns early before creating any interval.
    const fn = indexHtml.slice(indexHtml.indexOf('startPreviewClipTimeout(clip) {'));
    assert.match(fn, /this\.clearPreviewClipTimeout\(\);\s*const seconds = Number\(clip && clip\.timeout_seconds\) \|\| 0;/);
});

// --- (b) clip timeout in the published player ---

test('published player carries timeout fields and enforces the clip timeout', () => {
    const html = makePlayer(clipsWithTimeout);
    // The clip's timeout fields survive into the published CLIPS data.
    assert.match(html, /"timeout_to_id":"branch-b"/);
    assert.match(html, /"timeout_seconds":5/);
    // Timer state lives next to the choice-timer state.
    assert.match(html, /clipTimeLeft: null,\s*clipTimeoutId: null,/);
    // loadClip clears any previous clip timer and arms the new clip's.
    assert.match(html, /this\.clearClipTimeout\(\);\s*if \(this\._loadTimeout\) clearTimeout\(this\._loadTimeout\);/);
    assert.match(html, /this\.currentClip = nextClip;\s*this\.startClipTimeout\(nextClip\);/);
    // Same 100 ms interval countdown shape as the choice timer.
    assert.match(html, /this\.clipTimeoutId = setInterval\(\(\) => \{/);
    assert.match(html, /this\.clipTimeLeft = Math\.max\(0, \(this\.clipTimeLeft \|\| 0\) - 0\.1\);/);
    // No timeout configured (or no valid target) means no timer.
    assert.match(html, /if \(seconds <= 0 \|\| !targetId\) \{ this\.clipTimeLeft = null; return; \}/);
    assert.match(html, /if \(!CLIPS\.some\(c => c\.unique_id === targetId\)\) \{ this\.clipTimeLeft = null; return; \}/);
    // On expiry with no choice made, jump to the timeout target.
    // (Compared by unique_id: Vue wraps currentClip in a reactive proxy,
    // so object identity against the raw CLIPS entry never matches.)
    assert.match(html, /if \(!this\.currentClip \|\| this\.currentClip\.unique_id !== clip\.unique_id\) return;/);
    assert.match(html, /this\.loadClip\(targetId, 0\);/);
    // Timer is cleared when the movie ends and when the player unmounts,
    // so it cannot fire after playback is over.
    assert.match(html, /this\.clearClipTimeout\(\);\s*this\.showChoices = false;\s*this\.currentOptions = null;\s*this\.isLoading = false;\s*this\.isComplete = true;/);
    assert.match(html, /this\.clearChoiceTimer\(\);\s*this\.clearClipTimeout\(\);\s*if \(this\._loadTimeout\) clearTimeout\(this\._loadTimeout\);/);
});

test('published player never arms a clip timeout when the clip has none', () => {
    const html = makePlayer([
        { unique_id: 'main', name: 'Main story', filepath: 'clips/main.mp4', duration: 12, mute_audio: 0, is_event_clip: 0, timeout_to_id: null, timeout_seconds: null },
        { unique_id: 'branch-b', name: 'Branch B', filepath: 'clips/b.mp4', duration: 4, mute_audio: 0, is_event_clip: 0 }
    ]);
    assert.match(html, /"timeout_to_id":null/);
    // The early return still guards the arm path for this build.
    assert.match(html, /if \(seconds <= 0 \|\| !targetId\) \{ this\.clipTimeLeft = null; return; \}/);
});
