// Regression tests for the Nov 27, 2026 fix round (Jev-ranked, startup
// reconciliation first): non-destructive boot, chunked-upload integrity,
// JSON body limit, choice-tile artwork fallback, 2-clip MP4 crossfade,
// configurable OpenAI-compatible base URL, surfaced ffmpeg errors,
// dead /api/ai/generate removal, dead clips columns removal.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const root = path.join(__dirname, '..');
const port = 4300 + Math.floor(Math.random() * 1500);
const base = `http://127.0.0.1:${port}`;
const feedBase = `http://127.0.0.1:${port + 1}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mya-fixes-'));
const dbPath = path.join(tmpDir, 'test.sqlite');
const aiSettingsPath = path.join(root, '.ai-settings.json');
let aiSettingsBackup = null;
let server;
let db;
const createdProjects = new Set();
const createdExports = new Set();
const createdLinearExports = new Set();

async function api(method, url, body, origin = base) {
    const init = { method, headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(origin + url, init);
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: response.status, data, headers: response.headers };
}

function probeDuration(file) {
    const out = execFileSync(ffprobePath, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'csv=p=0', file
    ], { encoding: 'utf8' });
    return Number(out.trim());
}

function probeHasAudio(file) {
    const out = execFileSync(ffprobePath, [
        '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file
    ], { encoding: 'utf8' });
    return out.includes('audio');
}

function makeClip(file, { audio = false, dur = 2 } = {}) {
    const args = ['-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `color=c=red:s=320x180:d=${dur}:r=25`];
    if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:d=${dur}`);
    args.push('-shortest', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p');
    if (audio) args.push('-c:a', 'aac');
    args.push('-y', file);
    execFileSync(ffmpegPath, args);
}

