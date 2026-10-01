const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPublishedPlayerHtml } = require('../lib/published-player');
const { srtToVtt, looksLikeValidCues } = require('../lib/subtitles');

function makePlayer(overrides = {}) {
    return buildPublishedPlayerHtml({
        safeTitle: 'Timer Test',
        themeColor: '#2563eb',
        clips: [
            { unique_id: 'main', name: 'Main story', filepath: 'clips/main.mp4', thumbnail: 'clips/main.jpg', duration: 12, mute_audio: 0, is_event_clip: 0, bg_music: null, subtitle: 'clips/main.vtt' },
            { unique_id: 'branch-a', name: 'Branch A', filepath: 'clips/a.mp4', duration: 4, mute_audio: 0, is_event_clip: 0 },
            { unique_id: 'branch-b', name: 'Branch B', filepath: 'clips/b.mp4', duration: 4, mute_audio: 0, is_event_clip: 0 }
        ],
        logicBlocks: [
            {
                id: 'decision', from: 'main', time: 4, timeLimit: 10, shuffle: true,
                choices: [
                    { to: 'branch-a', label: 'Take A', color: '#f8fafc', action: 'target', isDefault: true },
                    { to: 'branch-b', label: 'Take B', color: '#f8fafc', action: 'target' }
                ]
            }
        ],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 21,
        ...overrides
    });
}

test('published player renders a choice countdown with auto-pick of the default choice', () => {
    const html = makePlayer();
    // Countdown UI.
    assert.match(html, /class="choice-timer"/);
    assert.match(html, /choiceTimeLeft/);
    assert.match(html, /startChoiceTimer\(displayBlock\)/);
    assert.match(html, /clearChoiceTimer\(\)/);
    // Auto-pick prefers the unlocked default choice, falls back to first unlocked.
    assert.match(html, /c\.isDefault && !this\.isLocked\(c\)/);
    assert.match(html, /this\.makeChoice\(pick\)/);
    // Timer is skipped when the block has no limit.
    assert.match(html, /if \(limit <= 0\) \{ this\.choiceTimeLeft = null; return; \}/);
    // Dismissing choices always clears the timer via watcher.
    assert.match(html, /showChoices\(v\) \{ if \(!v\) this\.clearChoiceTimer\(\); \}/);
});

test('published player shuffles choice order when the block requests it', () => {
    const html = makePlayer();
    assert.match(html, /function shuffledCopy\(arr\)/);
    assert.match(html, /block\.shuffle \? shuffledCopy\(block\.choices\) : block\.choices\.slice\(\)/);
});

test('published player exposes fullscreen, speed, and caption controls', () => {
    const html = makePlayer();
    assert.match(html, /@click="toggleFullscreen"/);
    assert.match(html, /@click="cycleSpeed"/);
    assert.match(html, /@click="toggleCaptions"/);
    assert.match(html, /v\.playbackRate = this\.playbackSpeed/);
    assert.match(html, /document\.exitFullscreen/);
});

test('published player renders a subtitle track when the clip has captions', () => {
    const html = makePlayer();
    assert.match(html, /<track v-if="currentClip && currentClip\.subtitle"/);
    assert.match(html, /kind="subtitles"/);
    assert.match(html, /captionsAvailable/);
    assert.match(html, /video::cue/);
});

test('srtToVtt converts SRT timestamps and leaves valid WebVTT untouched', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n';
    const vtt = srtToVtt(srt);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00:01\.000 --> 00:00:03\.500/);
    assert.doesNotMatch(vtt, /00:00:01,000/);
    assert.ok(looksLikeValidCues(vtt));

    const already = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHi\n';
    assert.equal(srtToVtt(already), already);
    assert.ok(!looksLikeValidCues('not subtitles at all'));
    assert.ok(!looksLikeValidCues('WEBVTT\n\nno timestamps here'));
});
