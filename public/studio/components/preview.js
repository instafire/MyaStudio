// Full-screen preview: the exact player viewers get, playing the movie's
// current state straight from the studio.
import { store } from '../store.js';

const { ref, computed, onMounted, onBeforeUnmount } = Vue;

export const PreviewModal = {
    name: 'PreviewModal',
    setup() {
        const frame = ref(null);
        const src = computed(() => {
            const params = new URLSearchParams();
            if (store.preview.sceneId) params.set('scene', store.preview.sceneId);
            params.set('t', String(store.preview.nonce));
            return `/preview/${store.project.id}?${params.toString()}`;
        });
        const close = () => { store.preview = null; };
        const onMessage = event => {
            if (event.origin !== window.location.origin) return;
            const data = event.data || {};
            if (data.source !== 'mya-player') return;
            if (data.type === 'close') close();
        };
        const onKey = event => { if (event.key === 'Escape') close(); };
        const onLoad = () => {
            try {
                frame.value.focus();
                if (frame.value.contentWindow) frame.value.contentWindow.focus();
            } catch (_) { /* focus is best effort */ }
        };
        onMounted(() => {
            window.addEventListener('message', onMessage);
            window.addEventListener('keydown', onKey);
        });
        onBeforeUnmount(() => {
            window.removeEventListener('message', onMessage);
            window.removeEventListener('keydown', onKey);
        });
        return { frame, src, onLoad };
    },
    template: `
    <div class="preview-shell" role="dialog" aria-modal="true" aria-label="Preview">
        <iframe ref="frame" :src="src" title="Movie preview" allow="autoplay; fullscreen" allowfullscreen @load="onLoad"></iframe>
    </div>`
};
