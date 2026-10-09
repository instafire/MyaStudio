const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PUBLIC_ASSET_FOLDERS = new Set(['videos', 'clips', 'thumbnails', 'audio', 'gifs', 'subtitles']);
const ASSET_EXTENSIONS = new Map([
    ['videos', new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp'])],
    ['clips', new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp'])],
    ['audio', new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac'])],
    ['thumbnails', new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])],
    ['gifs', new Set(['.gif'])],
    ['subtitles', new Set(['.vtt'])]
]);
const MEDIA_UPLOAD_EXTENSIONS = new Map([
    ['.mp4', 'video'], ['.m4v', 'video'], ['.mov', 'video'], ['.webm', 'video'], ['.mkv', 'video'], ['.avi', 'video'],
    ['.flv', 'video'], ['.wmv', 'video'], ['.mpg', 'video'], ['.mpeg', 'video'], ['.3gp', 'video'],
    ['.mp3', 'audio'], ['.wav', 'audio'], ['.m4a', 'audio'], ['.aac', 'audio'], ['.ogg', 'audio'], ['.oga', 'audio'], ['.opus', 'audio'], ['.flac', 'audio']
]);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MULTIPART_API_PATHS = new Set(['/api/upload', '/api/clip/subtitle']);
const IMPORT_COLUMNS = Object.freeze({
    projects: new Set(['title', 'theme_color', 'genre', 'synopsis', 'start_clip_id']),
    videos: new Set(['project_id', 'filename', 'filepath', 'thumbnail', 'duration']),
    clips: new Set([
        'unique_id', 'project_id', 'name', 'filepath', 'thumbnail', 'source_video_id', 'duration',
        'start_time', 'end_time', 'logic_name', 'timeout_to_id', 'timeout_seconds', 'bg_music',
        'mute_audio', 'is_event_clip', 'x', 'y', 'builder_visible', 'favorite',
        'tags', 'notes', 'markers', 'subtitle_path'
    ]),
    edges: new Set([
        'project_id', 'from_id', 'to_id', 'label', 'text_color', 'trigger_time', 'logic_id',
        'return_to_main', 'set_var', 'req_var', 'action_type', 'thumbnail', 'time_limit',
        'is_default', 'shuffle_choices'
    ])
});

function resolveLoopbackHost(value, variableName = 'HOST') {
    const raw = String(value == null || value === '' ? '127.0.0.1' : value).trim().toLowerCase();
    const host = raw === '[::1]' ? '::1' : raw;
    if (!LOOPBACK_HOSTS.has(host)) {
        throw new Error(`${variableName} must be a loopback host (localhost, 127.0.0.1, or ::1) because the local API has no authentication`);
    }
    return host;
}

function parsePort(value, fallback, variableName = 'PORT') {
    const raw = value == null || String(value).trim() === '' ? String(fallback) : String(value).trim();
    if (!/^\d+$/.test(raw)) throw new Error(`${variableName} must be an integer between 1 and 65535`);
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${variableName} must be an integer between 1 and 65535`);
    }
    return port;
}

function isAllowedLocalOrigin(origin, allowedPorts) {
    if (typeof origin !== 'string' || !origin || origin === 'null') return false;
    let url;
    try {
        url = new URL(origin);
    } catch (_) {
        return false;
    }
    if (url.protocol !== 'http:' || url.username || url.password) return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(hostname)) return false;
    const port = Number(url.port || 80);
    const ports = allowedPorts instanceof Set ? allowedPorts : new Set(allowedPorts || []);
    return ports.has(port);
}

function validateLocalRequestPolicy({ origin, allowedPorts, method, requestPath, contentType }) {
    if (origin && !isAllowedLocalOrigin(origin, allowedPorts)) {
        return { allowed: false, status: 403, error: 'Cross-origin request denied' };
    }
    if (MUTATING_METHODS.has(String(method || '').toUpperCase()) && String(requestPath || '').startsWith('/api/')) {
        const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
        const approvedMultipart = MULTIPART_API_PATHS.has(requestPath) && mediaType === 'multipart/form-data';
        if (mediaType !== 'application/json' && !approvedMultipart) {
            return { allowed: false, status: 415, error: 'API changes require JSON or a supported media upload' };
        }
    }
    return { allowed: true };
}

function normalizePublicAssetPath(value, allowedFolders = PUBLIC_ASSET_FOLDERS) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw.includes('\0')) throw new Error('Invalid public asset path');
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    const folders = allowedFolders instanceof Set ? allowedFolders : new Set(allowedFolders || []);
    if (segments.length < 2 || !folders.has(segments[0])) throw new Error('Invalid public asset path');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new Error('Invalid public asset path');
    }
    const allowedExtensions = ASSET_EXTENSIONS.get(segments[0]);
    if (allowedExtensions && !allowedExtensions.has(path.extname(segments[segments.length - 1]).toLowerCase())) {
        throw new Error('Invalid public asset path');
    }
    return `/${segments.join('/')}`;
}

function resolvePublicAssetPath(publicRoot, value, allowedFolders = PUBLIC_ASSET_FOLDERS) {
    const normalized = normalizePublicAssetPath(value, allowedFolders);
    const root = path.resolve(publicRoot);
    const absolutePath = path.resolve(root, ...normalized.slice(1).split('/'));
    const relativePath = path.relative(root, absolutePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error('Invalid public asset path');
    }
    return absolutePath;
}

function isSafeExportName(value) {
    return typeof value === 'string' && /^[a-z0-9_]{1,128}$/i.test(value);
}

function normalizeExportPosterPath(value) {
    const normalized = String(value == null ? '' : value).trim().replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
    if (segments.length !== 2 || segments[0] !== 'clips' || !/^[A-Za-z0-9._-]+$/.test(segments[1])) return null;
    if (!imageExtensions.has(path.extname(segments[1]).toLowerCase())) return null;
    return normalized;
}

function classifyMediaUpload(originalName, mimetype) {
    const extension = path.extname(String(originalName || '').replace(/\\/g, '/')).toLowerCase();
    const type = MEDIA_UPLOAD_EXTENSIONS.get(extension);
    if (!type) return null;
    const mime = String(mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (!mime || (mime !== 'application/octet-stream' && !mime.startsWith(`${type}/`))) return null;
    return { type, extension };
}

function selectAllowedImportColumns(table, row) {
    const allowed = IMPORT_COLUMNS[table];
    if (!allowed) throw new Error('Unsupported import table');
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid project import record');
    return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)));
}

module.exports = {
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
};
