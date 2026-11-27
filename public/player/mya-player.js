/*
 * MyaStudio interactive movie player (UI layer).
 * Requires story-core.js (window.MyaStory) to be loaded first.
 *
 * Usage:
 *   MyaPlayer.mount(element, story, { mode: 'published' | 'preview', ... })
 * or, on a page with <div id="mya-player" data-...> and
 * <script id="mya-story" type="application/json">, MyaPlayer.mountFromPage().
 */
(function () {
    'use strict';

    const Story = window.MyaStory;
    if (!Story) {
        console.error('MyaPlayer: story-core.js must be loaded before mya-player.js');
        return;
    }

    const ICONS = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
        back10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.6" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="Inter, system-ui, sans-serif">10</text></svg>',
        volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
        mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
        cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6" stroke-linecap="round"/></svg>',
        expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
        shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
        undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
        restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
        close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>'
    };

    function h(tag, props, children) {
        const node = document.createElement(tag);
        const options = props || {};
        Object.keys(options).forEach(key => {
            const value = options[key];
            if (value === undefined || value === null || value === false) return;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key === 'html') node.innerHTML = value;
            else if (key === 'on') Object.keys(value).forEach(evt => node.addEventListener(evt, value[evt]));
            else if (key === 'style') node.setAttribute('style', value);
            else node.setAttribute(key, value === true ? '' : value);
        });
        (children || []).forEach(child => {
            if (child === null || child === undefined || child === false) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function storageGet(key) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }
    function storageSet(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
    }
    function storageRemove(key) {
        try { window.localStorage.removeItem(key); } catch (_) { /* private mode */ }
    }

    function cssUrl(url) {
        return 'url("' + String(url).replace(/["\\\n\r]/g, '') + '")';
    }

    function mount(root, rawStory, options) {
        const opts = Object.assign({
            mode: 'published',
            startSceneId: null,
            storageKey: null,
            analytics: false,
            autoplay: false,
            poolSize: 3,
            onEvent: null
        }, options || {});
        const isPreview = opts.mode === 'preview';
        const engine = Story.createEngine(rawStory);
        const story = engine.story;
        const analysis = Story.analyzeStory(story);
        const totalEndings = analysis.endings.length;
        const storageBase = 'mya:' + (isPreview ? 'preview:' : '') + (opts.storageKey || story.id || story.title);
        const progressKey = storageBase + ':progress';
        const endingsKey = storageBase + ':endings';
        const prefsKey = 'mya:prefs';
        const prefs = Object.assign({ volume: 1, muted: false, captions: true }, storageGet(prefsKey) || {});
        const poolSize = Math.max(2, Math.min(4, Number(opts.poolSize) || 3));

        root.innerHTML = '';
        root.classList.add('mya-player');
        if (isPreview) root.classList.add('mp-preview');
        root.style.setProperty('--mp-accent', story.themeColor);
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', story.title + ' (interactive movie)');

        // ---- DOM -------------------------------------------------------------
        const stage = h('div', { class: 'mp-stage' });
        const pool = [];
        for (let i = 0; i < poolSize; i++) {
            const video = h('video', { class: 'mp-video', playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
            video.playsInline = true;
            video._sceneId = null;
            video._src = '';
            video._lastUsed = 0;
            stage.appendChild(video);
            pool.push(video);
        }
        const scrim = h('div', { class: 'mp-scrim' });
        const hit = h('button', { class: 'mp-hit', type: 'button', 'aria-label': 'Play or pause', tabindex: '-1' });
        const music = h('audio', { loop: true, preload: 'auto' });

        const titleEl = h('p', { class: 'mp-title', text: story.title });
        const sceneNameEl = h('div', { class: 'mp-scene-name' });
        const flagsEl = h('div', { class: 'mp-flags', 'aria-label': 'Story flags' });
        const topActions = h('div', { class: 'mp-top-actions' });
        if (isPreview) {
            topActions.appendChild(flagsEl);
            topActions.appendChild(h('span', { class: 'mp-badge', text: 'Preview' }));
            topActions.appendChild(h('button', { class: 'mp-icon-btn mp-glass', type: 'button', title: 'Restart preview (R)', 'aria-label': 'Restart preview', html: ICONS.restart, on: { click: () => restart() } }));
            topActions.appendChild(h('button', { class: 'mp-icon-btn mp-glass', type: 'button', title: 'Close preview (Esc)', 'aria-label': 'Close preview', html: ICONS.close, on: { click: () => emit('close') } }));
        }
        const top = h('div', { class: 'mp-top' }, [h('div', { class: 'mp-title-block' }, [titleEl, sceneNameEl]), topActions]);

        const spinner = h('div', { class: 'mp-spinner', role: 'status', 'aria-label': 'Loading' });

        const promptEl = h('p', { class: 'mp-prompt' });
        const timerFill = h('span', { class: 'mp-timer-fill' });
        const timerEl = h('div', { class: 'mp-timer', hidden: true, role: 'timer' }, [timerFill]);
        const timerText = h('span', { class: 'mp-timer-text', hidden: true, text: '' });
        const choiceList = h('div', { class: 'mp-choice-list', role: 'group', 'aria-label': 'Choices' });
        const choicesEl = h('div', { class: 'mp-choices', 'aria-hidden': 'true' }, [promptEl, timerEl, timerText, choiceList]);

        const progressBuffer = h('span', { class: 'mp-progress-buffer' });
        const progressFill = h('span', { class: 'mp-progress-fill' });
        const progressThumb = h('span', { class: 'mp-progress-thumb' });
        const markersEl = h('span', { class: 'mp-markers' });
        const progressRail = h('span', { class: 'mp-progress-rail' }, [progressBuffer, progressFill, markersEl, progressThumb]);
        const progress = h('div', {
            class: 'mp-progress',
            role: 'slider',
            tabindex: '0',
            'aria-label': 'Seek in this scene',
            'aria-valuemin': '0',
            'aria-valuemax': '0',
            'aria-valuenow': '0'
        }, [progressRail]);
        const playBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Play (Space)', 'aria-label': 'Play', html: ICONS.play });
        const backBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Back 10 seconds', 'aria-label': 'Back 10 seconds', html: ICONS.back10 });
        const timeEl = h('span', { class: 'mp-time', text: '0:00 / 0:00' });
        const nowEl = h('span', { class: 'mp-now' });
        const prevChoiceBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Back to previous choice (B)', 'aria-label': 'Back to previous choice', html: ICONS.undo, disabled: true });
        const ccBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Captions (C)', 'aria-label': 'Captions', html: ICONS.cc, hidden: true });
        const muteBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Mute (M)', 'aria-label': 'Mute', html: ICONS.volume });
        const volumeInput = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
        const fullscreenBtn = h('button', { class: 'mp-icon-btn', type: 'button', title: 'Full screen (F)', 'aria-label': 'Full screen', html: ICONS.expand });
        const canFullscreen = !!(root.requestFullscreen || root.webkitRequestFullscreen);
        if (!canFullscreen) fullscreenBtn.hidden = true;
        const controls = h('div', { class: 'mp-controls' }, [
            progress,
            h('div', { class: 'mp-control-row' }, [
                playBtn, backBtn, timeEl, nowEl,
                h('span', { class: 'mp-spacer' }),
                prevChoiceBtn, ccBtn,
                h('span', { class: 'mp-volume' }, [volumeInput, muteBtn]),
                fullscreenBtn
            ])
        ]);

        const startLayer = h('div', { class: 'mp-layer mp-start' });
        const endLayer = h('div', { class: 'mp-layer mp-end', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'The end' });
        const tapLayer = h('button', { class: 'mp-layer mp-tap', type: 'button', 'aria-label': 'Play' }, [h('span', { class: 'mp-big-play', html: ICONS.play })]);
        const errorLayer = h('div', { class: 'mp-layer mp-error', role: 'alert' });
        const toast = h('div', { class: 'mp-toast', role: 'status' });
        const live = h('div', { class: 'mp-sr-only', 'aria-live': 'polite' });

        [stage, scrim, hit, top, spinner, choicesEl, controls, startLayer, endLayer, tapLayer, errorLayer, toast, live, music]
            .forEach(node => root.appendChild(node));

        // ---- State -----------------------------------------------------------
        let activeVideo = null;
        let choice = null;          // { point, choices, buttons, limit, elapsed, last, chosen }
        let rafId = 0;
        let controlsTimer = 0;
        let bufferTimer = 0;
        let toastTimer = 0;
        let sceneTimeoutTimer = 0;
        let lastSave = 0;
        let transitionToken = 0;
        let pausedByUser = false;
        let ended = false;
        let dragging = false;
        let usingKeyboard = false;
        let destroyed = false;

        function emit(type, detail) {
            const payload = Object.assign({ type }, detail || {});
            if (typeof opts.onEvent === 'function') {
                try { opts.onEvent(payload); } catch (_) { /* host errors stay in the host */ }
            }
            if (isPreview && window.parent && window.parent !== window) {
                try { window.parent.postMessage(Object.assign({ source: 'mya-player' }, payload), window.location.origin); } catch (_) { /* cross-origin host */ }
            }
        }

        function announce(text) {
            live.textContent = '';
            window.setTimeout(() => { live.textContent = text; }, 30);
        }

        function showToast(text) {
            toast.textContent = text;
            toast.classList.add('is-open');
            window.clearTimeout(toastTimer);
            toastTimer = window.setTimeout(() => toast.classList.remove('is-open'), 1800);
        }

        function openLayer(layer) { layer.classList.add('is-open'); }
        function closeLayer(layer) { layer.classList.remove('is-open'); }

        // ---- Media pool --------------------------------------------------------
        function setTrack(video, src) {
            Array.from(video.querySelectorAll('track')).forEach(track => track.remove());
            if (!src) return;
            const track = h('track', { kind: 'subtitles', label: 'Captions', srclang: 'en', src });
            video.appendChild(track);
        }

        function applyCaptions(video) {
            if (!video || !video.textTracks) return;
            for (let i = 0; i < video.textTracks.length; i++) {
                video.textTracks[i].mode = prefs.captions ? 'showing' : 'hidden';
            }
        }

        function assign(video, scene) {
            if (video._sceneId === scene.id && video._src === scene.src) return;
            video._sceneId = scene.id;
            video._src = scene.src;
            video.src = scene.src;
            setTrack(video, scene.subtitles);
            try { video.load(); } catch (_) { /* ignore */ }
        }

        function acquire(scene) {
            const existing = pool.find(video => video._sceneId === scene.id && video._src === scene.src);
            if (existing) return existing;
            const wanted = new Set(engine.upcomingScenes().slice(0, poolSize - 1));
            const candidates = pool
                .filter(video => video !== activeVideo)
                .sort((a, b) => (wanted.has(a._sceneId) ? 1 : 0) - (wanted.has(b._sceneId) ? 1 : 0) || a._lastUsed - b._lastUsed);
            const video = candidates[0] || activeVideo || pool[0];
            assign(video, scene);
            return video;
        }

        function preloadUpcoming() {
            const ids = engine.upcomingScenes().slice(0, poolSize - 1);
            ids.forEach(id => {
                if (pool.some(video => video._sceneId === id)) return;
                const free = pool
                    .filter(video => video !== activeVideo && !ids.includes(video._sceneId))
                    .sort((a, b) => a._lastUsed - b._lastUsed)[0];
                const scene = engine.scene(id);
                if (free && scene) assign(free, scene);
            });
        }

        function whenReady(video, timeoutMs) {
            return new Promise(resolve => {
                if (video.readyState >= 1) return resolve(true);
                if (video.error) return resolve(false);
                let settled = false;
                const done = ok => {
                    if (settled) return;
                    settled = true;
                    video.removeEventListener('loadedmetadata', onMeta);
                    video.removeEventListener('error', onError);
                    resolve(ok);
                };
                const onMeta = () => done(true);
                const onError = () => done(false);
                video.addEventListener('loadedmetadata', onMeta);
                video.addEventListener('error', onError);
                window.setTimeout(() => done(video.readyState >= 1), timeoutMs || 8000);
            });
        }

        function seekVideo(video, time) {
            return new Promise(resolve => {
                const duration = video.duration;
                const target = Number.isFinite(duration) && duration > 0
                    ? Math.min(Math.max(0, time), Math.max(0, duration - 0.05))
                    : Math.max(0, time);
                if (Math.abs((video.currentTime || 0) - target) < 0.04) return resolve();
                let settled = false;
                const done = () => {
                    if (settled) return;
                    settled = true;
                    video.removeEventListener('seeked', done);
                    resolve();
                };
                video.addEventListener('seeked', done);
                try { video.currentTime = target; } catch (_) { done(); }
                window.setTimeout(done, 2500);
            });
        }

        function applyAudio(video, scene) {
            video.volume = prefs.volume;
            video.muted = prefs.muted || !!(scene && scene.muted);
            music.volume = Math.min(1, prefs.volume * 0.4);
            music.muted = prefs.muted;
            muteBtn.innerHTML = prefs.muted || prefs.volume === 0 ? ICONS.mute : ICONS.volume;
            muteBtn.setAttribute('aria-label', prefs.muted ? 'Unmute' : 'Mute');
            volumeInput.value = String(prefs.muted ? 0 : prefs.volume);
        }

        function setMusic(src) {
            if (!src) {
                if (!music.paused) music.pause();
                return;
            }
            const resolved = new URL(src, window.location.href).href;
            if (music.src !== resolved) music.src = src;
            if (music.paused) music.play().catch(() => { /* waits for a gesture */ });
        }

        function activate(video, previous) {
            activeVideo = video;
            video._lastUsed = Date.now();
            if (video === previous) {
                video.classList.add('is-active');
                return;
            }
            video.classList.add('is-entering');
            window.requestAnimationFrame(() => video.classList.add('is-active'));
            window.setTimeout(() => {
                video.classList.remove('is-entering');
                pool.forEach(other => {
                    if (other !== activeVideo) {
                        other.classList.remove('is-active');
                        if (!other.paused) other.pause();
                    }
                });
            }, 220);
        }

        // ---- Scenes --------------------------------------------------------------
        async function showScene(sceneId, time, showPointId) {
            const scene = engine.scene(sceneId);
            if (!scene) return run(engine.sceneEnded());
            const token = ++transitionToken;
            closeChoices();
            closeLayer(endLayer);
            closeLayer(tapLayer);
            closeLayer(errorLayer);
            closeLayer(startLayer);
            ended = false;
            pausedByUser = false;
            clearSceneTimeout();

            const previous = activeVideo;
            const video = acquire(scene);
            setBuffering(true);
            const ready = await whenReady(video);
            if (token !== transitionToken || destroyed) return;
            if (!ready) {
                setBuffering(false);
                showError(scene);
                return;
            }
            await seekVideo(video, time);
            if (token !== transitionToken || destroyed) return;
            applyAudio(video, scene);
            applyCaptions(video);

            let blocked = false;
            try {
                await video.play();
            } catch (err) {
                if (token !== transitionToken || destroyed) return;
                if (err && err.name === 'NotAllowedError') {
                    blocked = true;
                } else if (!(err && err.name === 'AbortError')) {
                    setBuffering(false);
                    showError(scene);
                    return;
                }
            }
            if (token !== transitionToken || destroyed) return;
            activate(video, previous);
            if (!blocked && video.paused) video.play().catch(() => openLayer(tapLayer));
            syncPlayButton();
            updateSceneUi(scene);
            setMusic(scene.music);
            preloadUpcoming();
            startSceneTimeout(scene);
            setBuffering(false);
            if (blocked) openLayer(tapLayer);
            emit('scene', { sceneId: scene.id, name: scene.name });
            if (showPointId) {
                const command = engine.openPoint(showPointId);
                if (command) openChoices(command.point, command.choices);
            }
            startLoop();
            saveProgress(true);
        }

        function updateSceneUi(scene) {
            // Scene names can spoil what's coming, so viewers only see the
            // movie title; creators previewing see where they are.
            sceneNameEl.textContent = isPreview ? scene.name : '';
            nowEl.textContent = isPreview ? scene.name : '';
            prevChoiceBtn.disabled = !engine.canGoBack();
            ccBtn.hidden = !scene.subtitles;
            ccBtn.setAttribute('aria-pressed', prefs.captions ? 'true' : 'false');
            renderMarkers(scene);
            renderFlags();
        }

        function renderMarkers(scene) {
            markersEl.innerHTML = '';
            const duration = sceneDuration();
            if (!(duration > 0)) return;
            engine.pointsFor(scene.id).forEach(point => {
                const left = Math.max(0.5, Math.min(99.5, (point.time / duration) * 100));
                markersEl.appendChild(h('span', { class: 'mp-marker', style: 'left:' + left + '%' }));
            });
        }

        function renderFlags() {
            if (!isPreview) return;
            flagsEl.innerHTML = '';
            Object.keys(engine.state.flags).filter(key => engine.state.flags[key]).forEach(flag => {
                flagsEl.appendChild(h('span', { class: 'mp-flag', text: flag }));
            });
        }

        function sceneDuration() {
            const scene = engine.currentScene();
            const mediaDuration = activeVideo ? activeVideo.duration : NaN;
            if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;
            return scene ? scene.duration : 0;
        }

        function startSceneTimeout(scene) {
            clearSceneTimeout();
            if (!scene.timeout) return;
            const sceneId = scene.id;
            sceneTimeoutTimer = window.setTimeout(() => {
                if (engine.state.sceneId !== sceneId || ended || (choice && choice.chosen)) return;
                run(engine.followTimeout());
            }, scene.timeout.seconds * 1000);
        }
        function clearSceneTimeout() {
            if (sceneTimeoutTimer) window.clearTimeout(sceneTimeoutTimer);
            sceneTimeoutTimer = 0;
        }

        function run(command) {
            if (!command || destroyed) return;
            if (command.type === 'play') {
                showScene(command.sceneId, command.time, command.showPointId);
            } else if (command.type === 'choices') {
                openChoices(command.point, command.choices);
            } else if (command.type === 'resume') {
                const holding = choice && choice.holding;
                closeChoices();
                if (holding || (activeVideo && activeVideo.ended)) {
                    run(engine.sceneEnded());
                } else if (activeVideo && activeVideo.paused && !pausedByUser) {
                    activeVideo.play().catch(() => openLayer(tapLayer));
                }
            } else if (command.type === 'end') {
                showEnd(command.ending);
            }
        }

        // ---- Frame loop ------------------------------------------------------------
        function tick() {
            rafId = 0;
            if (destroyed || !activeVideo) return;
            check();
            if (!activeVideo.paused || choice) rafId = window.requestAnimationFrame(tick);
        }
        function startLoop() {
            if (!rafId && !destroyed) rafId = window.requestAnimationFrame(tick);
        }
        function check() {
            if (!activeVideo) return;
            if (!choice && !ended && !dragging) {
                const command = engine.pointDue(activeVideo.currentTime || 0);
                if (command) openChoices(command.point, command.choices);
            }
            if (choice) updateTimer();
            updateProgress();
            if (!activeVideo.paused) saveProgress(false);
        }

        function onVideoEvent(event) {
            const video = event.currentTarget;
            if (video !== activeVideo) return;
            switch (event.type) {
                case 'play':
                    syncPlayButton();
                    startLoop();
                    scheduleControlsHide();
                    break;
                case 'pause':
                    syncPlayButton();
                    showControls();
                    break;
                case 'timeupdate':
                    check();
                    break;
                case 'progress':
                    updateBuffer();
                    break;
                case 'waiting':
                    setBuffering(true);
                    break;
                case 'playing':
                case 'canplay':
                case 'seeked':
                    setBuffering(false);
                    break;
                case 'loadedmetadata':
                    applyCaptions(video);
                    renderMarkers(engine.currentScene() || {});
                    break;
                case 'ended':
                    onEnded();
                    break;
                case 'error':
                    showError(engine.currentScene());
                    break;
                default:
                    break;
            }
        }
        pool.forEach(video => {
            ['play', 'pause', 'timeupdate', 'progress', 'waiting', 'playing', 'canplay', 'seeked', 'loadedmetadata', 'ended', 'error']
                .forEach(type => video.addEventListener(type, onVideoEvent));
        });

        function syncPlayButton() {
            const playing = !!(activeVideo && !activeVideo.paused);
            playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
            playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
        }

        function onEnded() {
            if (ended) return;
            if (choice) {
                // Hold the last frame until the viewer (or the timer) decides.
                choice.holding = true;
                return;
            }
            run(engine.sceneEnded());
        }

        function setBuffering(on) {
            window.clearTimeout(bufferTimer);
            if (on) {
                bufferTimer = window.setTimeout(() => root.classList.add('mp-buffering'), 280);
            } else {
                root.classList.remove('mp-buffering');
            }
        }

        // ---- Choices -----------------------------------------------------------------
        function openChoices(point, choices) {
            if (!choices || !choices.length) return;
            if (choice && choice.point.id === point.id) return;
            closeChoices();
            // A choice with no artwork of its own falls back to its target
            // scene's poster, and the card class is per-button, not global:
            // the old code gave EVERY button the card class when ANY choice
            // had an image, so imageless choices rendered as empty black
            // tiles (Two Doors demo: "Open the red door" was black while
            // "Enter the garden" showed its colour bars). A broken image
            // file degrades to a plain text button instead of a black tile.
            const scenePoster = id => {
                const scene = (story.scenes || []).find(item => item.id === id);
                return scene ? scene.poster : null;
            };
            const choiceImage = item => item.image || (item.action === 'scene' ? scenePoster(item.to) : null);
            const hasImages = choices.some(item => choiceImage(item));
            choiceList.innerHTML = '';
            choiceList.style.setProperty('--mp-count', String(choices.length <= 4 ? choices.length : Math.ceil(choices.length / 2)));
            const buttons = choices.map((item, index) => {
                const visited = !!engine.state.visitedChoices[item.id];
                const image = choiceImage(item);
                const button = h('button', {
                    class: 'mp-choice' + (image ? ' mp-choice-card' : '') + (item.isDefault && point.timeLimit > 0 ? ' is-default' : ''),
                    type: 'button',
                    'aria-label': (item.label || 'Choice') + (visited ? ' (already watched)' : '')
                }, [
                    choices.length > 1 && !hasImages ? h('span', { class: 'mp-choice-key', 'aria-hidden': 'true', text: String(index + 1) }) : null,
                    visited ? h('span', { class: 'mp-choice-visited', 'aria-hidden': 'true', text: '✓ Seen' }) : null,
                    image ? h('img', { src: image, alt: '', on: { error: event => {
                        const failed = event.currentTarget;
                        if (failed) failed.remove();
                        button.classList.remove('mp-choice-card');
                    } } }) : null,
                    h('span', { class: 'mp-choice-label', text: item.label || 'Continue' })
                ]);
                button.addEventListener('click', () => pick(item, false));
                return button;
            });
            buttons.forEach(button => choiceList.appendChild(button));
            promptEl.textContent = point.prompt || '';
            const limit = Number(point.timeLimit) || 0;
            timerEl.hidden = !(limit > 0);
            timerText.hidden = !(limit > 0);
            timerText.textContent = limit > 0 ? Math.ceil(limit) + 's left' : '';
            timerFill.style.transform = 'scaleX(1)';
            choice = { point, choices, buttons, limit, elapsed: 0, last: performance.now(), chosen: false, holding: false };
            if (point.pause && activeVideo && !activeVideo.paused) activeVideo.pause();
            root.classList.add('mp-choosing');
            choicesEl.classList.add('is-open');
            choicesEl.removeAttribute('aria-hidden');
            hideControls();
            if (usingKeyboard && buttons[0]) buttons[0].focus({ preventScroll: true });
            announce('Make a choice: ' + choices.map(item => item.label || 'Continue').join(', or '));
            emit('choices', { pointId: point.id });
            startLoop();
        }

        function updateTimer() {
            if (!choice || !choice.limit || choice.chosen) return;
            const now = performance.now();
            const delta = Math.min(0.25, Math.max(0, (now - choice.last) / 1000));
            choice.last = now;
            if (!pausedByUser) choice.elapsed += delta;
            const left = Math.max(0, choice.limit - choice.elapsed);
            timerFill.style.transform = 'scaleX(' + (left / choice.limit).toFixed(4) + ')';
            timerEl.setAttribute('aria-label', Math.ceil(left) + ' seconds left to choose');
            timerText.textContent = Math.ceil(left) + 's left';
            if (left <= 0) pick(engine.defaultChoice(choice.point, choice.choices), true);
        }

        function pick(item, automatic) {
            if (!choice || choice.chosen || !item) return;
            choice.chosen = true;
            const index = choice.choices.indexOf(item);
            if (choice.buttons[index]) choice.buttons[index].classList.add('is-chosen');
            choicesEl.classList.add('has-chosen');
            trackChoice(item);
            const command = engine.choose(choice.point.id, item.id);
            renderFlags();
            emit('choice', { pointId: choice.point.id, choiceId: item.id, automatic: !!automatic });
            window.setTimeout(() => {
                if (destroyed) return;
                if (command) run(command);
                else closeChoices();
            }, automatic ? 520 : 340);
        }

        function closeChoices() {
            if (!choice) return;
            choice = null;
            root.classList.remove('mp-choosing');
            choicesEl.classList.remove('is-open', 'has-chosen');
            choicesEl.setAttribute('aria-hidden', 'true');
            window.setTimeout(() => { if (!choice) choiceList.innerHTML = ''; }, 280);
        }

        function trackChoice(item) {
            if (isPreview || !opts.analytics || !story.analytics || !story.analytics.projectId) return;
            try {
                window.fetch('/api/analytics/track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: story.analytics.projectId, label: item.label, target: item.to }),
                    keepalive: true
                }).catch(() => { /* hosted elsewhere: analytics are optional */ });
            } catch (_) { /* fetch unavailable */ }
        }

        // ---- Start / end screens ----------------------------------------------------
        function foundEndings() {
            const list = storageGet(endingsKey);
            return Array.isArray(list) ? list : [];
        }

        function renderStart() {
            const startScene = engine.scene(story.startSceneId) || story.scenes[0];
            const saved = isPreview ? null : storageGet(progressKey);
            const canResume = !!(saved && engine.scene(saved.sceneId));
            const found = foundEndings().filter(key => analysis.endings.some(ending => ending.key === key));
            startLayer.innerHTML = '';
            if (startScene && startScene.poster) startLayer.style.backgroundImage = cssUrl(startScene.poster);
            const playButton = h('button', { class: 'mp-btn mp-btn-primary', type: 'button', html: ICONS.play + '<span>' + (canResume ? 'Resume' : 'Play') + '</span>' });
            playButton.addEventListener('click', () => {
                const command = (canResume && engine.restore(saved)) || freshCommand();
                unlockMedia(command && command.sceneId);
                run(command);
            });
            const actions = [playButton];
            if (canResume) {
                actions.push(h('button', { class: 'mp-btn mp-btn-ghost', type: 'button', html: ICONS.restart + '<span>Start over</span>', on: { click: () => { const command = freshCommand(); unlockMedia(command && command.sceneId); run(command); } } }));
            }
            const chips = [h('span', { class: 'mp-chip', text: 'You decide what happens' })];
            if (totalEndings > 1) chips.push(h('span', { class: 'mp-chip', text: totalEndings + ' endings' }));
            if (found.length) chips.push(h('span', { class: 'mp-chip', text: 'Found ' + found.length + ' of ' + Math.max(found.length, totalEndings) }));
            startLayer.appendChild(h('div', { class: 'mp-start-inner' }, [
                h('span', { class: 'mp-eyebrow', text: story.genre || 'Interactive movie' }),
                h('h1', { text: story.title }),
                story.synopsis ? h('p', { class: 'mp-synopsis', text: story.synopsis }) : null,
                h('div', { class: 'mp-meta' }, chips),
                h('div', { class: 'mp-actions' }, actions)
            ]));
            openLayer(startLayer);
            window.setTimeout(() => { if (!destroyed && usingKeyboard) playButton.focus({ preventScroll: true }); }, 50);
        }

        function showEnd(ending) {
            ended = true;
            closeChoices();
            clearSceneTimeout();
            if (activeVideo && !activeVideo.paused) activeVideo.pause();
            if (!music.paused) music.pause();
            storageRemove(progressKey);
            const found = foundEndings();
            if (ending && ending.key && !found.includes(ending.key)) {
                found.push(ending.key);
                storageSet(endingsKey, found.slice(-100));
            }
            const knownFound = found.filter(key => analysis.endings.some(item => item.key === key));
            const total = Math.max(totalEndings, knownFound.length);

            endLayer.innerHTML = '';
            const startScene = engine.scene(story.startSceneId);
            const currentScene = engine.currentScene();
            const poster = (currentScene && currentScene.poster) || (startScene && startScene.poster);
            endLayer.style.backgroundImage = poster ? cssUrl(poster) : '';
            const children = [
                h('span', { class: 'mp-eyebrow', text: ending && ending.kind === 'ending' ? 'You reached an ending' : 'The end' }),
                h('h2', { text: (ending && ending.title) || 'The End' })
            ];
            if (total > 1) {
                const dots = h('div', { class: 'mp-endings-progress', 'aria-hidden': 'true' });
                for (let i = 0; i < total; i++) dots.appendChild(h('span', { class: i < knownFound.length ? 'is-found' : '' }));
                children.push(dots);
                children.push(h('p', { class: 'mp-endings-text', text: knownFound.length >= total ? 'You found every ending. Nicely done.' : 'You\'ve found ' + knownFound.length + ' of ' + total + ' endings. Try different choices to find the rest.' }));
            }
            const journey = engine.state.journey;
            if (journey.length) {
                const list = h('ol', { class: 'mp-journey', 'aria-label': 'Your choices' });
                journey.slice(-12).forEach((step, index) => {
                    list.appendChild(h('li', {}, [
                        h('span', { class: 'mp-journey-num', text: String(Math.max(1, journey.length - 12 + 1) + index) }),
                        h('span', {}, [h('b', { text: step.label }), step.result ? h('small', { text: '  ·  ' + step.result }) : null])
                    ]));
                });
                children.push(list);
            }
            const actions = [];
            if (engine.canGoBack()) {
                actions.push(h('button', { class: 'mp-btn mp-btn-ghost', type: 'button', html: ICONS.undo + '<span>Back to last choice</span>', on: { click: () => goBack() } }));
            }
            const replay = h('button', { class: 'mp-btn mp-btn-primary', type: 'button', html: ICONS.restart + '<span>Watch again</span>', on: { click: () => restart() } });
            actions.push(replay);
            if (!isPreview) {
                actions.push(h('button', { class: 'mp-btn mp-btn-ghost', type: 'button', html: ICONS.share + '<span>Share</span>', on: { click: () => share() } }));
            }
            children.push(h('div', { class: 'mp-actions' }, actions));
            endLayer.appendChild(h('div', { class: 'mp-end-inner' }, children));
            openLayer(endLayer);
            announce(((ending && ending.title) || 'The End') + '.');
            window.setTimeout(() => { if (!destroyed) replay.focus({ preventScroll: true }); }, 60);
            emit('end', { ending });
        }

        function showError(scene) {
            setBuffering(false);
            errorLayer.innerHTML = '';
            const name = scene ? scene.name : 'this scene';
            errorLayer.appendChild(h('div', { class: 'mp-message' }, [
                h('h3', { text: 'This scene couldn\'t play' }),
                h('p', { text: 'The video for "' + name + '" didn\'t load. Check your connection, or skip ahead.' }),
                h('div', { class: 'mp-actions' }, [
                    h('button', { class: 'mp-btn mp-btn-primary', type: 'button', text: 'Try again', on: { click: () => { closeLayer(errorLayer); if (scene) { pool.forEach(video => { if (video._sceneId === scene.id) { video._sceneId = null; video._src = ''; } }); showScene(scene.id, 0); } } } }),
                    h('button', { class: 'mp-btn mp-btn-ghost', type: 'button', text: 'Skip scene', on: { click: () => { closeLayer(errorLayer); run(engine.sceneEnded()); } } })
                ])
            ]));
            openLayer(errorLayer);
            emit('error', { sceneId: scene ? scene.id : null });
        }

        // ---- Actions -------------------------------------------------------------------
        function unlockMedia(skipSceneId) {
            // Called inside a user gesture: lets every pooled video and the
            // music element play with sound later (iOS and Safari need this).
            // The video that is about to play is left alone.
            pool.forEach(video => {
                if (!video._src || video === activeVideo || (skipSceneId && video._sceneId === skipSceneId)) return;
                const wasMuted = video.muted;
                video.muted = true;
                const attempt = video.play();
                if (attempt && attempt.then) {
                    attempt.then(() => {
                        if (video !== activeVideo && video._sceneId !== engine.state.sceneId) video.pause();
                        video.muted = wasMuted;
                    }).catch(() => { video.muted = wasMuted; });
                }
            });
        }

        function freshCommand() {
            storageRemove(progressKey);
            return engine.start(opts.startSceneId);
        }

        function startFresh() {
            run(freshCommand());
        }

        function restart() {
            closeLayer(endLayer);
            const command = freshCommand();
            unlockMedia(command && command.sceneId);
            run(command);
            emit('restart');
        }

        function goBack() {
            const command = engine.goBack();
            if (command) {
                closeLayer(endLayer);
                run(command);
                showToast('Back to your last choice');
            }
        }

        function togglePlay() {
            if (!activeVideo || ended) return;
            if (activeVideo.paused) {
                pausedByUser = false;
                if (activeVideo.ended && !choice) return run(engine.sceneEnded());
                activeVideo.play().then(() => closeLayer(tapLayer)).catch(() => openLayer(tapLayer));
                if (music.src && engine.currentScene() && engine.currentScene().music) music.play().catch(() => {});
            } else {
                pausedByUser = true;
                activeVideo.pause();
                if (!music.paused) music.pause();
            }
        }

        function seekTo(time) {
            if (!activeVideo) return;
            const duration = sceneDuration();
            const target = Math.max(0, Math.min(duration > 0 ? duration - 0.05 : time, time));
            engine.seek(target);
            try { activeVideo.currentTime = target; } catch (_) { /* not seekable yet */ }
            if (choice && !choice.chosen && target < choice.point.time - 0.05) closeChoices();
            updateProgress();
        }

        function setVolume(value) {
            prefs.volume = Math.max(0, Math.min(1, value));
            prefs.muted = prefs.volume === 0;
            storageSet(prefsKey, prefs);
            if (activeVideo) applyAudio(activeVideo, engine.currentScene());
        }

        function toggleMute() {
            prefs.muted = !prefs.muted;
            if (!prefs.muted && prefs.volume === 0) prefs.volume = 0.8;
            storageSet(prefsKey, prefs);
            if (activeVideo) applyAudio(activeVideo, engine.currentScene());
            showToast(prefs.muted ? 'Sound off' : 'Sound on');
        }

        function toggleCaptions() {
            prefs.captions = !prefs.captions;
            storageSet(prefsKey, prefs);
            applyCaptions(activeVideo);
            ccBtn.setAttribute('aria-pressed', prefs.captions ? 'true' : 'false');
            showToast(prefs.captions ? 'Captions on' : 'Captions off');
        }

        function toggleFullscreen() {
            const doc = document;
            if (doc.fullscreenElement || doc.webkitFullscreenElement) {
                (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
            } else if (root.requestFullscreen) {
                root.requestFullscreen().catch(() => {});
            } else if (root.webkitRequestFullscreen) {
                root.webkitRequestFullscreen();
            }
        }
        function onFullscreenChange() {
            const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
            fullscreenBtn.innerHTML = on ? ICONS.shrink : ICONS.expand;
            fullscreenBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
        }

        function share() {
            const url = window.location.href.split('#')[0];
            if (navigator.share) {
                navigator.share({ title: story.title, url }).catch(() => {});
                return;
            }
            const done = () => showToast('Link copied');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url) && done());
            } else if (fallbackCopy(url)) {
                done();
            }
        }
        function fallbackCopy(text) {
            const area = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
            area.value = text;
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
            area.remove();
            return ok;
        }

        function saveProgress(force) {
            if (isPreview || !activeVideo || ended) return;
            const now = Date.now();
            if (!force && now - lastSave < 4000) return;
            lastSave = now;
            storageSet(progressKey, engine.snapshot(activeVideo.currentTime || 0));
        }

        // ---- Progress bar -------------------------------------------------------------
        function updateProgress() {
            if (!activeVideo) return;
            const duration = sceneDuration();
            const current = Math.min(duration || 0, activeVideo.currentTime || 0);
            const percent = duration > 0 ? (current / duration) * 100 : 0;
            progressFill.style.width = percent + '%';
            progressThumb.style.left = percent + '%';
            timeEl.textContent = Story.formatTime(current) + ' / ' + Story.formatTime(duration);
            progress.setAttribute('aria-valuemax', String(Math.round(duration)));
            progress.setAttribute('aria-valuenow', String(Math.round(current)));
            progress.setAttribute('aria-valuetext', Story.formatTime(current) + ' of ' + Story.formatTime(duration));
        }
        function updateBuffer() {
            if (!activeVideo || !activeVideo.buffered || !activeVideo.buffered.length) return;
            const duration = sceneDuration();
            if (!(duration > 0)) return;
            const end = activeVideo.buffered.end(activeVideo.buffered.length - 1);
            progressBuffer.style.width = Math.min(100, (end / duration) * 100) + '%';
        }
        function timeFromPointer(event) {
            const rect = progressRail.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
            return ratio * sceneDuration();
        }
        progress.addEventListener('pointerdown', event => {
            if (!activeVideo) return;
            dragging = true;
            progress.classList.add('is-dragging');
            progress.setPointerCapture(event.pointerId);
            seekTo(timeFromPointer(event));
        });
        progress.addEventListener('pointermove', event => {
            if (dragging) seekTo(timeFromPointer(event));
        });
        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            progress.classList.remove('is-dragging');
            check();
        };
        progress.addEventListener('pointerup', endDrag);
        progress.addEventListener('pointercancel', endDrag);
        progress.addEventListener('keydown', event => {
            if (!activeVideo) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                event.stopPropagation();
                seekTo((activeVideo.currentTime || 0) + (event.key === 'ArrowLeft' ? -5 : 5));
            }
        });

        // ---- Controls visibility --------------------------------------------------------
        function showControls() {
            root.classList.add('mp-controls-visible');
            root.classList.remove('mp-hide-cursor');
            scheduleControlsHide();
        }
        function hideControls() {
            root.classList.remove('mp-controls-visible');
        }
        function scheduleControlsHide() {
            window.clearTimeout(controlsTimer);
            controlsTimer = window.setTimeout(() => {
                if (!activeVideo || activeVideo.paused || dragging || controls.matches(':hover') || controls.contains(document.activeElement)) return;
                hideControls();
                root.classList.add('mp-hide-cursor');
            }, 2600);
        }

        // ---- Wiring ------------------------------------------------------------------
        playBtn.addEventListener('click', togglePlay);
        backBtn.addEventListener('click', () => activeVideo && seekTo((activeVideo.currentTime || 0) - 10));
        prevChoiceBtn.addEventListener('click', goBack);
        ccBtn.addEventListener('click', toggleCaptions);
        muteBtn.addEventListener('click', toggleMute);
        volumeInput.addEventListener('input', () => setVolume(Number(volumeInput.value)));
        fullscreenBtn.addEventListener('click', toggleFullscreen);
        tapLayer.addEventListener('click', () => {
            closeLayer(tapLayer);
            unlockMedia(engine.state.sceneId);
            if (activeVideo) {
                activeVideo.play().catch(() => openLayer(tapLayer));
                const scene = engine.currentScene();
                if (scene && scene.music) music.play().catch(() => {});
            }
        });
        hit.addEventListener('pointerup', event => {
            if (event.pointerType === 'mouse') {
                togglePlay();
                showControls();
            } else if (root.classList.contains('mp-controls-visible')) {
                hideControls();
            } else {
                showControls();
            }
        });
        root.addEventListener('pointermove', event => {
            if (event.pointerType === 'mouse') {
                usingKeyboard = false;
                if (!choice) showControls();
            }
        });
        root.addEventListener('pointerdown', () => { usingKeyboard = false; });
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);

        function onKey(event) {
            if (destroyed) return;
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) && target !== volumeInput) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            usingKeyboard = true;
            const key = event.key;
            if (choice && !choice.chosen && /^[1-9]$/.test(key)) {
                const item = choice.choices[Number(key) - 1];
                if (item) { event.preventDefault(); pick(item, false); }
                return;
            }
            if (choice && !choice.chosen && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) {
                event.preventDefault();
                const index = choice.buttons.indexOf(document.activeElement);
                const step = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
                const next = choice.buttons[(index + step + choice.buttons.length) % choice.buttons.length] || choice.buttons[0];
                if (next) next.focus({ preventScroll: true });
                return;
            }
            if (key === 'Escape' && isPreview) { emit('close'); return; }
            if (startLayer.classList.contains('is-open') || endLayer.classList.contains('is-open')) return;
            switch (key) {
                case ' ':
                case 'k':
                case 'K':
                    if (target && target.tagName === 'BUTTON' && target !== hit) return;
                    event.preventDefault();
                    togglePlay();
                    showControls();
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    if (activeVideo) seekTo((activeVideo.currentTime || 0) - 5);
                    showControls();
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    if (activeVideo) seekTo((activeVideo.currentTime || 0) + 5);
                    showControls();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    setVolume(prefs.volume + 0.1);
                    showToast('Volume ' + Math.round(prefs.volume * 100) + '%');
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    setVolume(prefs.volume - 0.1);
                    showToast('Volume ' + Math.round(prefs.volume * 100) + '%');
                    break;
                case 'm':
                case 'M':
                    toggleMute();
                    break;
                case 'c':
                case 'C':
                    if (!ccBtn.hidden) toggleCaptions();
                    break;
                case 'f':
                case 'F':
                    if (canFullscreen) toggleFullscreen();
                    break;
                case 'b':
                case 'B':
                case 'Backspace':
                    event.preventDefault();
                    goBack();
                    break;
                case 'r':
                case 'R':
                    if (isPreview) restart();
                    break;
                default:
                    break;
            }
        }
        const keyTarget = opts.keyboardTarget === 'root' ? root : window;
        keyTarget.addEventListener('keydown', onKey);

        function onVisibility() {
            if (document.hidden) saveProgress(true);
        }
        document.addEventListener('visibilitychange', onVisibility);

        // ---- Boot -------------------------------------------------------------------
        applyAudio(pool[0], null);
        if (!story.scenes.length || !story.startSceneId) {
            errorLayer.appendChild(h('div', { class: 'mp-message' }, [
                h('h3', { text: 'Nothing to play yet' }),
                h('p', { text: story.scenes.length ? 'Pick a start scene in the studio first.' : 'Add a scene in the studio first.' })
            ]));
            openLayer(errorLayer);
        } else {
            // Warm up the first scene (and what comes right after it) while the
            // start screen is showing.
            const first = engine.scene(opts.startSceneId) || engine.scene(story.startSceneId);
            if (first) {
                assign(pool[0], first);
                engine.start(first.id);
                activeVideo = null;
                preloadUpcomingFrom(first.id);
            }
            if (opts.autoplay || isPreview) {
                startFresh();
            } else {
                renderStart();
            }
        }

        function preloadUpcomingFrom() {
            const ids = engine.upcomingScenes().slice(0, poolSize - 1);
            ids.forEach((id, index) => {
                const video = pool[index + 1];
                const scene = engine.scene(id);
                if (video && scene) assign(video, scene);
            });
        }

        return {
            engine,
            analysis,
            restart,
            togglePlay,
            choose: index => { if (choice && choice.choices[index]) pick(choice.choices[index], false); },
            destroy() {
                destroyed = true;
                if (rafId) window.cancelAnimationFrame(rafId);
                clearSceneTimeout();
                keyTarget.removeEventListener('keydown', onKey);
                document.removeEventListener('fullscreenchange', onFullscreenChange);
                document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
                document.removeEventListener('visibilitychange', onVisibility);
                pool.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
                music.pause();
                root.innerHTML = '';
            }
        };
    }

    function mountFromPage() {
        const root = document.getElementById('mya-player');
        const data = document.getElementById('mya-story');
        if (!root || !data) return null;
        let story = null;
        try {
            story = JSON.parse(data.textContent || '{}');
        } catch (err) {
            root.textContent = 'This movie\'s story data is damaged.';
            return null;
        }
        return mount(root, story, {
            mode: root.dataset.mode || 'published',
            startSceneId: root.dataset.startScene || null,
            storageKey: root.dataset.storageKey || null,
            analytics: root.dataset.analytics === '1',
            autoplay: root.dataset.autoplay === '1'
        });
    }

    window.MyaPlayer = { mount, mountFromPage, version: Story.STORY_VERSION };

    if (document.currentScript && document.currentScript.hasAttribute('data-auto-mount')) {
        const boot = () => { window.MyaPlayer.instance = mountFromPage(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }
})();
