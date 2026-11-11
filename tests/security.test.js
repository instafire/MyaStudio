// Regression tests for GitHub issue #1: harden the local server and media
// handling. Pure-function unit tests for lib/security.js plus source guards
// (same style as tests/bugfix-guards.test.js) locking the server.js wiring
// in place, so a future edit cannot silently drop a guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const security = require('../lib/security');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function mockRes() {
    const res = {
        headers: {},
        statusCode: 200,
        body: null,
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; }
    };
    return res;
}

function sliceBetween(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    assert.notEqual(start, -1, `marker not found: ${startMarker}`);
    const end = endMarker ? src.indexOf(endMarker, start) : src.length;
    return src.slice(start, end === -1 ? src.length : end);
}

// --- Strict port parsing ---------------------------------------------------

test('parsePort accepts valid ports and falls back when unset', () => {
    assert.equal(security.parsePort('3000', 'PORT', 3000), 3000);
    assert.equal(security.parsePort(' 3001 ', 'PORT', 3000), 3001);
    assert.equal(security.parsePort(undefined, 'PORT', 3000), 3000);
    assert.equal(security.parsePort('', 'PORT', 3000), 3000);
    assert.equal(security.parsePort('65535', 'PORT', 3000), 65535);
});

test('parsePort rejects non-decimal and out-of-range ports', () => {
    for (const bad of ['abc', '3000abc', '3.5', '0x10', '0', '65536', '-1']) {
        assert.throws(() => security.parsePort(bad, 'PORT', 3000), /PORT/, `accepted: ${JSON.stringify(bad)}`);
    }
});

// --- Loopback-only listeners ------------------------------------------------

test('parseLoopbackHost accepts loopback addresses and defaults when unset', () => {
    assert.equal(security.parseLoopbackHost('127.0.0.1', 'HOST', '127.0.0.1'), '127.0.0.1');
    assert.equal(security.parseLoopbackHost('localhost', 'HOST', '127.0.0.1'), 'localhost');
    assert.equal(security.parseLoopbackHost('::1', 'HOST', '127.0.0.1'), '::1');
    assert.equal(security.parseLoopbackHost(undefined, 'HOST', '127.0.0.1'), '127.0.0.1');
});

test('parseLoopbackHost rejects wildcard and LAN addresses', () => {
    for (const bad of ['0.0.0.0', '::', '192.168.1.5', '10.0.0.1', 'example.com']) {
        assert.throws(() => security.parseLoopbackHost(bad, 'HOST', '127.0.0.1'), /loopback/, `accepted: ${bad}`);
    }
});

// --- Trusted Origins ---------------------------------------------------------

test('parseTrustedOrigins parses a list and rejects garbage', () => {
    const set = security.parseTrustedOrigins('https://myastudio.genznewz.com, HTTP://Example.com:8080/ ');
    assert.equal(set.size, 2);
    assert.ok(set.has('https://myastudio.genznewz.com'));
    assert.ok(set.has('http://example.com:8080'));
    assert.equal(security.parseTrustedOrigins('').size, 0);
    assert.equal(security.parseTrustedOrigins(undefined).size, 0);
    assert.throws(() => security.parseTrustedOrigins('not a url'), /TRUSTED_ORIGINS/);
});

test('isTrustedOrigin allows missing and loopback Origins only by default', () => {
    const none = new Set();
    assert.equal(security.isTrustedOrigin(undefined, none), true);
    assert.equal(security.isTrustedOrigin(null, none), true);
    assert.equal(security.isTrustedOrigin('http://127.0.0.1:3000', none), true);
    assert.equal(security.isTrustedOrigin('http://localhost:3001', none), true);
    assert.equal(security.isTrustedOrigin('http://[::1]:3000', none), true);
    assert.equal(security.isTrustedOrigin('https://myastudio.genznewz.com', none), false);
});

test('isTrustedOrigin rejects lookalike hosts and honors the allowlist', () => {
    const allowed = security.parseTrustedOrigins('https://myastudio.genznewz.com');
    assert.equal(security.isTrustedOrigin('https://myastudio.genznewz.com', allowed), true);
    assert.equal(security.isTrustedOrigin('http://127.0.0.1.evil.example', allowed), false);
    assert.equal(security.isTrustedOrigin('https://myastudio.genznewz.com.evil.example', allowed), false);
    assert.equal(security.isTrustedOrigin('https://evil.example', allowed), false);
});

