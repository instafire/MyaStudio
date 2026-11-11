// Shared security helpers for MyaStudio's local server (GitHub issue #1).
// Pure functions wherever possible so they can be unit-tested without
// starting the server; the Express middleware factories live here too.
const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

// --- Loopback-only listeners and strict port parsing ---------------------

function parsePort(value, name, fallback) {
    const raw = value === undefined || value === null || String(value).trim() === ''
        ? String(fallback)
        : String(value).trim();
    if (!/^\d+$/.test(raw)) {
        throw new Error(`${name} must be a decimal port number, got ${JSON.stringify(String(value))}`);
    }
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${name} must be a port between 1 and 65535, got ${port}`);
    }
    return port;
}

function normalizeHost(value) {
    // URL.hostname returns IPv6 literals with brackets ('[::1]'); env vars
    // and bare hostnames do not, so strip them for a single comparison.
    return String(value || '').trim().replace(/^\[|\]$/g, '');
}

function parseLoopbackHost(value, name, fallback) {
    const raw = value === undefined || value === null || String(value).trim() === ''
        ? String(fallback)
        : normalizeHost(value);
    if (!LOOPBACK_HOSTS.has(raw)) {
        throw new Error(
            `${name} must be a loopback address (127.0.0.1, ::1, or localhost); ` +
            `refusing to bind ${JSON.stringify(raw)} because this server is local-only`
        );
    }
    return raw;
}

// --- Trusted browser Origins ---------------------------------------------

function normalizeOrigin(value) {
    try {
        return new URL(String(value).trim()).origin;
    } catch (_) {
        return null;
    }
}

function parseTrustedOrigins(value) {
    const origins = new Set();
    for (const part of String(value || '').split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const origin = normalizeOrigin(trimmed);
        if (!origin || origin === 'null') {
            throw new Error(`TRUSTED_ORIGINS contains an invalid origin: ${JSON.stringify(trimmed)}`);
        }
        origins.add(origin);
    }
    return origins;
}

function isLoopbackOrigin(origin) {
    if (!origin) return false;
    let url;
    try {
        url = new URL(origin);
    } catch (_) {
        return false;
    }
    return LOOPBACK_HOSTS.has(normalizeHost(url.hostname).toLowerCase());
}

// Requests without an Origin header are not browser cross-origin requests
// (curl, server-to-server, top-level navigation), so they are allowed.
// Browser requests are allowed only from loopback origins or origins the
// operator explicitly listed in TRUSTED_ORIGINS (e.g. a reverse proxy host).
function isTrustedOrigin(origin, trustedOrigins) {
    if (!origin) return true;
    if (isLoopbackOrigin(origin)) return true;
    const normalized = normalizeOrigin(origin);
    return !!normalized && trustedOrigins instanceof Set && trustedOrigins.has(normalized);
}

function corsOriginChecker(trustedOrigins) {
    return (origin, callback) => {
        if (isTrustedOrigin(origin, trustedOrigins)) return callback(null, true);
        return callback(httpError('Origin not allowed', 403));
    };
}

// --- Browser security headers --------------------------------------------

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // The studio UI is a Vue in-DOM-template app served from local vendor
    // files with inline scripts, so 'unsafe-inline'/'unsafe-eval' are
    // required; everything else is still confined to same-origin.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self'"
].join('; ');

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
}

// --- State-changing API requests ------------------------------------------

// Mutations must carry a JSON body or an approved media multipart body.
// That rejects the content types a hostile page can send without CORS
// preflight (text/plain, application/x-www-form-urlencoded). Requests with
// no Content-Type at all (no body) are allowed through.
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requireMutationContentType(req, res, next) {
    if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return next();
    const raw = req.headers && req.headers['content-type'];
    if (!raw) return next();
    const contentType = String(raw).split(';')[0].trim().toLowerCase();
    if (contentType === 'application/json' || contentType === 'multipart/form-data') return next();
    return res.status(415).json({
        error: 'State-changing API requests must use a JSON or multipart media body'
    });
}

// --- Shared path and upload validation ------------------------------------

function resolveConfinedPath(rootDir, relativePath) {
    const root = path.resolve(rootDir);
    const rel = String(relativePath || '').replace(/^\/+/, '');
    if (!rel || rel.includes('\0')) {
        throw httpError('Invalid media path', 400);
    }
    const resolved = path.resolve(root, rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw httpError('Media path escapes the media library', 400);
    }
    return resolved;
}

function resolvePublicPath(publicRoot, webPath) {
    return resolveConfinedPath(publicRoot, webPath);
}

function isSafeRelativePath(value) {
    const rel = String(value || '');
    if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return false;
    return !rel.split('/').includes('..');
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac']);
const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);
const SUBTITLE_EXTENSIONS = new Set(['.vtt', '.srt']);
const POSTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Validates an uploaded media file (single-shot or chunked reassembly).
// Returns { kind: 'video' | 'audio', ext }. The extension is authoritative
// when the client sends no MIME type; when it sends one, the MIME family
// must agree with the extension family.
function validateMediaUpload(file) {
    const originalname = String((file && file.originalname) || '');
    const ext = path.extname(originalname).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) {
        throw httpError(`Unsupported media type: ${ext || '(no extension)'}. Upload a video or audio file.`, 400);
    }
    const kind = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'audio';
    const mimetype = String((file && file.mimetype) || '').split(';')[0].trim().toLowerCase();
    if (mimetype) {
        // Browsers and curl commonly report application/octet-stream for
        // media files, so an unknown MIME type is not a rejection — the
        // extension allowlist plus the ffprobe duration probe (which rejects
        // non-media content) are the real validation. Only a MIME type that
        // is clearly not media, or that disagrees with the extension's
        // family, is rejected here.
        if (mimetype !== 'application/octet-stream' &&
            !mimetype.startsWith('video/') && !mimetype.startsWith('audio/')) {
            throw httpError(`Unsupported media MIME type: ${mimetype}`, 400);
        }
        if (mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
            if ((kind === 'video') !== mimetype.startsWith('video/')) {
                throw httpError('Media file extension does not match its MIME type', 400);
            }
        }
    }
    return { kind, ext };
}

function validateSubtitleUpload(file) {
    const originalname = String((file && file.originalname) || '');
    const ext = path.extname(originalname).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) {
        throw httpError('Only .vtt and .srt subtitle files are accepted', 400);
    }
    return { ext };
}

// --- Imported SQL columns and project references --------------------------

const IMPORT_COLUMNS = {
    projects: new Set(['id', 'title', 'theme_color', 'genre', 'synopsis', 'created_at', 'start_clip_id']),
    videos: new Set(['id', 'project_id', 'filename', 'filepath', 'thumbnail', 'duration', 'created_at']),
    clips: new Set([
        'id', 'unique_id', 'project_id', 'name', 'filepath', 'thumbnail',
        'source_video_id', 'duration', 'start_time', 'end_time', 'logic_name',
        'timeout_to_id', 'timeout_seconds', 'bg_music', 'bg_music_url',
        'mute_audio', 'is_event_clip', 'x', 'y', 'builder_visible',
        'favorite', 'tags', 'notes', 'markers', 'subtitle_path'
    ]),
    edges: new Set([
        'id', 'project_id', 'from_id', 'to_id', 'label', 'text_color',
        'trigger_time', 'logic_id', 'return_to_main', 'set_var', 'req_var',
        'action_type', 'thumbnail', 'time_limit', 'is_default', 'shuffle_choices'
    ])
};

// Drops every key that is not a real column of the target table, so a
// crafted import file cannot smuggle arbitrary identifiers into SQL.
function pickAllowedColumns(table, row) {
    const allowed = IMPORT_COLUMNS[table];
    if (!allowed) throw httpError(`Unknown import table: ${table}`, 400);
    const picked = {};
    for (const [key, value] of Object.entries(row || {})) {
        if (allowed.has(key)) picked[key] = value;
    }
    return picked;
}

// Remaps an imported reference through the id map. An unmapped reference
// (a clip/video that was not imported) becomes null instead of keeping the
// foreign id, so the import can never point at another project's rows.
function remapImportedReference(idMap, value) {
    if (value === undefined || value === null || value === '') return null;
    return (idMap && idMap.get(value)) || null;
}

// --- Stored export / poster metadata ---------------------------------------

function validateExportName(name) {
    return /^[a-z0-9_]+$/i.test(String(name || ''));
}

function validatePosterPath(posterPath) {
    if (!isSafeRelativePath(posterPath)) return false;
    return POSTER_EXTENSIONS.has(path.extname(String(posterPath)).toLowerCase());
}

// --- Sanitized errors ------------------------------------------------------

function sanitizeErrorMessage(err, fallback = 'Server error') {
    const statusCode = (err && (err.statusCode || err.status)) || 500;
    if (statusCode >= 500) return fallback;
    return (err && err.message) || fallback;
}

module.exports = {
    parsePort,
    parseLoopbackHost,
    parseTrustedOrigins,
    isLoopbackOrigin,
    isTrustedOrigin,
    corsOriginChecker,
    securityHeaders,
    CONTENT_SECURITY_POLICY,
    requireMutationContentType,
    resolveConfinedPath,
    resolvePublicPath,
    isSafeRelativePath,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    MEDIA_EXTENSIONS,
    SUBTITLE_EXTENSIONS,
    validateMediaUpload,
    validateSubtitleUpload,
    IMPORT_COLUMNS,
    pickAllowedColumns,
    remapImportedReference,
    validateExportName,
    validatePosterPath,
    sanitizeErrorMessage,
    httpError
};
