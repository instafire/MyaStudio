function serializeInlineJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003C')
        .replace(/>/g, '\\u003E')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function collectReachableClipIds(sequence = [], edges = []) {
    const reachable = new Set(
        sequence
            .map(item => item && item.id)
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

function buildPublishedPlayerHtml({ safeTitle, themeColor, clips, logicBlocks, seq, projectId }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${safeTitle}</title>
    <link rel="manifest" href="manifest.json">
    <script src="./vendor/vue.global.prod.js"></script>
    <style>
        :root {
            --panel: oklch(0.12 0.012 255 / 0.96);
            --line: oklch(0.86 0.02 255 / 0.18);
            --line-strong: oklch(0.86 0.02 255 / 0.34);
            --text: oklch(0.97 0.008 255);
            --muted: oklch(0.72 0.025 255);
            --accent: ${themeColor};
            --timeline-accent: oklch(0.66 0.18 255);
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        * { box-sizing: border-box; }
        html { color-scheme: dark; }
        html, body { margin: 0; width: 100%; height: 100%; background: oklch(0.055 0.006 255); color: var(--text); overflow: hidden; }
        body {
            background:
                radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 28%),
                radial-gradient(circle at top right, rgba(15, 23, 42, 0.92), transparent 34%),
                linear-gradient(180deg, #040507 0%, #05070b 52%, #020304 100%);
        }
        button { font: inherit; }
        button:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; box-shadow: 0 0 0 6px var(--accent); }
        [v-cloak] { display: none; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .app-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
        .ambient-grid {
            position: absolute;
            inset: 0;
            background-image:
                linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
                linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
            background-size: 36px 36px;
            mask-image: linear-gradient(180deg, rgba(255,255,255,0.28), transparent 82%);
            pointer-events: none;
        }
        .video-layer {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #000;
            transition: opacity 220ms ease;
        }
        .video-layer.faded-out { opacity: 0; }
        video { width: 100%; height: 100%; object-fit: contain; background: #000; }
        .scrim {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(2, 6, 12, 0.82) 0%, rgba(2, 6, 12, 0.16) 28%, rgba(2, 6, 12, 0.64) 100%);
            pointer-events: none;
        }
        .topbar {
            position: absolute;
            top: 18px;
            left: 18px;
            right: 18px;
            display: flex;
            justify-content: space-between;
            gap: 16px;
            z-index: 20;
            pointer-events: none;
        }
        .hud-cluster { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .hud-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            min-height: 38px;
            padding: 0 14px;
            border-radius: 999px;
            background: rgba(5, 10, 16, 0.82);
            border: 1px solid var(--line);
            backdrop-filter: blur(14px);
            color: var(--text);
            font-size: 13px;
        }
        .hud-label {
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.12em;
            font-size: 11px;
        }
        .timeline-hud {
            position: absolute;
            left: 18px;
            right: 18px;
            bottom: 18px;
            z-index: 30;
            padding: 12px 14px 14px;
            border: 1px solid var(--line);
            border-radius: 16px;
            background: oklch(0.095 0.012 255 / 0.9);
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
            backdrop-filter: blur(16px);
        }
        .timeline-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-width: 0;
            margin-bottom: 9px;
            font-size: 11px;
            color: var(--muted);
        }
        .timeline-scene {
            min-width: 0;
            overflow: hidden;
            color: var(--text);
            font-weight: 700;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .timeline-status {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-variant-numeric: tabular-nums;
        }
        .timeline-next { color: oklch(0.83 0.12 82); }
        .timeline-track {
            position: relative;
            height: 24px;
            display: flex;
            align-items: center;
            border-radius: 8px;
            cursor: pointer;
        }
        .timeline-track:focus-within {
            outline: 2px solid var(--text);
            outline-offset: 4px;
        }
        .timeline-rail,
        .timeline-fill {
            position: absolute;
            left: 0;
            height: 5px;
            border-radius: 999px;
        }
        .timeline-rail {
            right: 0;
            z-index: 1;
            background: oklch(0.3 0.012 255 / 0.72);
            box-shadow: inset 0 0 0 1px oklch(0.85 0.01 255 / 0.08);
        }
        .timeline-fill {
            width: 0;
            max-width: 100%;
            z-index: 2;
            background: var(--timeline-accent);
            transition: width 140ms linear;
        }
        .timeline-playhead {
            position: absolute;
            top: 50%;
            z-index: 3;
            width: 12px;
            height: 12px;
            border: 2px solid oklch(0.97 0.008 255);
            border-radius: 999px;
            background: var(--timeline-accent);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.42);
            pointer-events: none;
            transform: translate(-50%, -50%);
            transition: transform 160ms ease-out;
        }
        .timeline-track:hover .timeline-playhead,
        .timeline-track.is-seeking .timeline-playhead { transform: translate(-50%, -50%) scale(1.24); }
        .timeline-scrubber {
            position: absolute;
            inset: 0;
            z-index: 4;
            width: 100%;
            height: 24px;
            margin: 0;
            opacity: 0;
            cursor: pointer;
            touch-action: none;
        }
        .timeline-marker {
            position: absolute;
            top: 50%;
            z-index: 5;
            width: 14px;
            height: 14px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: oklch(0.78 0.14 78);
            box-shadow: 0 0 0 3px oklch(0.095 0.012 255), 0 0 0 4px oklch(0.83 0.12 82 / 0.5);
            cursor: pointer;
            transform: translate(-50%, -50%) rotate(45deg);
            transition: background 180ms ease-out, box-shadow 180ms ease-out, transform 180ms ease-out;
        }
        .timeline-marker.passed {
            background: var(--timeline-accent);
            box-shadow: 0 0 0 3px oklch(0.095 0.012 255), 0 0 0 4px oklch(0.72 0.12 255 / 0.4);
        }
        .timeline-marker.active,
        .timeline-marker.next {
            transform: translate(-50%, -50%) rotate(45deg) scale(1.16);
        }
        .timeline-marker:focus-visible {
            outline: 2px solid var(--text);
            outline-offset: 5px;
        }
        .timeline-marker::after {
            content: attr(data-label);
            position: absolute;
            left: 50%;
            bottom: calc(100% + 12px);
            width: max-content;
            max-width: min(280px, 72vw);
            padding: 7px 9px;
            border: 1px solid var(--line-strong);
            border-radius: 8px;
            background: oklch(0.1 0.012 255 / 0.98);
            color: var(--text);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
            font-size: 11px;
            line-height: 1.35;
            opacity: 0;
            pointer-events: none;
            transform: translate(-50%, 4px) rotate(-45deg);
            transform-origin: center;
            transition: opacity 140ms ease-out, transform 140ms ease-out;
        }
        .timeline-marker:hover::after,
        .timeline-marker:focus-visible::after {
            opacity: 1;
            transform: translate(-50%, 0) rotate(-45deg);
        }
        .launch-screen, .choice-overlay, .end-screen {
            position: absolute;
            inset: 0;
            z-index: 40;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: linear-gradient(180deg, rgba(2, 6, 12, 0.66), rgba(2, 6, 12, 0.88));
            backdrop-filter: blur(16px);
        }
        .tap-overlay {
            position: absolute;
            inset: 0;
            z-index: 35;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 0;
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: rgba(2, 6, 12, 0.42);
            cursor: pointer;
        }
        .tap-overlay .play-dot {
            width: clamp(64px, 10vw, 96px);
            height: clamp(64px, 10vw, 96px);
            border-radius: 999px;
            border: 1px solid var(--line-strong);
            background: rgba(5, 10, 16, 0.84);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(12px);
        }
        .tap-overlay .play-dot::before {
            content: '';
            display: block;
            width: 0;
            height: 0;
            border-top: 13px solid transparent;
            border-bottom: 13px solid transparent;
            border-left: 20px solid #f8fafc;
            transform: translateX(2px);
        }
        .launch-card, .choice-panel {
            width: min(1120px, 100%);
            border-radius: 32px;
            border: 1px solid var(--line);
            background:
                linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)),
                var(--panel);
            overflow: hidden;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
        }
        .launch-card { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); }
        .launch-main, .launch-side, .choice-head, .choice-grid { padding: 28px; }
        .launch-side {
            border-left: 1px solid var(--line);
            background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0));
        }
        .eyebrow {
            color: var(--accent);
            text-transform: uppercase;
            letter-spacing: 0.18em;
            font-size: 11px;
            margin-bottom: 16px;
            font-weight: 700;
        }
        h1 {
            margin: 0;
            font-size: clamp(2.4rem, 4.8vw, 4.8rem);
            line-height: 0.95;
            letter-spacing: -0.05em;
        }
        .lead {
            margin: 18px 0 0;
            color: #d7e0ec;
            font-size: 17px;
            line-height: 1.65;
            max-width: 720px;
        }
        .launch-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
        .action-btn {
            border: 0;
            border-radius: 999px;
            min-height: 52px;
            padding: 0 22px;
            cursor: pointer;
            font-weight: 700;
            transition: transform 160ms ease, box-shadow 160ms ease;
        }
        .action-btn:hover { transform: translateY(-1px); }
        .action-btn.primary { background: var(--text); color: oklch(0.12 0.012 255); box-shadow: 0 0 0 2px var(--accent), 0 16px 48px rgba(0, 0, 0, 0.3); }
        .action-btn.secondary { background: rgba(255,255,255,0.04); color: var(--text); border: 1px solid var(--line-strong); }
        .stat-list { display: grid; gap: 12px; }
        .stat-card {
            padding: 16px 18px;
            border-radius: 18px;
            border: 1px solid var(--line);
            background: rgba(255,255,255,0.03);
        }
        .stat-card strong { display: block; font-size: 20px; margin-top: 6px; }
        .choice-panel { max-height: min(86vh, 860px); display: flex; flex-direction: column; }
        .choice-head {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: end;
            border-bottom: 1px solid var(--line);
        }
        .choice-head h2 {
            margin: 10px 0 0;
            font-size: clamp(2rem, 3.8vw, 3.4rem);
            line-height: 1;
            letter-spacing: -0.05em;
        }
        .choice-head p { margin: 10px 0 0; color: var(--muted); max-width: 680px; line-height: 1.6; }
        .choice-grid {
            width: min(1120px, 100%);
            max-height: min(86vh, 860px);
            padding: 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 16px;
            overflow: auto;
        }
        .choice-index {
            position: absolute;
            top: 12px;
            left: 12px;
            z-index: 4;
            display: grid;
            place-items: center;
            width: 30px;
            height: 30px;
            border-radius: 999px;
            background: rgba(3, 7, 12, 0.78);
            border: 1px solid var(--line-strong);
            color: var(--text);
            font-size: 12px;
            font-weight: 800;
        }
        .choice-card {
            position: relative;
            display: flex;
            flex-direction: column;
            border-radius: 24px;
            overflow: hidden;
            border: 1px solid var(--line);
            background: transparent;
            color: #04070b;
            cursor: pointer;
            text-align: left;
            transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
            box-shadow: inset 0 0 0 1px var(--line);
        }
        .choice-card:hover {
            transform: translateY(-3px);
            border-color: rgba(59, 130, 246, 0.45);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34);
        }
        .choice-card.locked { cursor: not-allowed; opacity: 0.56; filter: grayscale(1); }
        .choice-media-shell {
            position: relative;
            aspect-ratio: 4 / 3;
            overflow: hidden;
            background: #000;
        }
        .choice-card img, .choice-media-shell .choice-fallback {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
        }
        .choice-card img { object-fit: cover; }
        .choice-fallback {
            background:
                radial-gradient(circle at top right, rgba(59, 130, 246, 0.24), transparent 42%),
                linear-gradient(180deg, rgba(15,23,42,0.9), rgba(2,6,12,0.95));
        }
        .choice-preview-video {
            position: absolute;
            inset: 0;
            z-index: 2;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0;
            transition: opacity 200ms ease-out;
            pointer-events: none;
        }
        .choice-card:hover .choice-preview-video,
        .choice-card:focus-within .choice-preview-video { opacity: 1; }
        .choice-preview-badge {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 4;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(3, 7, 12, 0.82);
            border: 1px solid var(--line-strong);
            color: var(--text);
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0;
            transition: opacity 200ms ease-out;
            pointer-events: none;
        }
        .choice-card:hover .choice-preview-badge,
        .choice-card:focus-within .choice-preview-badge { opacity: 1; }
        .choice-content {
            position: absolute;
            inset: auto 0 0 0;
            z-index: 3;
            padding: 12px 16px 16px;
            background: linear-gradient(180deg, rgba(2, 6, 12, 0) 0%, rgba(2, 6, 12, 0.42) 42%, rgba(2, 6, 12, 0.96) 100%);
        }
        .choice-title {
            margin: 0;
            color: #f8fafc;
            font-size: 20px;
            font-weight: 800;
            line-height: 1.15;
            text-align: center;
            letter-spacing: -0.03em;
            text-shadow: 0 8px 24px rgba(0, 0, 0, 0.62);
        }
        .locked-cover {
            position: absolute;
            inset: 0;
            z-index: 2;
            background: rgba(2, 6, 12, 0.62);
        }
        .locked-label {
            position: absolute;
            inset: auto 12px 12px 12px;
            z-index: 5;
            padding: 8px 10px;
            border-radius: 999px;
            background: rgba(3, 7, 12, 0.9);
            border: 1px solid var(--line);
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
            text-align: center;
        }
        .end-card {
            width: min(640px, 100%);
            padding: 32px;
            border: 1px solid var(--line);
            border-radius: 28px;
            background: var(--panel);
            box-shadow: 0 30px 90px rgba(0, 0, 0, 0.52);
            text-align: center;
        }
        .end-card h2 { margin: 0; font-size: clamp(2rem, 6vw, 3.6rem); letter-spacing: -0.05em; line-height: 1; }
        .end-card p { margin: 14px auto 0; max-width: 46ch; color: var(--muted); line-height: 1.6; }
        .end-card .action-btn { margin-top: 24px; }
        @media (max-width: 880px) {
            .launch-card { grid-template-columns: 1fr; }
            .launch-side { border-left: 0; border-top: 1px solid var(--line); }
            .topbar { left: 12px; right: 12px; top: 12px; }
            .hud-pill { min-height: 34px; padding: 0 12px; }
            .choice-overlay { padding: 12px; align-items: flex-end; }
            .choice-panel { max-height: 92vh; border-radius: 24px 24px 0 0; }
            .choice-head, .choice-grid { padding: 18px; }
            .choice-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
            .timeline-hud { left: 10px; right: 10px; bottom: 10px; padding: 10px 12px 12px; border-radius: 14px; }
            .timeline-meta { gap: 10px; }
            .timeline-next { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
    </style>
</head>
<body>
    <div id="app" class="app-shell" v-cloak>
        <div class="ambient-grid"></div>
        <div class="video-layer" :class="{ 'faded-out': isFading }">
            <video ref="player" @timeupdate="checkTime" @loadedmetadata="syncTimeline" @durationchange="syncTimeline" @ended="onClipEnded" playsinline webkit-playsinline></video>
        </div>
        <audio ref="bgm" loop></audio>
        <section v-if="currentClip && !isComplete" class="timeline-hud" aria-label="Scene playback timeline">
            <div class="timeline-meta">
                <span class="timeline-scene">{{ currentClip.name }}</span>
                <span class="timeline-status">
                    <span v-if="nextTimelineDecision" class="timeline-next">Next choice {{ formatTime(nextTimelineDecision.time) }}</span>
                    <span>{{ formatTime(playbackTime) }} / {{ formatTime(timelineDuration) }}</span>
                </span>
            </div>
            <span id="timeline-seek-help" class="sr-only">Drag, click, or use the arrow keys to seek. Click a choice marker to jump to that decision.</span>
            <div class="timeline-track" :class="{ 'is-seeking': isSeeking }">
                <span class="timeline-rail"></span>
                <span class="timeline-fill" :style="{ width: timelineProgress + '%' }"></span>
                <span class="timeline-playhead" :style="{ left: timelineProgress + '%' }"></span>
                <input
                    class="timeline-scrubber"
                    type="range"
                    min="0"
                    :max="timelineDuration || 0"
                    step="0.1"
                    :value="playbackTime"
                    :disabled="!timelineDuration"
                    aria-label="Seek in current scene"
                    aria-describedby="timeline-seek-help"
                    :aria-valuetext="formatTime(playbackTime) + ' of ' + formatTime(timelineDuration)"
                    @pointerdown="isSeeking = true"
                    @pointerup="finishTimelineSeek"
                    @pointercancel="finishTimelineSeek"
                    @keydown="isSeeking = true"
                    @keyup="finishTimelineSeek"
                    @input="seekTimeline"
                    @change="finishTimelineSeek"
                >
                <button
                    v-for="(decision, index) in timelineDecisions"
                    :key="decision.id"
                    type="button"
                    class="timeline-marker"
                    :class="{ passed: decision.time < playbackTime - 0.5, next: nextTimelineDecision && nextTimelineDecision.id === decision.id, active: currentOptions && currentOptions.id === decision.id }"
                    :style="{ left: decision.position + '%' }"
                    :data-label="decision.label"
                    :aria-label="decision.label"
                    @click.stop="seekToDecision(decision)"
                ></button>
            </div>
        </section>
        <button v-if="awaitingInteraction && !showChoices" type="button" class="tap-overlay" @click="resumeAfterGesture" aria-label="Play">
            <span class="play-dot"></span>
        </button>

        <div v-if="showChoices" class="choice-overlay" role="dialog" aria-modal="true" aria-labelledby="choice-heading" aria-describedby="choice-help">
            <section class="choice-panel">
                <div class="choice-head">
                    <div>
                        <div class="eyebrow">Your decision</div>
                        <h2 id="choice-heading">What happens next?</h2>
                        <p id="choice-help">Hover any choice to preview it, then click to play it. When the choice clip ends, the movie resumes from this exact moment — unless the choice is a permanent branch.</p>
                    </div>
                    <div class="hud-pill"><span class="hud-label">Scene</span>{{ currentClip ? currentClip.name : 'Current scene' }}</div>
                </div>
                <div class="choice-grid">
                    <button
                        v-for="(ch, index) in currentChoices"
                        ref="choiceButtons"
                        type="button"
                        @click="makeChoice(ch)"
                        @mouseenter="startChoicePreview(ch, $event)"
                        @mouseleave="stopChoicePreview($event)"
                        @focus="startChoicePreview(ch, $event)"
                        @blur="stopChoicePreview($event)"
                        class="choice-card"
                        :class="{ locked: isLocked(ch) }"
                        :style="{ borderColor: ch.color || 'var(--line)' }"
                        :aria-label="(ch.label || 'Choice') + (isLocked(ch) ? '. Locked' : '')"
                        :aria-disabled="isLocked(ch) ? 'true' : 'false'"
                    >
                        <div class="choice-media-shell">
                            <span class="choice-index" aria-hidden="true">{{ index + 1 }}</span>
                            <img v-if="getChoiceArtwork(ch)" :src="getChoiceArtwork(ch)" alt="">
                            <div v-else class="choice-fallback"></div>
                            <video v-if="getChoiceVideo(ch)" class="choice-preview-video" :src="getChoiceVideo(ch)" muted loop playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video>
                            <span v-if="getChoiceVideo(ch)" class="choice-preview-badge" aria-hidden="true">Preview</span>
                            <div class="choice-content">
                                <p class="choice-title">{{ ch.label || 'Choice' }}</p>
                            </div>
                            <div v-if="isLocked(ch)" class="locked-cover"></div>
                            <div v-if="isLocked(ch)" class="locked-label">Unavailable on this path</div>
                        </div>
                    </button>
                </div>
            </section>
        </div>

        <div v-if="isComplete" class="end-screen" role="dialog" aria-modal="true" aria-labelledby="end-heading">
            <div class="end-card">
                <div class="eyebrow">Story complete</div>
                <h2 id="end-heading">You reached an ending</h2>
                <p>Replay the movie to explore another path and change the outcome.</p>
                <button ref="replayButton" type="button" class="action-btn primary" @click="restartMovie">Replay from the beginning</button>
            </div>
        </div>
    </div>
    <script>
        const CLIPS = ${serializeInlineJson(clips)};
        const BLOCKS = ${serializeInlineJson(logicBlocks)};
        const PLAYLIST = ${serializeInlineJson(seq)};
        const PROJECT_ID = ${projectId};
        const { createApp } = Vue;

        createApp({
            data() {
                return {
                    currentClip: null,
                    activeBlocks: [],
                    currentOptions: null,
                    showChoices: false,
                    historyStack: [],
                    gameState: {},
                    hasSave: false,
                    isFading: false,
                    awaitingInteraction: false,
                    playlistIndex: 0,
                    isComplete: false,
                    playbackTime: 0,
                    playbackDuration: 0,
                    isSeeking: false
                };
            },
            computed: {
                CLIPS() { return CLIPS; },
                BLOCKS() { return BLOCKS; },
                PLAYLIST() { return PLAYLIST; },
                currentChoices() { return this.currentOptions ? this.currentOptions.choices : []; },
                timelineDuration() {
                    const mediaDuration = Number(this.playbackDuration);
                    const clipDuration = Number(this.currentClip && this.currentClip.duration);
                    return mediaDuration > 0 ? mediaDuration : (clipDuration > 0 ? clipDuration : 0);
                },
                timelineProgress() {
                    if (!this.timelineDuration) return 0;
                    return Math.max(0, Math.min(100, (this.playbackTime / this.timelineDuration) * 100));
                },
                timelineDecisions() {
                    if (!this.currentClip || !this.timelineDuration) return [];
                    return BLOCKS
                        .filter(block => block.from === this.currentClip.unique_id)
                        .sort((a, b) => a.time - b.time)
                        .map((block, index) => ({
                            ...block,
                            position: Math.max(0.8, Math.min(99.2, (Number(block.time) / this.timelineDuration) * 100)),
                            label: 'Choice ' + (index + 1) + ' at ' + this.formatTime(block.time) + ': ' + block.choices.map(choice => choice.label || 'Untitled option').join(' or ')
                        }));
                },
                nextTimelineDecision() {
                    return this.timelineDecisions.find(decision => decision.time > this.playbackTime + 0.5) || null;
                }
            },
            mounted() {
                window.addEventListener('keydown', this.handleChoiceKey);
                try {
                    const raw = localStorage.getItem('studio_save_' + PROJECT_ID);
                    if (raw) {
                        const save = JSON.parse(raw);
                        if (save && save.currentId) {
                            this.gameState = save.gameState || {};
                            this.historyStack = Array.isArray(save.historyStack) ? save.historyStack : [];
                            this.playlistIndex = Number.isFinite(save.playlistIndex) ? save.playlistIndex : 0;
                            this.hasSave = true;
                            this.loadClip(save.currentId, save.currentTime || 0);
                            return;
                        }
                    }
                } catch (err) {
                    try { localStorage.removeItem('studio_save_' + PROJECT_ID); } catch (_) {}
                    this.hasSave = false;
                }
                try { localStorage.removeItem('studio_save_' + PROJECT_ID); } catch (_) {}
                this.hasSave = false;
                this.playlistIndex = 0;
                if (PLAYLIST.length > 0) this.loadClip(PLAYLIST[0].id);
            },
            beforeUnmount() {
                window.removeEventListener('keydown', this.handleChoiceKey);
                if (this._loadTimeout) clearTimeout(this._loadTimeout);
            },
            methods: {
                saveGame() {
                    if (!this.currentClip) return;
                    const data = {
                        currentId: this.currentClip.unique_id,
                        currentTime: this.$refs.player ? this.$refs.player.currentTime : 0,
                        gameState: this.gameState,
                        historyStack: this.historyStack,
                        playlistIndex: this.playlistIndex
                    };
                    try {
                        localStorage.setItem('studio_save_' + PROJECT_ID, JSON.stringify(data));
                        this.hasSave = true;
                    } catch (_) {
                        this.hasSave = false;
                    }
                },
                loadClip(id, forceTime = 0) {
                    const nextClip = CLIPS.find(c => c.unique_id === id);
                    if (!nextClip) return;
                    this.stopAllChoicePreviews();
                    const v = this.$refs.player;
                    this.isComplete = false;
                    this.awaitingInteraction = false;
                    this.isFading = true;
                    this.showChoices = false;
                    this.currentOptions = null;
                    this.isSeeking = false;
                    this.playbackTime = Math.max(0, Number(forceTime) || 0);
                    this.playbackDuration = Math.max(0, Number(nextClip.duration) || 0);
                    if (this._loadTimeout) clearTimeout(this._loadTimeout);
                    this._loadTimeout = setTimeout(() => {
                        this.currentClip = nextClip;
                        this.activeBlocks = BLOCKS.filter(b => b.from === id).sort((a, b) => a.time - b.time);
                        if (forceTime > 0) {
                            this.activeBlocks = this.activeBlocks.filter(b => b.time > forceTime + 0.1);
                        }
                        v.src = nextClip.filepath;
                        v.oncanplay = () => {
                            v.muted = !!nextClip.mute_audio;
                            v.currentTime = forceTime;
                            v.play().then(() => {
                                this.awaitingInteraction = false;
                                this.isFading = false;
                                if (nextClip.bg_music) {
                                    this.playMusic(nextClip.bg_music);
                                } else {
                                    this.$refs.bgm.pause();
                                }
                                this.saveGame();
                            }).catch((err) => {
                                this.isFading = false;
                                this.awaitingInteraction = true;
                                console.error('Play error:', err);
                            });
                            v.oncanplay = null;
                        };
                    }, 220);
                },
                onClipEnded() {
                    if (this.showChoices) return;
                    if (this.historyStack.length > 0) {
                        this.finishSubClip();
                        return;
                    }
                    this.playlistIndex += 1;
                    if (this.playlistIndex < PLAYLIST.length) {
                        this.loadClip(PLAYLIST[this.playlistIndex].id);
                    } else {
                        this.completeMovie();
                    }
                },
                goToNextClip() {
                    this.showChoices = false;
                    this.playlistIndex += 1;
                    if (this.playlistIndex < PLAYLIST.length) {
                        this.loadClip(PLAYLIST[this.playlistIndex].id);
                    } else {
                        this.completeMovie();
                    }
                },
                playMusic(src) {
                    const audio = this.$refs.bgm;
                    if (!src) {
                        audio.pause();
                        return;
                    }
                    const resolvedSrc = new URL(src, window.location.href).href;
                    if (audio.src !== resolvedSrc) {
                        audio.src = src;
                    }
                    audio.volume = 0.3;
                    audio.play().catch(() => {});
                },
                resumeAfterGesture() {
                    const player = this.$refs.player;
                    if (!player) return;
                    player.play().then(() => {
                        this.awaitingInteraction = false;
                        if (this.currentClip && this.currentClip.bg_music) {
                            this.playMusic(this.currentClip.bg_music);
                        }
                    }).catch(() => {
                        this.awaitingInteraction = true;
                    });
                },
                checkTime() {
                    const v = this.$refs.player;
                    this.syncTimeline();
                    if (this.isSeeking || this.showChoices || !this.activeBlocks.length) return;
                    if (v.currentTime >= this.activeBlocks[0].time && v.currentTime < this.activeBlocks[0].time + 1.0) {
                        const block = this.activeBlocks.shift();
                        const unlocked = block.choices.filter(ch => !this.isLocked(ch));
                        if (unlocked.length === 0) {
                            // All choices are locked, so let the clip play through naturally.
                            return;
                        }
                        v.pause();
                        this.currentOptions = block;
                        this.showChoices = true;
                        this.saveGame();
                        this.$nextTick(this.focusFirstChoice);
                    }
                },
                syncTimeline() {
                    const player = this.$refs.player;
                    if (!player) return;
                    this.playbackTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
                    if (Number.isFinite(player.duration) && player.duration > 0) {
                        this.playbackDuration = player.duration;
                    }
                },
                rebuildActiveBlocks(time) {
                    if (!this.currentClip) {
                        this.activeBlocks = [];
                        return;
                    }
                    const currentTime = Math.max(0, Number(time) || 0);
                    this.activeBlocks = BLOCKS
                        .filter(block => block.from === this.currentClip.unique_id && block.time > currentTime + 0.1)
                        .sort((a, b) => a.time - b.time);
                },
                seekTimeline(event) {
                    this.isSeeking = true;
                    this.seekToTime(event && event.target ? event.target.value : this.playbackTime);
                },
                seekToTime(value) {
                    const player = this.$refs.player;
                    if (!player || !this.timelineDuration) return;
                    const nextTime = Math.max(0, Math.min(Number(value) || 0, this.timelineDuration));
                    this.showChoices = false;
                    this.currentOptions = null;
                    player.currentTime = nextTime;
                    this.playbackTime = nextTime;
                    this.rebuildActiveBlocks(nextTime);
                },
                finishTimelineSeek() {
                    this.isSeeking = false;
                    this.syncTimeline();
                    this.rebuildActiveBlocks(this.playbackTime);
                    this.saveGame();
                },
                seekToDecision(decision) {
                    if (!decision) return;
                    const player = this.$refs.player;
                    const wasPlaying = player && !player.paused;
                    this.isSeeking = true;
                    this.seekToTime(Math.max(0, Number(decision.time) - 0.35));
                    this.isSeeking = false;
                    this.saveGame();
                    if (wasPlaying && player) player.play().catch(() => {});
                },
                formatTime(value) {
                    const seconds = Math.max(0, Math.floor(Number(value) || 0));
                    const minutes = Math.floor(seconds / 60);
                    const remainder = String(seconds % 60).padStart(2, '0');
                    return minutes + ':' + remainder;
                },
                isLocked(choice) {
                    if (!choice.reqVar) return false;
                    return !this.gameState[choice.reqVar];
                },
                makeChoice(choice) {
                    if (this.isLocked(choice)) return;
                    this.stopAllChoicePreviews();
                    if (choice.setVar) this.gameState[choice.setVar] = true;
                    // Queue analytics event in localStorage; batch-submit when possible
                    try {
                        const queueKey = 'studio_analytics_' + PROJECT_ID;
                        const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
                        queue.push({ projectId: PROJECT_ID, label: choice.label, target: choice.to, ts: Date.now() });
                        localStorage.setItem(queueKey, JSON.stringify(queue));
                        // Attempt to flush queue
                        const pending = JSON.parse(localStorage.getItem(queueKey) || '[]');
                        if (pending.length > 0) {
                            Promise.all(pending.map(evt =>
                                fetch('/api/analytics/track', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ projectId: evt.projectId, label: evt.label, target: evt.target })
                                }).then(response => {
                                    if (!response.ok) throw new Error('Analytics request failed');
                                    return response;
                                })
                            )).then(() => {
                                localStorage.removeItem(queueKey);
                            }).catch(() => {
                                // Events stay queued for next attempt
                            });
                        }
                    } catch (_) { /* localStorage unavailable */ }
                    if (choice.action === 'next') {
                        this.goToNextClip();
                        return;
                    }
                    if (choice.action === 'end') {
                        this.completeMovie();
                        return;
                    }
                    const targetClip = CLIPS.find(c => c.unique_id === choice.to);
                    if (targetClip) {
                        // Return branches are the default: when the choice clip ends,
                        // the movie resumes from the exact moment the choices appeared.
                        // A choice with return === false is a permanent branch instead.
                        if (choice.return !== false) {
                            if (this.currentClip && this.currentClip.is_event_clip === 1) {
                                this.historyStack.push({ clipId: this.currentClip.unique_id, time: 0 });
                            } else {
                                const returnTime = Math.max(0, Math.min((this.currentOptions.time || 0) + 0.1, (this.currentClip.duration || 999) - 0.1));
                                this.historyStack.push({ clipId: this.currentClip.unique_id, time: returnTime });
                            }
                        }
                        this.loadClip(choice.to, 0);
                    }
                },
                finishSubClip() {
                    if (this.historyStack.length > 0) {
                        const prev = this.historyStack.pop();
                        this.loadClip(prev.clipId, prev.time);
                    }
                },
                completeMovie() {
                    const player = this.$refs.player;
                    if (player) player.pause();
                    if (this.$refs.bgm) this.$refs.bgm.pause();
                    this.showChoices = false;
                    this.currentOptions = null;
                    this.isComplete = true;
                    try { localStorage.removeItem('studio_save_' + PROJECT_ID); } catch (_) {}
                    this.hasSave = false;
                    this.$nextTick(() => {
                        if (this.$refs.replayButton) this.$refs.replayButton.focus();
                    });
                },
                restartMovie() {
                    this.gameState = {};
                    this.historyStack = [];
                    this.playlistIndex = 0;
                    this.isComplete = false;
                    this.awaitingInteraction = false;
                    if (PLAYLIST.length > 0) this.loadClip(PLAYLIST[0].id, 0);
                },
                focusFirstChoice() {
                    const buttons = this.$refs.choiceButtons;
                    const list = Array.isArray(buttons) ? buttons : (buttons ? [buttons] : []);
                    const firstAvailable = list.find((button, index) => !this.isLocked(this.currentChoices[index]));
                    if (firstAvailable) firstAvailable.focus();
                },
                handleChoiceKey(event) {
                    if (!this.showChoices || event.altKey || event.ctrlKey || event.metaKey) return;
                    const index = Number(event.key) - 1;
                    if (!Number.isInteger(index) || index < 0 || index >= this.currentChoices.length) return;
                    const choice = this.currentChoices[index];
                    if (!choice || this.isLocked(choice)) return;
                    event.preventDefault();
                    this.makeChoice(choice);
                },
                getThumb(id) {
                    const clip = CLIPS.find(x => x.unique_id === id);
                    return clip ? clip.thumbnail : '';
                },
                getChoiceArtwork(choice) {
                    return this.getThumb(choice.to) || (this.currentClip && this.currentClip.thumbnail) || '';
                },
                getChoiceVideo(choice) {
                    if (!choice || !choice.to) return '';
                    const clip = CLIPS.find(c => c.unique_id === choice.to);
                    return clip ? (clip.filepath || '') : '';
                },
                getChoicePreviewStartTime(choice) {
                    const clip = choice && choice.to ? CLIPS.find(c => c.unique_id === choice.to) : null;
                    const duration = Number(clip && clip.duration) || 0;
                    if (!Number.isFinite(duration) || duration <= 0) return 0;
                    const isFullClip = String(clip.name || '').indexOf('FULL:') === 0;
                    const preferred = isFullClip ? Math.max(0.9, duration * 0.08) : Math.max(0.35, duration * 0.12);
                    return Math.min(preferred, Math.max(duration - 0.2, 0));
                },
                startChoicePreview(choice, event) {
                    if (!choice || this.isLocked(choice)) return;
                    const card = event && event.currentTarget;
                    const video = card && card.querySelector ? card.querySelector('.choice-preview-video') : null;
                    if (!video) return;
                    this.stopAllChoicePreviews(video);
                    const startTime = this.getChoicePreviewStartTime(choice);
                    const playFromOffset = () => {
                        try { video.currentTime = startTime; } catch (_) {}
                        video.play().catch(() => {});
                    };
                    if (video.readyState >= 1) {
                        playFromOffset();
                        return;
                    }
                    const handleReady = () => {
                        video.removeEventListener('loadedmetadata', handleReady);
                        playFromOffset();
                    };
                    video.addEventListener('loadedmetadata', handleReady, { once: true });
                    try { video.load(); } catch (_) {}
                },
                stopChoicePreview(event) {
                    const card = event && event.currentTarget;
                    const video = card && card.querySelector ? card.querySelector('.choice-preview-video') : null;
                    if (!video) return;
                    try {
                        video.pause();
                        video.currentTime = 0;
                    } catch (_) {}
                },
                stopAllChoicePreviews(except) {
                    const root = this.$el || document;
                    const videos = root.querySelectorAll ? root.querySelectorAll('.choice-preview-video') : [];
                    videos.forEach(video => {
                        if (video === except) return;
                        try {
                            video.pause();
                            video.currentTime = 0;
                        } catch (_) {}
                    });
                }
            }
        }).mount('#app');
    <\/script>
</body>
</html>`;
}

module.exports = {
    buildPublishedPlayerHtml,
    collectReachableClipIds,
    serializeInlineJson
};
