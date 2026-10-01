const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPublishedPlayerHtml,
    collectReachableClipIds,
    serializeInlineJson
} = require('../lib/published-player');

test('collectReachableClipIds excludes unused library clips from published movies', () => {
    const reachable = collectReachableClipIds(
        [{ id: 'start' }],
        [
            { from_id: 'start', to_id: 'branch-a', action_type: 'target' },
            { from_id: 'start', to_id: 'ending', action_type: 'target' },
            { from_id: 'branch-a', to_id: 'nested', action_type: 'target' },
            { from_id: 'unused', to_id: 'unused-ending', action_type: 'target' },
            { from_id: 'start', to_id: 'ignored-next-target', action_type: 'next' }
        ]
    );

    assert.deepEqual([...reachable].sort(), ['branch-a', 'ending', 'nested', 'start']);
});

test('serializeInlineJson escapes HTML-breaking characters for inline scripts', () => {
    const serialized = serializeInlineJson([
        {
            name: 'End </script> Test',
            meta: 'A&B',
            separators: '\u2028\u2029'
        }
    ]);

    assert.match(serialized, /\\u003C\/script\\u003E/);
    assert.match(serialized, /\\u0026/);
    assert.match(serialized, /\\u2028/);
    assert.match(serialized, /\\u2029/);
    assert.doesNotMatch(serialized, /End <\/script> Test/);
});

test('buildPublishedPlayerHtml keeps choice labels visible and embeds data without JSON.parse wrappers', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Audit Publish',
        themeColor: '#112233',
        clips: [
            {
                unique_id: 'clip-1',
                name: 'End </script> Test',
                filepath: 'clips/clip-1.mp4',
                thumbnail: 'clips/clip-1.jpg',
                mute_audio: 0,
                is_event_clip: 0,
                bg_music: null
            }
        ],
        logicBlocks: [
            {
                id: 'logic-1',
                from: 'clip-1',
                time: 1.8,
                choices: [{ to: 'clip-1', label: 'Go somewhere', color: '#ffffff', return: false, action: 'target' }]
            }
        ],
        seq: [{ id: 'clip-1', name: 'Clip 1', startTime: 0 }],
        projectId: 99
    });

    assert.match(html, /class="choice-content"/);
    assert.match(html, /\{\{ ch\.label \|\| 'Choice' \}\}/);
    assert.match(html, /const CLIPS = \[/);
    assert.doesNotMatch(html, /JSON\.parse\('/);
    assert.match(html, /End \\u003C\/script\\u003E Test/);
    assert.doesNotMatch(html, /End <\/script> Test/);
});

test('published player exposes accessible choices, keyboard shortcuts, and a replayable ending', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Branch Test',
        themeColor: '#2563eb',
        clips: [
            {
                unique_id: 'main',
                name: 'Main story',
                filepath: 'clips/main.mp4',
                thumbnail: 'clips/main.jpg',
                duration: 12,
                mute_audio: 0,
                is_event_clip: 0,
                bg_music: null
            },
            {
                unique_id: 'branch',
                name: 'Branch',
                filepath: 'clips/branch.mp4',
                thumbnail: 'clips/branch.jpg',
                duration: 3,
                mute_audio: 0,
                is_event_clip: 0,
                bg_music: null
            }
        ],
        logicBlocks: [
            {
                id: 'decision',
                from: 'main',
                time: 4,
                choices: [{ to: 'branch', label: 'Take the branch', color: '#f8fafc', return: true, action: 'target' }]
            }
        ],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 7
    });

    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="choice-heading"/);
    assert.match(html, /What happens next\?/);
    assert.match(html, /handleKey/);
    assert.match(html, /Replay from the beginning/);
    assert.match(html, /Math\.max\(0, Math\.min/);
});

test('published player ships playback controls, shortcuts overlay, journey recap, loading spinner, and back-to-decision', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Controls Test',
        themeColor: '#2563eb',
        clips: [
            {
                unique_id: 'main',
                name: 'Main story',
                filepath: 'clips/main.mp4',
                thumbnail: 'clips/main.jpg',
                duration: 12,
                mute_audio: 0,
                is_event_clip: 0,
                bg_music: null
            }
        ],
        logicBlocks: [],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 7
    });

    // Playback controls
    assert.match(html, /toggleMute/);
    assert.match(html, /togglePlay/);
    assert.match(html, /seekBy/);
    assert.match(html, /changeVolume/);
    assert.match(html, /copyLink/);
    assert.match(html, /cycleSpeed/);
    assert.match(html, /toggleFullscreen/);
    // Keyboard shortcuts
    assert.match(html, /showShortcuts/);
    assert.match(html, /Keyboard shortcuts/);
    assert.match(html, /key === '\?'/);
    // Decision history + back button
    assert.match(html, /decisionHistory/);
    assert.match(html, /goBackToDecision/);
    assert.match(html, /timeline-back/);
    // Journey recap on the end screen
    assert.match(html, /journeyLog/);
    assert.match(html, /journey-list/);
    assert.match(html, /endReason/);
    // Loading indicator
    assert.match(html, /class="loader"/);
    assert.match(html, /isLoading/);
    // Per-clip mute respects the user's mute choice
    assert.match(html, /v\.muted = this\.userMuted/);
});

