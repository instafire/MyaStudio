// Builds the HTML page that hosts the MyaStudio player, both for published
// movies (a self-contained folder that plays from any static host or a USB
// stick) and for the studio's live preview.
//
// The player itself lives in public/player/ (story-core.js, mya-player.js,
// mya-player.css). Published exports get a copy of those files in player/.

const PLAYER_ASSET_FILES = ['story-core.js', 'mya-player.js', 'mya-player.css'];

// JSON that is safe to embed inside a <script> element: no "</script>", no
// HTML comment openers, and no raw line separators that break older parsers.
function serializeInlineJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003C')
        .replace(/>/g, '\\u003E')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Clip ids reachable from a legacy playlist through 'target' edges. Kept for
// callers that still work with raw edge rows.
function collectReachableClipIds(sequence = [], edges = []) {
    const reachable = new Set(
        sequence
            .map(item => (item && typeof item === 'object' ? item.id : item))
            .filter(Boolean)
    );
    let changed = true;
    while (changed) {
        changed = false;
        edges.forEach(edge => {
            if (!edge || !reachable.has(edge.from_id)) return;
            const actionType = edge.action_type || 'target';
            if (actionType !== 'target' || !edge.to_id || reachable.has(edge.to_id)) return;
            reachable.add(edge.to_id);
            changed = true;
        });
    }
    return reachable;
}

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23000'/%3E%3Cpath d='M24 18v28l22-14z' fill='%23fff'/%3E%3C/svg%3E";

function buildPlayerPageHtml({
    story,
    assetBase = 'player/',
    mode = 'published',
    storageKey = '',
    startSceneId = '',
    analytics = false,
    autoplay = false,
    posterUrl = '',
    manifest = mode === 'published'
} = {}) {
    if (!story || typeof story !== 'object') throw new Error('buildPlayerPageHtml needs a story');
    const title = escapeHtml(story.title || 'Interactive movie');
    const description = escapeHtml(story.synopsis || 'An interactive movie: you choose what happens next.');
    const base = escapeHtml(assetBase);
    const attrs = [
        `data-mode="${mode === 'preview' ? 'preview' : 'published'}"`,
        storageKey ? `data-storage-key="${escapeHtml(storageKey)}"` : '',
        startSceneId ? `data-start-scene="${escapeHtml(startSceneId)}"` : '',
        analytics ? 'data-analytics="1"' : '',
        autoplay ? 'data-autoplay="1"' : '',
        `style="--mp-accent: ${escapeHtml(story.themeColor || '#3b82f6')}"`
    ].filter(Boolean).join(' ');
    return `<!DOCTYPE html>
<html lang="en" class="mya-player-page">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta name="theme-color" content="#000000">
    <meta name="generator" content="MyaStudio">
    <meta property="og:type" content="video.movie">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
${posterUrl ? `    <meta property="og:image" content="${escapeHtml(posterUrl)}">\n    <meta name="twitter:card" content="summary_large_image">\n` : ''}    <link rel="icon" href="${FAVICON}">
${manifest ? '    <link rel="manifest" href="manifest.json">\n' : ''}    <link rel="stylesheet" href="${base}mya-player.css">
</head>
<body>
    <div id="mya-player" ${attrs}></div>
    <noscript><p style="color:#fff;font-family:system-ui,sans-serif;padding:24px">This interactive movie needs JavaScript to play.</p></noscript>
    <script id="mya-story" type="application/json">${serializeInlineJson(story)}</script>
    <script src="${base}story-core.js"></script>
    <script src="${base}mya-player.js" data-auto-mount></script>
</body>
</html>
`;
}

module.exports = {
    PLAYER_ASSET_FILES,
    serializeInlineJson,
    escapeHtml,
    collectReachableClipIds,
    buildPlayerPageHtml
};
