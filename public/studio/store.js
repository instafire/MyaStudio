// Studio state and every action that talks to the server. Components read
// from `store` and call these functions; nothing else mutates server data.
import { api, uploadFile } from './api.js';
import * as U from './util.js';

const { reactive, computed } = Vue;
const Story = window.MyaStory;

function parseRoute() {
    const hash = window.location.hash || '';
    const match = hash.match(/^#\/movie\/(\d+)/);
    if (match) return { name: 'movie', projectId: Number(match[1]) };
    return { name: 'hub', projectId: null };
}

export const store = reactive({
    route: parseRoute(),
    projects: [],
    projectsLoaded: false,
    project: null,
    videos: [],
    clips: [],
    audio: [],
    published: [],
    analytics: [],
    feedUrl: '',
    points: {},
    modeOverride: {},
    loading: false,
    loadError: '',
    selection: { sceneId: null, choiceKey: null },
    saving: 0,
    saveError: '',
    uploads: [],
    toasts: [],
    dialog: null,
    cutter: null,
    preview: null,
    publishOpen: false,
    helpOpen: false,
    leftTab: 'scenes',
    showLeft: true,
    mobilePanel: null,
    lastPublish: null,
    mapFocus: 0,
    fitRequest: 0
});

window.addEventListener('hashchange', () => { store.route = parseRoute(); });

export function go(route) {
    window.location.hash = route;
}

// ---- Derived state ------------------------------------------------------------

export const clipById = computed(() => new Map(store.clips.map(clip => [clip.unique_id, clip])));

function usedInStory(id) {
    if (!store.project) return false;
    if (store.project.start_clip_id === id) return true;
    if ((store.points[id] || []).length) return true;
    for (const clip of store.clips) {
        if (clip.next_clip_id === id) return true;
    }
    for (const list of Object.values(store.points)) {
        for (const point of list) {
            if (point.choices.some(choice => choice.to === id)) return true;
        }
    }
    return false;
}

// Every clip that acts as a scene. Whole-video "FULL:" source clips only
// appear once something in the story uses them.
export const scenes = computed(() => store.clips.filter(clip => !U.isSourceClip(clip) || usedInStory(clip.unique_id)));
export const mapScenes = computed(() => scenes.value.filter(clip => Number(clip.builder_visible) === 1 || (store.project && store.project.start_clip_id === clip.unique_id)));
export const offMapScenes = computed(() => scenes.value.filter(clip => !mapScenes.value.includes(clip)));
export const story = computed(() => U.buildStory(store.project, scenes.value, store.points));
export const analysis = computed(() => Story.analyzeStory(story.value));
export const reachable = computed(() => Story.reachableScenes(story.value));
export const selectedScene = computed(() => clipById.value.get(store.selection.sceneId) || null);
export const flagNames = computed(() => analysis.value.flags || []);

export function issuesFor(sceneId) {
    return analysis.value.issues.filter(issue => issue.sceneId === sceneId);
}

export function modeOf(clip) {
    if (!clip) return 'none';
    return U.sceneMode(clip, store.points[clip.unique_id], store.modeOverride[clip.unique_id]);
}

// In "choices" mode the last choice point is the end-of-scene decision; any
// earlier ones are optional moments during the scene.
export function endPointOf(clip) {
    if (!clip || modeOf(clip) !== 'choices') return null;
    const points = store.points[clip.unique_id] || [];
    return points.length ? points[points.length - 1] : null;
}

export function momentsOf(clip) {
    if (!clip) return [];
    const points = store.points[clip.unique_id] || [];
    return modeOf(clip) === 'choices' ? points.slice(0, -1) : points.slice();
}

export function sceneLabel(id) {
    const clip = clipById.value.get(id);
    return clip ? U.sceneName(clip) : 'Missing scene';
}

export function sourceVideoOf(clip) {
    if (!clip || !clip.source_video_id) return null;
    return store.videos.find(video => video.id === clip.source_video_id) || null;
}

export function scenesFromVideo(videoId) {
    return scenes.value.filter(clip => clip.source_video_id === videoId && !U.isSourceClip(clip));
}

// ---- Feedback -------------------------------------------------------------------

let toastSeq = 0;
export function toast(message, type = 'success', action = null) {
    const id = ++toastSeq;
    store.toasts.push({ id, message, type, action });
    window.setTimeout(() => dismissToast(id), type === 'error' ? 6500 : 3400);
    return id;
}
export function dismissToast(id) {
    const index = store.toasts.findIndex(item => item.id === id);
    if (index >= 0) store.toasts.splice(index, 1);
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        store.dialog = { kind: 'confirm', title, message, confirmLabel, cancelLabel, danger, resolve };
    });
}

