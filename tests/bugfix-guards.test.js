// Guards for the 17 IMPROVEMENTS.md bug-round items.
// Most items were already fixed in the current source; these assertions lock
// the fixed state in so a future edit cannot silently reintroduce them.
// Items 6 and 11 had live defects at the time this file was added.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// The published player was rebuilt (public/player/*); the classic editor
// keeps the old studio UI, so its guards now read public/classic.html.
const player = read('public/player/mya-player.js');
const engineSource = read('public/player/story-core.js');
const Story = require('../public/player/story-core.js');
const server = read('server.js');
const index = read('public/classic.html');

function sliceBetween(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    assert.notEqual(start, -1, `marker not found: ${startMarker}`);
    const end = endMarker ? src.indexOf(endMarker, start) : src.length;
    return src.slice(start, end === -1 ? src.length : end);
}

// --- Item 1: a slow scene load can never overwrite a newer one
test('item 1: scene loads are tokenised so stale loads are ignored', () => {
    assert.match(player, /const token = \+\+transitionToken;/);
    assert.match(player, /if \(token !== transitionToken \|\| destroyed\) return;/);
});

// --- Item 2: analytics never break playback when the server is absent
test('item 2: analytics requests are fire-and-forget and only for published movies', () => {
    assert.match(player, /function trackChoice/);
    assert.match(player, /keepalive: true/);
    assert.match(player, /hosted elsewhere: analytics are optional/);
});

// --- Item 3: clip durations never call .toFixed on a null value
test('item 3: no bare c.duration.toFixed in templates', () => {
    assert.doesNotMatch(index, /{{\s*c\.duration\.toFixed/);
    assert.match(index, /\(c\.duration \|\| 0\)\.toFixed\(1\)/);
});

// --- Item 4: ffprobe path resolved for both export shapes
test('item 4: ffprobe path guarded before setFfprobePath', () => {
    assert.match(server, /typeof ffprobeStatic === 'string'/);
    assert.match(server, /if \(ffprobePath\) \{\s*ffmpeg\.setFfprobePath\(ffprobePath\);/);
});

// --- Item 5: no v-if and v-for on the same element
test('item 5: no v-if + v-for on the same element', () => {
    for (const line of index.split('\n')) {
        assert.doesNotMatch(line, /v-for="[^"]*"[^>]*v-if="|v-if="[^"]*"[^>]*v-for="/, `same-element v-if/v-for: ${line.trim().slice(0, 120)}`);
    }
    assert.match(index, /fullGraphNodes\.filter\(c => c\.unique_id !== this\.selectedBuilderNodeId\)/);
});

// --- Item 6: clipboard fallback failure must not report success
test('item 6: copyToClipboard reports failure when both copy paths fail', () => {
    const body = sliceBetween(index, 'async copyToClipboard(text) {', 'async testEventClip');
    assert.match(body, /document\.execCommand\('copy'\)/);
    // The fallback's own failure must show an error toast and return
    // BEFORE the success toast is reachable.
    const failAt = body.indexOf('Copy failed');
    const okAt = body.indexOf('ID Copied!');
    assert.ok(failAt !== -1, 'no failure toast in copyToClipboard');
    assert.ok(okAt !== -1, 'no success toast in copyToClipboard');
    assert.ok(failAt < okAt, 'failure toast must come before the success toast');
    const between = body.slice(failAt, okAt);
    assert.match(between, /return;/, 'failure path must return before the success toast');
});

// --- Item 7: toast timer cleared on unmount
test('item 7: toast timer cleared in beforeUnmount', () => {
    assert.match(index, /beforeUnmount\(\) \{ if \(this\._toastTimer\) clearTimeout\(this\._toastTimer\)/);
    assert.match(index, /showToast\(msg, type='success'\) \{ if \(this\._toastTimer\) clearTimeout\(this\._toastTimer\)/);
});

// --- Item 8: all-locked choices let the clip play through
test('item 8: an all-locked choice point is skipped instead of trapping the viewer', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 6, ending: { title: 'End' } }, { id: 'b', name: 'B', src: 'b.mp4', duration: 2 }],
        choicePoints: [{ id: 'p', sceneId: 'a', time: 3, choices: [{ id: 'x', label: 'Locked', to: 'b', requireFlag: 'never_set' }] }]
    });
    engine.start();
    assert.equal(engine.pointDue(3.2), null);
    assert.equal(engine.sceneEnded().type, 'end');
});

