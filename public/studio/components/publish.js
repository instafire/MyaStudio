// Publish: tidy up the movie's details, see what still needs fixing, and turn
// the project into a shareable, self-contained player.
import { store, analysis, clipById, publish, updateProject, deleteExport, resetStats, select, toast, sceneLabel } from '../store.js';
import { copyText, timeAgo } from '../util.js';

const { ref, reactive, computed } = Vue;
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#f8fafc'];

export const PublishModal = {
    name: 'PublishModal',
    setup() {
        const form = reactive({
            title: store.project.title || '',
            genre: store.project.genre || '',
            synopsis: store.project.synopsis || '',
            color: store.project.theme_color || '#3b82f6'
        });
        const busy = ref(false);
        const error = ref('');
        const result = computed(() => (store.lastPublish && store.published.some(item => item.exportName === store.lastPublish.exportName) ? store.lastPublish : null));
        const startScene = computed(() => clipById.value.get(store.project.start_clip_id));
        const problems = computed(() => analysis.value.issues.filter(issue => issue.level !== 'info'));
        const blocking = computed(() => !store.project.start_clip_id);
        const link = item => window.location.origin + (item.url || `/exports/${item.exportName}/index.html`);
        const shareUrl = computed(() => (result.value ? link(result.value) : ''));
        const embed = computed(() => (shareUrl.value
            ? `<iframe src="${shareUrl.value}" width="960" height="540" style="border:0;max-width:100%" allow="autoplay; fullscreen" allowfullscreen title="${form.title.replace(/"/g, '&quot;')}"></iframe>`
            : ''));
        const totalChoices = computed(() => store.analytics.reduce((sum, row) => sum + (Number(row.count) || 0), 0));

        async function doPublish() {
            if (busy.value) return;
            error.value = '';
            if (!form.title.trim()) {
                error.value = 'Give your movie a title first.';
                return;
            }
            busy.value = true;
            try {
                await updateProject({ title: form.title.trim(), genre: form.genre, synopsis: form.synopsis, color: form.color });
                const published = await publish({ title: form.title.trim() });
                toast(published.missingMedia && published.missingMedia.length
                    ? `Published, but ${published.missingMedia.length} media file(s) were missing.`
                    : 'Your movie is published', published.missingMedia && published.missingMedia.length ? 'error' : 'success');
            } catch (err) {
                error.value = err.message || 'Publishing failed';
            } finally {
                busy.value = false;
            }
        }
        async function copy(text, label) {
            const ok = await copyText(text);
            toast(ok ? `${label} copied` : 'Could not copy. Select the text and copy it yourself.', ok ? 'success' : 'error');
        }
        function fix(issue) {
            store.publishOpen = false;
            if (issue.sceneId) {
                select(issue.sceneId);
                store.mapFocus += 1;
            }
        }
        const close = () => { store.publishOpen = false; };
        return {
            store, form, busy, error, result, startScene, problems, blocking, shareUrl, embed, totalChoices, COLORS,
            doPublish, copy, fix, close, link, timeAgo, deleteExport, resetStats, sceneLabel
        };
    },
    template: `
    <modal title="Publish your movie" size="lg" @close="close">
        <div class="publish-grid">
            <div class="stack" style="gap: 14px">
                <div class="publish-poster">
                    <img v-if="startScene && startScene.thumbnail" :src="startScene.thumbnail" alt="">
                    <div class="poster-title">{{ form.title || 'Untitled movie' }}</div>
                </div>
                <div class="field"><label>Title</label><input class="input" v-model="form.title" maxlength="120"></div>
                <div class="field"><label>Genre</label><input class="input" v-model="form.genre" maxlength="48" placeholder="e.g. Thriller, Comedy, Lesson"></div>
                <div class="field">
                    <label>Synopsis</label>
                    <textarea class="textarea" v-model="form.synopsis" maxlength="280" placeholder="Shown on the start screen before viewers press play"></textarea>
                    <span class="hint">{{ form.synopsis.length }}/280</span>
                </div>
                <div class="field">
                    <label>Accent colour</label>
                    <div class="swatches">
                        <button v-for="color in COLORS" :key="color" type="button" class="swatch" :class="{ 'is-active': form.color.toLowerCase() === color }" :style="{ background: color }" :aria-label="'Use ' + color" @click="form.color = color"></button>
                        <label class="swatch swatch-custom" title="Pick any colour"><input type="color" v-model="form.color" aria-label="Custom colour"></label>
                    </div>
                </div>
            </div>

            <div class="stack" style="gap: 14px; align-content: start">
                <div v-if="blocking" class="callout callout-error"><icon name="error" /><span>Choose a start scene before publishing: select a scene on the map and click "Make start".</span></div>
                <div v-else-if="problems.length" class="callout callout-warn">
                    <icon name="warning" />
                    <div class="stack" style="gap: 6px">
                        <b>{{ problems.length }} thing{{ problems.length === 1 ? '' : 's' }} to check first</b>
                        <div v-for="(issue, index) in problems.slice(0, 4)" :key="index" style="font-size: 12.5px">
                            {{ issue.message }} <button v-if="issue.sceneId" class="link-btn" type="button" @click="fix(issue)">Show me</button>
                        </div>
                        <span v-if="problems.length > 4" class="hint">…and {{ problems.length - 4 }} more in the story check.</span>
                        <span class="hint">You can still publish; viewers just won't see unfinished choices.</span>
                    </div>
                </div>
                <div v-else class="callout callout-good"><icon name="check" /><span>The story check passed. Every path leads somewhere.</span></div>

                <div v-if="error" class="callout callout-error"><icon name="error" /><span>{{ error }}</span></div>

                <button class="btn btn-primary btn-lg btn-block" type="button" :disabled="busy || blocking" @click="doPublish">
                    <span v-if="busy" class="spinner"></span><icon v-else name="rocket" />
                    {{ busy ? 'Packaging your movie…' : (result ? 'Publish again with my changes' : 'Publish movie') }}
                </button>

                <div v-if="result" class="result-card">
                    <h3>Your movie is live</h3>
                    <div class="copy-field">
                        <input class="input" :value="shareUrl" readonly aria-label="Link to your movie" @focus="$event.target.select()">
                        <button class="btn" type="button" @click="copy(shareUrl, 'Link')"><icon name="copy" />Copy</button>
                    </div>
                    <div class="row" style="flex-wrap: wrap">
                        <a class="btn btn-sm" :href="shareUrl" target="_blank" rel="noopener"><icon name="external" />Open</a>
                        <a class="btn btn-sm" :href="result.zipUrl" download><icon name="download" />Download .zip</a>
                        <a v-if="store.feedUrl" class="btn btn-sm btn-ghost" :href="store.feedUrl" target="_blank" rel="noopener">View in feed</a>
                    </div>
                    <details class="collapsible">
                        <summary style="font-size: 11px">Embed on a website</summary>
                        <div class="collapsible-body">
                            <textarea class="code-box" readonly :value="embed" @focus="$event.target.select()"></textarea>
                            <button class="btn btn-sm" type="button" @click="copy(embed, 'Embed code')"><icon name="code" />Copy embed code</button>
                        </div>
                    </details>
                    <p class="hint">The .zip is a complete folder. Upload it to any web host (Netlify, GitHub Pages, your own site) or open index.html from a USB stick.</p>
                </div>

                <div v-if="store.published.length" class="stack" style="gap: 8px">
                    <h3 class="section-title" style="margin: 4px 0 0">Published copies</h3>
                    <div v-for="item in store.published" :key="item.exportName" class="export-row">
                        <div class="grow" style="min-width:0">
                            <b class="truncate" style="display:block">{{ item.title }}</b>
                            <span class="dim" style="font-size: 11.5px">Updated {{ timeAgo(item.updatedAt) }} · {{ item.viewCount || 0 }} view{{ item.viewCount === 1 ? '' : 's' }}</span>
                        </div>
                        <a class="icon-btn icon-btn-sm" :href="link(item)" target="_blank" rel="noopener" title="Open" aria-label="Open"><icon name="external" /></a>
                        <a class="icon-btn icon-btn-sm" :href="'/api/exports/' + item.exportName + '/zip'" download title="Download .zip" aria-label="Download zip"><icon name="download" /></a>
                        <button class="icon-btn icon-btn-sm danger" type="button" title="Unpublish" aria-label="Unpublish" @click="deleteExport(item.exportName)"><icon name="trash" /></button>
                    </div>
                </div>

                <div v-if="store.analytics.length" class="stack" style="gap: 8px">
                    <div class="row"><h3 class="section-title grow" style="margin: 4px 0 0">What viewers chose</h3><button class="btn btn-sm btn-ghost" type="button" @click="resetStats">Reset</button></div>
                    <div v-for="(row, index) in store.analytics.slice(0, 8)" :key="index" class="stat-bar">
                        <div class="row"><span class="truncate">{{ row.choice_label || 'Choice' }}<span v-if="row.target_clip_id" class="dim"> → {{ sceneLabel(row.target_clip_id) }}</span></span><span class="mono dim">{{ row.count }}</span></div>
                        <div class="track"><span :style="{ width: (totalChoices ? (row.count / totalChoices) * 100 : 0) + '%' }"></span></div>
                    </div>
                </div>
            </div>
        </div>
    </modal>`
};