export function promptDialog({ title, message = '', label = '', value = '', placeholder = '', confirmLabel = 'Save' }) {
    return new Promise(resolve => {
        store.dialog = { kind: 'prompt', title, message, label, value, placeholder, confirmLabel, resolve };
    });
}

export function closeDialog(result) {
    const dialog = store.dialog;
    store.dialog = null;
    if (dialog && dialog.resolve) dialog.resolve(result);
}

async function track(promise) {
    store.saving += 1;
    try {
        const result = await promise;
        store.saveError = '';
        return result;
    } catch (err) {
        store.saveError = err.message || 'Could not save';
        throw err;
    } finally {
        store.saving = Math.max(0, store.saving - 1);
    }
}

function fail(err, fallback) {
    toast((err && err.message) || fallback || 'Something went wrong', 'error');
}

// ---- Projects -------------------------------------------------------------------

export async function loadProjects() {
    try {
        store.projects = await api.get('/api/projects');
    } catch (err) {
        fail(err, 'Could not load your movies');
    } finally {
        store.projectsLoaded = true;
    }
}

export async function createProject(title) {
    const name = String(title || '').trim() || 'Untitled movie';
    try {
        await api.post('/api/projects', { title: name });
        const projects = await api.get('/api/projects');
        store.projects = projects;
        const created = projects.find(project => project.title === name) || projects[0];
        if (created) go(`#/movie/${created.id}`);
    } catch (err) {
        fail(err, 'Could not create the movie');
    }
}

export async function createSample() {
    try {
        toast('Building the sample story…', 'info');
        const result = await api.post('/api/projects/sample', {});
        go(`#/movie/${result.projectId}`);
    } catch (err) {
        fail(err, 'Could not build the sample');
    }
}

export async function renameProject(project) {
    const title = await promptDialog({ title: 'Rename movie', label: 'Title', value: project.title, confirmLabel: 'Rename' });
    if (title === null || !title.trim()) return;
    try {
        await api.post('/api/project/rename', { id: project.id, title: title.trim() });
        project.title = title.trim();
        if (store.project && store.project.id === project.id) store.project.title = title.trim();
    } catch (err) {
        fail(err);
    }
}

export async function duplicateProject(project) {
    try {
        const result = await api.post('/api/project/duplicate', { id: project.id });
        await loadProjects();
        toast(`Made a copy: ${result.project.title}`);
    } catch (err) {
        fail(err, 'Could not duplicate the movie');
    }
}

export async function deleteProject(project) {
    const ok = await confirmDialog({
        title: `Delete "${project.title}"?`,
        message: 'This permanently deletes the movie, its videos and every scene cut from them. Published copies stay online until you delete them.',
        confirmLabel: 'Delete movie',
        danger: true
    });
    if (!ok) return;
    try {
        await api.post('/api/project/delete', { id: project.id });
        store.projects = store.projects.filter(item => item.id !== project.id);
        toast('Movie deleted');
    } catch (err) {
        fail(err, 'Could not delete the movie');
    }
}

export async function exportProject(project) {
    try {
        const data = await api.get(`/api/project/export/${project.id}`);
        const safe = String(project.title || 'movie').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'movie';
        U.downloadJson(`${safe}.mya.json`, data);
        toast('Project file downloaded. It holds the story structure; your media stays on this computer.', 'info');
    } catch (err) {
        fail(err, 'Could not export the movie');
    }
}

export async function importProject(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await api.post('/api/project/import', data);
        await loadProjects();
        toast(`Imported "${result.project.title}"`);
    } catch (err) {
        fail(err, 'That file is not a MyaStudio project');
    }
}

