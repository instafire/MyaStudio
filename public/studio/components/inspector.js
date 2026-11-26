// Right panel. With nothing selected it shows the movie overview (getting
// started checklist + story check); with a scene selected it edits that scene.
import {
    store, scenes, mapScenes, analysis, selectedScene, modeOf, endPointOf, momentsOf, select, updateScene,
    saveChoices, setMode, setStart, addChoice, removeChoice, removePoint, addMoment, openPreview, openCutter,
    duplicateScene, deleteScene, removeFromMap, captureThumbnail, uploadSubtitles, removeSubtitles,
    sourceVideoOf, issuesFor, sceneLabel, flagNames, updateProject, uploadFiles, clipById, reachable, ensureOnMap
} from '../store.js';
import { fmt, fmtPrecise, fmtDuration, sceneName, videoName, round, clamp } from '../util.js';

const { ref, computed, watch, nextTick } = Vue;

const TIMER_PRESETS = [0, 5, 10, 15];

// ---- One choice moment (prompt, choices, timing) ----------------------------
const ChoicePointEditor = {
    name: 'ChoicePointEditor',
    props: {
        clip: { type: Object, required: true },
        point: { type: Object, required: true },
        isEnd: { type: Boolean, default: false },
        currentTime: { type: Number, default: 0 }
    },
    setup(props) {
        const duration = computed(() => Number(props.clip.duration) || 0);
        const save = () => saveChoices(props.clip.unique_id);
        const targets = computed(() => scenes.value.filter(item => item.unique_id !== props.clip.unique_id));
        const leadTime = computed({
            get: () => Math.max(0, round(duration.value - props.point.time, 0.1)),
            set: value => {
                props.point.time = clamp(round(duration.value - (Number(value) || 0), 0.1), 0, duration.value);
                save();
            }
        });
        const customTimer = ref(!TIMER_PRESETS.includes(Number(props.point.timeLimit) || 0));
        const setTimer = value => {
            customTimer.value = false;
            props.point.timeLimit = value;
            if (value > 0 && !props.point.choices.some(choice => choice.isDefault) && props.point.choices.length) {
                props.point.choices[0].isDefault = true;
            }
            save();
        };
        const setDefault = choice => {
            props.point.choices.forEach(item => { item.isDefault = item === choice ? !item.isDefault : false; });
            save();
        };
        const setTarget = (choice, value) => {
            if (value === '__end') {
                choice.action = 'end';
                choice.to = null;
                choice.returnHere = false;
            } else if (value === '__dismiss') {
                choice.action = 'dismiss';
                choice.to = null;
                choice.returnHere = false;
                if (!choice.label) choice.label = 'Keep watching';
            } else {
                choice.action = 'scene';
                choice.to = value || null;
                if (value && !choice.label) choice.label = sceneLabel(value);
                if (value) ensureOnMap(value, props.clip);
            }
            save();
        };
        const targetValue = choice => (choice.action === 'end' ? '__end' : choice.action === 'dismiss' ? '__dismiss' : (choice.to || ''));
        const useCurrentTime = () => {
            props.point.time = clamp(round(props.currentTime, 0.1), 0, duration.value || props.currentTime);
            save();
        };
        const isFocused = choice => store.selection.choiceKey === choice.key;
        const defaultLabel = computed(() => {
            const choice = props.point.choices.find(item => item.isDefault);
            return choice ? (choice.label || 'the default choice') : 'the first choice';
        });
        const percent = computed(() => (duration.value ? clamp((props.point.time / duration.value) * 100, 0, 100) : 100));
        return {
            store, duration, save, targets, leadTime, customTimer, setTimer, setDefault, setTarget, targetValue, useCurrentTime,
            isFocused, defaultLabel, percent, TIMER_PRESETS, flagNames, fmtPrecise, fmt, sceneName, addChoice, removeChoice, removePoint
        };
    },
    template: `
    <div class="stack" style="gap: 12px">
        <div class="field">
            <label>Question <span class="dim" style="text-transform:none; letter-spacing:0; font-weight:500">(optional)</span></label>
            <input class="input" v-model="point.prompt" placeholder="e.g. What should she do?" maxlength="160" @input="save">
        </div>

        <div v-for="(choice, index) in point.choices" :key="choice.key" class="choice-card" :class="{ 'is-focused': isFocused(choice), 'is-incomplete': choice.action === 'scene' && !choice.to }" :data-choice="choice.key">
            <div class="choice-top">
                <span class="choice-num">{{ index + 1 }}</span>
                <input class="input choice-label-input grow" v-model="choice.label" :placeholder="choice.action === 'dismiss' ? 'Keep watching' : 'Button text, e.g. Open the door'" maxlength="80" @input="save" @focus="store.selection.choiceKey = choice.key">
                <button class="icon-btn icon-btn-sm danger" type="button" title="Remove choice" aria-label="Remove choice" @click="removeChoice(clip, point, choice)"><icon name="trash" /></button>
            </div>
            <div class="choice-target">
                <span>Goes to</span>
                <select class="select select-sm" :value="targetValue(choice)" @change="setTarget(choice, $event.target.value)" :aria-label="'Where choice ' + (index + 1) + ' goes'">
                    <option value="">Pick a scene…</option>
                    <option v-for="target in targets" :key="target.unique_id" :value="target.unique_id">{{ sceneName(target) }}</option>
                    <option value="__end">End the movie here</option>
                    <option v-if="!isEnd" value="__dismiss">Keep watching this scene</option>
                </select>
            </div>
            <div class="choice-options">
                <label v-if="choice.action === 'scene'" class="check" title="After that scene (and anything it continues into) finishes, the movie comes back here"><input type="checkbox" v-model="choice.returnHere" @change="save">Come back here afterwards</label>
                <label v-if="point.timeLimit > 0" class="check"><input type="radio" :name="'default-' + point.id" :checked="choice.isDefault" @click="setDefault(choice)">Pick if time runs out</label>
            </div>
            <details class="collapsible" :open="!!(choice.setFlag || choice.requireFlag)">
                <summary style="font-size: 11px">Remember &amp; unlock</summary>
                <div class="collapsible-body">
                    <div class="choice-advanced">
                        <div class="field">
                            <label>Remember as</label>
                            <input class="input input-sm" v-model="choice.setFlag" list="mya-flags" placeholder="e.g. has_key" maxlength="40" @input="save">
                        </div>
                        <div class="field">
                            <label>Only show if</label>
                            <input class="input input-sm" v-model="choice.requireFlag" list="mya-flags" placeholder="has_key or !has_key" maxlength="41" @input="save">
                        </div>
                    </div>
                    <p class="hint">Choices can remember things ("has_key") and later choices can appear only if the viewer did, or didn't (!has_key), pick them.</p>
                </div>
            </details>
        </div>

        <button class="btn btn-sm" type="button" @click="addChoice(clip, { point })" :disabled="point.choices.length >= 8"><icon name="plus" />Add choice</button>

        <div class="timing-card">
            <div class="timing-line" v-if="isEnd">
                <icon name="clock" />
                <span>Choices appear</span>
                <input class="input input-sm input-time" type="number" min="0" :max="duration" step="0.5" v-model.number="leadTime" style="width: 64px" aria-label="Seconds before the end">
                <span>sec before the end</span>
            </div>
            <div class="timing-line" v-else>
                <icon name="clock" />
                <span>Show choices at</span>
                <time-field :model-value="point.time" :max="duration" small @update:model-value="value => { point.time = value; save(); }" aria-label="Time the choices appear" />
            </div>
            <div class="timing-bar" :title="'Choices appear at ' + fmtPrecise(point.time)">
                <div class="fill" :style="{ left: percent + '%' }"></div>
                <div class="label"><span>0:00</span><span>{{ fmtPrecise(point.time) }}</span><span>{{ fmt(duration) }}</span></div>
                <input type="range" min="0" :max="duration || 1" step="0.1" :value="point.time" @input="point.time = Number($event.target.value); save()" aria-label="When the choices appear">
            </div>
            <div class="row" style="justify-content: space-between">
                <button class="link-btn" type="button" style="font-size: 12px" @click="useCurrentTime">Set to the preview's playhead ({{ fmtPrecise(currentTime) }})</button>
            </div>
            <div class="field">
                <label>Countdown</label>
                <div class="chips">
                    <button v-for="value in TIMER_PRESETS" :key="value" type="button" class="chip" :class="{ 'is-active': !customTimer && (point.timeLimit || 0) === value }" @click="setTimer(value)">{{ value ? value + 's' : 'No timer' }}</button>
                    <button type="button" class="chip" :class="{ 'is-active': customTimer }" @click="customTimer = true">Custom</button>
                    <input v-if="customTimer" class="input input-sm" type="number" min="1" max="600" style="width: 74px" v-model.number="point.timeLimit" @input="save" aria-label="Custom countdown in seconds">
                </div>
                <p class="hint" v-if="point.timeLimit > 0">Viewers get {{ point.timeLimit }} seconds. If they don't choose, the movie picks {{ defaultLabel }}.</p>
                <p class="hint" v-else>The movie waits on the last frame until the viewer chooses.</p>
            </div>
            <label class="check"><input type="checkbox" v-model="point.pause" @change="save">Pause the video while viewers choose</label>
            <label class="check"><input type="checkbox" v-model="point.shuffle" @change="save">Shuffle the order of the choices</label>
            <button v-if="!isEnd" class="btn btn-sm btn-danger" type="button" @click="removePoint(clip, point)"><icon name="trash" />Remove this moment</button>
        </div>
    </div>`
};