test('corsOriginChecker allows loopback, rejects hostile Origins with 403', () => {
    const checker = security.corsOriginChecker(new Set());
    let ok;
    checker(undefined, (err, result) => { ok = !err && result; });
    assert.equal(ok, true);
    checker('http://127.0.0.1:3000', (err, result) => { ok = !err && result; });
    assert.equal(ok, true);
    let seen;
    checker('https://evil.example', (err) => { seen = err; });
    assert.ok(seen, 'hostile Origin was not rejected');
    assert.equal(seen.statusCode, 403);
});

// --- Security headers ---------------------------------------------------------

test('securityHeaders sets the standard headers with a same-origin CSP', () => {
    const res = mockRes();
    let nextCalled = false;
    security.securityHeaders({}, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['referrer-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.match(res.headers['content-security-policy'], /object-src 'none'/);
    assert.doesNotMatch(res.headers['content-security-policy'], /https:\/\/(?!fonts\.g)/);
});

// --- Mutation content types ----------------------------------------------------

test('requireMutationContentType rejects text/plain and form bodies on mutations', () => {
    for (const ct of ['text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded']) {
        const res = mockRes();
        let nextCalled = false;
        security.requireMutationContentType(
            { method: 'POST', headers: { 'content-type': ct } }, res, () => { nextCalled = true; }
        );
        assert.equal(nextCalled, false, `allowed: ${ct}`);
        assert.equal(res.statusCode, 415);
        assert.match(res.body.error, /JSON or multipart/);
    }
});

test('requireMutationContentType allows JSON, multipart, bodyless posts, and reads', () => {
    for (const req of [
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' } },
        { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=----x' } },
        { method: 'POST', headers: {} },
        { method: 'PUT', headers: { 'content-type': 'application/json' } },
        { method: 'GET', headers: { 'content-type': 'text/plain' } }
    ]) {
        const res = mockRes();
        let nextCalled = false;
        security.requireMutationContentType(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true, `blocked: ${req.method} ${req.headers['content-type'] || '(none)'}`);
    }
});

// --- Confined paths ---------------------------------------------------------------

test('resolveConfinedPath resolves normal paths inside the root', () => {
    const publicRoot = path.join(root, 'public');
    assert.equal(
        security.resolveConfinedPath(publicRoot, '/videos/clip.mp4'),
        path.join(publicRoot, 'videos', 'clip.mp4')
    );
    assert.equal(
        security.resolveConfinedPath(publicRoot, 'thumbnails/a.jpg'),
        path.join(publicRoot, 'thumbnails', 'a.jpg')
    );
});

test('resolveConfinedPath rejects traversal, absolute escapes, and NUL bytes', () => {
    const publicRoot = path.join(root, 'public');
    for (const bad of ['../../etc/passwd', 'videos/../../etc/passwd', '/../../etc/passwd', 'a\0b', '..']) {
        assert.throws(() => security.resolveConfinedPath(publicRoot, bad), /media path/i, `accepted: ${JSON.stringify(bad)}`);
    }
    // A leading slash alone is stripped (stored web paths start with one),
    // but the result must still stay inside the root.
    assert.equal(
        security.resolveConfinedPath(publicRoot, '/videos/x.mp4'),
        path.join(publicRoot, 'videos', 'x.mp4')
    );
});

// --- Upload validation --------------------------------------------------------------

test('validateMediaUpload accepts video and audio by extension', () => {
    assert.deepEqual(
        security.validateMediaUpload({ originalname: 'clip.mp4', mimetype: 'video/mp4' }),
        { kind: 'video', ext: '.mp4' }
    );
    assert.deepEqual(
        security.validateMediaUpload({ originalname: 'song.MP3', mimetype: 'audio/mpeg' }),
        { kind: 'audio', ext: '.mp3' }
    );
    // No MIME type from the client: the extension alone decides.
    assert.deepEqual(
        security.validateMediaUpload({ originalname: 'take.mov', mimetype: '' }),
        { kind: 'video', ext: '.mov' }
    );
    // Unknown MIME type (curl and some browsers send octet-stream for
    // media): accepted — ffprobe rejects non-media content downstream.
    assert.deepEqual(
        security.validateMediaUpload({ originalname: 'clip.mp4', mimetype: 'application/octet-stream' }),
        { kind: 'video', ext: '.mp4' }
    );
});

test('validateMediaUpload rejects executables, pages, and extensionless files', () => {
    for (const name of ['setup.exe', 'page.html', 'script.js', 'archive.zip', 'noext', 'clip.mp4.exe']) {
        assert.throws(
            () => security.validateMediaUpload({ originalname: name, mimetype: 'video/mp4' }),
            /Unsupported media type/, `accepted: ${name}`
        );
    }
});

test('validateMediaUpload rejects MIME family mismatches and non-media MIME types', () => {
    assert.throws(
        () => security.validateMediaUpload({ originalname: 'clip.mp4', mimetype: 'audio/mpeg' }),
        /does not match/
    );
    assert.throws(
        () => security.validateMediaUpload({ originalname: 'clip.mp4', mimetype: 'application/pdf' }),
        /Unsupported media MIME type/
    );
    assert.throws(
        () => security.validateMediaUpload({ originalname: 'clip.mp4', mimetype: 'application/x-msdownload' }),
        /Unsupported media MIME type/
    );
    assert.throws(
        () => security.validateMediaUpload({ originalname: 'song.mp3', mimetype: 'text/html' }),
        /Unsupported media MIME type/
    );
});

test('validateSubtitleUpload accepts only .vtt and .srt', () => {
    assert.deepEqual(security.validateSubtitleUpload({ originalname: 'caps.vtt' }), { ext: '.vtt' });
    assert.deepEqual(security.validateSubtitleUpload({ originalname: 'caps.SRT' }), { ext: '.srt' });
    for (const name of ['caps.txt', 'caps.mp4', 'caps.vtt.exe', 'caps']) {
        assert.throws(() => security.validateSubtitleUpload({ originalname: name }), /Only \.vtt and \.srt/, `accepted: ${name}`);
    }
});

// --- Import columns and references ------------------------------------------------------

test('pickAllowedColumns drops unknown and injection-style columns', () => {
    const picked = security.pickAllowedColumns('clips', {
        unique_id: 'abc',
        name: 'Scene',
        filepath: '/clips/a.mp4',
        evil: 1,
        'x); DROP TABLE clips; --': 1,
        'id': 9
    });
    assert.deepEqual(Object.keys(picked).sort(), ['filepath', 'id', 'name', 'unique_id']);
    assert.equal(picked.name, 'Scene');
});

test('pickAllowedColumns rejects unknown tables', () => {
    assert.throws(() => security.pickAllowedColumns('sqlite_master', { name: 'x' }), /Unknown import table/);
});

test('remapImportedReference nulls dangling references instead of keeping them', () => {
    const map = new Map([['old-1', 'new-1']]);
    assert.equal(security.remapImportedReference(map, 'old-1'), 'new-1');
    assert.equal(security.remapImportedReference(map, 'old-999'), null);
    assert.equal(security.remapImportedReference(map, null), null);
    assert.equal(security.remapImportedReference(map, ''), null);
    assert.equal(security.remapImportedReference(map, undefined), null);
});

// --- Error sanitization -----------------------------------------------------------------

test('sanitizeErrorMessage hides 5xx detail but keeps 4xx messages', () => {
    const internal = new Error("SQLITE_ERROR: no such table: clips\n    at Database.<anonymous> (/secret/path/db.js:12:3)");
    internal.statusCode = 500;
    assert.equal(security.sanitizeErrorMessage(internal, 'Server error'), 'Server error');
    const client = new Error('Project not found');
    client.statusCode = 404;
    assert.equal(security.sanitizeErrorMessage(client, 'Server error'), 'Project not found');
    assert.equal(security.sanitizeErrorMessage(new Error('boom'), 'Server error'), 'Server error');
});

// --- Export / poster metadata ----------------------------------------------------------------

test('validateExportName accepts safe names and rejects traversals', () => {
    assert.equal(security.validateExportName('my_movie_1'), true);
    assert.equal(security.validateExportName('MyMovie'), true);
    for (const bad of ['../etc', 'a/b', 'a b', '', 'a-b', 'a.b']) {
        assert.equal(security.validateExportName(bad), false, `accepted: ${JSON.stringify(bad)}`);
    }
});

test('validatePosterPath accepts safe image paths and rejects the rest', () => {
    assert.equal(security.validatePosterPath('clips/poster.jpg'), true);
    assert.equal(security.validatePosterPath('thumbnails/a.png'), true);
    for (const bad of ['../secret.jpg', '/abs.jpg', 'clips/x.exe', 'clips/x.svg', 'a\\b.jpg', '', 'clips/../../etc.jpg']) {
        assert.equal(security.validatePosterPath(bad), false, `accepted: ${JSON.stringify(bad)}`);
    }
});

// --- Server wiring guards ---------------------------------------------------------------------

test('server parses HOST/PORT strictly at startup', () => {
    assert.match(server, /security\.parseLoopbackHost\(process\.env\.HOST/);
    assert.match(server, /security\.parseLoopbackHost\(process\.env\.FEED_HOST/);
    assert.match(server, /security\.parsePort\(process\.env\.PORT/);
    assert.match(server, /security\.parsePort\(process\.env\.FEED_PORT/);
    assert.doesNotMatch(server, /Number\(process\.env\.PORT/);
    assert.doesNotMatch(server, /Number\(process\.env\.FEED_PORT/);
    assert.match(server, /Refusing to start/);
});

test('server uses restricted CORS on both apps, never bare cors()', () => {
    assert.doesNotMatch(server, /app\.use\(cors\(\)\)/);
    assert.doesNotMatch(server, /feedApp\.use\(cors\(\)\)/);
    assert.match(server, /cors\(\{ origin: security\.corsOriginChecker\(TRUSTED_ORIGINS\) \}\)/);
});

test('server applies security headers and mutation content-type checks on both apps', () => {
    assert.match(server, /app\.use\(security\.securityHeaders\)/);
    assert.match(server, /feedApp\.use\(security\.securityHeaders\)/);
    assert.match(server, /app\.use\('\/api', security\.requireMutationContentType/);
    assert.match(server, /feedApp\.use\('\/api', security\.requireMutationContentType/);
});

test('upload routes validate media and subtitle types through lib/security', () => {
    assert.match(server, /security\.validateMediaUpload\(file\)/);
    assert.match(server, /security\.validateMediaUpload\(\{ originalname: fileName, mimetype: body\.mimeType \}\)/);
    assert.match(server, /security\.validateSubtitleUpload\(file\)/);
});

test('buildInsertStatement filters imported rows through the column whitelist', () => {
    const body = sliceBetween(server, 'function buildInsertStatement(', 'function safeExportFolderName');
    assert.match(body, /security\.pickAllowedColumns\(table,/);
});

test('project import drops edges from unimported clips and nulls dangling targets', () => {
    const body = sliceBetween(server, "app.post('/api/project/import'", "app.post('/api/clip/reencode'");
    assert.match(body, /remapImportedReference\(sourceClipIdMap, edge\.from_id\)/);
    assert.match(body, /if \(!fromId\) continue;/);
    assert.match(body, /remapImportedReference\(sourceClipIdMap, edge\.to_id\)/);
    assert.doesNotMatch(body, /\|\| edge\.from_id/);
    assert.doesNotMatch(body, /\|\| edge\.to_id/);
});

test('project duplicate nulls references that do not survive the copy', () => {
    const body = sliceBetween(server, "app.post('/api/project/duplicate'", "app.post('/api/project/rename'");
    assert.doesNotMatch(body, /\|\| clip\.timeout_to_id/);
    assert.doesNotMatch(body, /\|\| edge\.to_id/);
});

test('subtitle upload updates the database before removing old captions', () => {
    const body = sliceBetween(server, "app.post('/api/clip/subtitle'", "app.post('/api/clip/subtitle/delete'");
    const updateAt = body.indexOf('UPDATE clips SET subtitle_path = ?');
    const removeAt = body.indexOf('resolvePublicPath(path.join(__dirname, \'public\'), previousPath)');
    assert.ok(updateAt !== -1 && removeAt !== -1 && updateAt < removeAt,
        'old subtitle file must only be removed after the database points at the new one');
    assert.match(body, /stillReferenced/);
    assert.match(body, /committed = true/);
    assert.match(body, /if \(req\.file && !committed\)/);
});

test('subtitle delete clears the database reference before removing the file', () => {
    const body = sliceBetween(server, "app.post('/api/clip/subtitle/delete'", "app.get('/api/story'");
    const updateAt = body.indexOf('UPDATE clips SET subtitle_path = NULL');
    const removeAt = body.indexOf('resolvePublicPath(path.join(__dirname, \'public\'), previousPath)');
    assert.ok(updateAt !== -1 && removeAt !== -1 && updateAt < removeAt,
        'subtitle file must only be removed after the database reference is cleared');
    assert.match(body, /stillReferenced/);
});

test('error paths sanitize unexpected server errors', () => {
    const handler = sliceBetween(server, 'app.use((err, req, res, next) => {', 'const server = app.listen');
    assert.match(handler, /statusCode >= 500 \? 'Server error'/);
    assert.doesNotMatch(handler, /error: err\.message/);
    const send = sliceBetween(server, 'function sendApiError(', 'function normalizeFilter');
    assert.match(send, /statusCode >= 500 \? fallback/);
});

test('stored export and poster metadata are validated before use', () => {
    assert.match(server, /security\.validateExportName\(row\.export_name\)/);
    assert.match(server, /security\.validatePosterPath\(row\.poster_path\)/);
    assert.match(server, /resolveConfinedPath\(path\.join\(exportDir, exportName\), row\.poster_path\)/);
});

test('npm test runs the security suite', () => {
    assert.match(pkg.scripts.test, /tests\/security\.test\.js/);
});