// ---- Opening a movie ------------------------------------------------------------

function applyStudioData(data) {
    store.project = data.project;
    store.videos = data.videos || [];
    store.clips = data.clips || [];
    store.audio = data.audio || [];
    store.published = data.published || [];
    store.analytics = data.analytics || [];
    store.feedUrl = data.feedUrl || '';
    store.points = U.pointsFromEdges(data.edges || []);
    store.modeOverride = {};
}

export async function openProject(id) {
    store.loading = true;
    store.loadError = '';
    store.selection = { sceneId: null, choiceKey: null };
    store.project = null;
    try {
        const data = await api.get(`/api/studio/${id}`);
        applyStudioData(data);
        store.leftTab = store.videos.length && !scenes.value.length ? 'media' : 'scenes';
        try { store.previewed = window.localStorage.getItem(`mya:studio:previewed:${id}`) === '1'; } catch (_) { store.previewed = false; }
    } catch (err) {
        store.loadError = err.status === 404 ? 'This movie no longer exists.' : (err.message || 'Could not open this movie');
    } finally {
        store.loading = false;
    }
}

export async function refreshProject() {
    if (!store.project) return;
    await flushAll();
    try {
        const data = await api.get(`/api/studio/${store.project.id}`);
        const selected = store.selection.sceneId;
        applyStudioData(data);
        if (selected && !clipById.value.has(selected)) store.selection = { sceneId: null, choiceKey: null };
    } catch (err) {
        fail(err, 'Could not refresh the movie');
    }
}

export function select(sceneId, choiceKey = null) {
    store.selection = { sceneId: sceneId || null, choiceKey: choiceKey || null };
    if (sceneId) store.mobilePanel = store.mobilePanel === 'left' ? null : store.mobilePanel;
}

// ---- Saving ---------------------------------------------------------------------

const ROW_FIELDS = {
    name: value => ({ name: value }),
    nextClipId: value => ({ next_clip_id: value || null }),
    isEnding: value => ({ is_ending: value ? 1 : 0 }),
    endingTitle: value => ({ ending_title: value || null }),
    notes: value => ({ notes: value || '' }),
    muteAudio: value => ({ mute_audio: value ? 1 : 0 }),
    bgMusic: value => ({ bg_music: value || null }),
    builderVisible: value => ({ builder_visible: value ? 1 : 0 }),
    x: value => ({ x: value }),
    y: value => ({ y: value })
};
const scenePatches = new Map();
const sceneTimers = new Map();
const choiceTimers = new Map();
const inflight = new Set();

export function updateScene(clip, patch, { immediate = false } = {}) {
    if (!clip || !store.project) return Promise.resolve();
    Object.keys(patch).forEach(key => {
        if (ROW_FIELDS[key]) Object.assign(clip, ROW_FIELDS[key](patch[key]));
    });
    const id = clip.unique_id;
    scenePatches.set(id, { ...(scenePatches.get(id) || {}), ...patch });
    window.clearTimeout(sceneTimers.get(id));
    if (immediate) return flushScene(id);
    sceneTimers.set(id, window.setTimeout(() => flushScene(id), 450));
    return Promise.resolve();
}

function flushScene(id) {
    window.clearTimeout(sceneTimers.get(id));
    sceneTimers.delete(id);
    const patch = scenePatches.get(id);
    scenePatches.delete(id);
    if (!patch || !store.project) return Promise.resolve();
    const projectId = store.project.id;
    const promise = track(api.post('/api/scene/update', { projectId, id, ...patch }))
        .catch(err => fail(err, 'Could not save the scene'))
        .finally(() => inflight.delete(promise));
    inflight.add(promise);
    return promise;
}

export function saveChoices(sceneId, { immediate = false } = {}) {
    if (!sceneId || !store.project) return Promise.resolve();
    window.clearTimeout(choiceTimers.get(sceneId));
    if (immediate) return flushChoices(sceneId);
    choiceTimers.set(sceneId, window.setTimeout(() => flushChoices(sceneId), 450));
    return Promise.resolve();
}

