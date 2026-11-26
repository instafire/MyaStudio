// Published movie page + story building from database rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    buildPlayerPageHtml,
    collectReachableClipIds,
    serializeInlineJson,
    PLAYER_ASSET_FILES
} = require('../lib/published-player');
const storyLib = require('../lib/story');
const Story = require('../public/player/story-core.js');

const playerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'player', 'mya-player.js'), 'utf8');

const rows = {
    project: { id: 7, title: 'The <Two> Doors', synopsis: 'Pick a door & see', genre: 'Mystery', theme_color: '#22c55e', start_clip_id: 'hall' },
    clips: [
        { unique_id: 'hall', name: 'Hallway', filepath: '/clips/hall.mp4', thumbnail: '/thumbnails/hall.jpg', duration: 8, subtitle_path: '/subtitles/hall.vtt', bg_music: '/audio/theme.mp3', mute_audio: 0 },
        { unique_id: 'red', name: 'Red door', filepath: '/clips/red.mp4', thumbnail: '/thumbnails/red.jpg', duration: 5, is_ending: 1, ending_title: 'Through the red door' },
        { unique_id: 'garden', name: 'Garden', filepath: '/clips/garden.mp4', duration: 5, next_clip_id: 'red' },
        { unique_id: 'unused', name: 'FULL: holiday.mp4', filepath: '/videos/holiday.mp4', duration: 40 }
    ],
    edges: [
        { id: 2, from_id: 'hall', to_id: 'garden', label: 'Garden', trigger_time: 4, logic_id: 'pt1', time_limit: 10, is_default: 1, shuffle_choices: 1, pause_on_show: 0, prompt: 'Which way?', action_type: 'target', return_to_main: 0 },
        { id: 1, from_id: 'hall', to_id: 'red', label: 'Red door', trigger_time: 4, logic_id: 'pt1', time_limit: 10, is_default: 0, shuffle_choices: 1, prompt: 'Which way?', action_type: 'target', return_to_main: 0, set_var: 'brave' },
        { id: 3, from_id: 'red', to_id: null, label: 'Give up', trigger_time: 4.8, logic_id: null, action_type: 'end' }
    ]
};

test('buildStory groups edges into choice points and maps every field', () => {
    const story = storyLib.buildStory(rows);
    assert.equal(story.startSceneId, 'hall');
    assert.equal(story.themeColor, '#22c55e');
    const point = story.choicePoints.find(item => item.id === 'pt1');
    assert.equal(point.sceneId, 'hall');
    assert.equal(point.time, 4);
    assert.equal(point.timeLimit, 10);
    assert.equal(point.shuffle, true);
    assert.equal(point.prompt, 'Which way?');
    // Choices keep their creation order (edge id), not the query order.
    assert.deepEqual(point.choices.map(choice => choice.label), ['Red door', 'Garden']);
    assert.equal(point.choices[1].isDefault, true);
    assert.equal(point.choices[0].setFlag, 'brave');
    const legacy = story.choicePoints.find(item => item.sceneId === 'red');
    assert.match(legacy.id, /^legacy_red_/);
    assert.equal(legacy.choices[0].action, 'end');
    const red = story.scenes.find(scene => scene.id === 'red');
    assert.deepEqual(red.ending, { title: 'Through the red door' });
    assert.equal(story.scenes.find(scene => scene.id === 'garden').next, 'red');
    assert.equal(story.scenes.find(scene => scene.id === 'hall').subtitles, '/subtitles/hall.vtt');
    // Source clips read like videos, not like "FULL: file.mp4".
    assert.equal(story.scenes.find(scene => scene.id === 'unused').name, 'holiday');
});

test('reachableOnly keeps just what a viewer can reach from the start scene', () => {
    const story = storyLib.reachableOnly(storyLib.buildStory(rows));
    assert.deepEqual(story.scenes.map(scene => scene.id).sort(), ['garden', 'hall', 'red']);
    const assets = storyLib.collectAssets(story).map(asset => asset.path);
    assert.ok(assets.includes('/clips/hall.mp4'));
    assert.ok(assets.includes('/audio/theme.mp3'));
    assert.ok(!assets.includes('/videos/holiday.mp4'));
});

test('mapStoryAssets rewrites every media path for the export folder', () => {
    const story = storyLib.reachableOnly(storyLib.buildStory(rows));
    const mapped = storyLib.mapStoryAssets(story, (webPath, kind) => `${kind === 'audio' ? 'audio' : 'clips'}/${path.basename(webPath)}`);
    const hall = mapped.scenes.find(scene => scene.id === 'hall');
    assert.equal(hall.src, 'clips/hall.mp4');
    assert.equal(hall.music, 'audio/theme.mp3');
    assert.equal(hall.subtitles, 'clips/hall.vtt');
    // The original story is untouched.
    assert.equal(story.scenes.find(scene => scene.id === 'hall').src, '/clips/hall.mp4');
});

