// Legacy "jump after N seconds" clip timeouts and the studio's live preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storyLib = require('../lib/story');
const Story = require('../public/player/story-core.js');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const playerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'player', 'mya-player.js'), 'utf8');

function storyWithTimeout(timeout) {
    return storyLib.buildStory({
        project: { id: 3, title: 'Timeouts', start_clip_id: 'a' },
        clips: [
            { unique_id: 'a', name: 'Waiting room', filepath: '/clips/a.mp4', duration: 30, ...timeout },
            { unique_id: 'b', name: 'Too late', filepath: '/clips/b.mp4', duration: 4 }
        ],
        edges: []
    });
}

test('clip timeout fields become a scene timeout in the story', () => {
    const story = storyWithTimeout({ timeout_to_id: 'b', timeout_seconds: 6 });
    assert.deepEqual(story.scenes[0].timeout, { seconds: 6, to: 'b' });
});

test('scenes without a usable timeout never arm one', () => {
    assert.equal(storyWithTimeout({}).scenes[0].timeout, null);
    assert.equal(storyWithTimeout({ timeout_to_id: 'b', timeout_seconds: 0 }).scenes[0].timeout, null);
    assert.equal(storyWithTimeout({ timeout_to_id: 'missing', timeout_seconds: 5 }).scenes[0].timeout, null);
});

test('the engine follows a timeout to its target scene', () => {
    const engine = Story.createEngine(storyWithTimeout({ timeout_to_id: 'b', timeout_seconds: 6 }));
    engine.start();
    assert.equal(engine.followTimeout().sceneId, 'b');
});

test('the player arms the timeout per scene and only fires it on that scene', () => {
    const body = playerSource.slice(playerSource.indexOf('function startSceneTimeout'), playerSource.indexOf('function clearSceneTimeout'));
    assert.match(body, /if \(!scene\.timeout\) return;/);
    assert.match(body, /engine\.state\.sceneId !== sceneId/);
    assert.match(body, /run\(engine\.followTimeout\(\)\)/);
});

test('the studio preview serves the real player for the current project state', () => {
    assert.match(server, /app\.get\('\/preview\/:projectId'/);
    assert.match(server, /mode: 'preview'/);
    assert.match(server, /assetBase: '\/player\/'/);
});
