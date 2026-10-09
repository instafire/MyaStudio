const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    classifyMediaUpload,
    isSafeExportName,
    isAllowedLocalOrigin,
    normalizeExportPosterPath,
    normalizePublicAssetPath,
    parsePort,
    resolveLoopbackHost,
    resolvePublicAssetPath,
    selectAllowedImportColumns,
    validateLocalRequestPolicy
} = require('../lib/security');

test('only explicit loopback hosts and valid TCP ports are accepted', () => {
    assert.equal(resolveLoopbackHost(undefined), '127.0.0.1');
    assert.equal(resolveLoopbackHost('localhost', 'FEED_HOST'), 'localhost');
    assert.equal(resolveLoopbackHost('[::1]'), '::1');
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.com', '']) {
        if (host === '') continue;
        assert.throws(() => resolveLoopbackHost(host), /loopback/);
    }
    assert.equal(parsePort('3000', 80), 3000);
    assert.equal(parsePort('', 3001), 3001);
    for (const port of ['0', '65536', '3.5', '-1', 'not-a-port']) {
        assert.throws(() => parsePort(port, 3000), /between 1 and 65535/);
    }
});

test('CORS permits only configured loopback origins and ports', () => {
    const ports = new Set([3000, 3001]);
    assert.equal(isAllowedLocalOrigin('http://127.0.0.1:3000', ports), true);
    assert.equal(isAllowedLocalOrigin('http://localhost:3001', ports), true);
    assert.equal(isAllowedLocalOrigin('http://[::1]:3000', ports), true);
    for (const origin of [
        'https://localhost:3000',
        'http://192.168.1.2:3000',
        'http://localhost:4444',
        'http://localhost.evil.example:3000',
        'null',
        'not a URL'
    ]) {
        assert.equal(isAllowedLocalOrigin(origin, ports), false, origin);
    }
});

test('state-changing API requests require local origins and JSON or approved media multipart bodies', () => {
    const allowedPorts = new Set([3000, 3001]);
    assert.deepEqual(validateLocalRequestPolicy({ method: 'GET', requestPath: '/api/projects', allowedPorts }), { allowed: true });
    assert.deepEqual(validateLocalRequestPolicy({
        origin: 'http://localhost:3000', method: 'POST', requestPath: '/api/projects',
        contentType: 'application/json; charset=utf-8', allowedPorts
    }), { allowed: true });
    assert.deepEqual(validateLocalRequestPolicy({
        method: 'POST', requestPath: '/api/upload', contentType: 'multipart/form-data; boundary=test', allowedPorts
    }), { allowed: true });
    assert.deepEqual(validateLocalRequestPolicy({
        method: 'POST', requestPath: '/api/clip/subtitle', contentType: 'multipart/form-data; boundary=test', allowedPorts
    }), { allowed: true });
    assert.equal(validateLocalRequestPolicy({
        origin: 'https://attacker.example', method: 'POST', requestPath: '/api/projects',
        contentType: 'application/json', allowedPorts
    }).status, 403);
    assert.equal(validateLocalRequestPolicy({
        method: 'POST', requestPath: '/api/projects', contentType: 'text/plain', allowedPorts
    }).status, 415);
    assert.equal(validateLocalRequestPolicy({
        method: 'POST', requestPath: '/api/projects', contentType: 'multipart/form-data; boundary=test', allowedPorts
    }).status, 415);
});

test('media uploads accept only supported extensions with matching media MIME types', () => {
    assert.deepEqual(classifyMediaUpload('movie.MP4', 'video/mp4'), { type: 'video', extension: '.mp4' });
    assert.deepEqual(classifyMediaUpload('track.wav', 'audio/wav'), { type: 'audio', extension: '.wav' });
    assert.deepEqual(classifyMediaUpload('movie.mp4', 'application/octet-stream'), { type: 'video', extension: '.mp4' });
    assert.equal(classifyMediaUpload('payload.html', 'text/html'), null);
    assert.equal(classifyMediaUpload('payload.mp4', 'text/html'), null);
    assert.equal(classifyMediaUpload('movie.mp4.exe', 'video/mp4'), null);
    assert.equal(classifyMediaUpload('track.mp3', 'video/mp4'), null);
    assert.equal(classifyMediaUpload('track.mp3', ''), null);
});

test('public media paths are normalized and confined to allowed folders', () => {
    const root = path.resolve('/srv/myastudio/public');
    assert.equal(normalizePublicAssetPath('/videos/a.mp4', ['videos']), '/videos/a.mp4');
    assert.equal(normalizePublicAssetPath('clips/sub/scene-1.mp4', ['clips']), '/clips/sub/scene-1.mp4');
    assert.equal(resolvePublicAssetPath(root, '/videos/a.mp4', ['videos']), path.join(root, 'videos', 'a.mp4'));
    for (const value of [
        '../.ai-settings.json',
        '/videos/../../.ai-settings.json',
        String.raw`\videos\..\..\.ai-settings.json`,
        '/.ai-settings.json',
        '/exports/story/index.html',
        '/videos/payload.html',
        '/audio/credentials.txt',
        '/videos/%2e%2e/secret',
        '/videos/a.mp4?download=1',
        '/videos'
    ]) {
        assert.throws(() => normalizePublicAssetPath(value), /Invalid public asset path/, value);
    }
    assert.throws(() => resolvePublicAssetPath(root, '/audio/song.mp3', ['videos']), /Invalid public asset path/);
});

test('project imports keep only known database columns', () => {
    assert.deepEqual(
        selectAllowedImportColumns('videos', {
            filename: 'take.mp4',
            filepath: '/videos/take.mp4',
            project_id: 99,
            id: 1,
            'filepath) VALUES (1); DROP TABLE projects; --': 'bad'
        }),
        { filename: 'take.mp4', filepath: '/videos/take.mp4', project_id: 99 }
    );
    assert.throws(() => selectAllowedImportColumns('metadata', { title: 'x' }), /Unsupported import table/);
    assert.deepEqual(selectAllowedImportColumns('projects', { title: 'x', 'title, id': 'bad' }), { title: 'x' });
    assert.throws(() => selectAllowedImportColumns('clips', []), /Invalid project import record/);
});

test('published feed metadata accepts only safe export names and image paths', () => {
    assert.equal(isSafeExportName('a_valid_export_2026'), true);
    assert.equal(isSafeExportName('../secret'), false);
    assert.equal(isSafeExportName('valid-export'), false);
    assert.equal(normalizeExportPosterPath('/clips/poster.webp'), 'clips/poster.webp');
    assert.equal(normalizeExportPosterPath('clips/cover.jpg'), 'clips/cover.jpg');
    for (const value of [
        '../index.html',
        'clips/../../.ai-settings.json',
        String.raw`clips\..\index.html`,
        'audio/sound.mp3',
        'clips/payload.html',
        'clips/poster.jpg?x=1'
    ]) {
        assert.equal(normalizeExportPosterPath(value), null, value);
    }
});
