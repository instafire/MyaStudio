const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storyLib = require('../lib/story');
const Story = require('../public/player/story-core.js');
const { srtToVtt, looksLikeValidCues } = require('../lib/subtitles');

const playerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'player', 'mya-player.js'), 'utf8');
const playerCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'player', 'mya-player.css'), 'utf8');

function timedStory() {
    return storyLib.buildStory({
        project: { id: 21, title: 'Timer Test', start_clip_id: 'main' },
        clips: [
            { unique_id: 'main', name: 'Main story', filepath: '/clips/main.mp4', duration: 12, subtitle_path: '/subtitles/main.vtt' },
            { unique_id: 'branch-a', name: 'Branch A', filepath: '/clips/a.mp4', duration: 4, is_ending: 1 },
            { unique_id: 'branch-b', name: 'Branch B', filepath: '/clips/b.mp4', duration: 4, is_ending: 1 }
        ],
        edges: [
            { id: 1, from_id: 'main', to_id: 'branch-a', label: 'Take A', trigger_time: 4, logic_id: 'decision', time_limit: 10, is_default: 1, shuffle_choices: 1, action_type: 'target' },
            { id: 2, from_id: 'main', to_id: 'branch-b', label: 'Take B', trigger_time: 4, logic_id: 'decision', time_limit: 10, is_default: 0, shuffle_choices: 1, action_type: 'target' }
        ]
    });
}

test('countdown choices carry their time limit and auto-pick the default choice', () => {
    const engine = Story.createEngine(timedStory(), { random: () => 0.99 });
    engine.start();
    const due = engine.pointDue(4.05);
    assert.equal(due.point.timeLimit, 10);
    assert.equal(engine.defaultChoice(due.point, due.choices).label, 'Take A');
    assert.deepEqual(engine.choose(due.point.id, engine.defaultChoice(due.point, due.choices).id), { type: 'play', sceneId: 'branch-a', time: 0 });
});

test('the player shows a countdown bar and picks the default when time runs out', () => {
    assert.match(playerSource, /class: 'mp-timer'/);
    assert.match(playerSource, /if \(left <= 0\) pick\(engine\.defaultChoice\(choice\.point, choice\.choices\), true\)/);
    // The countdown pauses while the viewer pauses the movie.
    assert.match(playerSource, /if \(!pausedByUser\) choice\.elapsed \+= delta/);
    assert.match(playerCss, /\.mp-timer-fill/);
});

test('shuffled choice points reorder their choices', () => {
    const engine = Story.createEngine(timedStory(), { random: () => 0 });
    engine.start();
    assert.deepEqual(engine.pointDue(4.05).choices.map(choice => choice.label), ['Take B', 'Take A']);
});

test('the player exposes fullscreen, captions and volume controls', () => {
    assert.match(playerSource, /'aria-label': 'Full screen'/);
    assert.match(playerSource, /'aria-label': 'Captions'/);
    assert.match(playerSource, /'aria-label': 'Volume'/);
    assert.match(playerSource, /kind: 'subtitles'/);
});

test('scenes with captions carry a subtitle track into the story', () => {
    const story = timedStory();
    assert.equal(story.scenes.find(scene => scene.id === 'main').subtitles, '/subtitles/main.vtt');
    assert.equal(story.scenes.find(scene => scene.id === 'branch-a').subtitles, null);
});

test('srtToVtt converts SRT timestamps and leaves valid WebVTT untouched', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n';
    const vtt = srtToVtt(srt);
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /00:00:01\.000 --> 00:00:02\.500/);
    assert.ok(looksLikeValidCues(vtt));
    const already = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    assert.equal(srtToVtt(already).trim(), already.trim());
    assert.equal(looksLikeValidCues('WEBVTT\n\nno cues here'), false);
});
