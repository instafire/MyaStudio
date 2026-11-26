// Small shared helpers for the studio. No Vue, no DOM state.

export function isSourceClip(clip) {
    return /^FULL:/i.test(String((clip && clip.name) || ''));
}

export function sceneName(clip) {
    if (!clip) return 'Untitled scene';
    const name = String(clip.name || '').trim();
    if (!isSourceClip(clip)) return name || 'Untitled scene';
    return name.replace(/^FULL:\s*/i, '').replace(/\.[a-z0-9]{2,4}$/i, '') || 'Full video';
}

export function videoName(video) {
    return String((video && video.filename) || 'Video').replace(/\.[a-z0-9]{2,4}$/i, '') || 'Video';
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function round(value, step = 0.1) {
    return Math.round(value / step) * step;
}

export function fmt(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtPrecise(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(value / 60);
    const s = (value - m * 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
}

export function fmtDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)}s`;
    return fmt(value);
}

// "75" -> 75, "1:15" -> 75, "1:15.5" -> 75.5, "0:04,2" -> 4.2
export function parseTime(text) {
    const raw = String(text === undefined || text === null ? '' : text).trim().replace(',', '.');
    if (!raw) return null;
    if (/^\d+(\.\d+)?s?$/.test(raw)) return Number(raw.replace(/s$/, ''));
    const parts = raw.split(':');
    if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) return null;
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function uid(prefix = 'id') {
    const random = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `${prefix}_${random}`;
}

export function debounce(fn, wait) {
    let timer = 0;
    const wrapped = (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => window.clearTimeout(timer);
    return wrapped;
}

export function timeAgo(value) {
    if (!value) return '';
    const raw = String(value);
    // SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
    const seconds = (Date.now() - date.getTime()) / 1000;
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initials(title) {
    return String(title || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || '?';
}

// ---- Choice points ---------------------------------------------------------
// The studio edits choice points with this client model:
//   { id, time, prompt, timeLimit, shuffle, pause, choices: [choice] }
//   choice = { key, label, action, to, returnHere, setFlag, requireFlag, isDefault, image, color }

export function newChoice(extra = {}) {
    return {
        key: uid('c'),
        label: '',
        action: 'scene',
        to: null,
        returnHere: false,
        setFlag: '',
        requireFlag: '',
        isDefault: false,
        image: null,
        color: null,
        ...extra
    };
}

export function pointsFromEdges(edges) {
    const byScene = {};
    const points = new Map();
    const sorted = (edges || []).slice().sort((a, b) => (Number(a.trigger_time) || 0) - (Number(b.trigger_time) || 0) || a.id - b.id);
    for (const edge of sorted) {
        const sceneId = String(edge.from_id || '');
        if (!sceneId) continue;
        const key = String(edge.logic_id || '') || `legacy_${sceneId}_${edge.trigger_time}`;
        if (!points.has(key)) {
            const point = {
                id: key,
                time: Math.max(0, Number(edge.trigger_time) || 0),
                prompt: edge.prompt || '',
                timeLimit: Math.max(0, Number(edge.time_limit) || 0),
                shuffle: !!Number(edge.shuffle_choices),
                pause: !!Number(edge.pause_on_show),
                choices: []
            };
            points.set(key, point);
            (byScene[sceneId] = byScene[sceneId] || []).push(point);
        }
        const action = ['end', 'next', 'dismiss'].includes(edge.action_type) ? edge.action_type : 'scene';
        points.get(key).choices.push(newChoice({
            key: `e${edge.id}`,
            label: edge.label || '',
            action,
            to: action === 'scene' ? (edge.to_id || null) : null,
            returnHere: !!Number(edge.return_to_main),
            setFlag: edge.set_var || '',
            requireFlag: edge.req_var || '',
            isDefault: !!Number(edge.is_default),
            image: edge.thumbnail || null,
            color: edge.text_color || null
        }));
    }
    Object.values(byScene).forEach(list => list.sort((a, b) => a.time - b.time));
    return byScene;
}

export function pointsToPayload(points) {
    return (points || []).map(point => ({
        id: point.id,
        time: Number(point.time) || 0,
        prompt: point.prompt || '',
        timeLimit: Number(point.timeLimit) || 0,
        shuffle: !!point.shuffle,
        pause: !!point.pause,
        choices: point.choices.map(choice => ({
            label: choice.label || '',
            action: choice.action || 'scene',
            to: choice.action === 'scene' ? (choice.to || null) : null,
            returnHere: !!choice.returnHere,
            setFlag: choice.setFlag || '',
            requireFlag: choice.requireFlag || '',
            isDefault: !!choice.isDefault,
            image: choice.image || null,
            color: choice.color || null
        }))
    }));
}

// What a scene does when it finishes, derived from its data.
export function sceneMode(clip, points, override) {
    if (override) return override;
    if (!clip) return 'none';
    if (clip.next_clip_id) return 'continue';
    if (Number(clip.is_ending)) return 'ending';
    if (points && points.length) return 'choices';
    return 'none';
}

export function defaultChoiceTime(duration) {
    const value = Math.max(0, Number(duration) || 0);
    if (!value) return 0;
    const lead = Math.min(5, value * 0.5);
    return Math.max(0, round(value - lead, 0.1));
}

// Builds the shared story format (see /player/story-core.js) from the
// studio's state so the story check runs live in the browser.
export function buildStory(project, clips, pointsByScene) {
    const safeProject = project || {};
    const scenes = (clips || []).map(clip => ({
        id: clip.unique_id,
        name: sceneName(clip),
        src: clip.filepath,
        poster: clip.thumbnail,
        duration: Number(clip.duration) || 0,
        subtitles: clip.subtitle_path || null,
        music: clip.bg_music || null,
        muted: !!Number(clip.mute_audio),
        next: clip.next_clip_id || null,
        ending: Number(clip.is_ending) ? { title: clip.ending_title || 'The End' } : null,
        timeout: clip.timeout_to_id && Number(clip.timeout_seconds) > 0 ? { seconds: Number(clip.timeout_seconds), to: clip.timeout_to_id } : null
    }));
    const choicePoints = [];
    Object.keys(pointsByScene || {}).forEach(sceneId => {
        (pointsByScene[sceneId] || []).forEach(point => {
            choicePoints.push({
                id: point.id,
                sceneId,
                time: point.time,
                prompt: point.prompt,
                timeLimit: point.timeLimit,
                shuffle: point.shuffle,
                pause: point.pause,
                choices: point.choices.map(choice => ({
                    id: choice.key,
                    label: choice.label,
                    action: choice.action,
                    to: choice.to,
                    returnHere: choice.returnHere,
                    setFlag: choice.setFlag,
                    requireFlag: choice.requireFlag,
                    isDefault: choice.isDefault,
                    image: choice.image
                }))
            });
        });
    });
    return {
        version: 2,
        id: safeProject.id,
        title: safeProject.title,
        synopsis: safeProject.synopsis,
        genre: safeProject.genre,
        themeColor: safeProject.theme_color,
        startSceneId: safeProject.start_clip_id || null,
        scenes,
        choicePoints
    };
}

export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) { /* fall back below */ }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
}

export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