function flushChoices(sceneId) {
    window.clearTimeout(choiceTimers.get(sceneId));
    choiceTimers.delete(sceneId);
    if (!store.project) return Promise.resolve();
    const points = (store.points[sceneId] || []).filter(point => point.choices.length);
    const promise = track(api.post('/api/scene/choices', { projectId: store.project.id, sceneId, points: U.pointsToPayload(points) }))
        .catch(err => fail(err, 'Could not save the choices'))
        .finally(() => inflight.delete(promise));
    inflight.add(promise);
    return promise;
}

export async function flushAll() {
    const pending = [];
    Array.from(sceneTimers.keys()).forEach(id => pending.push(flushScene(id)));
    Array.from(choiceTimers.keys()).forEach(id => pending.push(flushChoices(id)));
    pending.push(...inflight);
    await Promise.all(pending);
}

export async function updateProject(patch) {
    if (!store.project) return;
    Object.assign(store.project, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.genre !== undefined ? { genre: patch.genre } : {}),
        ...(patch.synopsis !== undefined ? { synopsis: patch.synopsis } : {}),
        ...(patch.color !== undefined ? { theme_color: patch.color } : {})
    });
    try {
        const result = await track(api.post('/api/project/update', { id: store.project.id, ...patch }));
        if (result && result.project) Object.assign(store.project, result.project);
    } catch (err) {
        fail(err, 'Could not save the movie details');
    }
}

// ---- Map placement --------------------------------------------------------------

export const NODE_W = 224;
export const NODE_HEAD = 172;
export const ROW_H = 30;

export function nodeHeight(clip) {
    const mode = modeOf(clip);
    const points = store.points[clip.unique_id] || [];
    let rows = points.reduce((total, point) => total + point.choices.length, 0);
    if (mode === 'choices') rows += 1;
    if (mode === 'continue') rows += 1;
    const footer = mode === 'ending' || mode === 'none' ? 40 : 0;
    return NODE_HEAD + (rows ? rows * ROW_H + 8 : 0) + footer;
}

function overlaps(x, y, ignoreId) {
    return mapScenes.value.some(clip => clip.unique_id !== ignoreId
        && Math.abs((Number(clip.x) || 0) - x) < NODE_W + 30
        && Math.abs((Number(clip.y) || 0) - y) < 200);
}

export function nextFreePosition(near) {
    const nodes = mapScenes.value;
    if (!nodes.length) return { x: 80, y: 120 };
    const anchor = near || selectedScene.value;
    let x;
    let y;
    if (anchor && mapScenes.value.includes(anchor)) {
        x = (Number(anchor.x) || 0) + NODE_W + 110;
        y = Number(anchor.y) || 0;
    } else {
        x = Math.max(...nodes.map(clip => Number(clip.x) || 0)) + NODE_W + 110;
        y = Math.min(...nodes.map(clip => Number(clip.y) || 0));
    }
    let guard = 0;
    while (overlaps(x, y) && guard < 40) {
        y += 230;
        guard += 1;
    }
    return { x: Math.round(x), y: Math.round(y) };
}

export async function tidyLayout() {
    const nodes = mapScenes.value;
    if (!nodes.length) return;
    const start = store.project.start_clip_id;
    const depth = new Map();
    const order = [];
    const links = id => {
        const out = [];
        (store.points[id] || []).forEach(point => point.choices.forEach(choice => { if (choice.to) out.push(choice.to); }));
        const clip = clipById.value.get(id);
        if (clip && clip.next_clip_id) out.push(clip.next_clip_id);
        return out;
    };
    const queue = start && nodes.some(clip => clip.unique_id === start) ? [start] : [];
    if (queue.length) depth.set(start, 0);
    while (queue.length) {
        const id = queue.shift();
        order.push(id);
        links(id).forEach(next => {
            if (!depth.has(next) && nodes.some(clip => clip.unique_id === next)) {
                depth.set(next, depth.get(id) + 1);
                queue.push(next);
            }
        });
    }
    const maxDepth = Math.max(0, ...Array.from(depth.values()));
    const columns = new Map();
    order.forEach(id => {
        const d = depth.get(id);
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d).push(id);
    });
    const loose = nodes.filter(clip => !depth.has(clip.unique_id)).map(clip => clip.unique_id);
    const updates = [];
    columns.forEach((ids, d) => {
        let y = 80;
        ids.forEach(id => {
            const clip = clipById.value.get(id);
            clip.x = 80 + d * (NODE_W + 120);
            clip.y = y;
            updates.push({ id, x: clip.x, y: clip.y });
            y += nodeHeight(clip) + 40;
        });
    });
    const tallest = Math.max(80, ...Array.from(columns.values()).map(ids => ids.reduce((total, id) => total + nodeHeight(clipById.value.get(id)) + 40, 80)));
    loose.forEach((id, index) => {
        const clip = clipById.value.get(id);
        clip.x = 80 + (index % Math.max(3, maxDepth + 1)) * (NODE_W + 120);
        clip.y = tallest + 80 + Math.floor(index / Math.max(3, maxDepth + 1)) * 260;
        updates.push({ id, x: clip.x, y: clip.y });
    });
    try {
        await track(api.post('/api/clip/positions', { projectId: store.project.id, updates }));
    } catch (err) {
        fail(err, 'Could not save the layout');
    }
    store.fitRequest += 1;
}

