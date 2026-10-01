const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const multer = require('multer');
const { buildPublishedPlayerHtml, collectReachableClipIds } = require('./lib/published-player');
const {
    buildFallbackMoviePlan,
    buildMovieAgentPrompt,
    normalizeMoviePlan
} = require('./lib/movie-agent');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const FEED_HOST = process.env.FEED_HOST || HOST;
const FEED_PORT = Number(process.env.FEED_PORT || (PORT === 3000 ? 3001 : PORT + 1));
const app = express();
const feedApp = express();

function normalizePublicHost(host) {
    const value = String(host || '').trim();
    if (!value || value === '0.0.0.0' || value === '::') return '127.0.0.1';
    return value;
}

const STUDIO_PUBLIC_ORIGIN = process.env.STUDIO_PUBLIC_ORIGIN || `http://${normalizePublicHost(HOST)}:${PORT}`;
const FEED_PUBLIC_ORIGIN = process.env.FEED_PUBLIC_ORIGIN || `http://${normalizePublicHost(FEED_HOST)}:${FEED_PORT}`;

if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
}
const ffprobePath = typeof ffprobeStatic === 'string'
    ? ffprobeStatic
    : (ffprobeStatic && ffprobeStatic.path);
if (ffprobePath) {
    ffmpeg.setFfprobePath(ffprobePath);
}

const AI_SETTINGS_PATH = path.join(__dirname, '.ai-settings.json');
const DEFAULT_AI_SETTINGS = {
    provider: 'ollama',
    model: 'llama3.2:3b',
    apiKey: '',
    ollamaHost: 'http://127.0.0.1:11434'
};

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

feedApp.use(cors());
feedApp.use(express.json());
feedApp.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
feedApp.use(express.static(path.join(__dirname, 'public', 'feed')));

// 1. SETUP FOLDERS
const folders = ['videos', 'clips', 'thumbnails', 'exports', 'audio', 'gifs'];
folders.forEach(f => fs.ensureDirSync(path.join(__dirname, 'public', f)));

// 2. DATABASE INIT
let db;
(async () => {
    db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
    
    // Core Tables
    await db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, theme_color TEXT DEFAULT '#3b82f6', genre TEXT DEFAULT 'Interactive story', synopsis TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, filename TEXT, filepath TEXT, thumbnail TEXT, duration REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    
    // Clips Table
    await db.exec(`CREATE TABLE IF NOT EXISTS clips (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_id TEXT UNIQUE, project_id INTEGER, name TEXT, filepath TEXT, thumbnail TEXT, source_video_id INTEGER, duration REAL, start_time REAL DEFAULT 0, end_time REAL, logic_name TEXT, timeout_to_id TEXT, timeout_seconds REAL, bg_music TEXT, bg_music_url TEXT, mute_audio INTEGER DEFAULT 0, is_event_clip INTEGER DEFAULT 0, x REAL DEFAULT 0, y REAL DEFAULT 0, builder_visible INTEGER DEFAULT 0);`);
    
    // Edges (Logic) Table
    await db.exec(`CREATE TABLE IF NOT EXISTS edges (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, from_id TEXT, to_id TEXT, label TEXT, text_color TEXT DEFAULT '#ffffff', trigger_time REAL, logic_id TEXT, return_to_main INTEGER DEFAULT 0, set_var TEXT, req_var TEXT, action_type TEXT DEFAULT 'target');`);
    
    // Stats Table
    await db.exec(`CREATE TABLE IF NOT EXISTS analytics (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, choice_label TEXT, target_clip_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    await db.exec(`CREATE TABLE IF NOT EXISTS published_movies (id INTEGER PRIMARY KEY AUTOINCREMENT, export_name TEXT UNIQUE, project_id INTEGER, title TEXT, synopsis TEXT DEFAULT '', genre TEXT DEFAULT 'Interactive story', poster_path TEXT, theme_color TEXT DEFAULT '#3b82f6', clip_count INTEGER DEFAULT 0, choice_count INTEGER DEFAULT 0, duration REAL DEFAULT 0, view_count INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0, published_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);

    // Migrations: only for columns NOT already in CREATE TABLE statements above
    const migrations = [
        `ALTER TABLE projects ADD COLUMN start_clip_id TEXT`,
        `ALTER TABLE edges ADD COLUMN thumbnail TEXT`,
        `ALTER TABLE clips ADD COLUMN favorite INTEGER DEFAULT 0`,
        `ALTER TABLE clips ADD COLUMN tags TEXT DEFAULT ''`,
        `ALTER TABLE clips ADD COLUMN notes TEXT DEFAULT ''`,
        `ALTER TABLE clips ADD COLUMN markers TEXT DEFAULT '[]'`
    ];
    for(let m of migrations) { try { await db.exec(m); } catch(e){} }
    await reconcileMediaRecords();
    await reconcilePublishedMovies();
    
    const proj = await db.get('SELECT * FROM projects');
    if(!proj) await db.run("INSERT INTO projects (title) VALUES ('Default Project')");
    console.log("MyaStudio Ready");
})();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = file.mimetype.startsWith('audio') ? 'public/audio' : 'public/videos';
        cb(null, path.join(__dirname, dest));
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: 1024 * 1024 * 800 }
});

function ensureDbReady() {
    if (!db) {
        const err = new Error('Database is not ready yet');
        err.statusCode = 503;
        throw err;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function createHttpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function buildInsertStatement(table, row, overrides = {}, omitKeys = []) {
    const payload = { ...row, ...overrides };
    omitKeys.forEach(key => delete payload[key]);
    const columns = Object.keys(payload);
    const placeholders = columns.map(() => '?').join(', ');
    return {
        sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
        values: columns.map(column => payload[column])
    };
}

function safeExportFolderName(title) {
    const base = String(title || '').replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/_+/g, '_').replace(/^_|_$/g, '');
    return base || `movie_${Date.now()}`;
}

function buildDuplicateProjectTitle(title, existingTitles = []) {
    const cleanTitle = String(title || '').trim() || 'Untitled Project';
    const titleSet = new Set(existingTitles.map(value => String(value || '').trim()).filter(Boolean));
    let candidate = `${cleanTitle} (Copy)`;
    let copyNumber = 2;
    while (titleSet.has(candidate)) {
        candidate = `${cleanTitle} (Copy ${copyNumber})`;
        copyNumber += 1;
    }
    return candidate;
}

function buildDuplicateClipTitle(title, existingTitles = []) {
    const cleanTitle = String(title || '').trim() || 'Untitled Clip';
    const titleSet = new Set(existingTitles.map(value => String(value || '').trim()).filter(Boolean));
    let candidate = `${cleanTitle} Alt`;
    let copyNumber = 2;
    while (titleSet.has(candidate)) {
        candidate = `${cleanTitle} Alt ${copyNumber}`;
        copyNumber += 1;
    }
    return candidate;
}

const { execFile } = require('child_process');
const generateThumbnail = (inputPath, filename, timestamp = '20%') => {
    return new Promise((resolve) => {
        const thumbFilename = filename.replace(path.extname(filename), '') + `_${Date.now()}.jpg`;
        const outputFolder = path.join(__dirname, 'public/thumbnails');
        ffmpeg(inputPath).screenshots({ timestamps: [timestamp], filename: thumbFilename, folder: outputFolder, size: '640x360' })
            .on('end', () => resolve(`/thumbnails/${thumbFilename}`)).on('error', () => resolve(null));
    });
};

function defaultTriggerTimeForClip(clip) {
    return Math.max(0, Number(clip && clip.duration ? clip.duration : 0) - 0.2);
}

function normalizeActionType(choice) {
    const value = String(choice && (choice.actionType || choice.action_type) || 'target').toLowerCase();
    return ['target', 'next', 'end'].includes(value) ? value : 'target';
}

function toFiniteNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

async function probeDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            const duration = toFiniteNumber(metadata && metadata.format && metadata.format.duration, 0);
            resolve(duration);
        });
    });
}

async function getVideoOrThrow(sourceId) {
    if (!sourceId) throw createHttpError('sourceId is required', 400);
    const video = await db.get('SELECT * FROM videos WHERE id = ?', [sourceId]);
    if (!video) throw createHttpError('Source video not found', 404);
    const sourcePath = path.join(__dirname, 'public', video.filepath);
    if (!(await fs.pathExists(sourcePath))) throw createHttpError('Source video file is missing', 404);
    return { video, sourcePath };
}

function validateClipWindow(start, end, duration = 0) {
    const startTime = Math.max(0, toFiniteNumber(start, 0));
    const rawEnd = toFiniteNumber(end, startTime);
    const maxDuration = duration > 0 ? duration : rawEnd;
    const endTime = Math.min(maxDuration || rawEnd, rawEnd);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw createHttpError('Invalid clip timing', 400);
    if (endTime <= startTime) throw createHttpError('End time must be greater than start time', 400);
    return { startTime, endTime };
}

function ensureName(name, fallback) {
    const value = String(name || '').trim();
    if (!value) throw createHttpError(fallback, 400);
    return value;
}

function parseRequiredId(value, fieldName = 'id') {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw createHttpError(`${fieldName} required`, 400);
    return id;
}

function parseProjectId(value, fallbackProjectId = 1) {
    if (value === undefined || value === null || value === '') {
        return parseRequiredId(fallbackProjectId, 'projectId');
    }
    return parseRequiredId(value, 'projectId');
}

function parseUniqueId(value, fieldName = 'unique_id') {
    const uniqueId = String(value || '').trim();
    if (!uniqueId) throw createHttpError(`${fieldName} required`, 400);
    return uniqueId;
}

function normalizeChoiceTargetId(choice) {
    const raw = choice ? (choice.toId || choice.to_id || choice.to) : null;
    const value = String(raw || '').trim();
    return value || null;
}

function normalizeThemeColor(color) {
    const value = String(color || '').trim();
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        throw createHttpError('Invalid theme color', 400);
    }
    return value;
}

function normalizeProjectGenre(value) {
    const cleaned = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);
    return cleaned || 'Interactive story';
}

function normalizeProjectSynopsis(value) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
}

function sendApiError(res, err, fallback = 'Server error') {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : fallback;
    res.status(statusCode).json({ error: message });
}

function normalizeFilter(filter) {
    const safeFilter = String(filter || 'none').toLowerCase();
    if (!['none', 'bw', 'sepia', 'vivid'].includes(safeFilter)) {
        throw createHttpError('Invalid filter', 400);
    }
    return safeFilter;
}

function normalizeSpeed(speed) {
    const safeSpeed = toFiniteNumber(speed, 1);
    if (safeSpeed < 0.5 || safeSpeed > 2) throw createHttpError('Speed must be between 0.5 and 2.0', 400);
    return safeSpeed;
}

function normalizeVolume(volume) {
    const safeVolume = toFiniteNumber(volume, 1);
    if (!Number.isFinite(safeVolume) || safeVolume < 0 || safeVolume > 2) {
        throw createHttpError('Volume must be between 0 and 2.0', 400);
    }
    return safeVolume;
}

function runFfmpeg(command) {
    return new Promise((resolve, reject) => {
        command.on('end', resolve).on('error', reject).run();
    });
}

async function reencodeClipFile(clip, { filter = 'none', speed = 1, volume = 1 } = {}) {
    const safeFilter = normalizeFilter(filter);
    const safeSpeed = normalizeSpeed(speed);
    const safeVolume = normalizeVolume(volume);
    const sourcePath = path.join(__dirname, 'public', stripLeadingSlashes(clip.filepath));
    if (!(await fs.pathExists(sourcePath))) throw createHttpError('Clip file is missing', 404);

    const newId = uuidv4();
    const outputFilename = `clip_${newId}.mp4`;
    const outputPath = path.join(__dirname, 'public/clips', outputFilename);
    const command = ffmpeg(sourcePath);
    const audioFilters = [];
    const videoFilters = [];
    let duration = toFiniteNumber(clip.duration, 0);

    if (safeSpeed !== 1) {
        audioFilters.push(`atempo=${safeSpeed}`);
        videoFilters.push(`setpts=${1 / safeSpeed}*PTS`);
        if (duration > 0) duration = duration / safeSpeed;
    }
    if (safeFilter === 'bw') videoFilters.push('hue=s=0');
    if (safeFilter === 'sepia') videoFilters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
    if (safeFilter === 'vivid') videoFilters.push('eq=saturation=2');
    if (safeVolume !== 1) audioFilters.push(`volume=${safeVolume}`);
    if (audioFilters.length) command.audioFilters(audioFilters);
    if (videoFilters.length) command.videoFilters(videoFilters);

    await runFfmpeg(
        command.videoCodec('libx264').audioCodec('aac').outputOptions('-preset ultrafast').output(outputPath)
    );

    const webPath = `/clips/${outputFilename}`;
    const thumbnail = await generateThumbnail(outputPath, outputFilename);
    if (!(duration > 0)) {
        try { duration = await probeDuration(outputPath); } catch (_) { duration = toFiniteNumber(clip.duration, 0); }
    }

    await db.run(
        'UPDATE clips SET unique_id = unique_id, filepath = ?, thumbnail = ?, duration = ? WHERE unique_id = ? AND project_id = ?',
        [webPath, thumbnail, duration, clip.unique_id, clip.project_id]
    );

    await removeUnusedPublicAssets([clip.filepath, clip.thumbnail]);
    return { filepath: webPath, thumbnail, duration };
}

async function readAiSettings() {
    try {
        if (await fs.pathExists(AI_SETTINGS_PATH)) {
            const raw = await fs.readJson(AI_SETTINGS_PATH);
            return { ...DEFAULT_AI_SETTINGS, ...raw };
        }
    } catch (_) {}
    return { ...DEFAULT_AI_SETTINGS };
}

