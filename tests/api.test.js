// End-to-end check of the studio API: a real server, a temporary database,
// real ffmpeg renders. Covers the whole loop a creator goes through.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

const root = path.join(__dirname, '..');
const port = 4300 + Math.floor(Math.random() * 1500);
const base = `http://127.0.0.1:${port}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mya-api-'));
const dbPath = path.join(tmpDir, 'test.sqlite');
let server;
const createdProjects = new Set();
const createdExports = new Set();

async function api(method, url, body) {
    const init = { method, headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const response = await fetch(base + url, init);
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: response.status, data, headers: response.headers };
}

test.before(async () => {
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
    if (server) server.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('sample story: studio data, scene settings, preview, publish and zip', { timeout: 120000 }, async () => {
    const sample = await api('POST', '/api/projects/sample', {});
    assert.equal(sample.status, 200, JSON.stringify(sample.data));
    const projectId = sample.data.projectId;
    createdProjects.add(projectId);

    const studio = await api('GET', `/api/studio/${projectId}`);
    assert.equal(studio.status, 200);
    assert.equal(studio.data.clips.length, 3);
    assert.equal(studio.data.edges.length, 2);
    const hall = studio.data.clips.find(clip => clip.name === 'The Hallway');
    const red = studio.data.clips.find(clip => clip.name === 'The Red Door');
    const garden = studio.data.clips.find(clip => clip.name === 'The Garden');
    assert.equal(studio.data.project.start_clip_id, hall.unique_id);
    assert.equal(red.is_ending, 1);

    // Rename the ending and replace the hallway's choices in one go.
    const updated = await api('POST', '/api/scene/update', { projectId, id: red.unique_id, endingTitle: '  The   Red Room ', name: 'Red door' });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.clip.ending_title, 'The Red Room');
    assert.equal(updated.data.clip.name, 'Red door');
    const loop = await api('POST', '/api/scene/update', { projectId, id: red.unique_id, nextClipId: red.unique_id });
    assert.equal(loop.status, 400, 'a scene cannot continue into itself');

    const choices = await api('POST', '/api/scene/choices', {
        projectId,
        sceneId: hall.unique_id,
        points: [{
            id: 'point_main',
            time: 5,
            timeLimit: 6,
            prompt: 'Which door?',
            choices: [
                { label: 'Red', action: 'scene', to: red.unique_id, isDefault: true },
                { label: 'Garden', action: 'scene', to: garden.unique_id, isDefault: true, setFlag: 'likes plants!' },
                { label: 'Nowhere yet', action: 'scene', to: 'not-a-real-scene' },
                { label: 'Give up', action: 'end' }
            ]
        }]
    });
    assert.equal(choices.status, 200, JSON.stringify(choices.data));
    assert.equal(choices.data.edges.length, 4);
    assert.equal(choices.data.edges.filter(edge => edge.is_default === 1).length, 1, 'only one default per moment');
    assert.equal(choices.data.edges.find(edge => edge.label === 'Garden').set_var, 'likes plants');
    assert.equal(choices.data.edges.find(edge => edge.label === 'Nowhere yet').to_id, null, 'unknown targets are stored as unfinished');
    assert.ok(choices.data.edges.every(edge => edge.logic_id === 'point_main' && edge.prompt === 'Which door?'));

    const preview = await api('GET', `/preview/${projectId}?scene=${garden.unique_id}`);
    assert.equal(preview.status, 200);
    assert.match(preview.data, /data-mode="preview"/);
    assert.match(preview.data, new RegExp(`data-start-scene="${garden.unique_id}"`));
    assert.equal(preview.headers.get('cache-control'), 'no-store');

    const published = await api('POST', '/api/publish', { projectId, title: `API Test ${port}` });
    assert.equal(published.status, 200, JSON.stringify(published.data));
    createdExports.add(published.data.exportName);
    assert.equal(published.data.stats.scenes, 3);
    assert.ok(published.data.issues.some(issue => issue.code === 'no-target'), 'unfinished choices are reported');
    const exportDir = path.join(root, 'public', 'exports', published.data.exportName);
    for (const file of ['index.html', 'story.json', 'manifest.json', 'player/mya-player.js', 'player/story-core.js', 'player/mya-player.css']) {
        assert.ok(fs.existsSync(path.join(exportDir, file)), `${file} is exported`);
    }
    const story = JSON.parse(fs.readFileSync(path.join(exportDir, 'story.json'), 'utf8'));
    assert.equal(story.scenes.length, 3);
    for (const scene of story.scenes) {
        assert.match(scene.src, /^clips\//);
        assert.ok(fs.existsSync(path.join(exportDir, scene.src)), `${scene.src} was copied`);
    }
    assert.equal(story.scenes.find(scene => scene.id === red.unique_id).ending.title, 'The Red Room');

    const page = await fetch(`${base}${published.data.url}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors \*/, 'published movies can be embedded');
    const studioPage = await fetch(`${base}/`);
    assert.equal(studioPage.headers.get('x-frame-options'), 'SAMEORIGIN', 'the studio itself cannot be framed');

    const zip = await fetch(`${base}${published.data.zipUrl}`);
    assert.equal(zip.status, 200);
    const bytes = Buffer.from(await zip.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'zip starts with a local file header');
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50, 'zip ends with the central directory');
    assert.ok(bytes.includes(Buffer.from(`${published.data.exportName}/index.html`)));

    const listing = await api('GET', `/api/studio/${projectId}`);
    assert.equal(listing.data.published.length, 1);
    assert.ok(listing.data.project.updated_at, 'edits bump the last-edited time');
});