// ---- Media ----------------------------------------------------------------------

let uploadSeq = 0;
export async function uploadFiles(fileList) {
    if (!store.project) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const projectId = store.project.id;
    const firstVideoBefore = store.videos.length === 0;
    let openedCutter = false;
    for (const file of files) {
        const item = reactive({ id: ++uploadSeq, name: file.name, progress: 0, phase: 'upload', error: '' });
        store.uploads.push(item);
        try {
            const result = await uploadFile(file, projectId, (fraction, phase) => {
                item.progress = fraction;
                item.phase = phase;
            });
            if (result && result.type === 'audio') {
                if (!store.audio.some(track => track.path === result.path)) {
                    store.audio.push({ name: result.path.split('/').pop(), path: result.path, label: result.name });
                }
                toast(`Added music: ${result.name}`);
            } else if (result && result.video) {
                store.videos.push(result.video);
                const clips = await api.get(`/api/studio/${projectId}`).then(data => data.clips).catch(() => null);
                if (clips) {
                    const known = new Set(store.clips.map(clip => clip.unique_id));
                    clips.filter(clip => !known.has(clip.unique_id)).forEach(clip => store.clips.push(clip));
                }
                toast(`Uploaded ${file.name}`);
                if (firstVideoBefore && !openedCutter && !scenes.value.length) {
                    openedCutter = true;
                    openCutter(result.video.id);
                }
            }
            store.uploads.splice(store.uploads.indexOf(item), 1);
        } catch (err) {
            item.error = err.message || 'Upload failed';
            item.phase = 'error';
            window.setTimeout(() => {
                const index = store.uploads.indexOf(item);
                if (index >= 0) store.uploads.splice(index, 1);
            }, 9000);
        }
    }
}

export async function deleteVideo(video) {
    const count = scenesFromVideo(video.id).length;
    const ok = await confirmDialog({
        title: `Delete "${U.videoName(video)}"?`,
        message: count
            ? `This also deletes the ${count} scene${count === 1 ? '' : 's'} cut from it, and any choices that lead to them.`
            : 'The video file is removed from this movie.',
        confirmLabel: 'Delete video',
        danger: true
    });
    if (!ok) return;
    try {
        await track(api.post('/api/delete_video', { projectId: store.project.id, id: video.id }));
        await refreshProject();
        toast('Video deleted');
    } catch (err) {
        fail(err, 'Could not delete the video');
    }
}

// ---- Scenes ---------------------------------------------------------------------

export function openCutter(videoId, sceneId = null) {
    const video = store.videos.find(item => item.id === videoId) || store.videos[0];
    if (!video) {
        store.leftTab = 'media';
        toast('Upload a video first, then cut scenes from it.', 'info');
        return;
    }
    store.cutter = { videoId: video.id, sceneId };
}

export async function cutScene({ videoId, start, end, name, position }) {
    const pos = position || nextFreePosition();
    const result = await track(api.post('/api/clip', { projectId: store.project.id, sourceId: videoId, start, end, name, x: pos.x, y: pos.y }));
    store.clips.push(result.clip);
    return result.clip;
}