async function writeAiSettings(settings) {
    const next = {
        provider: String(settings.provider || DEFAULT_AI_SETTINGS.provider).trim() || DEFAULT_AI_SETTINGS.provider,
        model: String(settings.model || DEFAULT_AI_SETTINGS.model).trim() || DEFAULT_AI_SETTINGS.model,
        apiKey: String(settings.apiKey || '').trim(),
        ollamaHost: String(settings.ollamaHost || DEFAULT_AI_SETTINGS.ollamaHost).trim() || DEFAULT_AI_SETTINGS.ollamaHost
    };
    await fs.writeJson(AI_SETTINGS_PATH, next, { spaces: 2 });
    return next;
}

async function callAiChat(settings, prompt, systemPrompt = 'You are a helpful interactive-story writing assistant.') {
    const provider = String(settings.provider || 'ollama').toLowerCase();
    const model = String(settings.model || DEFAULT_AI_SETTINGS.model);
    if (provider === 'ollama') {
        const host = String(settings.ollamaHost || DEFAULT_AI_SETTINGS.ollamaHost).replace(/\/+$/, '');
        const response = await fetch(`${host}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ]
            })
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw createHttpError(`Ollama request failed (${response.status}): ${text.slice(0, 200)}`, 502);
        }
        const data = await response.json();
        return (data && data.message && data.message.content) || data.response || '';
    }

    if (provider === 'openai' || provider === 'openai-compatible') {
        if (!settings.apiKey) throw createHttpError('API key required for this provider', 400);
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            })
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw createHttpError(`OpenAI request failed (${response.status}): ${text.slice(0, 200)}`, 502);
        }
        const data = await response.json();
        return data && data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : '';
    }

    throw createHttpError(`Unsupported AI provider: ${provider}`, 400);
}

function extractJsonBlock(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try { return JSON.parse(fenced[1].trim()); } catch (_) {}
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
    }
    return null;
}

function buildFallbackOutline({ premise, genre, targetScenes, tone }) {
    const count = Math.max(2, Math.min(12, Number(targetScenes) || 5));
    const scenes = [];
    for (let i = 1; i <= count; i++) {
        scenes.push({
            id: i,
            title: i === 1 ? 'Opening' : (i === count ? 'Finale' : `Scene ${i}`),
            description: i === 1
                ? `Introduce the premise: ${premise}`
                : (i === count
                    ? `Resolve the ${genre || 'story'} with a ${tone || 'neutral'} ending.`
                    : `Develop the ${genre || 'story'} through a choice that branches the path.`),
            choices: i === count
                ? []
                : [
                    { label: 'Take the bold path', goesTo: i + 1 },
                    { label: 'Take the careful path', goesTo: Math.min(count, i + 1) }
                ]
        });
    }
    return {
        title: String(premise || 'Untitled Story').slice(0, 64),
        genre: genre || 'Interactive story',
        tone: tone || 'neutral',
        premise,
        scenes
    };
}

async function getMovieAgentContext(projectId) {
    ensureDbReady();
    const safeProjectId = parseRequiredId(projectId, 'projectId');
    const project = await db.get('SELECT * FROM projects WHERE id = ?', [safeProjectId]);
    if (!project) throw createHttpError('Project not found', 404);
    const videos = await db.all('SELECT * FROM videos WHERE project_id = ? ORDER BY id ASC', [safeProjectId]);
    const clips = await db.all('SELECT * FROM clips WHERE project_id = ? ORDER BY id ASC', [safeProjectId]);
    const publicRoot = path.resolve(__dirname, 'public');
    const usableClips = [];
    const missingClipIds = [];
    for (const clip of clips) {
        const relativePath = stripLeadingSlashes(clip && clip.filepath);
        const resolvedPath = relativePath ? path.resolve(publicRoot, relativePath) : '';
        const isInsidePublic = resolvedPath && (resolvedPath === publicRoot || resolvedPath.startsWith(publicRoot + path.sep));
        if (isInsidePublic && await fs.pathExists(resolvedPath)) {
            usableClips.push(clip);
        } else if (clip && clip.unique_id) {
            missingClipIds.push(clip.unique_id);
        }
    }
    return {
        projectId: safeProjectId,
        project,
        videos,
        clips: usableClips,
        allClips: clips,
        missingClipIds
    };
}

function summarizeMovieAgentInventory(context) {
    return {
        projectId: context.projectId,
        projectTitle: context.project.title,
        sourceVideos: context.videos.length,
        totalClips: context.allClips.length,
        usableClips: context.clips.length,
        missingMedia: context.missingClipIds.length,
        thumbnails: context.clips.filter(clip => !!clip.thumbnail).length,
        fullSources: context.clips.filter(clip => /^FULL:/i.test(String(clip.name || ''))).length,
        choiceScenes: context.clips.filter(clip => Number(clip.is_event_clip) === 1).length,
        taggedClips: context.clips.filter(clip => String(clip.tags || '').trim()).length,
        notedClips: context.clips.filter(clip => String(clip.notes || '').trim()).length
    };
}

async function createMovieAgentPlan(context, options = {}) {
    const premise = String(options.premise || '').trim();
    const genre = String(options.genre || context.project.genre || 'Interactive story').trim();
    const tone = String(options.tone || 'cinematic').trim();
    const targetScenes = Math.max(3, Math.min(12, Number(options.targetScenes) || 7));
    const fallbackPlan = buildFallbackMoviePlan({
        project: context.project,
        clips: context.clips,
        videos: context.videos,
        premise,
        genre,
        tone,
        targetScenes
    });
    const settings = await readAiSettings();
    let plan = fallbackPlan;
    let mode = 'offline-planner';
    let warning = '';

    try {
        const prompt = buildMovieAgentPrompt({
            project: context.project,
            clips: context.clips,
            videos: context.videos,
            premise,
            genre,
            tone,
            targetScenes
        });
        const responseText = await callAiChat(
            settings,
            prompt,
            'You are a precise interactive-movie editor. You select only real uploaded clips and return valid JSON with playable choices.'
        );
        const rawPlan = extractJsonBlock(responseText);
        const normalizedPlan = normalizeMoviePlan(rawPlan, {
            project: context.project,
            clips: context.clips,
            videos: context.videos,
            tone
        });
        if (normalizedPlan) {
            plan = normalizedPlan;
            mode = `${settings.provider}:${settings.model}`;
        } else {
            warning = 'The AI response did not produce a valid playable graph, so the offline planner created the draft.';
        }
    } catch (err) {
        warning = `AI provider unavailable (${err.message || 'unknown error'}). The offline planner created the draft.`;
    }

    return {
        plan,
        mode,
        warning,
        inventory: summarizeMovieAgentInventory(context)
    };
}

function movieAgentNodePosition(scene, index, totals) {
    if (scene.role === 'main') return { x: 80, y: 220 };
    if (scene.role === 'ending') {
        const endingIndex = totals.ending++;
        return { x: 780, y: 100 + endingIndex * 180 };
    }
    const branchIndex = totals.branch++;
    return { x: 430, y: 40 + branchIndex * 160 };
}

async function applyMovieAgentPlan(context, rawPlan, options = {}) {
    const plan = normalizeMoviePlan(rawPlan, {
        project: context.project,
        clips: context.clips,
        videos: context.videos,
        tone: rawPlan && rawPlan.tone
    });
    if (!plan) throw createHttpError('The movie plan is invalid or does not contain playable choices', 400);
    const replaceExisting = !!options.replaceExisting;
    const renameProject = !!options.renameProject;
    const clipMap = new Map(context.clips.map(clip => [clip.unique_id, clip]));
    const selectedIds = [...new Set(plan.scenes.map(scene => scene.clipId))];
    let insertedEdges = 0;

    await db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
        if (replaceExisting) {
            await db.run('DELETE FROM edges WHERE project_id = ?', [context.projectId]);
            await db.run('UPDATE clips SET builder_visible = 0 WHERE project_id = ?', [context.projectId]);
        } else {
            await db.run("DELETE FROM edges WHERE project_id = ? AND logic_id LIKE 'ai_agent_%'", [context.projectId]);
        }

        const totals = { branch: 0, ending: 0 };
        for (let index = 0; index < plan.scenes.length; index++) {
            const scene = plan.scenes[index];
            const position = movieAgentNodePosition(scene, index, totals);
            await db.run(
                'UPDATE clips SET builder_visible = 1, x = ?, y = ? WHERE project_id = ? AND unique_id = ?',
                [position.x, position.y, context.projectId, scene.clipId]
            );
        }

        for (let decisionIndex = 0; decisionIndex < plan.decisions.length; decisionIndex++) {
            const decision = plan.decisions[decisionIndex];
            const fromClip = clipMap.get(decision.fromClipId);
            if (!fromClip) continue;
            const duration = Math.max(0.5, toFiniteNumber(fromClip.duration, 1));
            const triggerTime = Math.max(0.1, Math.min(duration - 0.2, duration * Number(decision.triggerRatio || 0.5)));
            const logicId = `ai_agent_${context.projectId}_${decisionIndex + 1}_${uuidv4()}`;
            for (const choice of decision.choices) {
                if ((choice.actionType || 'target') === 'target' && !clipMap.has(choice.toClipId)) continue;
                await db.run(
                    'INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        context.projectId,
                        decision.fromClipId,
                        (choice.actionType || 'target') === 'target' ? choice.toClipId : null,
                        choice.label || 'Choice',
                        '#f8fafc',
                        triggerTime,
                        logicId,
                        choice.returnToMain ? 1 : 0,
                        choice.setVar || null,
                        choice.reqVar || null,
                        choice.actionType || 'target'
                    ]
                );
                insertedEdges += 1;
            }
        }

        const nextTitle = renameProject ? plan.title : context.project.title;
        await db.run(
            'UPDATE projects SET title = ?, genre = ?, synopsis = ?, start_clip_id = ? WHERE id = ?',
            [
                ensureName(nextTitle, 'Movie title is required'),
                normalizeProjectGenre(plan.genre),
                normalizeProjectSynopsis(plan.synopsis),
                plan.startClipId,
                context.projectId
            ]
        );
        await db.exec('COMMIT');
    } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
    }

    return {
        projectId: context.projectId,
        title: renameProject ? plan.title : context.project.title,
        startClipId: plan.startClipId,
        selectedScenes: selectedIds.length,
        decisions: plan.decisions.length,
        choices: insertedEdges,
        returnBranches: plan.decisions.reduce((total, decision) => total + decision.choices.filter(choice => choice.returnToMain).length, 0),
        endings: plan.decisions.reduce((total, decision) => total + decision.choices.filter(choice => !choice.returnToMain).length, 0),
        replacedExistingChoices: replaceExisting
    };
}

function stripLeadingSlashes(value) {
    return String(value || '').replace(/^\/+/, '');
}

function buildStudioUrl(relativePath) {
    const normalized = stripLeadingSlashes(relativePath);
    return normalized ? `${STUDIO_PUBLIC_ORIGIN}/${normalized}` : STUDIO_PUBLIC_ORIGIN;
}

function prettifyExportTitle(exportName) {
    return String(exportName || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Published Movie';
}

function formatFeedItem(row) {
    return {
        id: row.id,
        exportName: row.export_name,
        projectId: row.project_id,
        title: row.title || prettifyExportTitle(row.export_name),
        synopsis: String(row.synopsis || '').trim(),
        genre: normalizeProjectGenre(row.genre),
        themeColor: row.theme_color || '#3b82f6',
        clipCount: toFiniteNumber(row.clip_count, 0),
        choiceCount: toFiniteNumber(row.choice_count, 0),
        duration: toFiniteNumber(row.duration, 0),
        viewCount: toFiniteNumber(row.view_count, 0),
        likeCount: toFiniteNumber(row.like_count, 0),
        publishedAt: row.published_at,
        updatedAt: row.updated_at || row.published_at,
        playerUrl: buildStudioUrl(`exports/${row.export_name}/index.html`),
        posterUrl: row.poster_path ? buildStudioUrl(`exports/${row.export_name}/${stripLeadingSlashes(row.poster_path)}`) : null,
        studioUrl: `${STUDIO_PUBLIC_ORIGIN}/`
    };
}

async function listPublishedMovies() {
    const rows = await db.all('SELECT * FROM published_movies ORDER BY datetime(updated_at) DESC, id DESC');
    return rows.map(formatFeedItem);
}

async function upsertPublishedMovie(entry) {
    await db.run(
        `INSERT INTO published_movies (export_name, project_id, title, synopsis, genre, poster_path, theme_color, clip_count, choice_count, duration, published_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(export_name) DO UPDATE SET
             project_id = excluded.project_id,
             title = excluded.title,
             synopsis = excluded.synopsis,
             genre = excluded.genre,
             poster_path = excluded.poster_path,
             theme_color = excluded.theme_color,
             clip_count = excluded.clip_count,
             choice_count = excluded.choice_count,
             duration = excluded.duration,
             updated_at = CURRENT_TIMESTAMP`,
        [
            entry.exportName,
            entry.projectId || null,
            entry.title,
            normalizeProjectSynopsis(entry.synopsis),
            normalizeProjectGenre(entry.genre),
            entry.posterPath || null,
            entry.themeColor || '#3b82f6',
            toFiniteNumber(entry.clipCount, 0),
            toFiniteNumber(entry.choiceCount, 0),
            toFiniteNumber(entry.duration, 0)
        ]
    );
}

async function ensureBuilderVisibility(projectId) {
    const safeProjectId = toFiniteNumber(projectId, 0);
    if (!safeProjectId) return;

    const summary = await db.get(
        'SELECT COUNT(*) AS total, SUM(CASE WHEN builder_visible = 1 THEN 1 ELSE 0 END) AS visible FROM clips WHERE project_id = ?',
        [safeProjectId]
    );
    const total = toFiniteNumber(summary && summary.total, 0);
    const visible = toFiniteNumber(summary && summary.visible, 0);
    if (total === 0 || visible > 0) return;

    const project = await db.get('SELECT start_clip_id FROM projects WHERE id = ?', [safeProjectId]);
    const referencedIds = new Set();
    if (project && project.start_clip_id) referencedIds.add(project.start_clip_id);

    const edges = await db.all('SELECT from_id, to_id, action_type FROM edges WHERE project_id = ?', [safeProjectId]);
    edges.forEach(edge => {
        if (edge && edge.from_id) referencedIds.add(edge.from_id);
        if (edge && normalizeActionType(edge) === 'target' && edge.to_id) referencedIds.add(edge.to_id);
    });

    let seedIds = Array.from(referencedIds);
    if (seedIds.length === 0) {
        const fallbackClips = await db.all(
            `SELECT unique_id
             FROM clips
             WHERE project_id = ?
             ORDER BY CASE WHEN name LIKE 'FULL:%' THEN 1 ELSE 0 END, id ASC
             LIMIT 8`,
            [safeProjectId]
        );
        seedIds = fallbackClips.map(row => row.unique_id).filter(Boolean);
    }

    if (seedIds.length === 0) return;
    const placeholders = seedIds.map(() => '?').join(', ');
    await db.run(
        `UPDATE clips SET builder_visible = 1 WHERE project_id = ? AND unique_id IN (${placeholders})`,
        [safeProjectId, ...seedIds]
    );
}

async function cleanupClipReferences(uniqueId) {
    await db.run('DELETE FROM edges WHERE from_id = ? OR to_id = ?', [uniqueId, uniqueId]);
    await db.run('DELETE FROM analytics WHERE target_clip_id = ?', [uniqueId]);
    await db.run('UPDATE projects SET start_clip_id = NULL WHERE start_clip_id = ?', [uniqueId]);
}

async function reconcileMediaRecords() {
    const clips = await db.all('SELECT unique_id, filepath, thumbnail, bg_music FROM clips');
    const videos = await db.all('SELECT id, filepath, thumbnail FROM videos');
    const missingClipFiles = [];
    const missingClipThumbs = [];
    const missingClipAudio = [];
    const missingVideoFiles = [];
    const missingVideoThumbs = [];

    for (const clip of clips) {
        const clipPath = path.join(__dirname, 'public', String(clip.filepath || '').replace(/^\/+/, ''));
        if (!clip.filepath || !(await fs.pathExists(clipPath))) {
            missingClipFiles.push(clip);
            continue;
        }
        if (clip.thumbnail) {
            const thumbPath = path.join(__dirname, 'public', String(clip.thumbnail).replace(/^\/+/, ''));
            if (!(await fs.pathExists(thumbPath))) missingClipThumbs.push(clip.unique_id);
        }
        if (clip.bg_music) {
            const audioPath = path.join(__dirname, 'public', String(clip.bg_music).replace(/^\/+/, ''));
            if (!(await fs.pathExists(audioPath))) missingClipAudio.push(clip.unique_id);
        }
    }

    for (const video of videos) {
        const videoPath = path.join(__dirname, 'public', String(video.filepath || '').replace(/^\/+/, ''));
        if (!video.filepath || !(await fs.pathExists(videoPath))) {
            missingVideoFiles.push(video);
            continue;
        }
        if (video.thumbnail) {
            const thumbPath = path.join(__dirname, 'public', String(video.thumbnail).replace(/^\/+/, ''));
            if (!(await fs.pathExists(thumbPath))) missingVideoThumbs.push(video.id);
        }
    }

    if (
        missingClipFiles.length === 0 &&
        missingClipThumbs.length === 0 &&
        missingClipAudio.length === 0 &&
        missingVideoFiles.length === 0 &&
        missingVideoThumbs.length === 0
    ) {
        return;
    }

    const clipAssetPaths = missingClipFiles.flatMap(clip => [clip.filepath, clip.thumbnail, clip.bg_music]);
    const videoAssetPaths = missingVideoFiles.flatMap(video => [video.filepath, video.thumbnail]);

    await db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
        for (const uniqueId of missingClipThumbs) {
            await db.run('UPDATE clips SET thumbnail = NULL WHERE unique_id = ?', [uniqueId]);
        }
        for (const uniqueId of missingClipAudio) {
            await db.run('UPDATE clips SET bg_music = NULL WHERE unique_id = ?', [uniqueId]);
        }
        for (const clip of missingClipFiles) {
            await db.run('DELETE FROM clips WHERE unique_id = ?', [clip.unique_id]);
            await cleanupClipReferences(clip.unique_id);
        }
        for (const id of missingVideoThumbs) {
            await db.run('UPDATE videos SET thumbnail = NULL WHERE id = ?', [id]);
        }
        for (const video of missingVideoFiles) {
            await db.run('UPDATE clips SET source_video_id = NULL WHERE source_video_id = ?', [video.id]);
            await db.run('DELETE FROM videos WHERE id = ?', [video.id]);
        }
        await db.exec('COMMIT');
    } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
    }

    await removeUnusedPublicAssets([...clipAssetPaths, ...videoAssetPaths]);
}

async function buildFallbackPublishedMovie(exportName) {
    const exportPath = path.join(__dirname, 'public', 'exports', exportName);
    const clipsDir = path.join(exportPath, 'clips');
    let posterPath = null;
    let clipCount = 0;

    if (await fs.pathExists(clipsDir)) {
        const clipFiles = await fs.readdir(clipsDir);
        const imageFile = clipFiles
            .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file))
            .sort((a, b) => a.localeCompare(b))[0];
        clipCount = clipFiles.filter(file => /\.(mp4|mov|m4v|webm)$/i.test(file)).length;
        if (imageFile) {
            posterPath = `clips/${imageFile}`;
        }
    }

    return {
        exportName,
        title: prettifyExportTitle(exportName),
        synopsis: '',
        genre: 'Interactive story',
        posterPath,
        themeColor: '#3b82f6',
        clipCount,
        choiceCount: 0,
        duration: 0
    };
}

async function reconcilePublishedMovies() {
    const exportDir = path.join(__dirname, 'public', 'exports');
    await fs.ensureDir(exportDir);

    const exportEntries = await fs.readdir(exportDir);
    const validExports = [];
    for (const entry of exportEntries) {
        const entryPath = path.join(exportDir, entry);
        if ((await fs.stat(entryPath)).isDirectory() && await fs.pathExists(path.join(entryPath, 'index.html'))) {
            validExports.push(entry);
        }
    }

    const validExportSet = new Set(validExports);
    const existingRows = await db.all('SELECT * FROM published_movies');
    const existingMap = new Map(existingRows.map(row => [row.export_name, row]));

    for (const row of existingRows) {
        if (!validExportSet.has(row.export_name)) {
            await db.run('DELETE FROM published_movies WHERE export_name = ?', [row.export_name]);
        }
    }

    for (const exportName of validExports) {
        const row = existingMap.get(exportName);
        const fallback = await buildFallbackPublishedMovie(exportName);
        if (!row) {
            await upsertPublishedMovie(fallback);
            continue;
        }

        const posterMissing = row.poster_path
            ? !(await fs.pathExists(path.join(exportDir, exportName, stripLeadingSlashes(row.poster_path))))
            : true;
        if (posterMissing || !row.title) {
            await db.run(
                `UPDATE published_movies
                 SET title = COALESCE(NULLIF(title, ''), ?),
                     poster_path = COALESCE(?, poster_path),
                     clip_count = CASE WHEN clip_count > 0 THEN clip_count ELSE ? END
                 WHERE export_name = ?`,
                [fallback.title, fallback.posterPath, fallback.clipCount, exportName]
            );
        }
    }
}

async function removePublicAssetIfUnused(webPath) {
    const normalized = String(webPath || '').trim();
    if (!normalized) return;
    const relativePath = normalized.replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('..')) return;
    const usage = await db.get(
        `SELECT
            (SELECT COUNT(*) FROM videos WHERE filepath = ? OR thumbnail = ?) +
            (SELECT COUNT(*) FROM clips WHERE filepath = ? OR thumbnail = ? OR bg_music = ?) AS total`,
        [normalized, normalized, normalized, normalized, normalized]
    );
    if (toFiniteNumber(usage && usage.total, 0) > 0) return;
    await fs.remove(path.join(__dirname, 'public', relativePath));
}

async function removeUnusedPublicAssets(paths) {
    const uniquePaths = Array.from(new Set((paths || []).filter(Boolean)));
    for (const assetPath of uniquePaths) {
        await removePublicAssetIfUnused(assetPath);
    }
}

// --- ROUTES ---
const DB_OPTIONAL_API_PATHS = new Set(['/audio', '/exports']);

app.use('/api', (req, res, next) => {
    if (DB_OPTIONAL_API_PATHS.has(req.path)) {
        return next();
    }
    try {
        ensureDbReady();
        next();
    } catch (err) {
        next(err);
    }
});

feedApp.use('/api', (req, res, next) => {
    try {
        ensureDbReady();
        next();
    } catch (err) {
        next(err);
    }
});

feedApp.get('/api/feed/items', async (req, res) => {
    try {
        const items = await listPublishedMovies();
        res.json({
            studioUrl: `${STUDIO_PUBLIC_ORIGIN}/`,
            feedUrl: `${FEED_PUBLIC_ORIGIN}/`,
            items
        });
    } catch (err) {
        sendApiError(res, err, 'Could not load feed');
    }
});

feedApp.post('/api/feed/engage', async (req, res) => {
    try {
        const exportName = String(req.body && req.body.exportName || '').trim();
        const action = String(req.body && req.body.action || '').trim().toLowerCase();
        if (!exportName) throw createHttpError('exportName required', 400);
        if (!['view', 'like'].includes(action)) throw createHttpError('Invalid engagement action', 400);

        const existing = await db.get('SELECT export_name FROM published_movies WHERE export_name = ?', [exportName]);
        if (!existing) throw createHttpError('Published movie not found', 404);

        if (action === 'view') {
            await db.run(
                'UPDATE published_movies SET view_count = COALESCE(view_count, 0) + 1 WHERE export_name = ?',
                [exportName]
            );
        } else {
            const liked = !!(req.body && req.body.liked);
            await db.run(
                `UPDATE published_movies
                 SET like_count = CASE
                     WHEN ? THEN COALESCE(like_count, 0) + 1
                     WHEN COALESCE(like_count, 0) > 0 THEN like_count - 1
                     ELSE 0
                 END
                 WHERE export_name = ?`,
                [liked ? 1 : 0, exportName]
            );
        }

        const row = await db.get('SELECT * FROM published_movies WHERE export_name = ?', [exportName]);
        res.json({ success: true, item: formatFeedItem(row) });
    } catch (err) {
        sendApiError(res, err, 'Could not update feed engagement');
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        ensureDbReady();
        const rows = await db.all('SELECT * FROM projects ORDER BY id DESC');
        const enriched = [];
        for (const project of rows) {
            const stats = await db.get(
                `SELECT
                    (SELECT COUNT(*) FROM videos WHERE project_id = ?) AS video_count,
                    (SELECT COUNT(*) FROM clips WHERE project_id = ?) AS clip_count,
                    (SELECT COUNT(*) FROM edges WHERE project_id = ?) AS edge_count,
                    (SELECT COUNT(*) FROM clips WHERE project_id = ? AND COALESCE(favorite, 0) = 1) AS favorite_count,
                    (SELECT thumbnail FROM clips WHERE project_id = ? AND thumbnail IS NOT NULL AND thumbnail != '' ORDER BY CASE WHEN unique_id = ? THEN 0 ELSE 1 END, id ASC LIMIT 1) AS poster
                `,
                [project.id, project.id, project.id, project.id, project.id, project.start_clip_id || '']
            );
            enriched.push({
                ...project,
                video_count: toFiniteNumber(stats && stats.video_count, 0),
                clip_count: toFiniteNumber(stats && stats.clip_count, 0),
                edge_count: toFiniteNumber(stats && stats.edge_count, 0),
                favorite_count: toFiniteNumber(stats && stats.favorite_count, 0),
                poster: stats && stats.poster ? stats.poster : null
            });
        }
        res.json(enriched);
    } catch (err) {
        sendApiError(res, err, 'Could not load projects');
    }
});

app.get('/api/project/health/:id', async (req, res) => {
    try {
        ensureDbReady();
        const projectId = parseRequiredId(req.params.id, 'id');
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const clips = await db.all('SELECT * FROM clips WHERE project_id = ?', [projectId]);
        const edges = await db.all('SELECT * FROM edges WHERE project_id = ?', [projectId]);
        const startId = project.start_clip_id;
        const nodeIds = new Set(clips.filter(c => c.builder_visible === 1 || c.unique_id === startId).map(c => c.unique_id));
        const deadEnds = [];
        const disconnected = [];
        const missingTargets = [];
        for (const clip of clips) {
            if (!nodeIds.has(clip.unique_id)) continue;
            const outs = edges.filter(e => e.from_id === clip.unique_id);
            const incoming = edges.filter(e => e.to_id === clip.unique_id);
            if (clip.unique_id === startId && outs.length === 0) {
                deadEnds.push({ id: clip.unique_id, name: clip.name });
            }
            const hasIn = incoming.length > 0;
            const hasOut = outs.length > 0;
            if (clip.unique_id !== startId && !hasIn && !hasOut) {
                disconnected.push({ id: clip.unique_id, name: clip.name });
            }
        }
        for (const edge of edges) {
            if ((edge.action_type || 'target') === 'target' && edge.to_id && !clips.some(c => c.unique_id === edge.to_id)) {
                missingTargets.push({ id: edge.id, from: edge.from_id, label: edge.label });
            }
        }
        res.json({
            success: true,
            health: {
                hasStart: !!startId,
                startClipId: startId || null,
                clipCount: clips.length,
                edgeCount: edges.length,
                builderNodes: nodeIds.size,
                deadEnds,
                disconnected,
                missingTargets,
                score: Math.max(0, 100
                    - (startId ? 0 : 30)
                    - deadEnds.length * 8
                    - disconnected.length * 5
                    - missingTargets.length * 10)
            }
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const title = ensureName(req.body && req.body.title, 'Project title is required');
        await db.run('INSERT INTO projects (title) VALUES (?)', [title]);
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err, 'Could not create project');
    }
});

// One-click sample story: generates three tiny ffmpeg clips and wires a
// two-choice branching demo so new users can try the editor instantly.
app.post('/api/projects/sample', async (req, res) => {
    const createdFiles = [];
    try {
        ensureDbReady();
        const title = String((req.body && req.body.title) || 'Sample: The Two Doors').slice(0, 80) || 'Sample: The Two Doors';
        const projectResult = await db.run(
            'INSERT INTO projects (title, genre, synopsis) VALUES (?, ?, ?)',
            [title, 'Interactive story', 'A tiny generated demo: stand in the hallway and pick a door.']
        );
        const projectId = projectResult.lastID;

        const scenes = [
            { name: 'The Hallway', hue: 210, dur: 6 },
            { name: 'The Red Door', hue: 350, dur: 5 },
            { name: 'The Garden', hue: 110, dur: 5 }
        ];
        const clipIds = [];
        let x = 120;
        for (const scene of scenes) {
            const clipId = uuidv4();
            const filename = `sample_${clipId}.mp4`;
            const outPath = path.join(__dirname, 'public/clips', filename);
            // NOTE: built with execFile (not fluent-ffmpeg) because fluent-ffmpeg's
            // capability check misparses newer ffmpeg `-formats` output and
            // wrongly rejects the lavfi input format.
            await new Promise((resolve, reject) => {
                execFile(ffmpegStatic, [
                    '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', `testsrc2=s=1280x720:d=${scene.dur}:r=30`,
                    '-vf', `hue=h=${scene.hue}`,
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                    '-y', outPath
                ], (err) => err ? reject(err) : resolve());
            });
            createdFiles.push(outPath);
            const thumbnail = await generateThumbnail(outPath, filename);
            const webPath = `/clips/${filename}`;
            await db.run(
                'INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, source_video_id, duration, start_time, end_time, x, y, builder_visible) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, 220, 1)',
                [clipId, projectId, scene.name, webPath, thumbnail, scene.dur, scene.dur, x]
            );
            clipIds.push(clipId);
            x += 420;
        }

        const logicId = uuidv4();
        const choices = [
            { label: 'Open the red door', to: clipIds[1] },
            { label: 'Enter the garden', to: clipIds[2] }
        ];
        for (const choice of choices) {
            await db.run(
                'INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [projectId, clipIds[0], choice.to, choice.label, '#ffffff', 4.0, logicId, 1, '', '', 'target']
            );
        }
        await db.run('UPDATE projects SET start_clip_id = ? WHERE id = ?', [clipIds[0], projectId]);
        res.json({ success: true, projectId });
    } catch (err) {
        for (const f of createdFiles) { try { await fs.unlink(f); } catch (e) {} }
        sendApiError(res, err, 'Could not build sample story');
    }
});
app.post('/api/project/duplicate', async (req, res) => {
    try {
        ensureDbReady();
        const id = parseRequiredId(req.body && req.body.id, 'id');
        const sourceProject = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
        if (!sourceProject) return res.status(404).json({ error: 'Project not found' });

        const existingTitles = await db.all('SELECT title FROM projects');
        const duplicateTitle = buildDuplicateProjectTitle(sourceProject.title, existingTitles.map(row => row.title));

        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            const projectInsert = buildInsertStatement(
                'projects',
                sourceProject,
                { title: duplicateTitle, start_clip_id: null },
                ['id', 'created_at']
            );
            const projectResult = await db.run(projectInsert.sql, projectInsert.values);
            const newProjectId = projectResult.lastID;

            const sourceVideos = await db.all('SELECT * FROM videos WHERE project_id = ? ORDER BY id ASC', [id]);
            const sourceVideoIdMap = new Map();
            for (const video of sourceVideos) {
                const videoInsert = buildInsertStatement('videos', video, { project_id: newProjectId }, ['id', 'created_at']);
                const videoResult = await db.run(videoInsert.sql, videoInsert.values);
                sourceVideoIdMap.set(video.id, videoResult.lastID);
            }

            const sourceClips = await db.all('SELECT * FROM clips WHERE project_id = ? ORDER BY id ASC', [id]);
            const sourceClipIdMap = new Map();
            sourceClips.forEach(clip => sourceClipIdMap.set(clip.unique_id, uuidv4()));

            for (const clip of sourceClips) {
                const clipInsert = buildInsertStatement(
                    'clips',
                    clip,
                    {
                        unique_id: sourceClipIdMap.get(clip.unique_id),
                        project_id: newProjectId,
                        source_video_id: clip.source_video_id ? (sourceVideoIdMap.get(clip.source_video_id) || null) : null,
                        timeout_to_id: clip.timeout_to_id ? (sourceClipIdMap.get(clip.timeout_to_id) || clip.timeout_to_id) : clip.timeout_to_id
                    },
                    ['id']
                );
                await db.run(clipInsert.sql, clipInsert.values);
            }

            const sourceEdges = await db.all('SELECT * FROM edges WHERE project_id = ? ORDER BY id ASC', [id]);
            for (const edge of sourceEdges) {
                const edgeInsert = buildInsertStatement(
                    'edges',
                    edge,
                    {
                        project_id: newProjectId,
                        from_id: sourceClipIdMap.get(edge.from_id) || edge.from_id,
                        to_id: edge.to_id ? (sourceClipIdMap.get(edge.to_id) || edge.to_id) : edge.to_id
                    },
                    ['id']
                );
                await db.run(edgeInsert.sql, edgeInsert.values);
            }

            const duplicatedStartClipId = sourceProject.start_clip_id ? (sourceClipIdMap.get(sourceProject.start_clip_id) || null) : null;
            await db.run('UPDATE projects SET start_clip_id = ? WHERE id = ?', [duplicatedStartClipId, newProjectId]);
            await db.exec('COMMIT');

            const duplicatedProject = await db.get('SELECT * FROM projects WHERE id = ?', [newProjectId]);
            res.json({ success: true, project: duplicatedProject });
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/project/rename', async (req, res) => {
    try {
        ensureDbReady();
        const id = parseRequiredId(req.body && req.body.id, 'id');
        const title = ensureName(req.body && req.body.title, 'Project title is required');
        const result = await db.run('UPDATE projects SET title = ? WHERE id = ?', [title, id]);
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Project not found' });
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/project/delete', async (req, res) => {
    try {
        ensureDbReady();
        const id = parseRequiredId(req.body && req.body.id, 'id');
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const projectVideos = await db.all('SELECT * FROM videos WHERE project_id = ?', [id]);
        const projectClips = await db.all('SELECT * FROM clips WHERE project_id = ?', [id]);
        const assetPaths = [
            ...projectVideos.flatMap(video => [video.filepath, video.thumbnail]),
            ...projectClips.flatMap(clip => [clip.filepath, clip.thumbnail, clip.bg_music])
        ];

        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            await db.run('DELETE FROM analytics WHERE project_id = ?', [id]);
            await db.run('DELETE FROM edges WHERE project_id = ?', [id]);
            await db.run('DELETE FROM clips WHERE project_id = ?', [id]);
            await db.run('DELETE FROM videos WHERE project_id = ?', [id]);
            await db.run('DELETE FROM projects WHERE id = ?', [id]);
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }

        await removeUnusedPublicAssets(assetPaths);
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/project/settings', async (req, res) => {
    try {
        const projectId = parseRequiredId(req.body && req.body.id, 'id');
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const color = normalizeThemeColor((req.body && req.body.color) || project.theme_color || '#3b82f6');
        const genre = normalizeProjectGenre(req.body && Object.prototype.hasOwnProperty.call(req.body, 'genre') ? req.body.genre : project.genre);
        const synopsis = normalizeProjectSynopsis(req.body && Object.prototype.hasOwnProperty.call(req.body, 'synopsis') ? req.body.synopsis : project.synopsis);
        await db.run('UPDATE projects SET theme_color = ?, genre = ?, synopsis = ? WHERE id = ?', [color, genre, synopsis, projectId]);
        const updatedProject = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        res.json({ success: true, project: updatedProject });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/project/start_clip', async (req, res) => {
    try {
        const { projectId, clipId } = req.body;
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeClipId = String(clipId || '').trim();
        if (safeClipId) {
            const clip = await db.get('SELECT unique_id FROM clips WHERE unique_id = ? AND project_id = ?', [safeClipId, safeProjectId]);
            if (!clip) return res.status(404).json({ error: 'Clip not found' });
            await db.run('UPDATE clips SET builder_visible = 1 WHERE unique_id = ? AND project_id = ?', [safeClipId, safeProjectId]);
        }
        const result = await db.run('UPDATE projects SET start_clip_id = ? WHERE id = ?', [safeClipId || null, safeProjectId]);
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Project not found' });
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/clip/builder', async (req, res) => {
    try {
        const { projectId, clipId, visible } = req.body;
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeClipId = String(clipId || '').trim();
        if (!safeClipId) return res.status(400).json({ error: 'clipId required' });
        const clip = await db.get('SELECT unique_id FROM clips WHERE unique_id = ? AND project_id = ?', [safeClipId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });
        await db.run('UPDATE clips SET builder_visible = ? WHERE unique_id = ? AND project_id = ?', [visible ? 1 : 0, safeClipId, safeProjectId]);
        if (!visible) {
            await db.run('UPDATE projects SET start_clip_id = NULL WHERE id = ? AND start_clip_id = ?', [safeProjectId, safeClipId]);
        }
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- STATS ROUTES ---
app.post('/api/analytics/track', async (req, res) => {
    try {
        ensureDbReady();
        const projectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        await db.run(
            'INSERT INTO analytics (project_id, choice_label, target_clip_id) VALUES (?, ?, ?)',
            [projectId, req.body.label || 'Choice', req.body.target || null]
        );
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.get('/api/analytics/:projectId', async (req, res) => {
    try {
        const projectId = parseRequiredId(req.params && req.params.projectId, 'projectId');
        const rows = await db.all(
            'SELECT choice_label, COUNT(*) as count FROM analytics WHERE project_id = ? GROUP BY choice_label ORDER BY count DESC',
            [projectId]
        );
        res.json(rows);
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/analytics/reset', async (req, res) => {
    try {
        const projectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        await db.run('DELETE FROM analytics WHERE project_id = ?', [projectId]);
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/exports', async (req, res) => {
    try {
        const exportDir = path.join(__dirname, 'public/exports');
        const dirs = await fs.readdir(exportDir);
        const builds = [];
        for (const dir of dirs) {
            const dirPath = path.join(exportDir, dir);
            if ((await fs.stat(dirPath)).isDirectory() && await fs.pathExists(path.join(dirPath, 'index.html'))) {
                builds.push({ name: dir, url: `/exports/${dir}/index.html` });
            }
        }
        res.json(builds.reverse());
    } catch (e) { res.json([]); }
});
app.post('/api/delete_export', async (req, res) => {
    try {
        const raw = String(req.body.name || '');
        if (!/^[a-z0-9_]+$/i.test(raw)) return res.status(400).json({ error: 'Invalid export name' });
        await fs.remove(path.join(__dirname, 'public/exports', raw));
        await db.run('DELETE FROM published_movies WHERE export_name = ?', [raw]);
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        ensureDbReady();
        const projectId = parseProjectId(req.body && req.body.projectId, 1);
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const project = await db.get('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (req.file.mimetype.startsWith('audio')) {
            return res.json({ success: true, type: 'audio', path: `/audio/${req.file.filename}`, name: req.file.originalname });
        }

        const filename = req.file.filename;
        const webPath = `/videos/${filename}`;
        const duration = await probeDuration(req.file.path);
        const thumbnail = await generateThumbnail(req.file.path, filename);
        const result = await db.run(
            'INSERT INTO videos (project_id, filename, filepath, thumbnail, duration) VALUES (?, ?, ?, ?, ?)',
            [projectId, req.file.originalname, webPath, thumbnail, duration]
        );
        const clipId = uuidv4();
        await db.run(
            'INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, source_video_id, duration, x, y, builder_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
            [clipId, projectId, `FULL: ${req.file.originalname}`, webPath, thumbnail, result.lastID, duration, 100, 100]
        );
        res.json({ success: true, type: 'video' });
    } catch (err) {
        console.error(err);
        sendApiError(res, err, 'Upload failed');
    }
});

app.get('/api/videos', async (req, res) => {
    try {
        const projectId = parseProjectId(req.query && req.query.projectId, 1);
        const videos = await db.all('SELECT * FROM videos WHERE project_id = ? ORDER BY id DESC', [projectId]);
        res.json(videos);
    } catch (err) {
        sendApiError(res, err);
    }
});
app.get('/api/audio', async (req, res) => { try{ const files = await fs.readdir(path.join(__dirname, 'public/audio')); res.json(files.map(f => ({ name: f, path: `/audio/${f}` }))); }catch(e){res.json([])} });

app.post('/api/delete_video', async (req, res) => { 
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const id = parseRequiredId(req.body && req.body.id, 'id');
        const vid = await db.get('SELECT * FROM videos WHERE id = ? AND project_id = ?', [id, safeProjectId]); 
        if (!vid) return res.status(404).json({ error: 'Video not found' });
        if (vid) { 
            const relatedClips = await db.all('SELECT * FROM clips WHERE source_video_id = ?', [id]);
            const assetPaths = [
                vid.filepath,
                vid.thumbnail,
                ...relatedClips.flatMap(clip => [clip.filepath, clip.thumbnail, clip.bg_music])
            ];

            await db.exec('BEGIN IMMEDIATE TRANSACTION');
            try {
                for (const clip of relatedClips) {
                    await cleanupClipReferences(clip.unique_id);
                }
                await db.run('DELETE FROM videos WHERE id = ?', [id]); 
                await db.run('DELETE FROM clips WHERE source_video_id = ?', [id]); 
                await db.exec('COMMIT');
            } catch (err) {
                await db.exec('ROLLBACK');
                throw err;
            }

            await removeUnusedPublicAssets(assetPaths);
        } 
        res.json({ success: true }); 
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip', async (req, res) => {
    const { projectId, sourceId, start, end, name, filter, speed, volume } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const project = await db.get('SELECT id FROM projects WHERE id = ?', [safeProjectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const { video, sourcePath } = await getVideoOrThrow(sourceId);
        if (toFiniteNumber(video.project_id, 0) !== safeProjectId) {
            return res.status(404).json({ error: 'Source video not found in this project' });
        }
        const clipName = ensureName(name, 'Clip name is required');
        const { startTime, endTime } = validateClipWindow(start, end, video.duration);
        const clipId = uuidv4();
        const outputFilename = `clip_${clipId}.mp4`;
        const outputPath = path.join(__dirname, 'public/clips', outputFilename);

        const safeFilter = String(filter || 'none').toLowerCase();
        if (!['none', 'bw', 'sepia', 'vivid'].includes(safeFilter)) throw createHttpError('Invalid filter', 400);
        const safeSpeed = toFiniteNumber(speed, 1);
        if (safeSpeed <= 0) throw createHttpError('Invalid speed', 400);
        if (safeSpeed < 0.5 || safeSpeed > 2) throw createHttpError('Speed must be between 0.5 and 2.0', 400);
        const safeVolume = toFiniteNumber(volume, 1);
        if (!Number.isFinite(safeVolume) || safeVolume < 0) throw createHttpError('Invalid volume', 400);

        let duration = endTime - startTime;
        let responded = false;
        let command = ffmpeg(sourcePath).setStartTime(startTime).setDuration(duration);
        const audioFilters = [];
        const videoFilters = [];
        if (safeSpeed !== 1) {
            audioFilters.push(`atempo=${safeSpeed}`);
            duration = duration / safeSpeed;
            videoFilters.push(`setpts=${1 / safeSpeed}*PTS`);
        }
        if (safeFilter === 'bw') videoFilters.push('hue=s=0');
        if (safeFilter === 'sepia') videoFilters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
        if (safeFilter === 'vivid') videoFilters.push('eq=saturation=2');
        if (safeVolume !== 1) audioFilters.push(`volume=${safeVolume}`);
        if (audioFilters.length) command.audioFilters(audioFilters);
        if (videoFilters.length) command.videoFilters(videoFilters);
        
        command.videoCodec('libx264').audioCodec('aac').outputOptions('-preset ultrafast').output(outputPath).on('end', async () => {
            try {
                if (responded) return;
                const thumbnail = await generateThumbnail(outputPath, outputFilename); 
                const webPath = `/clips/${outputFilename}`;
                await db.run(
                    'INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, source_video_id, duration, start_time, end_time, x, y, builder_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
                    [clipId, safeProjectId, clipName, webPath, thumbnail, sourceId, duration, startTime, endTime, 150, 150]
                );
                responded = true;
                res.json({ success: true });
            } catch (err) {
                console.error(err);
                if (!responded) sendApiError(res, err, 'Could not save clip');
            }
        }).on('error', (err) => {
            console.error(err);
            if (!responded) {
                responded = true;
                res.status(500).json({ error: 'Render Failed' });
            }
        }).run();
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/duplicate', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const sourceClipId = parseUniqueId(req.body && req.body.id, 'id');
        const sourceClip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [sourceClipId, safeProjectId]);
        if (!sourceClip) return res.status(404).json({ error: 'Clip not found' });
        if (String(sourceClip.name || '').startsWith('FULL:')) {
            return res.status(400).json({ error: 'Source clips are already reusable. Duplicate a scene or event clip instead.' });
        }

        const existingTitles = await db.all('SELECT name FROM clips WHERE project_id = ?', [safeProjectId]);
        const duplicateTitle = buildDuplicateClipTitle(sourceClip.name, existingTitles.map(row => row.name));
        const sourceEdges = await db.all('SELECT * FROM edges WHERE project_id = ? AND from_id = ? ORDER BY id ASC', [safeProjectId, sourceClipId]);
        const logicIdMap = new Map();
        const duplicatedClipId = uuidv4();

        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            const clipInsert = buildInsertStatement(
                'clips',
                sourceClip,
                {
                    unique_id: duplicatedClipId,
                    name: duplicateTitle,
                    x: toFiniteNumber(sourceClip.x, 0) + 56,
                    y: toFiniteNumber(sourceClip.y, 0) + 56,
                    builder_visible: 1
                },
                ['id']
            );
            await db.run(clipInsert.sql, clipInsert.values);

            for (const edge of sourceEdges) {
                const originalLogicId = String(edge.logic_id || '').trim();
                let nextLogicId = null;
                if (originalLogicId) {
                    if (!logicIdMap.has(originalLogicId)) {
                        logicIdMap.set(
                            originalLogicId,
                            originalLogicId === `builder_${sourceClipId}` ? `builder_${duplicatedClipId}` : uuidv4()
                        );
                    }
                    nextLogicId = logicIdMap.get(originalLogicId);
                }

                const duplicatedTargetId = edge.to_id === sourceClipId ? duplicatedClipId : edge.to_id;
                const edgeInsert = buildInsertStatement(
                    'edges',
                    edge,
                    {
                        from_id: duplicatedClipId,
                        to_id: duplicatedTargetId,
                        logic_id: nextLogicId
                    },
                    ['id']
                );
                await db.run(edgeInsert.sql, edgeInsert.values);
            }

            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }

        const duplicatedClip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [duplicatedClipId, safeProjectId]);
        res.json({ success: true, clip: duplicatedClip, duplicatedChoices: sourceEdges.length });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/update_event_logic', async (req, res) => {
    const { projectId, clipId, name, choices } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeClipId = String(clipId || '').trim();
        if (!safeClipId) throw createHttpError('clipId required', 400);
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [safeClipId, safeProjectId]);
        if (!clip) throw createHttpError('Clip not found', 404);
        if (name !== undefined) {
            const safeName = ensureName(name, 'Clip name is required');
            await db.run('UPDATE clips SET name = ? WHERE unique_id = ? AND project_id = ?', [safeName, safeClipId, safeProjectId]);
        }
        await db.run('DELETE FROM edges WHERE project_id = ? AND from_id = ?', [safeProjectId, safeClipId]);

        const triggerTime = Math.max(0, clip.duration - 0.2);
        const logicId = uuidv4();

        if (choices && Array.isArray(choices)) {
            for (const choice of choices) {
                if (choice && choice.label) {
                    const actionType = normalizeActionType(choice);
                    const targetId = normalizeChoiceTargetId(choice);
                    if (actionType === 'target' && !targetId) continue;
                    await db.run(
                        `INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [safeProjectId, safeClipId, actionType === 'target' ? targetId : null, choice.label, choice.color || '#ffffff', triggerTime, logicId, actionType === 'target' && choice.returnToMain ? 1 : 0, choice.setVar, choice.reqVar, actionType]
                    );
                }
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        sendApiError(res, err);
    }
});

