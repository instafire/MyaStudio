// Left panel: the movie's scenes and its uploaded media (videos and music).
import {
    store, scenes, mapScenes, uploadFiles, openCutter, wholeVideoScene, deleteVideo, select,
    scenesFromVideo, reachable, modeOf, issuesFor
} from '../store.js';
import { fmtDuration, sceneName, videoName } from '../util.js';

const { ref, computed } = Vue;

export const Library = {
    name: 'Library',
    setup() {
        const query = ref('');
        const fileInput = ref(null);
        const over = ref(false);

        const filtered = computed(() => {
            const q = query.value.trim().toLowerCase();
            return scenes.value.filter(clip => !q || sceneName(clip).toLowerCase().includes(q));
        });
        const onMap = clip => mapScenes.value.includes(clip);
        const isStart = clip => store.project && store.project.start_clip_id === clip.unique_id;
        const status = clip => {
            if (isStart(clip)) return { cls: 'badge-start', text: 'Start' };
            const mode = modeOf(clip);
            if (mode === 'ending') return { cls: 'badge-ending', text: 'Ending' };
            return null;
        };
        const warn = clip => issuesFor(clip.unique_id).some(issue => issue.level !== 'info');

        const pick = () => fileInput.value && fileInput.value.click();
        const onFiles = event => {
            const files = event.target.files;
            if (files && files.length) uploadFiles(files);
            event.target.value = '';
        };
        const onDrop = event => {
            over.value = false;
            if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
                event.preventDefault();
                event.stopPropagation();
                uploadFiles(event.dataTransfer.files);
            }
        };
        const onDragStart = (event, clip) => {
            event.dataTransfer.setData('text/mya-scene', clip.unique_id);
            event.dataTransfer.effectAllowed = 'move';
        };
        const newScene = () => {
            if (!store.videos.length) {
                store.leftTab = 'media';
                pick();
                return;
            }
            openCutter(store.videos[store.videos.length - 1].id);
        };
        const focusScene = clip => {
            select(clip.unique_id);
            store.mapFocus += 1;
        };
        return {
            store, query, fileInput, over, filtered, onMap, status, warn, pick, onFiles, onDrop, onDragStart,
            newScene, focusScene, openCutter, wholeVideoScene, deleteVideo, scenesFromVideo, fmtDuration,
            sceneName, videoName, reachable
        };
    },
    template: `
    <aside class="library" aria-label="Library">
        <div class="tabs" role="tablist">
            <button class="tab" role="tab" :class="{ 'is-active': store.leftTab === 'scenes' }" :aria-selected="store.leftTab === 'scenes'" @click="store.leftTab = 'scenes'">
                <icon name="film" />Scenes <span class="count">{{ filtered.length }}</span>
            </button>
            <button class="tab" role="tab" :class="{ 'is-active': store.leftTab === 'media' }" :aria-selected="store.leftTab === 'media'" @click="store.leftTab = 'media'">
                <icon name="folder" />Media <span class="count">{{ store.videos.length }}</span>
            </button>
        </div>
        <input ref="fileInput" type="file" accept="video/*,audio/*,.mkv,.mov,.m4v,.flac" multiple hidden @change="onFiles">

        <div v-if="store.leftTab === 'scenes'" class="library-body">
            <div class="row">
                <input class="input input-sm grow" v-model="query" placeholder="Search scenes" aria-label="Search scenes">
                <button class="btn btn-sm btn-accent" type="button" @click="newScene" title="Cut a new scene from a video"><icon name="scissors" />New</button>
            </div>
            <p v-if="!store.videos.length && !filtered.length" class="hint" style="padding: 8px 4px">Scenes are pieces of your videos. Upload a video in <button class="link-btn" type="button" @click="store.leftTab = 'media'">Media</button>, then cut it into scenes.</p>
            <p v-else-if="!filtered.length && !query" class="hint" style="padding: 8px 4px">No scenes yet. Click <b>New</b> to cut your first one.</p>
            <div v-for="clip in filtered" :key="clip.unique_id" class="scene-row" :class="{ 'is-selected': store.selection.sceneId === clip.unique_id }"
                draggable="true" @dragstart="onDragStart($event, clip)" @click="focusScene(clip)" :title="onMap(clip) ? sceneName(clip) : 'Drag onto the story map to use it'">
                <div class="thumb"><img v-if="clip.thumbnail" :src="clip.thumbnail" alt="" loading="lazy"></div>
                <div style="min-width:0">
                    <b>{{ sceneName(clip) }}</b>
                    <small>
                        <span class="mono">{{ fmtDuration(clip.duration) }}</span>
                        <span v-if="!onMap(clip)" class="off-map">· Not on map</span>
                        <span v-else-if="!reachable.has(clip.unique_id) && store.project.start_clip_id" class="dim">· Not connected</span>
                        <span v-if="warn(clip)" style="color: var(--gold)">· Needs attention</span>
                    </small>
                </div>
                <span v-if="status(clip)" class="badge" :class="status(clip).cls">{{ status(clip).text }}</span>
            </div>
        </div>

        <div v-else class="library-body">
            <div class="dropzone" :class="{ 'is-over': over }" role="button" tabindex="0" @click="pick" @keydown.enter="pick"
                @dragover.prevent="over = true" @dragleave="over = false" @drop="onDrop">
                <span class="dz-icon"><icon name="upload" /></span>
                <b>Add videos or music</b>
                <span>Drop files here or click to browse. MP4, MOV, WebM, MKV, MP3, WAV · up to 800 MB each</span>
            </div>
            <div v-for="item in store.uploads" :key="item.id" class="upload-item" :class="{ 'is-error': item.error }">
                <div class="row"><b class="truncate grow">{{ item.name }}</b><span class="mono dim">{{ item.error ? 'Failed' : item.phase === 'processing' ? 'Processing…' : Math.round(item.progress * 100) + '%' }}</span></div>
                <div class="bar"><span :style="{ width: (item.error ? 100 : item.phase === 'processing' ? 100 : item.progress * 100) + '%' }"></span></div>
                <div v-if="item.error" class="hint" style="color:#ffb3b3">{{ item.error }}</div>
            </div>

            <div v-for="video in store.videos.slice().reverse()" :key="video.id" class="media-card">
                <div class="media-thumb" @click="openCutter(video.id)" :title="'Cut scenes from ' + videoName(video)">
                    <img v-if="video.thumbnail" :src="video.thumbnail" alt="" loading="lazy">
                    <span class="duration">{{ fmtDuration(video.duration) }}</span>
                    <div class="cut-overlay"><span class="btn btn-primary btn-sm"><icon name="scissors" />Cut scenes</span></div>
                </div>
                <div class="media-info">
                    <div class="grow" style="min-width:0">
                        <b class="truncate">{{ videoName(video) }}</b>
                        <small>{{ scenesFromVideo(video.id).length }} scene{{ scenesFromVideo(video.id).length === 1 ? '' : 's' }} cut</small>
                    </div>
                    <button class="btn btn-sm" type="button" @click="openCutter(video.id)"><icon name="scissors" />Cut</button>
                    <menu-button label="Video actions">
                        <button type="button" @click="openCutter(video.id)"><icon name="scissors" />Cut scenes</button>
                        <button type="button" @click="wholeVideoScene(video)"><icon name="film" />Use the whole video as a scene</button>
                        <hr>
                        <button type="button" class="danger" @click="deleteVideo(video)"><icon name="trash" />Delete video</button>
                    </menu-button>
                </div>
            </div>

            <div v-if="store.audio.length" class="stack" style="margin-top: 6px">
                <div class="section-title" style="margin: 6px 2px 0">Music <span class="count">{{ store.audio.length }}</span></div>
                <div v-for="track in store.audio" :key="track.path" class="music-row">
                    <icon name="music" /><span class="truncate grow">{{ track.label || track.name }}</span>
                </div>
                <p class="hint" style="padding: 0 2px">Add music to a scene from its settings on the right.</p>
            </div>
        </div>
    </aside>`
};