export async function wholeVideoScene(video, name) {
    try {
        const pos = nextFreePosition();
        const result = await track(api.post('/api/scene/whole', { projectId: store.project.id, videoId: video.id, name: name || U.videoName(video), x: pos.x, y: pos.y }));
        store.clips.push(result.clip);
        afterSceneCreated(result.clip);
        toast(`Added "${U.sceneName(result.clip)}" as a scene`);
        return result.clip;
    } catch (err) {
        fail(err, 'Could not add the scene');
        return null;
    }
}

// The first scene of a movie becomes its start scene automatically.
export function afterSceneCreated(clip) {
    if (store.project && !store.project.start_clip_id) setStart(clip, { quiet: true });
}

export async function retrimScene(clip, start, end) {
    const result = await track(api.post('/api/scene/retrim', { projectId: store.project.id, id: clip.unique_id, start, end }));
    Object.assign(clip, result.clip);
    return clip;
}

export async function setStart(clip, { quiet = false } = {}) {
    if (!clip || !store.project) return;
    store.project.start_clip_id = clip.unique_id;
    clip.builder_visible = 1;
    try {
        await track(api.post('/api/project/start_clip', { projectId: store.project.id, clipId: clip.unique_id }));
        if (!quiet) toast(`"${U.sceneName(clip)}" is now where the movie starts`);
    } catch (err) {
        fail(err);
    }
}

export async function duplicateScene(clip) {
    try {
        await flushAll();
        const result = await track(api.post('/api/clip/duplicate', { projectId: store.project.id, id: clip.unique_id }));
        await refreshProject();
        select(result.clip.unique_id);
        toast(`Duplicated "${U.sceneName(clip)}"`);
    } catch (err) {
        fail(err, 'Could not duplicate the scene');
    }
}

export async function deleteScene(clip) {
    if (!clip) return;
    if (U.isSourceClip(clip)) {
        await removeFromMap(clip);
        return;
    }
    const incoming = countIncoming(clip.unique_id);
    const ok = await confirmDialog({
        title: `Delete "${U.sceneName(clip)}"?`,
        message: incoming
            ? `${incoming} choice${incoming === 1 ? '' : 's'} lead${incoming === 1 ? 's' : ''} here and will be removed too. The source video is kept.`
            : 'The scene is removed. The source video is kept, so you can cut it again.',
        confirmLabel: 'Delete scene',
        danger: true
    });
    if (!ok) return;
    try {
        await flushAll();
        await track(api.post('/api/delete_clip', { projectId: store.project.id, unique_id: clip.unique_id }));
        if (store.selection.sceneId === clip.unique_id) select(null);
        await refreshProject();
        toast('Scene deleted');
    } catch (err) {
        fail(err, 'Could not delete the scene');
    }
}

export function countIncoming(id) {
    let total = 0;
    Object.values(store.points).forEach(list => list.forEach(point => point.choices.forEach(choice => { if (choice.to === id) total += 1; })));
    store.clips.forEach(clip => { if (clip.next_clip_id === id) total += 1; });
    return total;
}

export async function removeFromMap(clip) {
    await updateScene(clip, { builderVisible: false }, { immediate: true });
    if (store.project.start_clip_id === clip.unique_id) store.project.start_clip_id = null;
    if (store.selection.sceneId === clip.unique_id) select(null);
    toast(`Removed "${U.sceneName(clip)}" from the map. It's still in your scene list.`, 'info');
}

export function placeOnMap(clip, x, y) {
    updateScene(clip, { builderVisible: true, x: Math.round(x), y: Math.round(y) }, { immediate: true });
    if (store.project && !store.project.start_clip_id) setStart(clip, { quiet: true });
}

export async function captureThumbnail(clip, time) {
    try {
        const result = await track(api.post('/api/clip/thumbnail', { projectId: store.project.id, id: clip.unique_id, time: Math.max(0, Number(time) || 0) }));
        clip.thumbnail = result.thumbnail;
        toast('Thumbnail updated');
    } catch (err) {
        fail(err, 'Could not grab that frame');
    }
}