test('uploaded video: cut, re-trim, whole-video scene and shot detection', { timeout: 120000 }, async () => {
    const created = await api('POST', '/api/projects', { title: `Upload ${port}` });
    assert.equal(created.status, 200);
    assert.ok(Number.isInteger(created.data.projectId), 'creating a movie returns its id');
    const projects = await api('GET', '/api/projects');
    const project = projects.data.find(item => item.id === created.data.projectId);
    assert.equal(project.title, `Upload ${port}`);
    assert.equal(project.scene_count, 0);
    createdProjects.add(project.id);

    const clipPath = path.join(tmpDir, 'two-shots.mp4');
    execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=red:s=321x181:d=2:r=25',
        '-f', 'lavfi', '-i', 'color=c=blue:s=321x181:d=2:r=25',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', '-y', clipPath
    ]);
    const form = new FormData();
    form.append('projectId', String(project.id));
    form.append('file', new Blob([fs.readFileSync(clipPath)], { type: 'video/mp4' }), 'two-shots.mp4');
    const upload = await api('POST', '/api/upload', form);
    assert.equal(upload.status, 200, JSON.stringify(upload.data));
    const video = upload.data.video;
    assert.ok(video && video.id, 'upload returns the new video');
    assert.ok(video.duration > 3.5 && video.duration < 4.5);

    // Odd-sized, non-4:2:0 footage still renders (even dimensions are enforced).
    const cut = await api('POST', '/api/clip', { projectId: project.id, sourceId: video.id, start: 0.5, end: 1.5, name: 'Red part', x: 300, y: 40 });
    assert.equal(cut.status, 200, JSON.stringify(cut.data));
    assert.equal(cut.data.clip.name, 'Red part');
    assert.equal(cut.data.clip.x, 300);
    assert.ok(Math.abs(cut.data.clip.duration - 1) < 0.25);
    const tooShort = await api('POST', '/api/clip', { projectId: project.id, sourceId: video.id, start: 1, end: 1.05, name: 'Blink' });
    assert.equal(tooShort.status, 400);

    const retrim = await api('POST', '/api/scene/retrim', { projectId: project.id, id: cut.data.clip.unique_id, start: 2.5, end: 3.5 });
    assert.equal(retrim.status, 200, JSON.stringify(retrim.data));
    assert.equal(retrim.data.clip.unique_id, cut.data.clip.unique_id, 're-trimming keeps the scene id');
    assert.equal(retrim.data.clip.start_time, 2.5);
    assert.notEqual(retrim.data.clip.filepath, cut.data.clip.filepath);
    assert.ok(!fs.existsSync(path.join(root, 'public', cut.data.clip.filepath)), 'the old render is cleaned up');

    const whole = await api('POST', '/api/scene/whole', { projectId: project.id, videoId: video.id });
    assert.equal(whole.status, 200);
    assert.equal(whole.data.clip.filepath, video.filepath, 'whole-video scenes reuse the upload without re-encoding');
    assert.equal(whole.data.clip.name, 'two-shots');

    const shots = await api('POST', '/api/video/detect-scenes', { projectId: project.id, videoId: video.id });
    assert.equal(shots.status, 200, JSON.stringify(shots.data));
    assert.equal(shots.data.cuts.length, 1);
    assert.ok(Math.abs(shots.data.cuts[0] - 2) < 0.2, `shot change found near 2s (got ${shots.data.cuts[0]})`);

    // Deleting the whole-video scene must not delete the uploaded file.
    const removed = await api('POST', '/api/delete_clip', { projectId: project.id, unique_id: whole.data.clip.unique_id });
    assert.equal(removed.status, 200);
    assert.ok(fs.existsSync(path.join(root, 'public', video.filepath)));
});
