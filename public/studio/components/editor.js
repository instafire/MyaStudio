// The editing workspace: top bar, library (left), story map (center),
// inspector (right), plus the cutter, preview, publish and help overlays.
import {
    store, analysis, openProject, updateProject, openPreview, uploadFiles, go, flushAll,
    selectedScene, deleteScene, select
} from '../store.js';
import { Library } from './library.js';
import { StoryMap } from './storymap.js';
import { Inspector } from './inspector.js';
import { Cutter } from './cutter.js';
import { PreviewModal } from './preview.js';
import { PublishModal } from './publish.js';
import { HelpModal } from './help.js';

const { ref, computed, watch, onMounted, onBeforeUnmount } = Vue;

export const Editor = {
    name: 'Editor',
    components: { Library, StoryMap, Inspector, Cutter, PreviewModal, PublishModal, HelpModal },
    setup() {
        const title = ref('');
        const dragDepth = ref(0);
        watch(() => store.project && store.project.title, value => {
            title.value = value || '';
            document.title = value ? `${value} · MyaStudio` : 'MyaStudio';
        }, { immediate: true });

        const commitTitle = () => {
            const next = title.value.trim();
            if (!store.project) return;
            if (!next) { title.value = store.project.title; return; }
            if (next !== store.project.title) updateProject({ title: next });
        };

        const health = computed(() => {
            const result = analysis.value;
            if (!result.stats.scenes) return { cls: '', label: 'No scenes yet', icon: 'info' };
            if (result.errors) return { cls: 'has-errors', label: `${result.errors} to fix`, icon: 'error' };
            if (result.warnings) return { cls: 'has-warnings', label: `${result.warnings} to check`, icon: 'warning' };
            return { cls: 'is-good', label: 'Story ready', icon: 'check' };
        });

        const saveLabel = computed(() => {
            if (store.saving > 0) return 'Saving…';
            if (store.saveError) return 'Not saved';
            return 'Saved';
        });

        const showOverview = () => {
            select(null);
            store.mobilePanel = 'right';
        };

        // Drop video files anywhere in the editor to upload them.
        const hasFiles = event => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
        const onDragEnter = event => { if (hasFiles(event)) { event.preventDefault(); dragDepth.value += 1; } };
        const onDragOver = event => { if (hasFiles(event)) event.preventDefault(); };
        const onDragLeave = event => { if (hasFiles(event)) dragDepth.value = Math.max(0, dragDepth.value - 1); };
        const onDrop = event => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth.value = 0;
            store.leftTab = 'media';
            uploadFiles(event.dataTransfer.files);
        };

        const onKey = event => {
            const target = event.target;
            const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
            if (store.cutter || store.preview || store.publishOpen || store.dialog) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                openPreview(selectedScene.value ? selectedScene.value.unique_id : null);
                return;
            }
            if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
                event.preventDefault();
                flushAll();
                return;
            }
            if (typing) return;
            if (event.key === '?') { store.helpOpen = true; return; }
            if (event.key === 'f' || event.key === 'F') { store.fitRequest += 1; return; }
            if (event.key === 'Escape') { select(null); return; }
            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedScene.value) {
                event.preventDefault();
                deleteScene(selectedScene.value);
            }
        };

        const beforeUnload = event => {
            if (store.saving > 0) {
                event.preventDefault();
                event.returnValue = '';
            }
        };

        onMounted(() => {
            openProject(store.route.projectId);
            window.addEventListener('keydown', onKey);
            window.addEventListener('beforeunload', beforeUnload);
        });
        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('beforeunload', beforeUnload);
        });

        const back = async () => {
            await flushAll();
            go('#/');
        };

        return {
            store, title, commitTitle, health, saveLabel, showOverview, openPreview, back, selectedScene,
            dragDepth, onDragEnter, onDragOver, onDragLeave, onDrop
        };
    },
    template: `
    <div class="boot" v-if="store.loading && !store.project"><div class="spinner spinner-lg"></div></div>
    <div class="boot" v-else-if="store.loadError">
        <div style="text-align:center; display:grid; gap:14px; justify-items:center">
            <p class="muted">{{ store.loadError }}</p>
            <button class="btn" type="button" @click="back">Back to your movies</button>
        </div>
    </div>
    <div v-else-if="store.project" class="editor" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
        <header class="topbar">
            <button class="icon-btn" type="button" title="All movies" aria-label="All movies" @click="back"><icon name="arrowLeft" /></button>
            <span class="brand-mark hide-sm" aria-hidden="true"><icon name="logo" /></span>
            <input class="title-input" v-model="title" aria-label="Movie title" @blur="commitTitle" @keydown.enter.prevent="$event.target.blur()" maxlength="120">
            <span class="save-state" :class="{ 'is-saving': store.saving > 0, 'is-error': store.saveError && !store.saving }" :title="store.saveError || 'Changes save automatically'">
                <span class="dot"></span><span class="hide-sm">{{ saveLabel }}</span>
            </span>
            <span class="grow"></span>
            <button class="icon-btn only-sm" type="button" title="Library" aria-label="Library" @click="store.mobilePanel = store.mobilePanel === 'left' ? null : 'left'"><icon name="panelLeft" /></button>
            <button class="btn btn-sm health-btn" :class="health.cls" type="button" @click="showOverview" title="Story check">
                <icon :name="health.icon" /><span class="hide-md">{{ health.label }}</span>
            </button>
            <button class="icon-btn hide-sm" type="button" title="Help and shortcuts (?)" aria-label="Help" @click="store.helpOpen = true"><icon name="help" /></button>
            <span class="topbar-divider hide-sm"></span>
            <button class="btn" type="button" @click="openPreview(null)" title="Preview from the start (Ctrl+Enter)" aria-label="Preview"><icon name="play" /><span class="hide-sm">Preview</span></button>
            <button class="btn btn-primary" type="button" @click="store.publishOpen = true" aria-label="Publish"><icon name="rocket" /><span class="hide-sm">Publish</span></button>
        </header>
        <div class="workspace" :class="{ 'show-left': store.mobilePanel === 'left', 'show-right': store.mobilePanel === 'right' || (store.mobilePanel !== 'left' && selectedScene) }">
            <library />
            <story-map />
            <inspector />
        </div>
        <cutter v-if="store.cutter" />
        <preview-modal v-if="store.preview" />
        <publish-modal v-if="store.publishOpen" />
        <help-modal v-if="store.helpOpen" />
        <div v-if="dragDepth > 0" class="global-drop">Drop videos or music to add them</div>
    </div>`
};