export async function uploadSubtitles(clip, file) {
    const form = new FormData();
    form.append('projectId', String(store.project.id));
    form.append('unique_id', clip.unique_id);
    form.append('file', file);
    try {
        const response = await track(fetch('/api/clip/subtitle', { method: 'POST', body: form }).then(async res => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Subtitle upload failed');
            return data;
        }));
        clip.subtitle_path = response.path;
        toast('Captions added');
    } catch (err) {
        fail(err, 'Subtitle upload failed');
    }
}

export async function removeSubtitles(clip) {
    try {
        await track(api.post('/api/clip/subtitle/delete', { projectId: store.project.id, unique_id: clip.unique_id }));
        clip.subtitle_path = null;
        toast('Captions removed');
    } catch (err) {
        fail(err);
    }
}

// ---- Choices --------------------------------------------------------------------

function pointsOf(clip) {
    const id = clip.unique_id;
    if (!store.points[id]) store.points[id] = [];
    return store.points[id];
}

export function ensureEndPoint(clip) {
    const points = pointsOf(clip);
    if (modeOf(clip) !== 'choices' || !points.length) {
        if (clip.next_clip_id || Number(clip.is_ending)) {
            updateScene(clip, { nextClipId: null, isEnding: false });
        }
        delete store.modeOverride[clip.unique_id];
        const point = reactive({
            id: U.uid('point'),
            time: U.defaultChoiceTime(clip.duration),
            prompt: '',
            timeLimit: 0,
            shuffle: false,
            pause: false,
            choices: []
        });
        points.push(point);
        points.sort((a, b) => a.time - b.time);
        // keep the new point last: it is the end-of-scene decision
        const index = points.indexOf(point);
        if (index !== points.length - 1) {
            points.splice(index, 1);
            points.push(point);
            point.time = Math.max(point.time, ...points.slice(0, -1).map(item => item.time + 0.5));
        }
    }
    return points[points.length - 1];
}

export function addChoice(clip, { to = null, label = '', point = null } = {}) {
    const target = point || ensureEndPoint(clip);
    if (target.choices.length >= 8) {
        toast('A choice moment can have up to 8 choices.', 'info');
        return null;
    }
    const choice = reactive(U.newChoice({ to, label: label || (to ? sceneLabel(to) : '') }));
    target.choices.push(choice);
    saveChoices(clip.unique_id);
    select(clip.unique_id, choice.key);
    return choice;
}

export function connectChoice(clip, choiceKey, targetId) {
    const points = store.points[clip.unique_id] || [];
    for (const point of points) {
        const choice = point.choices.find(item => item.key === choiceKey);
        if (choice) {
            choice.action = 'scene';
            choice.to = targetId;
            if (!choice.label) choice.label = sceneLabel(targetId);
            saveChoices(clip.unique_id);
            select(clip.unique_id, choice.key);
            return choice;
        }
    }
    return null;
}

export function connectNext(clip, targetId) {
    if (targetId === clip.unique_id) return;
    delete store.modeOverride[clip.unique_id];
    updateScene(clip, { nextClipId: targetId, isEnding: false });
    select(clip.unique_id);
}

export function removeChoice(clip, point, choice) {
    const index = point.choices.indexOf(choice);
    if (index >= 0) point.choices.splice(index, 1);
    if (!point.choices.length) {
        const points = pointsOf(clip);
        const pointIndex = points.indexOf(point);
        if (pointIndex >= 0) points.splice(pointIndex, 1);
    }
    saveChoices(clip.unique_id);
}

export function removePoint(clip, point) {
    const points = pointsOf(clip);
    const index = points.indexOf(point);
    if (index >= 0) points.splice(index, 1);
    saveChoices(clip.unique_id);
}