// ---- Scene inspector --------------------------------------------------------
const SceneInspector = {
    name: 'SceneInspector',
    components: { ChoicePointEditor },
    props: { clip: { type: Object, required: true } },
    setup(props) {
        const videoEl = ref(null);
        const currentTime = ref(0);
        const name = ref('');
        const subtitleInput = ref(null);
        const musicInput = ref(null);
        watch(() => props.clip, clip => { name.value = sceneName(clip); currentTime.value = 0; }, { immediate: true });
        watch(() => props.clip && props.clip.name, () => { if (document.activeElement && document.activeElement.classList.contains('name-input')) return; name.value = sceneName(props.clip); });

        const mode = computed(() => modeOf(props.clip));
        const endPoint = computed(() => endPointOf(props.clip));
        const moments = computed(() => momentsOf(props.clip));
        const source = computed(() => sourceVideoOf(props.clip));
        const isStart = computed(() => store.project && store.project.start_clip_id === props.clip.unique_id);
        const issues = computed(() => issuesFor(props.clip.unique_id));
        const targets = computed(() => scenes.value.filter(item => item.unique_id !== props.clip.unique_id));
        const onMap = computed(() => mapScenes.value.includes(props.clip));
        const isReachable = computed(() => reachable.value.has(props.clip.unique_id));
        const canRetrim = computed(() => !!props.clip.source_video_id && !/^FULL:/i.test(props.clip.name || ''));

        const commitName = () => {
            const value = name.value.trim();
            if (!value) { name.value = sceneName(props.clip); return; }
            if (value !== props.clip.name) updateScene(props.clip, { name: value });
        };
        const onTime = () => { if (videoEl.value) currentTime.value = videoEl.value.currentTime || 0; };
        const setNext = value => {
            updateScene(props.clip, { nextClipId: value || null });
            if (value) ensureOnMap(value, props.clip);
        };
        const endingTitle = computed({
            get: () => props.clip.ending_title || '',
            set: value => updateScene(props.clip, { endingTitle: value })
        });
        const notes = computed({
            get: () => props.clip.notes || '',
            set: value => updateScene(props.clip, { notes: value })
        });
        const music = computed({
            get: () => props.clip.bg_music || '',
            set: value => updateScene(props.clip, { bgMusic: value || null }, { immediate: true })
        });
        const muted = computed({
            get: () => !!Number(props.clip.mute_audio),
            set: value => updateScene(props.clip, { muteAudio: value }, { immediate: true })
        });
        const onSubtitle = event => {
            const file = event.target.files && event.target.files[0];
            event.target.value = '';
            if (file) uploadSubtitles(props.clip, file);
        };
        const onMusic = event => {
            const files = event.target.files;
            event.target.value = '';
            if (files && files.length) uploadFiles(files);
        };
        const newMoment = () => {
            addMoment(props.clip);
            saveChoices(props.clip.unique_id);
        };
        const grabFrame = () => captureThumbnail(props.clip, currentTime.value);
        const retrim = () => openCutter(props.clip.source_video_id, props.clip.unique_id);
        const fixMode = value => setMode(props.clip, value);

        // Scroll the inspector to a choice picked on the map.
        watch(() => store.selection.choiceKey, key => {
            if (!key) return;
            nextTick(() => {
                const node = document.querySelector(`[data-choice="${key}"]`);
                if (node) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        });

        return {
            store, videoEl, currentTime, name, subtitleInput, musicInput, mode, endPoint, moments, source, isStart, issues, targets,
            onMap, isReachable, canRetrim, commitName, onTime, setNext, endingTitle, notes, music, muted, onSubtitle, onMusic, newMoment,
            grabFrame, retrim, fixMode, setStart, openPreview, duplicateScene, deleteScene, removeFromMap, removeSubtitles, select,
            fmt, fmtPrecise, fmtDuration, sceneName, videoName, sceneLabel
        };
    },
    template: `
    <div>
        <div class="panel-section">
            <div class="row" style="margin-bottom: 10px">
                <button class="btn btn-sm btn-ghost" type="button" @click="select(null)" style="margin-left:-8px"><icon name="arrowLeft" />Overview</button>
                <span class="grow"></span>
                <span v-if="isStart" class="badge badge-start"><icon name="flag" />Start scene</span>
            </div>
            <div class="scene-preview">
                <video ref="videoEl" :key="clip.filepath" :src="clip.filepath" :poster="clip.thumbnail || undefined" controls preload="metadata" playsinline @timeupdate="onTime" @seeked="onTime"></video>
            </div>
            <input class="name-input" v-model="name" aria-label="Scene name" maxlength="120" @blur="commitName" @keydown.enter.prevent="$event.target.blur()">
            <div class="scene-meta">
                <span class="mono">{{ fmtDuration(clip.duration) }}</span>
                <span v-if="source">from {{ videoName(source) }} <span class="mono">({{ fmtPrecise(clip.start_time || 0) }}–{{ fmtPrecise(clip.end_time || clip.duration) }})</span></span>
                <button v-if="canRetrim" class="link-btn" type="button" @click="retrim"><icon name="scissors" /> Adjust cut</button>
            </div>
            <div class="scene-actions">
                <button class="btn btn-sm" type="button" @click="openPreview(clip.unique_id)"><icon name="play" />Play from here</button>
                <button v-if="!isStart" class="btn btn-sm" type="button" @click="setStart(clip)"><icon name="flag" />Make start</button>
                <button class="btn btn-sm" type="button" @click="grabFrame" title="Use the frame showing in the preview as this scene's thumbnail"><icon name="camera" />Use frame</button>
                <menu-button label="Scene actions" btn-class="btn btn-sm" icon="more">
                    <button v-if="canRetrim" type="button" @click="retrim"><icon name="scissors" />Adjust the cut</button>
                    <button type="button" @click="duplicateScene(clip)"><icon name="duplicate" />Duplicate scene</button>
                    <button v-if="onMap" type="button" @click="removeFromMap(clip)"><icon name="eyeOff" />Remove from map</button>
                    <hr>
                    <button type="button" class="danger" @click="deleteScene(clip)"><icon name="trash" />Delete scene</button>
                </menu-button>
            </div>
            <div v-if="!onMap" class="callout callout-info" style="margin-top: 12px"><icon name="info" /><span>This scene isn't on the story map. Drag it from the scene list onto the map to use it.</span></div>
            <div v-else-if="!isReachable && store.project.start_clip_id && !isStart" class="callout" style="margin-top: 12px"><icon name="info" /><span>Nothing leads here yet. Connect a choice from another scene to this one.</span></div>
        </div>

        <div class="panel-section">
            <h3 class="section-title">When this scene ends</h3>
            <div class="segmented" role="radiogroup" aria-label="When this scene ends">
                <button type="button" role="radio" :aria-checked="mode === 'choices'" :class="{ 'is-active': mode === 'choices' }" @click="fixMode('choices')"><icon name="branch" />Choices</button>
                <button type="button" role="radio" :aria-checked="mode === 'continue'" :class="{ 'is-active': mode === 'continue' }" @click="fixMode('continue')"><icon name="arrowRight" />Continue</button>
                <button type="button" role="radio" :aria-checked="mode === 'ending'" :class="{ 'is-active': mode === 'ending' }" @click="fixMode('ending')"><icon name="star" />Ending</button>
            </div>

            <div v-if="mode === 'none'" class="callout callout-warn" style="margin-top: 12px"><icon name="warning" /><span>Nothing is set yet, so the movie stops after this scene. Give viewers choices, continue to another scene, or make it an ending.</span></div>

            <div v-if="mode === 'choices' && endPoint" style="margin-top: 14px">
                <choice-point-editor :clip="clip" :point="endPoint" :is-end="true" :current-time="currentTime" />
            </div>

            <div v-if="mode === 'continue'" class="stack" style="margin-top: 14px">
                <div class="field">
                    <label>Continue to</label>
                    <select class="select" :value="clip.next_clip_id || ''" @change="setNext($event.target.value)">
                        <option value="">Pick a scene…</option>
                        <option v-for="target in targets" :key="target.unique_id" :value="target.unique_id">{{ sceneName(target) }}</option>
                    </select>
                </div>
                <p class="hint">The next scene plays straight away, with no choice. Use this to split long stretches into scenes or to join paths back together.</p>
            </div>

            <div v-if="mode === 'ending'" class="stack" style="margin-top: 14px">
                <div class="field">
                    <label>Name this ending</label>
                    <input class="input" v-model.lazy="endingTitle" placeholder="e.g. The Happy Ending" maxlength="80">
                </div>
                <p class="hint">Viewers see this on the end screen, along with how many of the movie's endings they've found.</p>
            </div>
        </div>

        <div class="panel-section">
            <details class="collapsible" :open="moments.length > 0">
                <summary>Moments during the scene <span class="count mono dim" v-if="moments.length">{{ moments.length }}</span></summary>
                <div class="collapsible-body">
                    <p class="hint">Offer choices partway through, like a quick detour that comes back here, or a decision with a timer.</p>
                    <div v-for="(point, index) in moments" :key="point.id" class="moment-card">
                        <div class="moment-head"><b style="font-size: 13px">Moment {{ index + 1 }}</b><span class="mono dim">at {{ fmtPrecise(point.time) }}</span></div>
                        <choice-point-editor :clip="clip" :point="point" :current-time="currentTime" />
                    </div>
                    <button class="btn btn-sm" type="button" @click="newMoment"><icon name="plus" />Add a moment</button>
                </div>
            </details>
        </div>

        <div class="panel-section">
            <details class="collapsible" :open="!!(clip.bg_music || clip.subtitle_path || Number(clip.mute_audio))">
                <summary>Sound &amp; captions</summary>
                <div class="collapsible-body">
                    <div class="field">
                        <label>Background music</label>
                        <div class="row">
                            <select class="select select-sm grow" v-model="music">
                                <option value="">None</option>
                                <option v-for="track in store.audio" :key="track.path" :value="track.path">{{ track.label || track.name }}</option>
                            </select>
                            <button class="btn btn-sm" type="button" @click="musicInput.click()"><icon name="upload" />Add</button>
                            <input ref="musicInput" type="file" accept="audio/*" hidden @change="onMusic">
                        </div>
                    </div>
                    <label class="check"><input type="checkbox" v-model="muted">Mute this scene's own sound</label>
                    <div class="field">
                        <label>Captions</label>
                        <div class="row" v-if="clip.subtitle_path">
                            <span class="muted grow" style="font-size: 12.5px"><icon name="captions" /> Captions added</span>
                            <button class="btn btn-sm" type="button" @click="subtitleInput.click()">Replace</button>
                            <button class="btn btn-sm btn-ghost" type="button" @click="removeSubtitles(clip)">Remove</button>
                        </div>
                        <button v-else class="btn btn-sm" type="button" @click="subtitleInput.click()"><icon name="captions" />Upload .srt or .vtt</button>
                        <input ref="subtitleInput" type="file" accept=".srt,.vtt,text/vtt" hidden @change="onSubtitle">
                    </div>
                </div>
            </details>
        </div>

        <div class="panel-section">
            <details class="collapsible" :open="!!clip.notes">
                <summary>Notes</summary>
                <div class="collapsible-body">
                    <textarea class="textarea" v-model.lazy="notes" placeholder="Anything you want to remember about this scene. Viewers never see this." maxlength="1000"></textarea>
                </div>
            </details>
        </div>

        <div class="panel-section" v-if="issues.length">
            <h3 class="section-title">Story check</h3>
            <div v-for="(issue, index) in issues" :key="index" class="issue" :class="'level-' + issue.level">
                <icon :name="issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info'" />
                <span>{{ issue.message }}</span>
                <span></span>
            </div>
        </div>
    </div>`
};

// ---- Movie overview ---------------------------------------------------------
const MovieOverview = {
    name: 'MovieOverview',
    setup() {
        const steps = computed(() => {
            const result = analysis.value;
            const hasVideo = store.videos.length > 0 || scenes.value.length > 0;
            const hasScene = scenes.value.length > 0;
            const hasStart = !!(store.project && store.project.start_clip_id);
            const hasChoice = Object.values(store.points).some(list => list.some(point => point.choices.some(choice => choice.to || choice.action === 'end')));
            const noDeadEnds = hasChoice && !result.issues.some(issue => issue.code === 'dead-end' || issue.code === 'no-target');
            const list = [
                { key: 'video', text: 'Upload a video', done: hasVideo, action: () => { store.leftTab = 'media'; if (uploadInput.value) uploadInput.value.click(); } },
                { key: 'scene', text: 'Cut it into scenes', done: hasScene, action: () => { if (store.videos.length) openCutter(store.videos[0].id); } },
                { key: 'start', text: 'Choose where the movie starts', done: hasStart, action: () => {} },
                { key: 'choice', text: 'Add a choice between scenes', done: hasChoice, action: () => {} },
                { key: 'endings', text: 'Make sure every path ends well', done: noDeadEnds, action: () => {} },
                { key: 'preview', text: 'Preview your movie', done: store.previewed, action: () => openPreview(null) },
                { key: 'publish', text: 'Publish and share it', done: store.published.length > 0, action: () => { store.publishOpen = true; } }
            ];
            const next = list.find(step => !step.done);
            if (next) next.next = true;
            return list;
        });
        const doneCount = computed(() => steps.value.filter(step => step.done).length);
        const uploadInput = ref(null);
        const onUpload = event => {
            const files = event.target.files;
            if (files && files.length) uploadFiles(files);
            event.target.value = '';
        };
        const hints = {
            start: 'Select a scene on the map and click "Make start".',
            choice: 'Select a scene, choose "Choices" under "When this scene ends", or drag from a scene\'s + dot to another scene.',
            endings: 'Every scene should end with choices, continue to another scene, or be marked as an ending.'
        };
        const issues = computed(() => analysis.value.issues);
        const fix = issue => {
            if (issue.sceneId) {
                select(issue.sceneId, issue.choiceId && store.points[issue.sceneId] ? findChoiceKey(issue) : null);
                store.mapFocus += 1;
            } else if (issue.code === 'no-scenes') {
                store.leftTab = store.videos.length ? 'scenes' : 'media';
            }
        };
        function findChoiceKey(issue) {
            const points = store.points[issue.sceneId] || [];
            for (const point of points) {
                const choice = point.choices.find(item => item.key === issue.choiceId);
                if (choice) return choice.key;
            }
            return null;
        }
        const genre = ref(store.project.genre || '');
        const synopsis = ref(store.project.synopsis || '');
        const saveDetails = () => updateProject({ genre: genre.value, synopsis: synopsis.value });
        const stats = computed(() => analysis.value.stats);
        const startScene = computed(() => clipById.value.get(store.project.start_clip_id));
        const selectStart = () => {
            if (!startScene.value) return;
            select(startScene.value.unique_id);
            store.mapFocus += 1;
        };
        return { store, steps, doneCount, hints, issues, fix, genre, synopsis, saveDetails, stats, startScene, selectStart, sceneName, openPreview, uploadInput, onUpload };
    },
    template: `
    <div>
        <div class="inspector-head">
            <h2>Movie overview</h2>
            <p class="hint" style="margin: 4px 0 0">Select a scene on the map to edit it.</p>
        </div>
        <div class="panel-section">
            <div class="stat-grid">
                <div class="stat"><b>{{ stats.scenes }}</b><span>scenes</span></div>
                <div class="stat"><b>{{ stats.choices }}</b><span>choices</span></div>
                <div class="stat"><b>{{ stats.endings }}</b><span>endings</span></div>
            </div>
            <p class="hint" style="margin: 10px 0 0" v-if="startScene">Starts with <button class="link-btn" type="button" @click="selectStart">{{ sceneName(startScene) }}</button></p>
        </div>
        <div class="panel-section" v-if="doneCount < steps.length">
            <input ref="uploadInput" type="file" accept="video/*,audio/*,.mkv,.mov,.m4v" multiple hidden @change="onUpload">
            <h3 class="section-title">Getting started <span class="count">{{ doneCount }}/{{ steps.length }}</span></h3>
            <div class="progress-track" style="margin-bottom: 10px"><span :style="{ width: (doneCount / steps.length * 100) + '%' }"></span></div>
            <div class="checklist">
                <div v-for="step in steps" :key="step.key" class="check-item" :class="{ 'is-done': step.done, 'is-next': step.next }">
                    <span class="tick"><icon v-if="step.done" name="check" /></span>
                    <div class="text">
                        <div>{{ step.text }}</div>
                        <div v-if="step.next && hints[step.key]" class="hint" style="text-decoration: none">{{ hints[step.key] }}</div>
                    </div>
                    <button v-if="step.next && ['video', 'scene', 'preview', 'publish'].includes(step.key)" class="btn btn-sm" type="button" @click="step.action()">{{ step.key === 'video' ? 'Upload' : step.key === 'scene' ? 'Cut' : step.key === 'preview' ? 'Preview' : 'Publish' }}</button>
                </div>
            </div>
        </div>
        <div class="panel-section">
            <h3 class="section-title">Story check <span class="count">{{ issues.length ? issues.length : '' }}</span></h3>
            <div v-if="!issues.length" class="callout callout-good"><icon name="check" /><span>Every path works. Preview it once more, then publish.</span></div>
            <div v-for="(issue, index) in issues" :key="index" class="issue" :class="'level-' + issue.level">
                <icon :name="issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info'" />
                <span>{{ issue.message }}</span>
                <button v-if="issue.sceneId" class="btn btn-sm btn-ghost" type="button" @click="fix(issue)">Show</button>
                <span v-else></span>
            </div>
        </div>
        <div class="panel-section">
            <details class="collapsible">
                <summary>Movie details</summary>
                <div class="collapsible-body">
                    <div class="field"><label>Genre</label><input class="input" v-model="genre" maxlength="48" placeholder="e.g. Mystery" @change="saveDetails"></div>
                    <div class="field"><label>Synopsis</label><textarea class="textarea" v-model="synopsis" maxlength="280" placeholder="One or two lines that make people want to watch" @change="saveDetails"></textarea><span class="hint">{{ synopsis.length }}/280 · shown on the movie's start screen</span></div>
                </div>
            </details>
        </div>
    </div>`
};

export const Inspector = {
    name: 'Inspector',
    components: { SceneInspector, MovieOverview },
    setup() {
        const closeDrawer = () => {
            store.mobilePanel = null;
            select(null);
        };
        return { store, selectedScene, flagNames, closeDrawer };
    },
    template: `
    <aside class="inspector" aria-label="Inspector">
        <div class="drawer-close"><button class="btn btn-sm btn-ghost" type="button" @click="closeDrawer"><icon name="x" />Close</button></div>
        <datalist id="mya-flags"><option v-for="flag in flagNames" :key="flag" :value="flag"></option></datalist>
        <scene-inspector v-if="selectedScene" :key="selectedScene.unique_id" :clip="selectedScene" />
        <movie-overview v-else />
    </aside>`
};
