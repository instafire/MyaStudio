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
const player = read('lib/published-player.js');
const server = read('server.js');
const index = read('public/index.html');

function sliceBetween(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    assert.notEqual(start, -1, `marker not found: ${startMarker}`);
    const end = endMarker ? src.indexOf(endMarker, start) : src.length;
    return src.slice(start, end === -1 ? src.length : end);
}

// --- Item 1: loadClip clears the pending timeout before scheduling a new one
test('item 1: loadClip cancels the previous load timeout', () => {
    const body = sliceBetween(player, 'loadClip(id, forceTime = 0) {', 'onClipEnded()');
    assert.match(body, /if \(this\._loadTimeout\) clearTimeout\(this\._loadTimeout\);/);
    assert.match(body, /this\._loadTimeout = setTimeout\(/);
});

// --- Item 2: analytics events queue in localStorage and survive a failed flush
test('item 2: analytics queue is retained when the server rejects an event', () => {
    assert.match(player, /studio_analytics_/);
    assert.match(player, /Events stay queued for next attempt/);
    assert.match(player, /localStorage\.removeItem\(queueKey\)/);
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
test('item 8: all-locked choice block does not pause or show choices', () => {
    const body = sliceBetween(player, 'checkTime() {', 'makePreviewChoice');
    const m = body.match(/if \(unlocked\.length === 0\) \{([\s\S]*?)\n {24}\}/);
    assert.ok(m, 'all-locked branch not found');
    assert.match(m[1], /return;/);
    assert.doesNotMatch(m[1], /showChoices = true|v\.pause\(\)/);
});

// --- Item 9: 'next' advances forward only; no timeout-target index jump
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
    assert.match(server, /return: !!e\.return_to_main/);
});

// --- Item 15: testEventClip refreshes data before filtering edges
test('item 15: testEventClip awaits refreshData before filtering', () => {
    const body = sliceBetween(index, 'async testEventClip(clip) {', 'onPreviewTimeUpdate');
    const refreshAt = body.indexOf('await this.refreshData();');
    const filterAt = body.indexOf('this.edges.filter');
    assert.ok(refreshAt !== -1 && filterAt !== -1 && refreshAt < filterAt, 'refreshData must run before edge filtering');
});

// --- Item 16: return time clamped inside the clip duration
test('item 16: return time clamped below clip duration', () => {
    assert.match(player, /Math\.min\(\(this\.currentOptions\.time \|\| 0\) \+ 0\.1, \(this\.currentClip\.duration \|\| 999\) - 0\.1\)/);
});

// --- Item 17: no blocking confirm()/alert() dialogs
test('item 17: no confirm() or alert() calls', () => {
    for (const [name, src] of [['index.html', index], ['published-player.js', player], ['server.js', server]]) {
        assert.doesNotMatch(src, /\b(confirm|alert)\s*\(/, `${name} still calls confirm()/alert()`);
    }
});