app.post('/api/create_event_clip', async (req, res) => {
    const { projectId, sourceId, start, end, name, choices } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const project = await db.get('SELECT id FROM projects WHERE id = ?', [safeProjectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const { video, sourcePath } = await getVideoOrThrow(sourceId);
        if (toFiniteNumber(video.project_id, 0) !== safeProjectId) {
            return res.status(404).json({ error: 'Source video not found in this project' });
        }
        const clipName = ensureName(name, 'Event name is required');
        const { startTime, endTime } = validateClipWindow(start, end, video.duration);
        const clipId = uuidv4();
        const outputFilename = `event_${clipId}.mp4`;
        const outputPath = path.join(__dirname, 'public/clips', outputFilename);
        
        let duration = endTime - startTime;
        let responded = false;

        let command = ffmpeg(sourcePath).setStartTime(startTime).setDuration(duration);
        
        command.videoCodec('libx264').audioCodec('aac').outputOptions('-preset ultrafast').output(outputPath).on('end', async () => {
            try {
                if (responded) return;
                const thumbnail = await generateThumbnail(outputPath, outputFilename); 
                const webPath = `/clips/${outputFilename}`;
                
                await db.run('INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, source_video_id, duration, start_time, end_time, is_event_clip, x, y, builder_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)', 
                    [clipId, safeProjectId, clipName, webPath, thumbnail, sourceId, duration, startTime, endTime, 200, 200]);
                
                const logicId = uuidv4();
                const triggerTime = Math.max(0, duration - 0.2); 
                
                if (choices && choices.length > 0) {
                    for (const choice of choices) {
                        if (choice && choice.label) {
                            const actionType = normalizeActionType(choice);
                            const targetId = normalizeChoiceTargetId(choice);
                            if (actionType === 'target' && !targetId) continue;
                            await db.run('INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
                            [safeProjectId, clipId, actionType === 'target' ? targetId : null, choice.label, choice.color || '#ffffff', triggerTime, logicId, actionType === 'target' && choice.returnToMain ? 1 : 0, choice.setVar, choice.reqVar, actionType]); 
                        }
                    }
                }
                responded = true;
                res.json({ success: true, clipId });
            } catch (err) {
                console.error(err);
                if (!responded) sendApiError(res, err, 'Could not create event clip');
            }
        }).on('error', (err) => { console.error(err); if (!responded) { responded = true; res.status(500).json({ error: "Render Failed" }); } }).run();
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/positions', async (req, res) => {
    const { projectId, updates } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        if (!Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });
        for(const u of updates) {
            if (!u || !u.id) continue;
            await db.run('UPDATE clips SET x = ?, y = ? WHERE unique_id = ? AND project_id = ?', [toFiniteNumber(u.x, 0), toFiniteNumber(u.y, 0), u.id, safeProjectId]);
        }
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/delete_clip', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const uniqueId = parseUniqueId(req.body && req.body.unique_id);
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [uniqueId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });
        if (String(clip.name || '').startsWith('FULL:')) {
            return res.status(400).json({ error: 'Use delete video for source clips' });
        }
        const assetPaths = [clip.filepath, clip.thumbnail, clip.bg_music];
        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            await db.run('DELETE FROM clips WHERE unique_id = ? AND project_id = ?', [uniqueId, safeProjectId]);
            await cleanupClipReferences(uniqueId);
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }
        await removeUnusedPublicAssets(assetPaths);
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/clip/update', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const clipId = parseUniqueId(req.body && req.body.id, 'id');
        const name = ensureName(req.body && req.body.name, 'Clip name is required');
        const result = await db.run('UPDATE clips SET name = ? WHERE unique_id = ? AND project_id = ?', [name, clipId, safeProjectId]);
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Clip not found' });
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/meta', async (req, res) => {
    try {
        ensureDbReady();
        const body = req.body || {};
        const safeProjectId = parseRequiredId(body.projectId, 'projectId');
        const clipId = parseUniqueId(body.id, 'id');
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });

        const nextFavorite = Object.prototype.hasOwnProperty.call(body, 'favorite')
            ? (body.favorite ? 1 : 0)
            : (clip.favorite ? 1 : 0);
        const nextTags = Object.prototype.hasOwnProperty.call(body, 'tags')
            ? String(body.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 12).join(', ')
            : (clip.tags || '');
        const nextNotes = Object.prototype.hasOwnProperty.call(body, 'notes')
            ? String(body.notes || '').slice(0, 1000)
            : (clip.notes || '');
        let nextMarkers = clip.markers || '[]';
        if (Object.prototype.hasOwnProperty.call(body, 'markers')) {
            const markers = Array.isArray(body.markers) ? body.markers : [];
            nextMarkers = JSON.stringify(markers.slice(0, 40).map(m => ({
                time: Math.max(0, toFiniteNumber(m.time, 0)),
                label: String(m.label || 'Marker').slice(0, 40)
            })));
        }

        await db.run(
            'UPDATE clips SET favorite = ?, tags = ?, notes = ?, markers = ? WHERE unique_id = ? AND project_id = ?',
            [nextFavorite, nextTags, nextNotes, nextMarkers, clipId, safeProjectId]
        );
        const updated = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        res.json({ success: true, clip: updated });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/split', async (req, res) => {
    try {
        ensureDbReady();
        const body = req.body || {};
        const safeProjectId = parseRequiredId(body.projectId, 'projectId');
        const clipId = parseUniqueId(body.id, 'id');
        const splitAt = toFiniteNumber(body.time, -1);
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });
        if (String(clip.name || '').startsWith('FULL:')) {
            return res.status(400).json({ error: 'Cannot split source FULL clips. Create a scene clip first.' });
        }
        const duration = toFiniteNumber(clip.duration, 0);
        if (!(splitAt > 0.15) || !(splitAt < duration - 0.15)) {
            throw createHttpError('Split point must be inside the clip (not near the ends)', 400);
        }
        const sourcePath = path.join(__dirname, 'public', stripLeadingSlashes(clip.filepath));
        if (!(await fs.pathExists(sourcePath))) throw createHttpError('Clip file is missing', 404);

        const makePart = async (start, end, suffix) => {
            const id = uuidv4();
            const filename = `clip_${id}.mp4`;
            const outputPath = path.join(__dirname, 'public/clips', filename);
            const partDuration = end - start;
            await runFfmpeg(
                ffmpeg(sourcePath)
                    .setStartTime(start)
                    .setDuration(partDuration)
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .outputOptions(['-preset ultrafast'])
                    .output(outputPath)
            );
            const thumb = await generateThumbnail(outputPath, filename);
            const webPath = `/clips/${filename}`;
            await db.run(
                `INSERT INTO clips (unique_id, project_id, name, filepath, thumbnail, source_video_id, duration, start_time, end_time, x, y, builder_visible, favorite, tags, notes, markers, is_event_clip)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '', '[]', ?)`,
                [
                    id,
                    safeProjectId,
                    `${clip.name} ${suffix}`,
                    webPath,
                    thumb,
                    clip.source_video_id,
                    partDuration,
                    toFiniteNumber(clip.start_time, 0) + start,
                    toFiniteNumber(clip.start_time, 0) + end,
                    toFiniteNumber(clip.x, 0) + (suffix === 'B' ? 40 : 0),
                    toFiniteNumber(clip.y, 0) + (suffix === 'B' ? 40 : 0),
                    clip.builder_visible ? 1 : 0,
                    clip.tags || '',
                    clip.is_event_clip ? 1 : 0
                ]
            );
            return id;
        };

        const partA = await makePart(0, splitAt, 'A');
        const partB = await makePart(splitAt, duration, 'B');
        res.json({ success: true, partA, partB });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/clip/thumbnail', async (req, res) => {
    const { projectId, id, time } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const clipId = parseUniqueId(id, 'id');
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if(!clip) return res.status(404).json({error: "Clip not found"});
        const fullPath = path.join(__dirname, 'public', clip.filepath);
        if (!(await fs.pathExists(fullPath))) return res.status(404).json({ error: 'Clip file is missing' });
        const filename = path.basename(clip.filepath);
        const newThumb = await generateThumbnail(fullPath, filename, time);
        await db.run('UPDATE clips SET thumbnail = ? WHERE unique_id = ? AND project_id = ?', [newThumb, clipId, safeProjectId]);
        res.json({ success: true, thumbnail: newThumb });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/audio', async (req, res) => {
    const body = req.body || {};
    const { projectId, unique_id, bgMusic, muteAudio, timeoutToId, timeoutSeconds } = body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const clipId = parseUniqueId(unique_id);
        const existing = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if (!existing) return res.status(404).json({ error: 'Clip not found' });

        let nextBgMusic = existing.bg_music;
        if (Object.prototype.hasOwnProperty.call(body, 'bgMusic')) {
            nextBgMusic = bgMusic ? String(bgMusic).trim() : null;
            if (nextBgMusic && !nextBgMusic.startsWith('/audio/')) {
                throw createHttpError('bgMusic must reference an /audio file', 400);
            }
            if (nextBgMusic) {
                const bgMusicPath = path.join(__dirname, 'public', nextBgMusic.replace(/^\/+/, ''));
                if (!(await fs.pathExists(bgMusicPath))) {
                    throw createHttpError('Audio file not found', 404);
                }
            }
        }

        const nextMute = Object.prototype.hasOwnProperty.call(body, 'muteAudio')
            ? (muteAudio ? 1 : 0)
            : (existing.mute_audio ? 1 : 0);

        let nextTimeoutToId = existing.timeout_to_id;
        if (Object.prototype.hasOwnProperty.call(body, 'timeoutToId')) {
            nextTimeoutToId = timeoutToId ? String(timeoutToId).trim() : null;
            if (nextTimeoutToId) {
                const target = await db.get(
                    'SELECT unique_id FROM clips WHERE unique_id = ? AND project_id = ?',
                    [nextTimeoutToId, safeProjectId]
                );
                if (!target) throw createHttpError('Timeout target clip not found', 404);
            }
        }

        let nextTimeoutSeconds = existing.timeout_seconds;
        if (Object.prototype.hasOwnProperty.call(body, 'timeoutSeconds')) {
            nextTimeoutSeconds = timeoutSeconds === undefined || timeoutSeconds === null || timeoutSeconds === ''
                ? null
                : Math.max(0, toFiniteNumber(timeoutSeconds, 0));
        }

        await db.run(
            'UPDATE clips SET bg_music = ?, mute_audio = ?, timeout_to_id = ?, timeout_seconds = ? WHERE unique_id = ? AND project_id = ?',
            [nextBgMusic || null, nextMute, nextTimeoutToId, nextTimeoutSeconds, clipId, safeProjectId]
        );
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/story', async (req, res) => { 
    try {
        ensureDbReady();
        const projectId = parseProjectId(req.query && req.query.projectId, 1);
        const project = await db.get('SELECT id FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        await ensureBuilderVisibility(projectId);
        const clips = await db.all('SELECT * FROM clips WHERE project_id = ? ORDER BY id DESC', [projectId]); 
        const edges = await db.all('SELECT * FROM edges WHERE project_id = ? ORDER BY trigger_time ASC', [projectId]); 
        res.json({ clips, edges });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/save_logic_block', async (req, res) => {
    const { projectId, fromId, logicId, triggerTime, choices, bgMusic, muteAudio } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeFromId = String(fromId || '').trim();
        if (!safeFromId) return res.status(400).json({ error: 'fromId required' });
        const normalizedBgMusic = bgMusic ? String(bgMusic).trim() : null;
        if (normalizedBgMusic && !normalizedBgMusic.startsWith('/audio/')) {
            throw createHttpError('bgMusic must reference an /audio file', 400);
        }
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [safeFromId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Source clip not found' });
        const newLogicId = String(logicId || '').trim() || uuidv4();
        const safeTriggerTime = Math.max(0, toFiniteNumber(triggerTime, 0));
        const safeChoices = Array.isArray(choices) ? choices : [];
        await db.run('UPDATE clips SET bg_music = ?, mute_audio = ? WHERE unique_id = ? AND project_id = ?', [normalizedBgMusic || null, muteAudio ? 1 : 0, safeFromId, safeProjectId]);
        if (logicId) await db.run('DELETE FROM edges WHERE project_id = ? AND logic_id = ?', [safeProjectId, logicId]);
        for (const choice of safeChoices) { 
            const actionType = normalizeActionType(choice);
            const targetId = normalizeChoiceTargetId(choice);
            if (actionType === 'target' && !targetId) continue;
            await db.run('INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
            [safeProjectId, safeFromId, actionType === 'target' ? targetId : null, choice.label || 'Choice', choice.color || '#ffffff', safeTriggerTime, newLogicId, actionType === 'target' && choice.return ? 1 : 0, choice.setVar, choice.reqVar, actionType]); 
        }
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/delete_logic_block', async (req, res) => {
    const { projectId, logicId, fromId, triggerTime } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeLogicId = String(logicId || '').trim();
        const safeFromId = String(fromId || '').trim();
        if (safeLogicId && !safeLogicId.startsWith('legacy_')) {
            await db.run('DELETE FROM edges WHERE project_id = ? AND logic_id = ?', [safeProjectId, safeLogicId]);
        } else {
            if (!safeFromId) return res.status(400).json({ error: 'fromId required' });
            const safeTriggerTime = toFiniteNumber(triggerTime, 0);
            await db.run('DELETE FROM edges WHERE project_id = ? AND from_id = ? AND trigger_time BETWEEN ? AND ?', [safeProjectId, safeFromId, safeTriggerTime - 0.01, safeTriggerTime + 0.01]);
        }
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/edge/update', async (req, res) => {
    try {
        ensureDbReady();
        const { projectId, id, toId, label, color, returnToMain, setVar, reqVar, actionType } = req.body;
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeId = parseRequiredId(id, 'id');
        const normalizedAction = normalizeActionType({ actionType });
        const targetId = normalizeChoiceTargetId({ toId });
        if (normalizedAction === 'target' && !targetId) return res.status(400).json({ error: 'Target clip required for this choice type' });
        const result = await db.run(
            'UPDATE edges SET to_id = ?, label = ?, text_color = ?, return_to_main = ?, set_var = ?, req_var = ?, action_type = ? WHERE id = ? AND project_id = ?',
            [normalizedAction === 'target' ? targetId : null, label || 'Choice', color || '#ffffff', normalizedAction === 'target' && returnToMain ? 1 : 0, setVar || null, reqVar || null, normalizedAction, safeId, safeProjectId]
        );
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Edge not found' });
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/edge/delete', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const edgeId = parseRequiredId(req.body && req.body.id, 'id');
        const result = await db.run('DELETE FROM edges WHERE id = ? AND project_id = ?', [edgeId, safeProjectId]);
        if (!result || result.changes === 0) return res.status(404).json({ error: 'Edge not found' });
        res.json({ success: true });
    } catch (err) {
        sendApiError(res, err);
    }
});
app.post('/api/builder/connect', async (req, res) => {
    try {
        ensureDbReady();
        const { projectId, fromId, toId, label, color, returnToMain, setVar, reqVar, actionType } = req.body;
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const safeFromId = String(fromId || '').trim();
        const safeToId = String(toId || '').trim() || null;
        if (!safeFromId) return res.status(400).json({ error: 'fromId required' });
        const normalizedAction = normalizeActionType({ actionType });
        if (normalizedAction === 'target' && !safeToId) return res.status(400).json({ error: 'toId required for target choices' });

        const fromClip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [safeFromId, safeProjectId]);
        if (!fromClip) return res.status(404).json({ error: 'Source clip not found' });
        let toClip = null;
        if (safeToId) {
            toClip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [safeToId, safeProjectId]);
            if (!toClip && normalizedAction === 'target') return res.status(404).json({ error: 'Target clip not found' });
        }

        if (safeToId) {
            await db.run('UPDATE clips SET builder_visible = 1 WHERE unique_id IN (?, ?) AND project_id = ?', [safeFromId, safeToId, safeProjectId]);
        } else {
            await db.run('UPDATE clips SET builder_visible = 1 WHERE unique_id = ? AND project_id = ?', [safeFromId, safeProjectId]);
        }
        const logicId = `builder_${safeFromId}`;
        const triggerTime = defaultTriggerTimeForClip(fromClip);
        await db.run('UPDATE edges SET trigger_time = ? WHERE project_id = ? AND logic_id = ?', [triggerTime, safeProjectId, logicId]);

        const edgeTarget = normalizedAction === 'target' ? safeToId : null;
        const existing = await db.get(
            'SELECT * FROM edges WHERE project_id = ? AND logic_id = ? AND from_id = ? AND ((to_id = ?) OR (to_id IS NULL AND ? IS NULL))',
            [safeProjectId, logicId, safeFromId, edgeTarget, edgeTarget]
        );
        const fallbackLabel = normalizedAction === 'next'
            ? 'Next scene'
            : (normalizedAction === 'end' ? 'End movie' : ((toClip && toClip.name) || 'Choice'));
        if (existing) {
            await db.run(
                'UPDATE edges SET label = ?, text_color = ?, return_to_main = ?, set_var = ?, req_var = ?, trigger_time = ?, action_type = ? WHERE id = ?',
                [label || existing.label || fallbackLabel, color || existing.text_color || '#ffffff', normalizedAction === 'target' && returnToMain ? 1 : 0, setVar || null, reqVar || null, triggerTime, normalizedAction, existing.id]
            );
            return res.json({ success: true, edgeId: existing.id, logicId, triggerTime });
        }

        const result = await db.run(
            'INSERT INTO edges (project_id, from_id, to_id, label, text_color, trigger_time, logic_id, return_to_main, set_var, req_var, action_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [safeProjectId, safeFromId, edgeTarget, label || fallbackLabel, color || '#ffffff', triggerTime, logicId, normalizedAction === 'target' && returnToMain ? 1 : 0, setVar || null, reqVar || null, normalizedAction]
        );
        res.json({ success: true, edgeId: result.lastID, logicId, triggerTime });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- PROJECT IMPORT / EXPORT ---
app.get('/api/project/export/:id', async (req, res) => {
    try {
        ensureDbReady();
        const projectId = parseRequiredId(req.params.id, 'id');
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const videos = await db.all('SELECT * FROM videos WHERE project_id = ? ORDER BY id ASC', [projectId]);
        const clips = await db.all('SELECT * FROM clips WHERE project_id = ? ORDER BY id ASC', [projectId]);
        const edges = await db.all('SELECT * FROM edges WHERE project_id = ? ORDER BY id ASC', [projectId]);
        res.json({
            version: 1,
            exportedAt: new Date().toISOString(),
            project: {
                title: project.title,
                theme_color: project.theme_color,
                genre: project.genre,
                synopsis: project.synopsis,
                start_clip_id: project.start_clip_id
            },
            videos,
            clips,
            edges
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/project/import', async (req, res) => {
    try {
        ensureDbReady();
        const payload = req.body || {};
        const sourceProject = payload.project;
        if (!sourceProject || !sourceProject.title) {
            throw createHttpError('Invalid project file: missing project.title', 400);
        }

        const existingTitles = await db.all('SELECT title FROM projects');
        const title = buildDuplicateProjectTitle(sourceProject.title, existingTitles.map(row => row.title));
        const videos = Array.isArray(payload.videos) ? payload.videos : [];
        const clips = Array.isArray(payload.clips) ? payload.clips : [];
        const edges = Array.isArray(payload.edges) ? payload.edges : [];

        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            const projectResult = await db.run(
                'INSERT INTO projects (title, theme_color, genre, synopsis, start_clip_id) VALUES (?, ?, ?, ?, NULL)',
                [
                    title,
                    normalizeThemeColor(sourceProject.theme_color || '#3b82f6'),
                    normalizeProjectGenre(sourceProject.genre),
                    normalizeProjectSynopsis(sourceProject.synopsis)
                ]
            );
            const newProjectId = projectResult.lastID;

            const sourceVideoIdMap = new Map();
            for (const video of videos) {
                const videoInsert = buildInsertStatement(
                    'videos',
                    video,
                    { project_id: newProjectId },
                    ['id', 'created_at']
                );
                const videoResult = await db.run(videoInsert.sql, videoInsert.values);
                if (video && video.id != null) sourceVideoIdMap.set(video.id, videoResult.lastID);
            }

            const sourceClipIdMap = new Map();
            clips.forEach(clip => {
                if (clip && clip.unique_id) sourceClipIdMap.set(clip.unique_id, uuidv4());
            });

            for (const clip of clips) {
                if (!clip || !clip.unique_id) continue;
                const clipInsert = buildInsertStatement(
                    'clips',
                    clip,
                    {
                        unique_id: sourceClipIdMap.get(clip.unique_id),
                        project_id: newProjectId,
                        source_video_id: clip.source_video_id ? (sourceVideoIdMap.get(clip.source_video_id) || null) : null,
                        timeout_to_id: clip.timeout_to_id ? (sourceClipIdMap.get(clip.timeout_to_id) || null) : null
                    },
                    ['id']
                );
                await db.run(clipInsert.sql, clipInsert.values);
            }

            for (const edge of edges) {
                if (!edge || !edge.from_id) continue;
                const edgeInsert = buildInsertStatement(
                    'edges',
                    edge,
                    {
                        project_id: newProjectId,
                        from_id: sourceClipIdMap.get(edge.from_id) || edge.from_id,
                        to_id: edge.to_id ? (sourceClipIdMap.get(edge.to_id) || edge.to_id) : edge.to_id
                    },
                    ['id']
                );
                await db.run(edgeInsert.sql, edgeInsert.values);
            }

            const importedStart = sourceProject.start_clip_id
                ? (sourceClipIdMap.get(sourceProject.start_clip_id) || null)
                : null;
            await db.run('UPDATE projects SET start_clip_id = ? WHERE id = ?', [importedStart, newProjectId]);
            await db.exec('COMMIT');

            const project = await db.get('SELECT * FROM projects WHERE id = ?', [newProjectId]);
            res.json({ success: true, project });
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- CLIP RE-ENCODE / BATCH / THUMBNAILS ---
app.post('/api/clip/reencode', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const clipId = parseUniqueId(req.body && req.body.id, 'id');
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });
        if (String(clip.name || '').startsWith('FULL:')) {
            return res.status(400).json({ error: 'Cannot re-encode source FULL clips' });
        }
        const result = await reencodeClipFile(clip, {
            filter: req.body.filter,
            speed: req.body.speed,
            volume: req.body.volume
        });
        res.json({ success: true, ...result });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clips/batch_delete', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) throw createHttpError('ids required', 400);

        const placeholders = ids.map(() => '?').join(', ');
        const clips = await db.all(
            `SELECT * FROM clips WHERE project_id = ? AND unique_id IN (${placeholders})`,
            [safeProjectId, ...ids]
        );
        const deletable = clips.filter(c => !String(c.name || '').startsWith('FULL:'));
        if (!deletable.length) throw createHttpError('No deletable clips selected', 400);

        const assetPaths = [];
        await db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
            for (const clip of deletable) {
                assetPaths.push(clip.filepath, clip.thumbnail, clip.bg_music);
                await db.run('DELETE FROM clips WHERE unique_id = ? AND project_id = ?', [clip.unique_id, safeProjectId]);
                await cleanupClipReferences(clip.unique_id);
            }
            await db.exec('COMMIT');
        } catch (err) {
            await db.exec('ROLLBACK');
            throw err;
        }
        await removeUnusedPublicAssets(assetPaths);
        res.json({ success: true, deleted: deletable.length });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clips/batch_rename', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) throw createHttpError('ids required', 400);
        const prefix = String(req.body.prefix || '');
        const suffix = String(req.body.suffix || '');
        let updated = 0;
        for (const id of ids) {
            const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [id, safeProjectId]);
            if (!clip || String(clip.name || '').startsWith('FULL:')) continue;
            const nextName = `${prefix}${clip.name || 'Clip'}${suffix}`.trim();
            if (!nextName) continue;
            await db.run('UPDATE clips SET name = ? WHERE unique_id = ? AND project_id = ?', [nextName, id, safeProjectId]);
            updated += 1;
        }
        res.json({ success: true, updated });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clips/batch_reencode', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) throw createHttpError('ids required', 400);
        let updated = 0;
        for (const id of ids) {
            const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [id, safeProjectId]);
            if (!clip || String(clip.name || '').startsWith('FULL:')) continue;
            await reencodeClipFile(clip, {
                filter: req.body.filter,
                speed: req.body.speed,
                volume: req.body.volume
            });
            updated += 1;
        }
        res.json({ success: true, updated });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clips/batch_audio', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
        if (!ids.length) throw createHttpError('ids required', 400);
        const muteAudio = !!(req.body && req.body.muteAudio);
        const bgMusic = req.body && req.body.bgMusic ? String(req.body.bgMusic).trim() : null;
        if (bgMusic) {
            if (!bgMusic.startsWith('/audio/')) throw createHttpError('bgMusic must reference an /audio file', 400);
            const bgMusicPath = path.join(__dirname, 'public', stripLeadingSlashes(bgMusic));
            if (!(await fs.pathExists(bgMusicPath))) throw createHttpError('Audio file not found', 404);
        }
        let updated = 0;
        for (const id of ids) {
            const result = await db.run(
                'UPDATE clips SET mute_audio = ?, bg_music = COALESCE(?, bg_music) WHERE unique_id = ? AND project_id = ?',
                [muteAudio ? 1 : 0, bgMusic, id, safeProjectId]
            );
            if (result && result.changes) updated += 1;
        }
        res.json({ success: true, updated });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/clip/thumbnails', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const clipId = parseUniqueId(req.body && req.body.clipId, 'clipId');
        const interval = Math.max(0.5, toFiniteNumber(req.body && req.body.interval, 2));
        const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
        if (!clip) return res.status(404).json({ error: 'Clip not found' });
        const fullPath = path.join(__dirname, 'public', stripLeadingSlashes(clip.filepath));
        if (!(await fs.pathExists(fullPath))) return res.status(404).json({ error: 'Clip file is missing' });
        const duration = toFiniteNumber(clip.duration, 0) || await probeDuration(fullPath);
        const timestamps = [];
        for (let t = 0; t < duration; t += interval) timestamps.push(t);
        if (!timestamps.length) timestamps.push(0);
        const limited = timestamps.slice(0, 40);
        const thumbnails = [];
        for (const t of limited) {
            const thumb = await generateThumbnail(fullPath, path.basename(clip.filepath), t);
            if (thumb) thumbnails.push({ time: t, url: thumb });
        }
        res.json({ success: true, thumbnails });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/edge/thumbnail', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const edgeId = parseRequiredId(req.body && req.body.id, 'id');
        const edge = await db.get('SELECT * FROM edges WHERE id = ? AND project_id = ?', [edgeId, safeProjectId]);
        if (!edge) return res.status(404).json({ error: 'Edge not found' });

        let thumbnail = req.body && req.body.thumbUrl ? String(req.body.thumbUrl).trim() : '';
        if (!thumbnail) {
            if (!edge.to_id) throw createHttpError('Edge has no target clip to capture from', 400);
            const target = await db.get(
                'SELECT * FROM clips WHERE unique_id = ? AND project_id = ?',
                [edge.to_id, safeProjectId]
            );
            if (!target) throw createHttpError('Target clip not found', 404);
            const fullPath = path.join(__dirname, 'public', stripLeadingSlashes(target.filepath));
            if (!(await fs.pathExists(fullPath))) throw createHttpError('Target clip file is missing', 404);
            thumbnail = await generateThumbnail(
                fullPath,
                path.basename(target.filepath),
                req.body && req.body.time != null ? req.body.time : '50%'
            );
            if (!thumbnail) throw createHttpError('Could not generate thumbnail', 500);
        }

        await db.run('UPDATE edges SET thumbnail = ? WHERE id = ? AND project_id = ?', [thumbnail, edgeId, safeProjectId]);
        res.json({ success: true, thumbnail });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- GIF EXPORT ---
app.post('/api/export/gif', async (req, res) => {
    try {
        ensureDbReady();
        const body = req.body || {};
        const safeProjectId = parseRequiredId(body.projectId, 'projectId');
        const project = await db.get('SELECT id FROM projects WHERE id = ?', [safeProjectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        let sourcePath = null;
        let label = 'clip';
        let startTime = Math.max(0, toFiniteNumber(body.start, 0));
        let endTime = body.end != null ? toFiniteNumber(body.end, startTime) : null;

        if (body.clipId) {
            const clipId = parseUniqueId(body.clipId, 'clipId');
            const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [clipId, safeProjectId]);
            if (!clip) return res.status(404).json({ error: 'Clip not found' });
            sourcePath = path.join(__dirname, 'public', stripLeadingSlashes(clip.filepath));
            label = String(clip.name || 'clip').replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'clip';
            if (endTime == null) {
                endTime = toFiniteNumber(clip.duration, 0);
                startTime = 0;
            }
        } else if (body.sourceId) {
            const { video, sourcePath: videoPath } = await getVideoOrThrow(body.sourceId);
            if (toFiniteNumber(video.project_id, 0) !== safeProjectId) {
                return res.status(404).json({ error: 'Source video not found in this project' });
            }
            sourcePath = videoPath;
            label = String(video.filename || 'source').replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'source';
            if (endTime == null) endTime = toFiniteNumber(video.duration, startTime + 3);
        } else {
            throw createHttpError('clipId or sourceId is required', 400);
        }

        if (!(await fs.pathExists(sourcePath))) throw createHttpError('Source media file is missing', 404);
        if (!(endTime > startTime)) throw createHttpError('End time must be greater than start time', 400);

        let duration = endTime - startTime;
        // Cap GIF length so exports stay usable in browsers
        const maxDuration = 15;
        if (duration > maxDuration) {
            duration = maxDuration;
            endTime = startTime + maxDuration;
        }

        const fps = Math.min(15, Math.max(6, Math.round(toFiniteNumber(body.fps, 10))));
        const width = Math.min(640, Math.max(160, Math.round(toFiniteNumber(body.width, 400))));
        const gifName = `gif_${Date.now()}_${label}.gif`;
        const gifPath = path.join(__dirname, 'public', 'gifs', gifName);
        const palettePath = path.join(__dirname, 'public', 'gifs', `palette_${Date.now()}.png`);
        await fs.ensureDir(path.dirname(gifPath));

        try {
            await runFfmpeg(
                ffmpeg(sourcePath)
                    .setStartTime(startTime)
                    .setDuration(duration)
                    .outputOptions([
                        '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff`
                    ])
                    .output(palettePath)
            );
            await runFfmpeg(
                ffmpeg(sourcePath)
                    .setStartTime(startTime)
                    .setDuration(duration)
                    .input(palettePath)
                    .complexFilter([
                        `[0:v]fps=${fps},scale=${width}:-1:flags=lanczos[x]`,
                        `[x][1:v]paletteuse=dither=bayer:bayer_scale=3`
                    ])
                    .outputOptions(['-loop', '0'])
                    .output(gifPath)
            );
        } finally {
            await fs.remove(palettePath).catch(() => {});
        }

        res.json({
            success: true,
            url: `/gifs/${gifName}`,
            duration,
            fps,
            width,
            start: startTime,
            end: endTime
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- LINEAR MP4 EXPORT ---
app.post('/api/export/mp4', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const pathIds = Array.isArray(req.body && req.body.path) ? req.body.path.map(String).filter(Boolean) : [];
        if (pathIds.length < 2) throw createHttpError('Select at least 2 clips', 400);
        const crossfade = !!(req.body && req.body.crossfade);

        const clips = [];
        for (const id of pathIds) {
            const clip = await db.get('SELECT * FROM clips WHERE unique_id = ? AND project_id = ?', [id, safeProjectId]);
            if (!clip) throw createHttpError(`Clip not found: ${id}`, 404);
            const fullPath = path.join(__dirname, 'public', stripLeadingSlashes(clip.filepath));
            if (!(await fs.pathExists(fullPath))) throw createHttpError(`Missing clip file: ${clip.name}`, 404);
            clips.push({ ...clip, fullPath });
        }

        const exportName = `linear_${Date.now()}.mp4`;
        const outputPath = path.join(__dirname, 'public/exports', exportName);
        await fs.ensureDir(path.dirname(outputPath));

        if (!crossfade || clips.length === 2) {
            // Concat demuxer is reliable for simple joins
            const listPath = path.join(__dirname, 'public/exports', `concat_${Date.now()}.txt`);
            const listBody = clips.map(c => `file '${c.fullPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
            await fs.writeFile(listPath, listBody);
            try {
                await runFfmpeg(
                    ffmpeg()
                        .input(listPath)
                        .inputOptions(['-f concat', '-safe 0'])
                        .outputOptions(['-c copy'])
                        .output(outputPath)
                );
            } catch (_) {
                // Fallback re-encode if stream copy fails
                await runFfmpeg(
                    ffmpeg()
                        .input(listPath)
                        .inputOptions(['-f concat', '-safe 0'])
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .outputOptions(['-preset ultrafast'])
                        .output(outputPath)
                );
            } finally {
                await fs.remove(listPath).catch(() => {});
            }
        } else {
            // Re-encode concat with optional short crossfade via xfade filter chain
            let command = ffmpeg();
            clips.forEach(c => { command = command.input(c.fullPath); });
            const fadeDur = 0.5;
            let filter = '';
            let lastLabel = '[0:v]';
            let lastAudio = '[0:a]';
            let offset = Math.max(0, toFiniteNumber(clips[0].duration, 1) - fadeDur);
            for (let i = 1; i < clips.length; i++) {
                const vOut = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
                const aOut = i === clips.length - 1 ? '[aout]' : `[a${i}]`;
                filter += `${lastLabel}[${i}:v]xfade=transition=fade:duration=${fadeDur}:offset=${offset}${vOut};`;
                filter += `${lastAudio}[${i}:a]acrossfade=d=${fadeDur}${aOut};`;
                lastLabel = vOut;
                lastAudio = aOut;
                offset += Math.max(0, toFiniteNumber(clips[i].duration, 1) - fadeDur);
            }
            await runFfmpeg(
                command
                    .complexFilter(filter.replace(/;$/g, ''))
                    .outputOptions(['-map [vout]', '-map [aout]', '-preset ultrafast'])
                    .videoCodec('libx264')
                    .audioCodec('aac')
                    .output(outputPath)
            );
        }

        res.json({ success: true, url: `/exports/${exportName}` });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- AI ASSISTANT ---
app.get('/api/ai/movie-agent/context/:projectId', async (req, res) => {
    try {
        const context = await getMovieAgentContext(req.params.projectId);
        res.json({
            success: true,
            inventory: summarizeMovieAgentInventory(context),
            project: {
                id: context.project.id,
                title: context.project.title,
                genre: context.project.genre,
                synopsis: context.project.synopsis
            }
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/ai/movie-agent/plan', async (req, res) => {
    try {
        const body = req.body || {};
        const context = await getMovieAgentContext(body.projectId);
        const result = await createMovieAgentPlan(context, {
            premise: body.premise,
            genre: body.genre,
            tone: body.tone,
            targetScenes: body.targetScenes
        });
        res.json({ success: true, ...result });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/ai/movie-agent/apply', async (req, res) => {
    try {
        const body = req.body || {};
        const context = await getMovieAgentContext(body.projectId);
        const build = await applyMovieAgentPlan(context, body.plan, {
            replaceExisting: body.replaceExisting,
            renameProject: body.renameProject
        });
        res.json({ success: true, build });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.get('/api/ai/settings', async (req, res) => {
    try {
        const settings = await readAiSettings();
        res.json({
            success: true,
            settings: {
                provider: settings.provider,
                model: settings.model,
                apiKey: settings.apiKey ? '••••••••' : '',
                ollamaHost: settings.ollamaHost,
                hasApiKey: !!settings.apiKey
            }
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.put('/api/ai/settings', async (req, res) => {
    try {
        const current = await readAiSettings();
        const body = req.body || {};
        const next = {
            provider: body.provider != null ? body.provider : current.provider,
            model: body.model != null ? body.model : current.model,
            ollamaHost: body.ollamaHost != null ? body.ollamaHost : current.ollamaHost,
            apiKey: body.apiKey && body.apiKey !== '••••••••' ? body.apiKey : current.apiKey
        };
        const saved = await writeAiSettings(next);
        res.json({
            success: true,
            settings: {
                provider: saved.provider,
                model: saved.model,
                apiKey: saved.apiKey ? '••••••••' : '',
                ollamaHost: saved.ollamaHost,
                hasApiKey: !!saved.apiKey
            }
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/ai/test', async (req, res) => {
    try {
        const body = req.body || {};
        const current = await readAiSettings();
        const settings = {
            provider: body.provider || current.provider,
            model: body.model || current.model,
            ollamaHost: body.ollamaHost || current.ollamaHost,
            apiKey: body.apiKey && body.apiKey !== '••••••••' ? body.apiKey : current.apiKey
        };
        const response = await callAiChat(settings, 'Reply with exactly: OK', 'You are a connection test bot.');
        res.json({ success: true, response: String(response || '').slice(0, 200) });
    } catch (err) {
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.message || 'Connection failed',
            response: err.message || 'Connection failed'
        });
    }
});

app.post('/api/ai/generate', async (req, res) => {
    try {
        const premise = String((req.body && req.body.premise) || '').trim();
        if (!premise) throw createHttpError('premise is required', 400);
        const genre = String((req.body && req.body.genre) || 'Mystery').trim();
        const targetScenes = Math.max(2, Math.min(12, Number((req.body && req.body.targetScenes) || 5)));
        const tone = String((req.body && req.body.tone) || 'neutral').trim();
        const settings = await readAiSettings();

        const prompt = `Create an interactive choose-your-own-adventure outline as JSON only.
Premise: ${premise}
Genre: ${genre}
Tone: ${tone}
Target scenes: ${targetScenes}
Return JSON shaped like:
{
  "title": "...",
  "genre": "...",
  "tone": "...",
  "premise": "...",
  "scenes": [
    { "id": 1, "title": "...", "description": "...", "choices": [{ "label": "...", "goesTo": 2 }] }
  ]
}`;

        let outline = null;
        try {
            const text = await callAiChat(settings, prompt);
            outline = extractJsonBlock(text);
        } catch (err) {
            console.warn('AI generate failed, using fallback outline:', err.message);
        }
        if (!outline || !Array.isArray(outline.scenes) || !outline.scenes.length) {
            outline = buildFallbackOutline({ premise, genre, targetScenes, tone });
        }
        res.json({ success: true, outline });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.post('/api/ai/validate', async (req, res) => {
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(req.body && req.body.projectId, 'projectId');
        const edges = await db.all('SELECT * FROM edges WHERE project_id = ?', [safeProjectId]);
        const setVars = new Set();
        const reqVars = new Set();
        edges.forEach(edge => {
            const setVar = String(edge.set_var || '').trim();
            const reqVar = String(edge.req_var || '').trim();
            if (setVar) setVars.add(setVar);
            if (reqVar) reqVars.add(reqVar);
        });
        const unset = [...reqVars].filter(v => !setVars.has(v));
        const unchecked = [...setVars].filter(v => !reqVars.has(v));
        const suggestions = [];
        if (setVars.size === 0 && edges.length > 0) {
            suggestions.push('key_found', 'ally_recruited', 'ending_unlocked');
        }
        res.json({
            success: true,
            validation: {
                setVars: [...setVars],
                reqVars: [...reqVars],
                unset,
                unchecked,
                suggestions
            }
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

// --- PUBLISH ENGINE ---
app.post('/api/publish', async (req, res) => {
    const { projectId, title, sequence } = req.body;
    try {
        ensureDbReady();
        const safeProjectId = parseRequiredId(projectId, 'projectId');
        const project = await db.get('SELECT * FROM projects WHERE id = ?', [safeProjectId]);
        if (!project) return res.status(404).json({ error: 'Project not found' });
        const seq = Array.isArray(sequence) && sequence.length > 0
            ? sequence.filter(item => item && item.id)
            : (project.start_clip_id ? [{ id: project.start_clip_id, name: 'Start Clip', startTime: 0 }] : []);
        if (seq.length === 0) return res.status(400).json({ error: 'Sequence is empty' });
        const themeColor = normalizeThemeColor(project.theme_color || '#3b82f6');
        const displayTitle = String(title || 'My Movie').trim() || 'My Movie';
        const exportName = safeExportFolderName(displayTitle);
        const exportPath = path.join(__dirname, 'public/exports', exportName);
        await fs.emptyDir(exportPath);
        await fs.ensureDir(path.join(exportPath, 'clips'));
        await fs.ensureDir(path.join(exportPath, 'audio'));
        await fs.ensureDir(path.join(exportPath, 'vendor'));

        const localVuePath = path.join(__dirname, 'public', 'vendor', 'vue.global.prod.js');
        if (!(await fs.pathExists(localVuePath))) {
            throw createHttpError('Local Vue runtime is missing from public/vendor', 500);
        }
        await fs.copy(localVuePath, path.join(exportPath, 'vendor', 'vue.global.prod.js'));

        const allClips = await db.all('SELECT * FROM clips WHERE project_id = ?', [safeProjectId]);
        const allEdges = await db.all('SELECT * FROM edges WHERE project_id = ? ORDER BY trigger_time ASC', [safeProjectId]);
        const clipIds = new Set(allClips.map(c => c.unique_id));
        const missingSequence = seq.find(item => !clipIds.has(item.id));
        if (missingSequence) return res.status(400).json({ error: `Sequence clip not found: ${missingSequence.id}` });
        const reachableClipIds = collectReachableClipIds(seq, allEdges);
        const clips = allClips.filter(clip => reachableClipIds.has(clip.unique_id));
        const edges = allEdges.filter(edge => reachableClipIds.has(edge.from_id));
        const missingChoiceTarget = edges.find(edge => {
            const actionType = edge.action_type || 'target';
            return actionType === 'target' && (!edge.to_id || !clipIds.has(edge.to_id));
        });
        if (missingChoiceTarget) {
            return res.status(400).json({ error: `Choice target not found for edge ${missingChoiceTarget.id}` });
        }

        for (const clip of clips) {
            const src = path.join(__dirname, 'public', clip.filepath); const filename = path.basename(clip.filepath); const dest = path.join(exportPath, 'clips', filename);
            if(await fs.pathExists(src)) { await fs.copy(src, dest); clip.filepath = `clips/${filename}`; }
            if(clip.thumbnail) { const thumbName = path.basename(clip.thumbnail); if(await fs.pathExists(path.join(__dirname, 'public', clip.thumbnail))) { await fs.copy(path.join(__dirname, 'public', clip.thumbnail), path.join(exportPath, 'clips', thumbName)); clip.thumbnail = `clips/${thumbName}`; } }
            if(clip.bg_music) { const audSrc = path.join(__dirname, 'public', clip.bg_music); const audName = path.basename(clip.bg_music); if(await fs.pathExists(audSrc)) { await fs.copy(audSrc, path.join(exportPath, 'audio', audName)); clip.bg_music = `audio/${audName}`; } }
        }

        const logicBlocks = {};
        edges.forEach(e => {
            const blockKey = e.logic_id != null && String(e.logic_id).length > 0
                ? e.logic_id
                : ('legacy_' + e.from_id + '_' + e.trigger_time);
            if (!logicBlocks[blockKey]) {
                logicBlocks[blockKey] = { id: blockKey, from: e.from_id, time: e.trigger_time, choices: [] };
            }
            logicBlocks[blockKey].choices.push({
                to: e.to_id,
                label: e.label,
                color: e.text_color,
                return: !!e.return_to_main,
                action: e.action_type || 'target',
                setVar: e.set_var,
                reqVar: e.req_var
            });
        });

        const safeTitle = escapeHtml(displayTitle);

        const manifest = { name: displayTitle, short_name: displayTitle, start_url: "./index.html", display: "fullscreen", background_color: "#000", theme_color: themeColor, icons: [] };
        await fs.writeFile(path.join(exportPath, 'manifest.json'), JSON.stringify(manifest));

        const htmlContent = buildPublishedPlayerHtml({
            safeTitle,
            themeColor,
            clips,
            logicBlocks: Object.values(logicBlocks),
            seq,
            projectId: safeProjectId
        });
        await fs.writeFile(path.join(exportPath, 'index.html'), htmlContent);
        const clipMap = new Map(clips.map(clip => [clip.unique_id, clip]));
        const featuredClip = clipMap.get(seq[0].id) || clips[0] || null;
        const sequenceDuration = seq.reduce((total, item) => total + toFiniteNumber(clipMap.get(item.id) && clipMap.get(item.id).duration, 0), 0);

        await upsertPublishedMovie({
            exportName,
            projectId: safeProjectId,
            title: displayTitle,
            synopsis: project.synopsis,
            genre: project.genre,
            posterPath: featuredClip && featuredClip.thumbnail ? stripLeadingSlashes(featuredClip.thumbnail) : null,
            themeColor,
            clipCount: clips.length,
            choiceCount: edges.length,
            duration: sequenceDuration
        });

        res.json({
            success: true,
            url: `/exports/${exportName}/index.html`,
            feedUrl: `${FEED_PUBLIC_ORIGIN}/`
        });
    } catch (err) {
        sendApiError(res, err);
    }
});

app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 800 MB)' });
    }
    if (err) {
        console.error(err);
        const statusCode = err && err.statusCode ? err.statusCode : 500;
        return res.status(statusCode).json({ error: err.message || 'Server error' });
    }
    next();
});

feedApp.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 800 MB)' });
    }
    if (err) {
        console.error(err);
        const statusCode = err && err.statusCode ? err.statusCode : 500;
        return res.status(statusCode).json({ error: err.message || 'Server error' });
    }
    next();
});

const server = app.listen(PORT, HOST, () => {
    console.log(`MyaStudio Running: http://${HOST}:${PORT}`);
    console.log(`Interactive Feed: ${FEED_PUBLIC_ORIGIN}/`);
});

server.on('error', (err) => {
    console.error(`MyaStudio failed to listen on ${HOST}:${PORT}`);
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});

const feedServer = feedApp.listen(FEED_PORT, FEED_HOST, () => {
    console.log(`Feed Server Running: http://${FEED_HOST}:${FEED_PORT}`);
});

feedServer.on('error', (err) => {
    console.error(`Interactive feed failed to listen on ${FEED_HOST}:${FEED_PORT}`);
    console.error(err && err.stack ? err.stack : err);
});