test('item 9: next-action index can only move forward in the sequence', () => {
    assert.match(index, /getNextSequenceClipId\(currentClipId\) \{[\s\S]*?if \(index >= 0 && index \+ 1 < sequence\.length\) return sequence\[index \+ 1\]\.id;/);
    const branch = sliceBetween(index, "if(choice.action === 'next') {", "const targetClip = this.clips.find");
    assert.match(branch, /getNextSequenceClipId\(/);
});

// --- Item 10: migrations only add columns absent from that table's CREATE TABLE
test('item 10: no migration re-adds a column from CREATE TABLE', () => {
    const tables = new Map();
    for (const m of server.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
        const cols = new Set();
        for (const col of m[2].split(',')) {
            const name = col.trim().split(/\s+/)[0];
            if (name) cols.add(name.toLowerCase());
        }
        tables.set(m[1].toLowerCase(), cols);
    }
    const migrations = [...server.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)];
    assert.ok(migrations.length > 0, 'no migrations found to check');
    for (const [, table, col] of migrations) {
        const cols = tables.get(table.toLowerCase()) || new Set();
        assert.ok(!cols.has(col.toLowerCase()), `migration re-adds existing column: ${table}.${col}`);
    }
});

// --- Item 11: no bare v.play() without .catch() in the preview engine
test('item 11: preview onPreviewTimeUpdate play() has a catch', () => {
    const body = sliceBetween(index, 'onPreviewTimeUpdate() {', 'makePreviewChoice(choice) {');
    assert.doesNotMatch(body, /v\.play\(\)(?!\s*\.catch)/);
});

// --- Item 12: editEvent resets the clip range to the full clip
test('item 12: editEvent sets clipStart 0 and clipEnd to duration', () => {
    const body = sliceBetween(index, 'editEvent(c) {', 'cancelEventEdit()');
    assert.match(body, /this\.clipStart = 0; this\.clipEnd = c\.duration \|\| 0;/);
});

// --- Item 13: .choice-card-overlay defined once, preview via modifier
test('item 13: single .choice-card-overlay base rule', () => {
    const count = (index.match(/\.choice-card-overlay \{/g) || []).length;
    assert.equal(count, 1, `expected 1 base rule, found ${count}`);
    assert.match(index, /\.choice-card-overlay\.is-preview/);
});

// --- Item 14: NOT A BUG — return_to_main is persisted per edge and used.
// Guard prevents a future "cleanup" from deleting it on the stale doc's say-so.
test('item 14: return_to_main is persisted by the server and read back', () => {
    assert.match(server, /return_to_main = \?/);
    assert.match(read('lib/story.js'), /returnHere: !!Number\(edge\.return_to_main\)/);
});

// --- Item 15: testEventClip refreshes data before filtering edges
test('item 15: testEventClip awaits refreshData before filtering', () => {
    const body = sliceBetween(index, 'async testEventClip(clip) {', 'onPreviewTimeUpdate');
    const refreshAt = body.indexOf('await this.refreshData();');
    const filterAt = body.indexOf('this.edges.filter');
    assert.ok(refreshAt !== -1 && filterAt !== -1 && refreshAt < filterAt, 'refreshData must run before edge filtering');
});

// --- Item 16: return time clamped inside the clip duration
test('item 16: returning from a detour never seeks past the end of the scene', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 5 }, { id: 'b', name: 'B', src: 'b.mp4', duration: 2 }],
        choicePoints: [{ id: 'p', sceneId: 'a', time: 4.95, choices: [{ id: 'x', label: 'Detour', to: 'b', returnHere: true }, { id: 'y', label: 'Stay', action: 'end' }] }]
    });
    engine.start();
    engine.pointDue(5);
    engine.choose('p', 'x');
    const back = engine.sceneEnded();
    assert.equal(back.sceneId, 'a');
    assert.ok(back.time <= 5 - 0.05, `resume time ${back.time} stays inside the scene`);
    assert.match(engineSource, /duration - 0\.05/);
});

test('item 17: no confirm() or alert() calls', () => {
    const studioFiles = fs.readdirSync(path.join(root, 'public', 'studio', 'components'))
        .map(file => [`studio/components/${file}`, read(`public/studio/components/${file}`)]);
    const files = [
        ['classic.html', index],
        ['player/mya-player.js', player],
        ['player/story-core.js', engineSource],
        ['studio/store.js', read('public/studio/store.js')],
        ['server.js', server],
        ...studioFiles
    ];
    for (const [name, src] of files) {
        // window.confirm / window.alert block the page; the studio uses its own dialogs.
        assert.doesNotMatch(src, /(?<![\w.])(confirm|alert)\s*\(/, `${name} still calls confirm()/alert()`);
    }
});