test('serializeInlineJson escapes HTML-breaking characters for inline scripts', () => {
    const json = serializeInlineJson({ label: '</script><script>alert(1)</script>', amp: 'a & b', sep: '\u2028' });
    assert.doesNotMatch(json, /<\/script>/i);
    assert.doesNotMatch(json, /</);
    assert.match(json, /\\u003C\/script\\u003E/);
    assert.deepEqual(JSON.parse(json).label, '</script><script>alert(1)</script>');
});

test('the published page embeds the story safely and loads the shared player', () => {
    const story = storyLib.buildStory(rows);
    story.scenes[0].name = '</script><img src=x onerror=alert(1)>';
    const html = buildPlayerPageHtml({ story, assetBase: 'player/', mode: 'published', storageKey: 'two_doors', analytics: true, posterUrl: 'clips/hall.jpg' });
    assert.match(html, /<title>The &lt;Two&gt; Doors<\/title>/);
    assert.match(html, /<meta property="og:image" content="clips\/hall\.jpg">/);
    assert.match(html, /<script id="mya-story" type="application\/json">/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /data-mode="published"/);
    assert.match(html, /data-storage-key="two_doors"/);
    assert.match(html, /data-analytics="1"/);
    assert.match(html, /<link rel="manifest" href="manifest.json">/);
    for (const file of PLAYER_ASSET_FILES) assert.ok(html.includes(`player/${file}`), `${file} is referenced`);
    const json = html.split('<script id="mya-story" type="application/json">')[1].split('</script>')[0];
    const parsed = JSON.parse(json);
    assert.equal(parsed.scenes[0].name, '</script><img src=x onerror=alert(1)>');
});

test('the preview page plays from a chosen scene without a manifest or analytics', () => {
    const story = storyLib.buildStory(rows);
    const html = buildPlayerPageHtml({ story, assetBase: '/player/', mode: 'preview', startSceneId: 'garden', manifest: false });
    assert.match(html, /data-mode="preview"/);
    assert.match(html, /data-start-scene="garden"/);
    assert.doesNotMatch(html, /data-analytics/);
    assert.doesNotMatch(html, /manifest\.json/);
    assert.match(html, /src="\/player\/story-core\.js"/);
});

test('every player asset file ships in public/player', () => {
    for (const file of PLAYER_ASSET_FILES) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'player', file)), `${file} exists`);
    }
});

test('the player is accessible and keyboard friendly', () => {
    assert.match(playerSource, /aria-live/);
    assert.match(playerSource, /role: 'group', 'aria-label': 'Choices'/);
    assert.match(playerSource, /\/\^\[1-9\]\$\/\.test\(key\)/, 'number keys pick choices');
    assert.match(playerSource, /case 'b':/, 'B goes back to the previous choice');
    assert.match(playerSource, /toggleCaptions/);
    assert.match(playerSource, /toggleFullscreen/);
    assert.match(playerSource, /Back to last choice/);
    assert.match(playerSource, /Watch again/);
});

test('the player only reports viewer choices for published, analytics-enabled movies', () => {
    const body = playerSource.slice(playerSource.indexOf('function trackChoice'), playerSource.indexOf('// ---- Start / end screens'));
    assert.match(body, /if \(isPreview \|\| !opts\.analytics/);
    assert.match(body, /keepalive: true/);
    assert.match(body, /\.catch\(/);
});

test('the player holds the last frame while choices are open and keeps decisions unskippable', () => {
    assert.match(playerSource, /choice\.holding = true/);
    assert.match(playerSource, /engine\.pointDue\(/);
    assert.match(playerSource, /engine\.sceneEnded\(\)/);
});

test('collectReachableClipIds (legacy helper) follows target edges only', () => {
    const reachable = collectReachableClipIds([{ id: 'a' }], [
        { from_id: 'a', to_id: 'b', action_type: 'target' },
        { from_id: 'b', to_id: 'c' },
        { from_id: 'a', to_id: 'z', action_type: 'end' },
        { from_id: 'x', to_id: 'y', action_type: 'target' }
    ]);
    assert.deepEqual([...reachable].sort(), ['a', 'b', 'c']);
});

test('stories built from rows pass the same story check the studio shows', () => {
    const story = storyLib.reachableOnly(storyLib.buildStory(rows));
    const result = Story.analyzeStory(story);
    assert.equal(result.errors, 0);
    assert.equal(result.stats.reachableScenes, 3);
});