test('published player provides a seekable scene timeline and accessible decision markers', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Timeline Test',
        themeColor: '#2563eb',
        clips: [{ unique_id: 'main', name: 'Main', filepath: 'clips/main.mp4', thumbnail: '', duration: 60, mute_audio: 0, is_event_clip: 0, bg_music: null }],
        logicBlocks: [
            { id: 'first-choice', from: 'main', time: 15, choices: [{ to: 'main', label: 'Wait', action: 'target' }] },
            { id: 'ending-choice', from: 'main', time: 45, choices: [{ to: 'main', label: 'Finish', action: 'target' }] }
        ],
        seq: [{ id: 'main', name: 'Main', startTime: 0 }],
        projectId: 10
    });

    assert.match(html, /class="timeline-hud"/);
    assert.match(html, /class="timeline-scrubber"/);
    assert.match(html, /type="range"/);
    assert.match(html, /@input="seekTimeline"/);
    assert.match(html, /seekToDecision\(decision\)/);
    assert.match(html, /rebuildActiveBlocks/);
    assert.match(html, /v-for="\(decision, index\) in timelineDecisions"/);
    assert.match(html, /Next choice/);
    assert.match(html, /Choice ' \+ \(index \+ 1\) \+ ' at '/);
});

test('published analytics queue is retained when the server rejects an event', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Analytics Test',
        themeColor: '#2563eb',
        clips: [{ unique_id: 'main', name: 'Main', filepath: 'clips/main.mp4', thumbnail: '', duration: 1, mute_audio: 0, is_event_clip: 0, bg_music: null }],
        logicBlocks: [],
        seq: [{ id: 'main', name: 'Main', startTime: 0 }],
        projectId: 8
    });

    assert.match(html, /if \(!response\.ok\) throw new Error\('Analytics request failed'\)/);
    assert.match(html, /Events stay queued for next attempt/);
});

test('published player previews choice clips on hover and resumes from the trigger moment by default', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Preview Test',
        themeColor: '#2563eb',
        clips: [
            { unique_id: 'main', name: 'Main story', filepath: 'clips/main.mp4', thumbnail: 'clips/main.jpg', duration: 12, mute_audio: 0, is_event_clip: 0, bg_music: null },
            { unique_id: 'branch', name: 'Branch', filepath: 'clips/branch.mp4', thumbnail: 'clips/branch.jpg', duration: 4, mute_audio: 0, is_event_clip: 0, bg_music: null }
        ],
        logicBlocks: [
            // Note: no explicit `return` flag on the choice — the default must kick in.
            { id: 'decision', from: 'main', time: 4, choices: [{ to: 'branch', label: 'Take the branch', color: '#f8fafc', action: 'target' }] }
        ],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 11
    });

    // Hover preview markup and handlers on each choice card.
    assert.match(html, /class="choice-preview-video"/);
    assert.match(html, /:src="getChoiceVideo\(ch\)"/);
    assert.match(html, /@mouseenter="startChoicePreview\(ch, \$event\)"/);
    assert.match(html, /@mouseleave="stopChoicePreview\(\$event\)"/);
    assert.match(html, /@focus="startChoicePreview\(ch, \$event\)"/);
    assert.match(html, /@blur="stopChoicePreview\(\$event\)"/);
    assert.match(html, /choice-preview-badge/);
    // Preview helper methods exist in the player script.
    assert.match(html, /getChoiceVideo\(choice\)/);
    assert.match(html, /getChoicePreviewStartTime\(choice\)/);
    assert.match(html, /startChoicePreview\(choice, event\)/);
    assert.match(html, /stopAllChoicePreviews\(except\)/);
    assert.match(html, /video\.play\(\)\.catch\(\(\) => \{\}\)/);
    // Return-to-trigger is the default when the flag is absent.
    assert.match(html, /if \(choice\.return !== false\)/);
    assert.match(html, /resumes from this exact moment/);
    // Clicking a choice stops any running hover previews first.
    assert.match(html, /this\.stopAllChoicePreviews\(\);/);
});

test('published player still honors an explicit permanent branch (return === false)', () => {
    const html = buildPublishedPlayerHtml({
        safeTitle: 'Permanent Branch Test',
        themeColor: '#2563eb',
        clips: [
            { unique_id: 'main', name: 'Main story', filepath: 'clips/main.mp4', thumbnail: '', duration: 12, mute_audio: 0, is_event_clip: 0, bg_music: null },
            { unique_id: 'ending', name: 'Ending', filepath: 'clips/ending.mp4', thumbnail: '', duration: 5, mute_audio: 0, is_event_clip: 0, bg_music: null }
        ],
        logicBlocks: [
            { id: 'decision', from: 'main', time: 4, choices: [{ to: 'ending', label: 'Walk away', color: '#f8fafc', return: false, action: 'target' }] }
        ],
        seq: [{ id: 'main', name: 'Main story', startTime: 0 }],
        projectId: 12
    });

    // The default-on return logic is present; explicit `return: false` in the
    // serialized data keeps the branch permanent because `false !== false` is false.
    assert.match(html, /if \(choice\.return !== false\)/);
    assert.match(html, /"return":false/);
});
