// Scene cutter: a focused, full-screen trimming tool. Scrub the video, set a
// start and end (drag the blue handles or press I / O), name it, add it.
import {
    store, clipById, cutScene, retrimScene, wholeVideoScene, scenesFromVideo, afterSceneCreated, toast,
    select, scenes
} from '../store.js';
import { api } from '../api.js';
import { fmt, fmtPrecise, fmtDuration, sceneName, videoName, clamp, round } from '../util.js';

const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;
const FRAME = 1 / 30;

export const Cutter = {
    name: 'Cutter',
    setup() {
        const videoEl = ref(null);
        const scrollEl = ref(null);
        const timelineEl = ref(null);
        const nameInput = ref(null);
        const state = reactive({
            videoId: store.cutter.videoId,
            current: 0,
            duration: 0,
            playing: false,
            rate: 1,
            inPoint: 0,
            outPoint: 0,
            loop: false,
            stopAtOut: false,
            zoom: 1,
            width: 800,
            name: '',
            busy: false,
            bulk: null,
            strip: [],
            stripLoading: false,
            cuts: null,
            detecting: false,
            drag: null
        });
        const editing = computed(() => (store.cutter.sceneId ? clipById.value.get(store.cutter.sceneId) : null));
        const video = computed(() => store.videos.find(item => item.id === state.videoId) || null);
        const existing = computed(() => (video.value ? scenesFromVideo(video.value.id) : []).slice().sort((a, b) => (a.start_time || 0) - (b.start_time || 0)));
        const length = computed(() => Math.max(0, state.outPoint - state.inPoint));
        const pxPerSec = computed(() => (state.duration > 0 ? (state.width * state.zoom) / state.duration : 0));
        const timelineWidth = computed(() => Math.max(state.width, state.width * state.zoom));
        const x = t => `${(Number(t) || 0) * pxPerSec.value}px`;
        const ticks = computed(() => {
            if (!state.duration || !pxPerSec.value) return [];
            const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
            const step = steps.find(value => value * pxPerSec.value >= 80) || 900;
            const list = [];
            for (let t = 0; t <= state.duration + 0.001; t += step) list.push(round(t, 0.01));
            return list;
        });

        function defaultName() {
            return `Scene ${scenes.value.length + 1}`;
        }

        function resetRange() {
            if (editing.value) {
                state.inPoint = Number(editing.value.start_time) || 0;
                state.outPoint = Number(editing.value.end_time) || (state.inPoint + (Number(editing.value.duration) || 0));
                state.name = sceneName(editing.value);
                return;
            }
            // Start the next cut where the last scene from this video ended.
            const last = existing.value[existing.value.length - 1];
            const start = last && Number(last.end_time) < state.duration - 0.5 ? Number(last.end_time) : 0;
            state.inPoint = clamp(start, 0, state.duration);
            state.outPoint = clamp(start + Math.min(10, Math.max(1, (state.duration - start) / 2)), state.inPoint + 0.2, state.duration || start + 10);
            state.name = defaultName();
        }

        function measure() {
            if (scrollEl.value) state.width = Math.max(300, scrollEl.value.clientWidth - 2);
        }

        function onMeta() {
            const el = videoEl.value;
            state.duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (Number(video.value && video.value.duration) || 0);
            resetRange();
            if (editing.value) el.currentTime = state.inPoint;
            buildStrip();
        }

        function onTime() {
            const el = videoEl.value;
            if (!el) return;
            state.current = el.currentTime || 0;
            if (state.playing && (state.loop || state.stopAtOut) && state.current >= state.outPoint - 0.03) {
                if (state.loop) {
                    el.currentTime = state.inPoint;
                } else {
                    el.pause();
                    state.stopAtOut = false;
                }
            }
        }

        let rafId = 0;
        function loop() {
            rafId = 0;
            onTime();
            if (state.playing) rafId = requestAnimationFrame(loop);
        }
        function onPlay() { state.playing = true; if (!rafId) rafId = requestAnimationFrame(loop); }
        function onPause() { state.playing = false; onTime(); }

        function togglePlay() {
            const el = videoEl.value;
            if (!el) return;
            if (el.paused) {
                if (el.ended || el.currentTime >= state.duration - 0.05) el.currentTime = 0;
                el.play().catch(() => {});
            } else {
                el.pause();
            }
        }
        function seek(t) {
            const el = videoEl.value;
            if (!el || !state.duration) return;
            const value = clamp(t, 0, Math.max(0, state.duration - 0.01));
            el.currentTime = value;
            state.current = value;
        }
        function step(delta) {
            const el = videoEl.value;
            if (!el) return;
            el.pause();
            seek((el.currentTime || 0) + delta);
        }
        function playSelection() {
            seek(state.inPoint);
            state.stopAtOut = !state.loop;
            videoEl.value.play().catch(() => {});
        }
        function setIn(t = state.current) {
            const value = round(clamp(t, 0, state.duration), 0.01);
            state.inPoint = value;
            if (state.outPoint <= value + 0.2) state.outPoint = clamp(value + Math.max(1, length.value || 5), value + 0.2, state.duration);
        }
        function setOut(t = state.current) {
            const value = round(clamp(t, 0, state.duration), 0.01);
            if (value <= state.inPoint + 0.2) {
                state.outPoint = clamp(state.inPoint + 0.2, 0, state.duration);
                if (value < state.inPoint) {
                    state.inPoint = Math.max(0, value - 1);
                    state.outPoint = value;
                }
                return;
            }
            state.outPoint = value;
        }
        function setRate(rate) {
            state.rate = rate;
            if (videoEl.value) videoEl.value.playbackRate = rate;
        }

        // ---- Filmstrip -------------------------------------------------------------
        let stripToken = 0;
        async function buildStrip() {
            const token = ++stripToken;
            state.strip = [];
            if (!video.value || !state.duration) return;
            state.stripLoading = true;
            const probe = document.createElement('video');
            probe.muted = true;
            probe.preload = 'auto';
            probe.src = video.value.filepath;
            const count = clamp(Math.ceil(state.duration / 3), 8, 36);
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 90;
            const ctx = canvas.getContext('2d');
            const ready = await new Promise(resolve => {
                probe.addEventListener('loadeddata', () => resolve(true), { once: true });
                probe.addEventListener('error', () => resolve(false), { once: true });
                setTimeout(() => resolve(probe.readyState >= 2), 10000);
            });
            if (!ready || token !== stripToken) { state.stripLoading = false; return; }
            const frames = [];
            for (let i = 0; i < count; i++) {
                if (token !== stripToken) return;
                const t = ((i + 0.5) / count) * state.duration;
                await new Promise(resolve => {
                    const done = () => { probe.removeEventListener('seeked', done); resolve(); };
                    probe.addEventListener('seeked', done);
                    probe.currentTime = t;
                    setTimeout(done, 2500);
                });
                try {
                    const ratio = probe.videoWidth && probe.videoHeight ? probe.videoWidth / probe.videoHeight : 16 / 9;
                    canvas.width = Math.round(90 * ratio);
                    ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
                    frames.push(canvas.toDataURL('image/jpeg', 0.6));
                } catch (_) {
                    frames.push('');
                }
                if (i % 4 === 3 || i === count - 1) state.strip = frames.slice();
            }
            probe.removeAttribute('src');
            probe.load();
            state.stripLoading = false;
        }

        // ---- Timeline dragging -------------------------------------------------
        function timeAt(clientX) {
            const rect = timelineEl.value.getBoundingClientRect();
            return clamp((clientX - rect.left) / Math.max(1, pxPerSec.value), 0, state.duration);
        }
        function onTimelineDown(event) {
            if (!state.duration || event.button !== 0) return;
            const role = event.target.dataset.role;
            const t = timeAt(event.clientX);
            if (role === 'in' || role === 'out') {
                state.drag = { mode: role };
            } else if (role === 'range') {
                state.drag = { mode: 'move', offset: t - state.inPoint, len: length.value };
            } else if (role === 'cut') {
                seek(Number(event.target.dataset.time));
                return;
            } else if (role === 'scene') {
                seek(Number(event.target.dataset.time));
                return;
            } else {
                state.drag = { mode: 'scrub' };
                if (videoEl.value) videoEl.value.pause();
                seek(t);
            }
            timelineEl.value.setPointerCapture(event.pointerId);
            event.preventDefault();
        }
        function onTimelineMove(event) {
            if (!state.drag) return;
            const t = timeAt(event.clientX);
            const snap = snapTime(t);
            if (state.drag.mode === 'scrub') seek(t);
            else if (state.drag.mode === 'in') { state.inPoint = round(clamp(snap, 0, state.outPoint - 0.2), 0.01); seek(state.inPoint); }
            else if (state.drag.mode === 'out') { state.outPoint = round(clamp(snap, state.inPoint + 0.2, state.duration), 0.01); seek(Math.max(0, state.outPoint - 0.05)); }
            else if (state.drag.mode === 'move') {
                const start = clamp(t - state.drag.offset, 0, state.duration - state.drag.len);
                state.inPoint = round(start, 0.01);
                state.outPoint = round(start + state.drag.len, 0.01);
                seek(state.inPoint);
            }
        }
        function onTimelineUp() { state.drag = null; }
        // Handles snap to detected shot changes when they're close.
        function snapTime(t) {
            if (!state.cuts || !state.cuts.length || !pxPerSec.value) return t;
            const near = state.cuts.find(cut => Math.abs(cut - t) * pxPerSec.value < 8);
            return near !== undefined ? near : t;
        }

        // ---- Actions -----------------------------------------------------------
        async function addScene() {
            if (state.busy || !video.value) return;
            if (length.value < 0.2) {
                toast('Make the scene at least a fraction of a second long.', 'error');
                return;
            }
            state.busy = true;
            const name = state.name.trim() || defaultName();
            try {
                if (editing.value) {
                    await retrimScene(editing.value, state.inPoint, state.outPoint);
                    toast(`Updated the cut for "${sceneName(editing.value)}"`);
                    close();
                    return;
                }
                const clip = await cutScene({ videoId: video.value.id, start: state.inPoint, end: state.outPoint, name });
                afterSceneCreated(clip);
                select(clip.unique_id);
                toast(`Added "${name}". Keep cutting, or click Done.`);
                const len = length.value;
                state.inPoint = state.outPoint;
                state.outPoint = clamp(state.outPoint + len, state.inPoint + 0.2, state.duration);
                if (state.inPoint >= state.duration - 0.2) {
                    state.inPoint = Math.max(0, state.duration - Math.min(len, state.duration));
                    state.outPoint = state.duration;
                }
                state.name = defaultName();
                seek(state.inPoint);
            } catch (err) {
                toast(err.message || 'Could not cut that scene', 'error');
            } finally {
                state.busy = false;
            }
        }

        async function detectShots() {
            if (!video.value || state.detecting) return;
            state.detecting = true;
            try {
                const result = await api.post('/api/video/detect-scenes', { projectId: store.project.id, videoId: video.value.id });
                state.cuts = result.cuts || [];
                if (!state.cuts.length) toast('No clear shot changes found. You can still cut scenes by hand.', 'info');
            } catch (err) {
                toast(err.message || 'Could not analyse the video', 'error');
            } finally {
                state.detecting = false;
            }
        }

        const shotSegments = computed(() => {
            if (!state.cuts || !state.duration) return [];
            const points = [0, ...state.cuts, state.duration];
            const segments = [];
            for (let i = 0; i < points.length - 1; i++) {
                if (points[i + 1] - points[i] >= 0.5) segments.push({ start: points[i], end: points[i + 1] });
            }
            return segments;
        });

        async function makeShotScenes() {
            const segments = shotSegments.value;
            if (!segments.length || state.busy) return;
            state.busy = true;
            state.bulk = { done: 0, total: segments.length };
            const base = videoName(video.value);
            let first = null;
            try {
                for (let i = 0; i < segments.length; i++) {
                    const clip = await cutScene({ videoId: video.value.id, start: segments[i].start, end: segments[i].end, name: `${base} · Shot ${i + 1}` });
                    if (!first) { first = clip; afterSceneCreated(clip); }
                    select(clip.unique_id);
                    state.bulk.done = i + 1;
                }
                toast(`Made ${segments.length} scenes from the shots in ${base}`);
                if (first) select(first.unique_id);
                close();
                store.fitRequest += 1;
            } catch (err) {
                toast(err.message || 'Stopped making scenes', 'error');
            } finally {
                state.busy = false;
                state.bulk = null;
            }
        }

        async function useWhole() {
            if (!video.value) return;
            const clip = await wholeVideoScene(video.value, state.name.trim() || videoName(video.value));
            if (clip) {
                select(clip.unique_id);
                close();
            }
        }

        function close() {
            if (videoEl.value) videoEl.value.pause();
            store.cutter = null;
            store.fitRequest += 1;
        }

        function onKey(event) {
            const target = event.target;
            const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.type !== 'range';
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (typing) {
                if (event.key === 'Enter' && target === nameInput.value) { event.preventDefault(); addScene(); }
                return;
            }
            if (store.dialog) return;
            const key = event.key;
            if (key === ' ' || key === 'k' || key === 'K') { event.preventDefault(); togglePlay(); }
            else if (key === 'i' || key === 'I') { event.preventDefault(); setIn(); }
            else if (key === 'o' || key === 'O') { event.preventDefault(); setOut(); }
            else if (key === 'ArrowLeft') { event.preventDefault(); step(event.shiftKey ? -5 : -1); }
            else if (key === 'ArrowRight') { event.preventDefault(); step(event.shiftKey ? 5 : 1); }
            else if (key === ',') { event.preventDefault(); step(-FRAME); }
            else if (key === '.') { event.preventDefault(); step(FRAME); }
            else if (key === 'l' || key === 'L') { state.loop = !state.loop; }
            else if (key === 'Home') { event.preventDefault(); seek(state.inPoint); }
            else if (key === 'End') { event.preventDefault(); seek(Math.max(0, state.outPoint - 0.05)); }
            else if (key === 'Enter') { event.preventDefault(); addScene(); }
        }

        watch(() => state.videoId, () => {
            state.cuts = null;
            state.strip = [];
            state.current = 0;
            store.cutter = { videoId: state.videoId, sceneId: null };
        });

        let resizeObserver = null;
        onMounted(() => {
            window.addEventListener('keydown', onKey);
            measure();
            if (window.ResizeObserver && scrollEl.value) {
                resizeObserver = new ResizeObserver(measure);
                resizeObserver.observe(scrollEl.value);
            }
        });
        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onKey);
            if (resizeObserver) resizeObserver.disconnect();
            stripToken += 1;
            if (rafId) cancelAnimationFrame(rafId);
        });

        return {
            store, state, editing, video, existing, length, pxPerSec, timelineWidth, ticks, x, videoEl, scrollEl, timelineEl, nameInput, shotSegments,
            onMeta, onTime, onPlay, onPause, togglePlay, seek, step, playSelection, setIn, setOut, setRate,
            onTimelineDown, onTimelineMove, onTimelineUp, addScene, detectShots, makeShotScenes, useWhole, close,
            fmt, fmtPrecise, fmtDuration, sceneName, videoName
        };
    },
    template: `
    <div class="cutter" role="dialog" aria-modal="true" aria-label="Scene cutter">
        <header class="cutter-top">
            <button class="icon-btn" type="button" aria-label="Close cutter" title="Close (Esc)" @click="close"><icon name="x" /></button>
            <h2>{{ editing ? 'Adjust the cut: ' + sceneName(editing) : 'Cut scenes' }}</h2>
            <select v-if="!editing && store.videos.length > 1" class="select select-sm" style="max-width: 280px" v-model.number="state.videoId" aria-label="Video to cut">
                <option v-for="item in store.videos" :key="item.id" :value="item.id">{{ videoName(item) }}</option>
            </select>
            <span v-else-if="video" class="muted truncate" style="max-width: 320px">{{ videoName(video) }}</span>
            <span class="grow"></span>
            <span class="hint hide-sm" v-if="!editing">Scenes you add appear on the story map.</span>
            <button class="btn btn-primary" type="button" @click="close"><icon name="check" />Done</button>
        </header>
        <div class="cutter-main">
            <div class="cutter-stage">
                <div class="cutter-video" @click="togglePlay">
                    <video v-if="video" ref="videoEl" :src="video.filepath" preload="auto" playsinline
                        @loadedmetadata="onMeta" @timeupdate="onTime" @play="onPlay" @pause="onPause" @seeked="onTime"></video>
                </div>
                <div class="cutter-transport">
                    <button class="icon-btn" type="button" title="Go to start of selection (Home)" aria-label="Go to start of selection" @click="seek(state.inPoint)"><icon name="toStart" /></button>
                    <button class="icon-btn" type="button" title="Back one frame (,)" aria-label="Back one frame" @click="step(-1/30)"><icon name="stepBack" /></button>
                    <button class="play-btn" type="button" :aria-label="state.playing ? 'Pause' : 'Play'" title="Play / pause (Space)" @click="togglePlay"><icon :name="state.playing ? 'pause' : 'play'" /></button>
                    <button class="icon-btn" type="button" title="Forward one frame (.)" aria-label="Forward one frame" @click="step(1/30)"><icon name="stepForward" /></button>
                    <button class="icon-btn" type="button" title="Go to end of selection (End)" aria-label="Go to end of selection" @click="seek(Math.max(0, state.outPoint - 0.05))"><icon name="toEnd" /></button>
                    <span class="timecode">{{ fmtPrecise(state.current) }} <span>/ {{ fmtPrecise(state.duration) }}</span></span>
                    <span class="topbar-divider"></span>
                    <button class="btn btn-sm" type="button" @click="setIn()" title="Start the scene at the playhead (I)"><icon name="bracketLeft" />Start here</button>
                    <button class="btn btn-sm" type="button" @click="setOut()" title="End the scene at the playhead (O)"><icon name="bracketRight" />End here</button>
                    <button class="btn btn-sm" type="button" @click="playSelection" title="Play just the selected part"><icon name="play" />Play selection</button>
                    <button class="icon-btn" :class="{ 'is-active': state.loop }" type="button" title="Loop the selection (L)" aria-label="Loop the selection" :aria-pressed="state.loop ? 'true' : 'false'" @click="state.loop = !state.loop"><icon name="loop" /></button>
                    <span class="grow"></span>
                    <select class="select select-sm" :value="state.rate" @change="setRate(Number($event.target.value))" aria-label="Playback speed" title="Playback speed">
                        <option v-for="rate in [0.25, 0.5, 1, 1.5, 2]" :key="rate" :value="rate">{{ rate }}×</option>
                    </select>
                    <label class="row" style="gap:6px; font-size:12px; color: var(--text-3)" title="Zoom the timeline">
                        <icon name="zoomIn" />
                        <input class="range" type="range" min="1" max="24" step="0.5" v-model.number="state.zoom" style="width: 80px" aria-label="Timeline zoom">
                    </label>
                </div>
                <div class="timeline-wrap">
                    <div class="timeline-scroll" ref="scrollEl">
                        <div class="timeline" ref="timelineEl" :style="{ width: timelineWidth + 'px' }"
                            @pointerdown="onTimelineDown" @pointermove="onTimelineMove" @pointerup="onTimelineUp" @pointercancel="onTimelineUp">
                            <div class="tl-ruler">
                                <span v-for="t in ticks" :key="t" class="tl-tick" :style="{ left: x(t) }">{{ fmt(t) }}</span>
                            </div>
                            <div class="tl-scenes">
                                <span v-for="clip in existing" :key="clip.unique_id" class="tl-scene" :class="{ 'is-editing': editing && editing.unique_id === clip.unique_id }"
                                    data-role="scene" :data-time="clip.start_time || 0"
                                    :style="{ left: x(clip.start_time || 0), width: 'calc(' + x((clip.end_time || 0) - (clip.start_time || 0)) + ' - 2px)' }"
                                    :title="sceneName(clip)">{{ sceneName(clip) }}</span>
                            </div>
                            <div class="tl-strip">
                                <img v-for="(src, index) in state.strip" :key="index" :src="src" alt="" draggable="false">
                                <span v-if="!state.strip.length" class="tl-loading">{{ state.stripLoading ? 'Loading preview frames…' : '' }}</span>
                            </div>
                            <span v-for="cut in (state.cuts || [])" :key="'cut' + cut" class="tl-cut" data-role="cut" :data-time="cut" :style="{ left: x(cut) }" :title="'Shot change at ' + fmtPrecise(cut)"></span>
                            <span class="tl-dim" :style="{ left: 0, width: x(state.inPoint) }"></span>
                            <span class="tl-dim" :style="{ left: x(state.outPoint), right: 0 }"></span>
                            <div class="tl-range" data-role="range" :style="{ left: x(state.inPoint), width: x(length) }">
                                <span class="tl-range-handle left" data-role="in" title="Drag to set the start"></span>
                                <span class="tl-range-handle right" data-role="out" title="Drag to set the end"></span>
                                <span class="tl-range-label">{{ fmtDuration(length) }}</span>
                            </div>
                            <span class="tl-playhead" :style="{ left: x(state.current) }"></span>
                        </div>
                    </div>
                </div>
            </div>

            <aside class="cutter-side">
                <div class="panel-section">
                    <h3 class="section-title">{{ editing ? 'New cut' : 'New scene' }}</h3>
                    <div class="stack">
                        <div class="inout">
                            <div class="field">
                                <label>Starts at</label>
                                <div class="inout-control">
                                    <time-field :model-value="state.inPoint" :max="state.duration" small aria-label="Scene start" @update:model-value="value => setIn(value)" />
                                    <button class="btn btn-sm" type="button" title="Use the playhead (I)" @click="setIn()">Set</button>
                                </div>
                            </div>
                            <div class="field">
                                <label>Ends at</label>
                                <div class="inout-control">
                                    <time-field :model-value="state.outPoint" :max="state.duration" small aria-label="Scene end" @update:model-value="value => setOut(value)" />
                                    <button class="btn btn-sm" type="button" title="Use the playhead (O)" @click="setOut()">Set</button>
                                </div>
                            </div>
                        </div>
                        <p class="hint">Length: <b class="mono" style="color: var(--text)">{{ fmtDuration(length) }}</b>. Drag the blue handles on the timeline, or play the video and press <span class="kbd">I</span> and <span class="kbd">O</span>.</p>
                        <div class="field" v-if="!editing">
                            <label>Scene name</label>
                            <input ref="nameInput" class="input" v-model="state.name" maxlength="120" placeholder="e.g. The phone rings">
                        </div>
                        <button class="btn btn-primary btn-block btn-lg" type="button" :disabled="state.busy || length < 0.2" @click="addScene">
                            <span v-if="state.busy" class="spinner"></span>
                            <icon v-else :name="editing ? 'check' : 'plus'" />
                            {{ state.busy ? (state.bulk ? 'Making scene ' + (state.bulk.done + 1) + ' of ' + state.bulk.total + '…' : 'Cutting…') : (editing ? 'Save the new cut' : 'Add scene') }}
                        </button>
                        <p class="hint" v-if="!editing">Tip: after you add a scene, the next one starts where it ended, so you can cut a whole video in a row.</p>
                        <p class="hint" v-else>Choices and links to this scene are kept.</p>
                    </div>
                </div>

                <div class="panel-section" v-if="!editing">
                    <h3 class="section-title">Faster ways</h3>
                    <div class="stack">
                        <button class="btn btn-block" type="button" :disabled="state.detecting || state.busy" @click="detectShots">
                            <span v-if="state.detecting" class="spinner"></span><icon v-else name="wand" />
                            {{ state.detecting ? 'Looking for shot changes…' : 'Find shot changes' }}
                        </button>
                        <template v-if="state.cuts && state.cuts.length">
                            <p class="hint">Found {{ state.cuts.length }} shot change{{ state.cuts.length === 1 ? '' : 's' }} (gold marks). The handles snap to them.</p>
                            <button class="btn btn-block btn-accent" type="button" :disabled="state.busy" @click="makeShotScenes"><icon name="grid" />Make {{ shotSegments.length }} scenes, one per shot</button>
                        </template>
                        <button class="btn btn-block" type="button" :disabled="state.busy" @click="useWhole"><icon name="film" />Use the whole video as one scene</button>
                    </div>
                </div>

                <div class="panel-section" v-if="existing.length">
                    <h3 class="section-title">From this video <span class="count">{{ existing.length }}</span></h3>
                    <div class="existing-list">
                        <div v-for="clip in existing" :key="clip.unique_id" class="scene-row" @click="seek(clip.start_time || 0)">
                            <div class="thumb"><img v-if="clip.thumbnail" :src="clip.thumbnail" alt=""></div>
                            <div style="min-width:0"><b>{{ sceneName(clip) }}</b><small class="mono">{{ fmtPrecise(clip.start_time || 0) }}–{{ fmtPrecise(clip.end_time || 0) }}</small></div>
                            <span></span>
                        </div>
                    </div>
                </div>

                <div class="panel-section">
                    <h3 class="section-title">Shortcuts</h3>
                    <div class="shortcut-list">
                        <span class="kbd">Space</span><span>Play / pause</span>
                        <span class="kbd">I</span><span>Start the scene here</span>
                        <span class="kbd">O</span><span>End the scene here</span>
                        <span class="kbd">← →</span><span>Move 1 second (Shift: 5)</span>
                        <span class="kbd">, .</span><span>Move one frame</span>
                        <span class="kbd">L</span><span>Loop the selection</span>
                        <span class="kbd">Enter</span><span>Add the scene</span>
                        <span class="kbd">Esc</span><span>Close</span>
                    </div>
                </div>
            </aside>
        </div>
    </div>`
};