test.before(async () => {
    // .ai-settings.json is a live repo file (gitignored); back it up so the
    // settings test can never leave test values behind.
    aiSettingsBackup = fs.existsSync(aiSettingsPath)
        ? { exists: true, content: fs.readFileSync(aiSettingsPath, 'utf8') }
        : { exists: false, content: null };

    // Pre-seed a database in the OLD shape: clips table WITH the dead
    // columns, plus rows whose files are missing from disk, so boot must
    // migrate the schema and reconcile without deleting anything.
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec(`CREATE TABLE clips (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT UNIQUE, project_id INTEGER, name TEXT, filepath TEXT, thumbnail TEXT, source_video_id INTEGER, duration REAL, start_time REAL DEFAULT 0, end_time REAL, logic_name TEXT, timeout_to_id TEXT, timeout_seconds REAL, bg_music TEXT, bg_music_url TEXT, mute_audio INTEGER DEFAULT 0, is_event_clip INTEGER DEFAULT 0, x REAL DEFAULT 0, y REAL DEFAULT 0, builder_visible INTEGER DEFAULT 0);`);
    await db.exec(`CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, filename TEXT, filepath TEXT, thumbnail TEXT, duration REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    await db.exec(`CREATE TABLE published_movies (id INTEGER PRIMARY KEY AUTOINCREMENT, export_name TEXT UNIQUE, project_id INTEGER, title TEXT, synopsis TEXT DEFAULT '', genre TEXT DEFAULT 'Interactive story', poster_path TEXT, theme_color TEXT DEFAULT '#3b82f6', clip_count INTEGER DEFAULT 0, choice_count INTEGER DEFAULT 0, duration REAL DEFAULT 0, view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, published_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    await db.run(
        `INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, duration, logic_name, bg_music_url, builder_visible)
         VALUES (?, 1, 'Ghost scene', '/clips/does-not-exist.mp4', NULL, 5, 'old-logic', 'https://example.invalid/music.mp3', 1)`,
        ['ghost-clip-id']
    );
    await db.run(
        `INSERT INTO videos (project_id, filename, filepath, thumbnail, duration)
         VALUES (1, 'ghost.mp4', '/videos/does-not-exist.mp4', NULL, 5)`
    );
    await db.run(
        `INSERT INTO published_movies (export_name, project_id, title) VALUES ('ghost_movie', 1, 'Ghost Movie')`
    );

    server = spawn(process.execPath, ['server.js'], {
        cwd: root,
        env: { ...process.env, PORT: String(port), FEED_PORT: String(port + 1), MYA_DB_PATH: dbPath },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 20000);
        server.stdout.on('data', chunk => {
            if (String(chunk).includes('MyaStudio Ready')) { clearTimeout(timer); resolve(); }
        });
        server.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited with ${code}`)); });
    });
});

test.after(async () => {
    for (const name of createdExports) await api('POST', '/api/delete_export', { name }).catch(() => {});
    for (const id of createdProjects) await api('POST', '/api/project/delete', { id }).catch(() => {});
    for (const file of createdLinearExports) fs.rmSync(file, { force: true });
    if (server) server.kill();
    if (db) await db.close().catch(() => {});
    if (aiSettingsBackup) {
        if (aiSettingsBackup.exists) fs.writeFileSync(aiSettingsPath, aiSettingsBackup.content);
        else fs.rmSync(aiSettingsPath, { force: true });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('2a: dead clips columns are dropped from an existing database', async () => {
    const columns = await db.all('PRAGMA table_info(clips)');
    const names = columns.map(column => column.name);
    assert.ok(!names.includes('logic_name'), 'logic_name is gone');
    assert.ok(!names.includes('bg_music_url'), 'bg_music_url is gone');
    assert.ok(names.includes('bg_music'), 'bg_music (live) survives');
    assert.ok(names.includes('timeout_to_id'), 'timeout_to_id survives');
});

test('2g: startup reconciliation keeps rows for missing files and reports them', async () => {
    const clip = await db.get('SELECT * FROM clips WHERE unique_id = ?', ['ghost-clip-id']);
    assert.ok(clip, 'clip row survives boot despite its missing file');
    const video = await db.get('SELECT * FROM videos WHERE filepath = ?', ['/videos/does-not-exist.mp4']);
    assert.ok(video, 'video row survives boot despite its missing file');
    const published = await db.get('SELECT * FROM published_movies WHERE export_name = ?', ['ghost_movie']);
    assert.ok(published, 'published row survives boot despite its missing folder');

    const report = await api('GET', '/api/reconciliation');
    assert.equal(report.status, 200);
    assert.ok(report.data.checkedAt, 'the report is timestamped');
    assert.ok(report.data.missingClips.includes('ghost-clip-id'));
    assert.ok(report.data.missingVideos.includes(video.id));
    assert.ok(report.data.missingPublished.includes('ghost_movie'));

    const feed = await api('GET', '/api/feed/items', undefined, feedBase);
    assert.equal(feed.status, 200);
    assert.ok(!feed.data.items.some(item => item.exportName === 'ghost_movie'),
        'a kept row with no folder stays out of the feed instead of linking at a dead export');
});

test('2f: a JSON body over the old 100KB default is accepted', async () => {
    const big = await api('POST', '/api/projects', { title: 'Big body project', padding: 'x'.repeat(200 * 1024) });
    assert.equal(big.status, 200, JSON.stringify(big.data));
    assert.ok(Number.isInteger(big.data.projectId), 'project was created');
    createdProjects.add(big.data.projectId);
});

test('2b: POST /api/ai/generate is gone', async () => {
    const res = await api('POST', '/api/ai/generate', { premise: 'A door' });
    assert.equal(res.status, 404);
});

test('1: already-fixed Nov 27 items are still present', () => {
    const feed = fs.readFileSync(path.join(root, 'public/feed/index.html'), 'utf8');
    assert.ok(feed.split('\n').length > 700, 'feed page is the rebuilt complete page');
    const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(serverSrc, /feedApp\.use\('\/exports'/, 'feed app serves /exports');
    const player = fs.readFileSync(path.join(root, 'public/player/mya-player.js'), 'utf8');
    assert.match(player, /s left/, 'player shows countdown seconds');
    const core = fs.readFileSync(path.join(root, 'public/player/story-core.js'), 'utf8');
    assert.match(core, /long-quiet-scene/, 'long-quiet-scene story check exists');
});

test('3: choice images fall back to the target scene poster', async () => {
    const storyLib = require('../lib/story');
    const story = storyLib.buildStory({
        project: { id: 1, title: 'Fallback', start_clip_id: 'hall' },
        clips: [
            { unique_id: 'hall', name: 'Hallway', filepath: '/clips/hall.mp4', thumbnail: '/thumbnails/hall.jpg', duration: 6 },
            { unique_id: 'red', name: 'Red Door', filepath: '/clips/red.mp4', thumbnail: '/thumbnails/red.jpg', duration: 5 },
            { unique_id: 'garden', name: 'Garden', filepath: '/clips/garden.mp4', thumbnail: '/thumbnails/garden.jpg', duration: 5 }
        ],
        edges: [
            { id: 1, from_id: 'hall', to_id: 'red', label: 'Open the red door', action_type: 'target', trigger_time: 4, logic_id: 'p1', thumbnail: null },
            { id: 2, from_id: 'hall', to_id: 'garden', label: 'Enter the garden', action_type: 'target', trigger_time: 4, logic_id: 'p1', thumbnail: '/thumbnails/custom-garden.jpg' }
        ]
    });
    assert.equal(story.choicePoints.length, 1);
    const [redChoice, gardenChoice] = story.choicePoints[0].choices;
    assert.equal(redChoice.image, '/thumbnails/red.jpg', 'no edge thumbnail -> target scene poster');
    assert.equal(gardenChoice.image, '/thumbnails/custom-garden.jpg', 'an edge thumbnail still wins');

    // Same guarantee through the live preview path (the Two Doors demo).
    const sample = await api('POST', '/api/projects/sample', {});
    assert.equal(sample.status, 200, JSON.stringify(sample.data));
    createdProjects.add(sample.data.projectId);
    const preview = await api('GET', `/preview/${sample.data.projectId}`);
    assert.equal(preview.status, 200);
    const match = String(preview.data).match(/<script id="mya-story" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(match, 'preview embeds the story JSON');
    const previewStory = JSON.parse(match[1]);
    for (const choice of previewStory.choicePoints[0].choices) {
        assert.ok(choice.image, `${choice.label} has a preview image`);
    }
});

test('2e: chunked uploads verify per-chunk SHA-256 and complete only when whole', { timeout: 120000 }, async () => {
    const project = await api('POST', '/api/projects', { title: 'Chunk test' });
    assert.equal(project.status, 200);
    createdProjects.add(project.data.projectId);

    const clipPath = path.join(tmpDir, 'chunked.mp4');
    makeClip(clipPath);
    const bytes = fs.readFileSync(clipPath);
    const half = Math.ceil(bytes.length / 2);
    const parts = [bytes.subarray(0, half), bytes.subarray(half)];
    const uploadId = crypto.randomUUID();

    async function postChunk(id, index, total, chunkBytes, hash) {
        const form = new FormData();
        form.append('uploadId', id);
        form.append('chunkIndex', String(index));
        form.append('totalChunks', String(total));
        if (hash !== undefined) form.append('chunkHash', hash);
        form.append('chunk', new Blob([chunkBytes], { type: 'video/mp4' }), 'chunk.bin');
        return api('POST', '/api/upload/chunk', form);
    }
    const hashOf = chunk => crypto.createHash('sha256').update(chunk).digest('hex');

    const noHash = await postChunk(uploadId, 0, 2, parts[0]);
    assert.equal(noHash.status, 400, 'a chunk without a hash is rejected');
    const first = await postChunk(uploadId, 0, 2, parts[0], hashOf(parts[0]));
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const corrupt = await postChunk(uploadId, 1, 2, parts[1], hashOf(Buffer.from('tampered')));
    assert.equal(corrupt.status, 400, 'a chunk whose bytes do not match its hash is rejected');
    assert.match(String(corrupt.data.error || ''), /integrity check/);
    const retry = await postChunk(uploadId, 0, 2, parts[0], hashOf(parts[0]));
    assert.equal(retry.status, 200, 'retrying a stored chunk is idempotent');
    assert.equal(retry.data.duplicate, true);
    const second = await postChunk(uploadId, 1, 2, parts[1], hashOf(parts[1]));
    assert.equal(second.status, 200, JSON.stringify(second.data));

    const done = await api('POST', '/api/upload/complete', {
        uploadId, fileName: 'chunked.mp4', projectId: project.data.projectId,
        totalChunks: 2, totalSize: bytes.length, mimeType: 'video/mp4'
    });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.ok(done.data.video && done.data.video.id, 'chunked upload finalizes like a single-shot one');

    // A gap in the indexes fails completion even when the size adds up.
    const gapId = crypto.randomUUID();
    const gapFirst = await postChunk(gapId, 0, 2, parts[0], hashOf(parts[0]));
    assert.equal(gapFirst.status, 200);
    const gapDone = await api('POST', '/api/upload/complete', {
        uploadId: gapId, fileName: 'chunked.mp4', projectId: project.data.projectId,
        totalChunks: 2, totalSize: bytes.length, mimeType: 'video/mp4'
    });
    assert.equal(gapDone.status, 400, 'completion with a missing chunk is rejected');
    fs.rmSync(path.join(root, 'uploads', 'chunks', `${gapId}.part`), { force: true });
    fs.rmSync(path.join(root, 'uploads', 'chunks', `${gapId}.meta.json`), { force: true });
});

test('2c: a 2-clip MP4 export honours crossfade', { timeout: 120000 }, async () => {
    const sample = await api('POST', '/api/projects/sample', {});
    assert.equal(sample.status, 200, JSON.stringify(sample.data));
    createdProjects.add(sample.data.projectId);
    const studio = await api('GET', `/api/studio/${sample.data.projectId}`);
    const red = studio.data.clips.find(clip => clip.name === 'The Red Door');
    const garden = studio.data.clips.find(clip => clip.name === 'The Garden');

    const faded = await api('POST', '/api/export/mp4', {
        projectId: sample.data.projectId, path: [red.unique_id, garden.unique_id], crossfade: true
    });
    assert.equal(faded.status, 200, JSON.stringify(faded.data));
    const fadedPath = path.join(root, 'public', faded.data.url.replace(/^\/+/, ''));
    createdLinearExports.add(fadedPath);
    assert.ok(fs.existsSync(fadedPath), 'crossfaded export exists');
    const fadedDuration = probeDuration(fadedPath);
    assert.ok(Math.abs(fadedDuration - 9.5) < 0.7, `2 x 5s clips with a 0.5s crossfade last ~9.5s (got ${fadedDuration})`);

    const plain = await api('POST', '/api/export/mp4', {
        projectId: sample.data.projectId, path: [red.unique_id, garden.unique_id], crossfade: false
    });
    assert.equal(plain.status, 200, JSON.stringify(plain.data));
    const plainPath = path.join(root, 'public', plain.data.url.replace(/^\/+/, ''));
    createdLinearExports.add(plainPath);
    const plainDuration = probeDuration(plainPath);
    assert.ok(Math.abs(plainDuration - 10) < 0.7, `concat without crossfade lasts ~10s (got ${plainDuration})`);
});

test('2c: a 2-clip crossfade keeps audio when both clips have it', { timeout: 120000 }, async () => {
    const project = await api('POST', '/api/projects', { title: 'Audio crossfade' });
    assert.equal(project.status, 200);
    createdProjects.add(project.data.projectId);
    const clipPath = path.join(tmpDir, 'with-audio.mp4');
    makeClip(clipPath, { audio: true });
    const form = new FormData();
    form.append('projectId', String(project.data.projectId));
    form.append('file', new Blob([fs.readFileSync(clipPath)], { type: 'video/mp4' }), 'with-audio.mp4');
    const upload = await api('POST', '/api/upload', form);
    assert.equal(upload.status, 200, JSON.stringify(upload.data));
    const first = await api('POST', '/api/clip', {
        projectId: project.data.projectId, sourceId: upload.data.video.id, start: 0, end: 1, name: 'First'
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const second = await api('POST', '/api/clip', {
        projectId: project.data.projectId, sourceId: upload.data.video.id, start: 1, end: 2, name: 'Second'
    });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    const exported = await api('POST', '/api/export/mp4', {
        projectId: project.data.projectId,
        path: [first.data.clip.unique_id, second.data.clip.unique_id], crossfade: true
    });
    assert.equal(exported.status, 200, JSON.stringify(exported.data));
    const outPath = path.join(root, 'public', exported.data.url.replace(/^\/+/, ''));
    createdLinearExports.add(outPath);
    assert.ok(probeHasAudio(outPath), 'crossfaded export keeps an audio stream');
    const duration = probeDuration(outPath);
    assert.ok(Math.abs(duration - 1.5) < 0.5, `2 x 1s clips with a 0.5s crossfade last ~1.5s (got ${duration})`);
});

test('2d: openai-compatible requests go to the configured base URL', { timeout: 60000 }, async () => {
    const seen = [];
    const stub = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, body });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: 'STUB-OK' } }] }));
        });
    });
    await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
    const stubUrl = `http://127.0.0.1:${stub.address().port}/v1`;
    try {
        const checked = await api('POST', '/api/ai/test', {
            provider: 'openai-compatible', model: 'stub-model', apiKey: 'test-key', openaiBaseUrl: stubUrl
        });
        assert.equal(checked.status, 200, JSON.stringify(checked.data));
        assert.equal(checked.data.success, true);
        assert.match(String(checked.data.response || ''), /STUB-OK/);
        assert.equal(seen.length, 1, 'the request went to the stub, not api.openai.com');
        assert.equal(seen[0].url, '/v1/chat/completions');

        const bad = await api('PUT', '/api/ai/settings', { openaiBaseUrl: 'ftp://example.com/v1' });
        assert.equal(bad.status, 400, 'a non-http(s) base URL is rejected');

        const saved = await api('PUT', '/api/ai/settings', {
            provider: 'openai-compatible', model: 'stub-model', apiKey: 'test-key', openaiBaseUrl: stubUrl
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.settings.openaiBaseUrl, stubUrl);
        assert.equal(saved.data.settings.apiKey, '••••••••', 'the key stays masked');
    } finally {
        await new Promise(resolve => stub.close(resolve));
        // Restore the real settings immediately, not just in test.after.
        if (aiSettingsBackup.exists) fs.writeFileSync(aiSettingsPath, aiSettingsBackup.content);
        else fs.rmSync(aiSettingsPath, { force: true });
    }
});

test('2h: an ffmpeg failure surfaces its real error, not the generic fallback', { timeout: 120000 }, async () => {
    const project = await api('POST', '/api/projects', { title: 'Broken render' });
    assert.equal(project.status, 200);
    createdProjects.add(project.data.projectId);
    const clipPath = path.join(tmpDir, 'to-corrupt.mp4');
    makeClip(clipPath);
    const form = new FormData();
    form.append('projectId', String(project.data.projectId));
    form.append('file', new Blob([fs.readFileSync(clipPath)], { type: 'video/mp4' }), 'to-corrupt.mp4');
    const upload = await api('POST', '/api/upload', form);
    assert.equal(upload.status, 200, JSON.stringify(upload.data));
    const diskPath = path.join(root, 'public', upload.data.video.filepath.replace(/^\/+/, ''));
    fs.writeFileSync(diskPath, Buffer.from('this is not a video file'));
    const cut = await api('POST', '/api/clip', {
        projectId: project.data.projectId, sourceId: upload.data.video.id, start: 0.5, end: 1.5, name: 'Broken'
    });
    assert.equal(cut.status, 500, JSON.stringify(cut.data));
    assert.match(String(cut.data.error || ''), /ffmpeg failed/, 'the real ffmpeg error reaches the UI');
    assert.notEqual(cut.data.error, 'Could not render this scene', 'no longer the generic fallback');
    assert.ok(!String(cut.data.error || '').includes(root), 'no local paths leak into the message');
});
