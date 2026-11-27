// Builds the shared story format (see public/player/story-core.js) from the
// studio's SQLite rows. Pure functions only, so they can be unit tested.
const core = require('../public/player/story-core.js');

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function str(value) {
    return value === undefined || value === null ? '' : String(value).trim();
}

function isSourceClip(clip) {
    return /^FULL:/i.test(str(clip && clip.name));
}

// "FULL: holiday.mp4" -> "holiday"
function displaySceneName(clip) {
    const name = str(clip && clip.name);
    if (!isSourceClip(clip)) return name || 'Untitled scene';
    return name.replace(/^FULL:\s*/i, '').replace(/\.[a-z0-9]{2,4}$/i, '') || 'Full video';
}

function mapActionType(value) {
    const action = str(value).toLowerCase();
    if (action === 'end') return 'end';
    if (action === 'next') return 'next';
    if (action === 'dismiss') return 'dismiss';
    return 'scene';
}

function choicePointKey(edge) {
    const logicId = str(edge && edge.logic_id);
    return logicId || `legacy_${str(edge && edge.from_id)}_${num(edge && edge.trigger_time, 0)}`;
}

function edgeToChoice(edge, mapAsset, fallbackImage) {
    return {
        id: String(edge.id),
        label: str(edge.label),
        action: mapActionType(edge.action_type),
        to: str(edge.to_id) || null,
        returnHere: !!Number(edge.return_to_main),
        setFlag: str(edge.set_var) || null,
        requireFlag: str(edge.req_var) || null,
        isDefault: !!Number(edge.is_default),
        // No edge thumbnail of its own? Fall back to the target scene's
        // poster, so a choice never renders as an empty black tile while
        // its siblings show artwork (Two Doors demo, Nov 27, 2026).
        image: edge.thumbnail ? mapAsset(edge.thumbnail, 'image') : (fallbackImage || null),
        color: str(edge.text_color) || null
    };
}

// Groups edge rows into choice points ("logic blocks"): every edge sharing a
// logic_id (or, for very old data, the same source clip and trigger time) is
// one decision moment.
function groupChoicePoints(edges, mapAsset = value => value, scenePosterById = null) {
    const points = new Map();
    const sorted = (Array.isArray(edges) ? edges : [])
        .filter(edge => edge && str(edge.from_id))
        .slice()
        .sort((a, b) => num(a.trigger_time, 0) - num(b.trigger_time, 0) || num(a.id, 0) - num(b.id, 0));
    for (const edge of sorted) {
        const key = choicePointKey(edge);
        if (!points.has(key)) {
            points.set(key, {
                id: key,
                sceneId: str(edge.from_id),
                time: Math.max(0, num(edge.trigger_time, 0)),
                prompt: str(edge.prompt),
                timeLimit: Math.max(0, num(edge.time_limit, 0)),
                shuffle: !!Number(edge.shuffle_choices),
                pause: !!Number(edge.pause_on_show),
                choices: []
            });
        }
        const fallbackImage = scenePosterById ? scenePosterById.get(str(edge.to_id)) || null : null;
        points.get(key).choices.push(edgeToChoice(edge, mapAsset, fallbackImage));
    }
    return Array.from(points.values());
}

function clipToScene(clip, mapAsset = value => value) {
    const timeoutSeconds = num(clip.timeout_seconds, 0);
    return {
        id: str(clip.unique_id),
        name: displaySceneName(clip),
        src: mapAsset(clip.filepath, 'video'),
        poster: clip.thumbnail ? mapAsset(clip.thumbnail, 'image') : null,
        duration: Math.max(0, num(clip.duration, 0)),
        subtitles: clip.subtitle_path ? mapAsset(clip.subtitle_path, 'subtitles') : null,
        music: clip.bg_music ? mapAsset(clip.bg_music, 'audio') : null,
        muted: !!Number(clip.mute_audio),
        next: str(clip.next_clip_id) || null,
        ending: Number(clip.is_ending) ? { title: str(clip.ending_title) || 'The End' } : null,
        timeout: str(clip.timeout_to_id) && timeoutSeconds > 0
            ? { seconds: timeoutSeconds, to: str(clip.timeout_to_id) }
            : null
    };
}

function buildStory({ project, clips, edges, playlist = [], mapAsset = value => value, analyticsProjectId = null } = {}) {
    const safeProject = project || {};
    const scenes = (Array.isArray(clips) ? clips : []).filter(clip => clip && clip.unique_id).map(clip => clipToScene(clip, mapAsset));
    const scenePosterById = new Map(scenes.map(scene => [scene.id, scene.poster]));
    const raw = {
        version: core.STORY_VERSION,
        id: safeProject.id === undefined ? null : safeProject.id,
        title: str(safeProject.title) || 'Interactive movie',
        synopsis: str(safeProject.synopsis),
        genre: str(safeProject.genre),
        themeColor: str(safeProject.theme_color) || '#3b82f6',
        startSceneId: str(safeProject.start_clip_id) || null,
        playlist: (Array.isArray(playlist) ? playlist : []).map(str).filter(Boolean),
        scenes,
        choicePoints: groupChoicePoints(edges, mapAsset, scenePosterById),
        analytics: analyticsProjectId ? { projectId: analyticsProjectId } : null
    };
    return core.normalizeStory(raw);
}

// Keeps only what a viewer can actually reach from the start scene (and the
// legacy main sequence), so a published export never ships unused footage.
function reachableOnly(story) {
    const normalized = core.normalizeStory(story);
    const reachable = core.reachableScenes(normalized);
    const scenes = normalized.scenes.filter(scene => reachable.has(scene.id));
    const choicePoints = normalized.choicePoints.filter(point => reachable.has(point.sceneId));
    return core.normalizeStory({ ...normalized, scenes, choicePoints });
}

// Every media path a story references, with the kind of asset it is.
function collectAssets(story) {
    const assets = [];
    (story.scenes || []).forEach(scene => {
        if (scene.src) assets.push({ path: scene.src, kind: 'video', sceneId: scene.id });
        if (scene.poster) assets.push({ path: scene.poster, kind: 'image', sceneId: scene.id });
        if (scene.subtitles) assets.push({ path: scene.subtitles, kind: 'subtitles', sceneId: scene.id });
        if (scene.music) assets.push({ path: scene.music, kind: 'audio', sceneId: scene.id });
    });
    (story.choicePoints || []).forEach(point => point.choices.forEach(choice => {
        if (choice.image) assets.push({ path: choice.image, kind: 'image', sceneId: point.sceneId });
    }));
    return assets;
}

// Returns a copy of the story with every asset path passed through `mapPath`.
function mapStoryAssets(story, mapPath) {
    const copy = JSON.parse(JSON.stringify(story));
    copy.scenes.forEach(scene => {
        scene.src = scene.src ? mapPath(scene.src, 'video') : scene.src;
        if (scene.poster) scene.poster = mapPath(scene.poster, 'image');
        if (scene.subtitles) scene.subtitles = mapPath(scene.subtitles, 'subtitles');
        if (scene.music) scene.music = mapPath(scene.music, 'audio');
    });
    copy.choicePoints.forEach(point => point.choices.forEach(choice => {
        if (choice.image) choice.image = mapPath(choice.image, 'image');
    }));
    return copy;
}

module.exports = {
    buildStory,
    reachableOnly,
    collectAssets,
    mapStoryAssets,
    groupChoicePoints,
    clipToScene,
    displaySceneName,
    isSourceClip,
    choicePointKey
};