export function addMoment(clip) {
    const points = pointsOf(clip);
    const duration = Number(clip.duration) || 0;
    const end = endPointOf(clip);
    const before = end ? end.time : duration;
    const point = reactive({
        id: U.uid('point'),
        time: Math.max(0, U.round(Math.min(before - 1, duration * 0.4), 0.1)),
        prompt: '',
        timeLimit: 8,
        shuffle: false,
        pause: false,
        // A moment during a scene is usually an optional detour: one choice
        // that comes back here afterwards, and "Keep watching" to carry on.
        choices: [
            reactive(U.newChoice({ returnHere: true })),
            reactive(U.newChoice({ label: 'Keep watching', action: 'dismiss', isDefault: true }))
        ]
    });
    if (end) points.splice(points.length - 1, 0, point);
    else points.push(point);
    points.sort((a, b) => a.time - b.time);
    if (end && points[points.length - 1] !== end) {
        points.splice(points.indexOf(end), 1);
        points.push(end);
    }
    return point;
}

export function pointHasContent(point) {
    return !!point && point.choices.some(choice => choice.label || choice.to || choice.action !== 'scene');
}

export async function setMode(clip, mode) {
    const current = modeOf(clip);
    if (current === mode) return;
    const end = endPointOf(clip);
    if (current === 'choices' && mode !== 'choices' && pointHasContent(end)) {
        const ok = await confirmDialog({
            title: 'Remove these choices?',
            message: `Switching to "${mode === 'continue' ? 'Continue' : 'Ending'}" removes the ${end.choices.length} choice${end.choices.length === 1 ? '' : 's'} at the end of this scene.`,
            confirmLabel: 'Remove choices',
            danger: true
        });
        if (!ok) return;
    }
    if (current === 'choices' && end) {
        const points = pointsOf(clip);
        points.splice(points.indexOf(end), 1);
        saveChoices(clip.unique_id);
    }
    if (mode === 'choices') {
        updateScene(clip, { nextClipId: null, isEnding: false });
        delete store.modeOverride[clip.unique_id];
        const point = ensureEndPoint(clip);
        if (!point.choices.length) {
            point.choices.push(reactive(U.newChoice()));
            point.choices.push(reactive(U.newChoice()));
        }
        saveChoices(clip.unique_id);
    } else if (mode === 'continue') {
        updateScene(clip, { isEnding: false });
        if (!clip.next_clip_id) store.modeOverride[clip.unique_id] = 'continue';
    } else if (mode === 'ending') {
        delete store.modeOverride[clip.unique_id];
        updateScene(clip, { isEnding: true, nextClipId: null, endingTitle: clip.ending_title || '' });
    }
}

// ---- Preview & publish ----------------------------------------------------------

export async function openPreview(sceneId = null) {
    await flushAll();
    if (!store.project.start_clip_id && !sceneId) {
        const first = mapScenes.value[0] || scenes.value[0];
        if (!first) {
            toast('Add a scene first, then preview your movie.', 'info');
            return;
        }
        sceneId = first.unique_id;
    }
    store.preview = { sceneId, nonce: Date.now() };
    store.previewed = true;
    try { window.localStorage.setItem(`mya:studio:previewed:${store.project.id}`, '1'); } catch (_) { /* private mode */ }
}

export async function publish({ title }) {
    await flushAll();
    const result = await track(api.post('/api/publish', { projectId: store.project.id, title }));
    store.lastPublish = result;
    try {
        const data = await api.get(`/api/studio/${store.project.id}`);
        store.published = data.published || [];
        store.analytics = data.analytics || [];
    } catch (_) { /* the result is still valid */ }
    return result;
}

export async function deleteExport(name) {
    const ok = await confirmDialog({
        title: 'Unpublish this copy?',
        message: 'The published folder is deleted and its link stops working. Your project is not affected.',
        confirmLabel: 'Unpublish',
        danger: true
    });
    if (!ok) return;
    try {
        await track(api.post('/api/delete_export', { name }));
        store.published = store.published.filter(item => item.exportName !== name);
        if (store.lastPublish && store.lastPublish.exportName === name) store.lastPublish = null;
        toast('Unpublished');
    } catch (err) {
        fail(err);
    }
}

export async function resetStats() {
    const ok = await confirmDialog({ title: 'Reset viewer stats?', message: 'This clears the choice counts collected from published copies of this movie.', confirmLabel: 'Reset', danger: true });
    if (!ok) return;
    try {
        await track(api.post('/api/analytics/reset', { projectId: store.project.id }));
        store.analytics = [];
    } catch (err) {
        fail(err);
    }
}
