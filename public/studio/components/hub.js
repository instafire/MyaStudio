// Project hub: every movie, plus the fastest ways to start a new one.
import {
    store, loadProjects, createProject, createSample, renameProject, duplicateProject,
    deleteProject, exportProject, importProject, promptDialog, go
} from '../store.js';
import { timeAgo, initials } from '../util.js';

const { ref, computed, onMounted } = Vue;

export const ProjectHub = {
    name: 'ProjectHub',
    setup() {
        const query = ref('');
        const importInput = ref(null);
        onMounted(() => {
            document.title = 'MyaStudio · Interactive movie studio';
            loadProjects();
        });
        const sorted = computed(() => {
            const q = query.value.trim().toLowerCase();
            return store.projects
                .filter(project => !q || [project.title, project.genre, project.synopsis].some(value => String(value || '').toLowerCase().includes(q)))
                .slice()
                .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || b.id - a.id);
        });
        const newMovie = async () => {
            const title = await promptDialog({ title: 'New interactive movie', label: 'What is it called?', value: '', placeholder: 'e.g. The Last Train Home', confirmLabel: 'Create movie' });
            if (title === null) return;
            createProject(title);
        };
        const onImport = event => {
            const file = event.target.files && event.target.files[0];
            event.target.value = '';
            if (file) importProject(file);
        };
        const sceneCount = project => (project.scene_count !== undefined ? project.scene_count : project.clip_count) || 0;
        const open = project => go(`#/movie/${project.id}`);
        return {
            store, query, sorted, importInput, newMovie, onImport, open, sceneCount, timeAgo, initials,
            createSample, renameProject, duplicateProject, deleteProject, exportProject
        };
    },
    template: `
    <div class="hub">
        <div class="hub-inner">
            <nav class="hub-nav">
                <a class="brand" href="#/"><span class="brand-mark"><icon name="logo" /></span>MyaStudio</a>
                <div class="row">
                    <button class="btn btn-ghost btn-sm" type="button" @click="importInput.click()"><icon name="upload" />Import project file</button>
                    <input ref="importInput" type="file" accept=".json,application/json" hidden @change="onImport">
                </div>
            </nav>

            <section class="hub-hero">
                <div>
                    <h1>Make movies your audience gets to steer.</h1>
                    <p>Upload your footage, cut it into scenes, and connect them with choices. Viewers pick what happens next, just like the interactive specials on Netflix. Everything runs on your computer.</p>
                    <div class="hub-actions">
                        <button class="btn btn-primary btn-lg" type="button" @click="newMovie"><icon name="plus" />New movie</button>
                        <button class="btn btn-lg" type="button" @click="createSample"><icon name="sparkles" />Try the sample story</button>
                    </div>
                </div>
                <div class="steps">
                    <div class="step"><span class="step-num">01</span><div><b>Add footage</b><span>Drop in videos from your phone or camera.</span></div></div>
                    <div class="step"><span class="step-num">02</span><div><b>Cut scenes and connect them</b><span>Trim scenes, then drag a choice from one scene to the next.</span></div></div>
                    <div class="step"><span class="step-num">03</span><div><b>Preview and publish</b><span>Watch every path, then share a link or download the movie.</span></div></div>
                </div>
            </section>

            <div class="hub-toolbar">
                <h2>Your movies</h2>
                <span class="dim mono">{{ store.projects.length }}</span>
                <span class="grow"></span>
                <input class="input input-sm" style="max-width: 260px" v-model="query" placeholder="Search movies" aria-label="Search movies">
            </div>

            <div class="project-grid">
                <button class="project-card new-card" type="button" @click="newMovie">
                    <div><div class="plus"><icon name="plus" /></div><b>New movie</b><div class="dim" style="font-size: 12.5px; margin-top: 4px">Start from your own footage</div></div>
                </button>
                <article v-for="project in sorted" :key="project.id" class="project-card" @click="open(project)" tabindex="0" @keydown.enter="open(project)">
                    <div class="project-poster">
                        <img v-if="project.poster" :src="project.poster" alt="" loading="lazy">
                        <div v-else class="poster-fallback">{{ initials(project.title) }}</div>
                        <div class="poster-play"><span><icon name="play" /></span></div>
                    </div>
                    <div class="project-body">
                        <div class="grow">
                            <h3 class="truncate">{{ project.title }}</h3>
                            <div class="project-meta">{{ sceneCount(project) }} scene{{ sceneCount(project) === 1 ? '' : 's' }} · {{ project.edge_count || 0 }} choice{{ project.edge_count === 1 ? '' : 's' }}<template v-if="project.updated_at || project.created_at"> · {{ timeAgo(project.updated_at || project.created_at) }}</template></div>
                        </div>
                        <menu-button label="Movie actions">
                            <button type="button" @click="open(project)"><icon name="film" />Open</button>
                            <button type="button" @click="renameProject(project)"><icon name="rename" />Rename</button>
                            <button type="button" @click="duplicateProject(project)"><icon name="duplicate" />Duplicate</button>
                            <button type="button" @click="exportProject(project)"><icon name="download" />Export project file</button>
                            <hr>
                            <button type="button" class="danger" @click="deleteProject(project)"><icon name="trash" />Delete</button>
                        </menu-button>
                    </div>
                </article>
            </div>
            <p v-if="store.projectsLoaded && !sorted.length && query" class="empty-note">No movies match "{{ query }}".</p>
        </div>
    </div>`
};
