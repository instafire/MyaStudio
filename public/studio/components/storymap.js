// The story map: scenes as cards, choices as wires. Drag cards to arrange,
// drag from a choice's dot to another scene to connect them.
import {
    store, mapScenes, offMapScenes, clipById, modeOf, endPointOf, select, updateScene, placeOnMap,
    connectChoice, connectNext, addChoice, openPreview, openCutter, uploadFiles, tidyLayout,
    reachable, issuesFor, sceneLabel, createSample, NODE_W, ROW_H, nextFreePosition, setMode,
    afterSceneCreated
} from '../store.js';
import { fmtDuration, fmt, sceneName } from '../util.js';

const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

const FIRST_ROW = 178;   // node border + header + rows padding (see .node-rows)
const IN_Y = 64;         // centre of the input dot (see .port-in)

export const StoryMap = {
    name: 'StoryMap',
    setup() {
        const el = ref(null);
        const view = reactive({ x: 40, y: 40, zoom: 1 });
        const drag = ref(null);       // node drag
        const pan = ref(null);        // background pan
        const link = ref(null);       // connection being drawn
        const hoverEdge = ref(null);
        const fileInput = ref(null);

        const nodes = computed(() => mapScenes.value);

        function rowsFor(clip) {
            const mode = modeOf(clip);
            const points = store.points[clip.unique_id] || [];
            const end = endPointOf(clip);
            const rows = [];
            points.forEach(point => {
                const isEnd = point === end;
                point.choices.forEach(choice => {
                    const missing = choice.action === 'scene' && !choice.to;
                    rows.push({
                        kind: 'choice',
                        key: choice.key,
                        point,
                        choice,
                        tag: isEnd ? '' : fmt(point.time),
                        label: choice.label || (choice.action === 'dismiss' ? 'Keep watching' : ''),
                        icon: choice.action === 'end' ? 'end' : (choice.action === 'dismiss' ? 'play' : (choice.returnHere ? 'corner' : (missing ? 'warning' : 'arrowRight'))),
                        port: choice.action === 'scene' ? (choice.returnHere ? 'return' : 'choice') : null,
                        connected: !!choice.to,
                        missing
                    });
                });
            });
            if (mode === 'choices') rows.push({ kind: 'add', key: 'add', label: 'Add choice', port: 'add' });
            if (mode === 'continue') {
                rows.push({
                    kind: 'next',
                    key: 'next',
                    label: clip.next_clip_id ? 'Continues to ' + sceneLabel(clip.next_clip_id) : 'Continue to… (drag the dot)',
                    port: 'next',
                    connected: !!clip.next_clip_id,
                    missing: !clip.next_clip_id
                });
            }
            return rows;
        }

        const rowsById = computed(() => {
            const map = new Map();
            nodes.value.forEach(clip => map.set(clip.unique_id, rowsFor(clip)));
            return map;
        });

        const incoming = computed(() => {
            const set = new Set();
            edges.value.forEach(edge => set.add(edge.to));
            return set;
        });

        function portPoint(clip, index) {
            return { x: (Number(clip.x) || 0) + NODE_W - 1, y: (Number(clip.y) || 0) + FIRST_ROW + index * ROW_H + ROW_H / 2 };
        }
        function inPoint(clip) {
            return { x: (Number(clip.x) || 0) + 1, y: (Number(clip.y) || 0) + IN_Y };
        }
        function curve(a, b) {
            const forward = b.x > a.x + 40;
            const dx = forward ? Math.max(50, (b.x - a.x) * 0.45) : 120 + Math.abs(b.y - a.y) * 0.15;
            return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
        }

        const edges = computed(() => {
            const list = [];
            const onMap = new Map(nodes.value.map(clip => [clip.unique_id, clip]));
            nodes.value.forEach(clip => {
                const rows = rowsById.value.get(clip.unique_id) || [];
                rows.forEach((row, index) => {
                    let targetId = null;
                    let type = 'choice';
                    if (row.kind === 'choice' && row.choice.action === 'scene' && row.choice.to) {
                        targetId = row.choice.to;
                        type = row.choice.returnHere ? 'return' : 'choice';
                    } else if (row.kind === 'next' && clip.next_clip_id) {
                        targetId = clip.next_clip_id;
                        type = 'next';
                    }
                    const target = targetId && onMap.get(targetId);
                    if (!target) return;
                    list.push({
                        id: `${clip.unique_id}:${row.key}`,
                        from: clip.unique_id,
                        to: targetId,
                        choiceKey: row.kind === 'choice' ? row.key : null,
                        type,
                        d: curve(portPoint(clip, index), inPoint(target))
                    });
                });
                if (clip.timeout_to_id && Number(clip.timeout_seconds) > 0 && onMap.get(clip.timeout_to_id)) {
                    const target = onMap.get(clip.timeout_to_id);
                    list.push({ id: `${clip.unique_id}:timeout`, from: clip.unique_id, to: target.unique_id, type: 'timeout', d: curve({ x: (Number(clip.x) || 0) + NODE_W - 1, y: (Number(clip.y) || 0) + 30 }, inPoint(target)) });
                }
            });
            return list;
        });

        const draftPath = computed(() => {
            if (!link.value || !link.value.moved) return '';
            return curve(link.value.from, link.value.cursor);
        });

        const isDim = edge => {
            const selected = store.selection.sceneId;
            if (!selected) return false;
            return edge.from !== selected && edge.to !== selected;
        };

        // ---- Coordinates -------------------------------------------------------
        function toWorld(clientX, clientY) {
            const rect = el.value.getBoundingClientRect();
            return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
        }

        function zoomAt(factor, clientX, clientY) {
            const rect = el.value.getBoundingClientRect();
            const cx = clientX === undefined ? rect.width / 2 : clientX - rect.left;
            const cy = clientY === undefined ? rect.height / 2 : clientY - rect.top;
            const next = Math.min(1.6, Math.max(0.25, view.zoom * factor));
            const wx = (cx - view.x) / view.zoom;
            const wy = (cy - view.y) / view.zoom;
            view.zoom = next;
            view.x = cx - wx * next;
            view.y = cy - wy * next;
        }

        function bounds(list) {
            const items = list || nodes.value;
            if (!items.length) return null;
            const xs = items.map(clip => Number(clip.x) || 0);
            const ys = items.map(clip => Number(clip.y) || 0);
            const bottoms = items.map(clip => (Number(clip.y) || 0) + 172 + (rowsById.value.get(clip.unique_id) || []).length * ROW_H + 48);
            return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs) + NODE_W, maxY: Math.max(...bottoms) };
        }

        function fit() {
            if (!el.value) return;
            const box = bounds();
            const rect = el.value.getBoundingClientRect();
            if (!box || !rect.width) {
                view.x = 40; view.y = 40; view.zoom = 1;
                return;
            }
            const pad = 70;
            const zoom = Math.min(1.05, Math.max(0.3, Math.min((rect.width - pad * 2) / (box.maxX - box.minX), (rect.height - pad * 2) / (box.maxY - box.minY))));
            view.zoom = zoom;
            view.x = (rect.width - (box.maxX - box.minX) * zoom) / 2 - box.minX * zoom;
            view.y = Math.max(pad * 0.6, (rect.height - (box.maxY - box.minY) * zoom) / 2) - box.minY * zoom;
        }

        function centerOn(clip) {
            if (!el.value || !clip) return;
            const rect = el.value.getBoundingClientRect();
            const box = bounds([clip]);
            const cx = (box.minX + box.maxX) / 2;
            const cy = (box.minY + box.maxY) / 2;
            const sx = cx * view.zoom + view.x;
            const sy = cy * view.zoom + view.y;
            if (sx > 80 && sx < rect.width - 80 && sy > 80 && sy < rect.height - 80) return;
            view.x = rect.width / 2 - cx * view.zoom;
            view.y = rect.height / 2 - cy * view.zoom;
        }

        watch(() => store.fitRequest, () => nextTick(() => setTimeout(fit, 30)));
        watch(() => store.mapFocus, () => nextTick(() => {
            const clip = clipById.value.get(store.selection.sceneId);
            if (clip && mapScenes.value.includes(clip)) centerOn(clip);
            else fit();
        }));

        // ---- Pointer handling ---------------------------------------------------
        function onPointerDown(event) {
            if (event.button !== 0 && event.button !== 1) return;
            const target = event.target;
            if (target.closest('.node') || target.closest('.map-toolbar') || target.closest('.map-zoom') || target.closest('.map-empty-card')) return;
            pan.value = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, moved: false };
            el.value.setPointerCapture(event.pointerId);
        }

        function startNodeDrag(event, clip) {
            if (event.button !== 0) return;
            event.stopPropagation();
            drag.value = { clip, startX: event.clientX, startY: event.clientY, x: Number(clip.x) || 0, y: Number(clip.y) || 0, moved: false };
            el.value.setPointerCapture(event.pointerId);
        }

        function startLink(event, clip, row, index) {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            link.value = {
                clip,
                row,
                from: portPoint(clip, index),
                cursor: toWorld(event.clientX, event.clientY),
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
                target: null
            };
            el.value.setPointerCapture(event.pointerId);
        }

        function nodeUnder(clientX, clientY) {
            const hit = document.elementsFromPoint(clientX, clientY).find(node => node.classList && node.classList.contains('node'));
            return hit ? hit.getAttribute('data-id') : null;
        }

        function onPointerMove(event) {
            if (drag.value) {
                const d = drag.value;
                const dx = (event.clientX - d.startX) / view.zoom;
                const dy = (event.clientY - d.startY) / view.zoom;
                if (!d.moved && Math.hypot(dx, dy) * view.zoom < 4) return;
                d.moved = true;
                d.clip.x = Math.round(d.x + dx);
                d.clip.y = Math.round(d.y + dy);
            } else if (link.value) {
                const l = link.value;
                l.cursor = toWorld(event.clientX, event.clientY);
                if (!l.moved && Math.hypot(event.clientX - l.startX, event.clientY - l.startY) > 5) l.moved = true;
                const id = nodeUnder(event.clientX, event.clientY);
                l.target = id && id !== l.clip.unique_id ? id : null;
            } else if (pan.value) {
                const p = pan.value;
                const dx = event.clientX - p.startX;
                const dy = event.clientY - p.startY;
                if (!p.moved && Math.hypot(dx, dy) < 3) return;
                p.moved = true;
                view.x = p.x + dx;
                view.y = p.y + dy;
            }
        }

        function onPointerUp(event) {
            if (drag.value) {
                const d = drag.value;
                drag.value = null;
                if (d.moved) updateScene(d.clip, { x: d.clip.x, y: d.clip.y });
                else select(d.clip.unique_id);
            } else if (link.value) {
                const l = link.value;
                link.value = null;
                const targetId = l.target || nodeUnder(event.clientX, event.clientY);
                const valid = targetId && targetId !== l.clip.unique_id;
                if (!l.moved) {
                    if (l.row.kind === 'add') addChoice(l.clip);
                    else select(l.clip.unique_id, l.row.kind === 'choice' ? l.row.key : null);
                    return;
                }
                if (!valid) return;
                if (l.row.kind === 'choice') connectChoice(l.clip, l.row.key, targetId);
                else if (l.row.kind === 'add') addChoice(l.clip, { to: targetId });
                else if (l.row.kind === 'next') connectNext(l.clip, targetId);
            } else if (pan.value) {
                const p = pan.value;
                pan.value = null;
                if (!p.moved) select(null);
            }
        }

        function onWheel(event) {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                zoomAt(Math.exp(-event.deltaY * 0.0022), event.clientX, event.clientY);
            } else {
                view.x -= event.deltaX;
                view.y -= event.deltaY;
            }
        }

        // Scenes dragged in from the library panel.
        function onDragOver(event) {
            if (Array.from(event.dataTransfer.types || []).includes('text/mya-scene')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            }
        }
        function onDrop(event) {
            const id = event.dataTransfer.getData('text/mya-scene');
            if (!id) return;
            event.preventDefault();
            event.stopPropagation();
            const clip = clipById.value.get(id);
            if (!clip) return;
            const point = toWorld(event.clientX, event.clientY);
            placeOnMap(clip, point.x - NODE_W / 2, point.y - 40);
            select(clip.unique_id);
        }

        function addAllToMap() {
            offMapScenes.value.forEach(clip => {
                const pos = nextFreePosition();
                placeOnMap(clip, pos.x, pos.y);
            });
            nextTick(() => setTimeout(fit, 50));
        }

        function newScene() {
            if (!store.videos.length) {
                if (fileInput.value) fileInput.value.click();
                return;
            }
            openCutter(store.videos[store.videos.length - 1].id);
        }

        function onFiles(event) {
            const files = event.target.files;
            if (files && files.length) uploadFiles(files);
            event.target.value = '';
        }

        const nodeClass = clip => ({
            'is-selected': store.selection.sceneId === clip.unique_id,
            'is-dragging': drag.value && drag.value.clip === clip && drag.value.moved,
            'is-drop-target': link.value && link.value.target === clip.unique_id,
            'is-unreachable': store.project.start_clip_id && !reachable.value.has(clip.unique_id),
            'has-incoming': incoming.value.has(clip.unique_id)
        });

        const isStart = clip => store.project && store.project.start_clip_id === clip.unique_id;
        const summary = clip => {
            const mode = modeOf(clip);
            const end = endPointOf(clip);
            if (mode === 'choices' && end) {
                const n = end.choices.length;
                return `${n} choice${n === 1 ? '' : 's'} at ${fmt(end.time)}${end.timeLimit ? ' · ' + end.timeLimit + 's timer' : ''}`;
            }
            if (mode === 'continue') return 'Plays straight on';
            if (mode === 'ending') return 'Ends the movie';
            return 'Nothing happens next yet';
        };
        const hasWarning = clip => issuesFor(clip.unique_id).some(issue => issue.level === 'warning' || issue.level === 'error');

        const transform = computed(() => `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`);
        const zoomLabel = computed(() => `${Math.round(view.zoom * 100)}%`);

        onMounted(() => {
            el.value.addEventListener('wheel', onWheel, { passive: false });
            nextTick(() => setTimeout(fit, 30));
        });
        onBeforeUnmount(() => {
            if (el.value) el.value.removeEventListener('wheel', onWheel);
        });

        return {
            el, store, view, nodes, rowsById, edges, draftPath, hoverEdge, transform, zoomLabel, link, pan, fileInput,
            offMapScenes, nodeClass, isStart, summary, hasWarning, isDim, modeOf,
            onPointerDown, onPointerMove, onPointerUp, startNodeDrag, startLink, onDragOver, onDrop,
            zoomAt, fit, tidyLayout, addAllToMap, newScene, onFiles, select, openPreview, createSample, setMode,
            fmtDuration, sceneName, sceneLabel, addChoice
        };
    },
    template: `
    <section class="map" ref="el" :class="{ 'is-panning': pan && pan.moved, 'is-connecting': link && link.moved }" aria-label="Story map"
        @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"
        @dragover="onDragOver" @drop="onDrop">
        <div class="map-toolbar" v-if="nodes.length">
            <button class="btn btn-sm btn-accent" type="button" @click="newScene"><icon name="scissors" />New scene</button>
            <button class="btn btn-sm btn-ghost" type="button" @click="tidyLayout" title="Arrange scenes from left to right"><icon name="layout" />Tidy up</button>
            <button v-if="offMapScenes.length" class="btn btn-sm btn-ghost" type="button" @click="addAllToMap" :title="offMapScenes.length + ' scenes are not on the map'"><icon name="plus" />Place {{ offMapScenes.length }} more</button>
        </div>
        <div class="map-hint" v-if="link && link.moved">{{ link.target ? 'Release to connect to ' + sceneLabel(link.target) : 'Drop on a scene to connect' }}</div>

        <div class="map-world" :style="{ transform }">
            <svg class="map-edges" aria-hidden="true">
                <defs>
                    <marker id="arrow-choice" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#2f8cff" /></marker>
                    <marker id="arrow-return" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f5c451" /></marker>
                    <marker id="arrow-next" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#c9d1dc" /></marker>
                    <marker id="arrow-timeout" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6d7584" /></marker>
                </defs>
                <g v-for="edge in edges" :key="edge.id">
                    <path class="edge-hit" :d="edge.d" @pointerdown.stop @click.stop="select(edge.from, edge.choiceKey)" @mouseenter="hoverEdge = edge.id" @mouseleave="hoverEdge = null"></path>
                    <path :d="edge.d" :class="['edge-' + edge.type, { 'is-dim': isDim(edge), 'is-hot': hoverEdge === edge.id || (store.selection.choiceKey && store.selection.choiceKey === edge.choiceKey) }]" :marker-end="'url(#arrow-' + edge.type + ')'" style="pointer-events:none"></path>
                </g>
                <path v-if="draftPath" class="edge-draft" :d="draftPath" marker-end="url(#arrow-choice)"></path>
            </svg>

            <div v-for="clip in nodes" :key="clip.unique_id" class="node" :class="nodeClass(clip)" :data-id="clip.unique_id"
                :style="{ left: (clip.x || 0) + 'px', top: (clip.y || 0) + 'px' }" @pointerdown.stop="select(clip.unique_id)">
                <span class="port-in" aria-hidden="true"></span>
                <div class="node-head" @pointerdown="startNodeDrag($event, clip)">
                    <div class="node-thumb">
                        <img v-if="clip.thumbnail" :src="clip.thumbnail" alt="" draggable="false">
                        <div class="badges">
                            <span v-if="isStart(clip)" class="badge badge-start"><icon name="flag" />Start</span>
                            <span v-if="modeOf(clip) === 'ending'" class="badge badge-ending"><icon name="star" />Ending</span>
                        </div>
                        <button class="node-play" type="button" title="Preview from this scene" @pointerdown.stop @click.stop="openPreview(clip.unique_id)"><icon name="play" /></button>
                        <span class="duration">{{ fmtDuration(clip.duration) }}</span>
                    </div>
                    <div class="node-title">
                        <b>{{ sceneName(clip) }}</b>
                        <small>{{ summary(clip) }}</small>
                    </div>
                </div>
                <div class="node-rows" v-if="rowsById.get(clip.unique_id).length">
                    <div v-for="(row, index) in rowsById.get(clip.unique_id)" :key="row.key" class="node-row"
                        :class="{ 'is-selected': store.selection.choiceKey === row.key, 'is-return': row.choice && row.choice.returnHere, 'is-end': row.choice && row.choice.action === 'end', 'is-missing': row.missing, 'is-add': row.kind === 'add', 'is-continue': row.kind === 'next' }"
                        @pointerdown.stop="row.kind === 'add' ? startLink($event, clip, row, index) : select(clip.unique_id, row.kind === 'choice' ? row.key : null)">
                        <icon v-if="row.kind === 'add'" name="plus" class="row-icon" />
                        <icon v-else-if="row.kind === 'next'" name="arrowRight" class="row-icon" />
                        <icon v-else :name="row.icon" class="row-icon" />
                        <span class="row-label" :class="{ 'is-empty': !row.label }">{{ row.label || 'Untitled choice' }}</span>
                        <span v-if="row.tag" class="row-tag">{{ row.tag }}</span>
                        <span v-if="row.port" class="port" :class="['port-' + row.port, { 'is-connected': row.connected, 'is-active': link && link.row === row }]"
                            :title="row.kind === 'add' ? 'Drag to a scene to add a choice' : 'Drag to a scene to connect'"
                            @pointerdown="startLink($event, clip, row, index)"></span>
                    </div>
                </div>
                <div v-if="modeOf(clip) === 'ending'" class="node-foot is-ending"><icon name="star" /><span class="truncate">{{ clip.ending_title || 'The End' }}</span></div>
                <div v-else-if="modeOf(clip) === 'none'" class="node-foot is-warning">
                    <icon name="warning" /><span style="white-space:nowrap">What's next?</span>
                    <button class="btn btn-sm btn-ghost" type="button" @pointerdown.stop @click.stop="setMode(clip, 'choices'); select(clip.unique_id)">Add choices</button>
                </div>
            </div>
        </div>

        <div class="map-empty" v-if="!nodes.length">
            <div class="map-empty-card" v-if="!store.videos.length">
                <div class="big-icon"><icon name="upload" /></div>
                <h2>Start with your footage</h2>
                <p>Upload one or more videos. You'll cut them into scenes, then connect the scenes with choices for your viewers.</p>
                <div class="row">
                    <button class="btn btn-primary" type="button" @click="fileInput.click()"><icon name="upload" />Upload videos</button>
                    <button class="btn" type="button" @click="createSample"><icon name="sparkles" />Open the sample story</button>
                </div>
                <input ref="fileInput" type="file" accept="video/*,audio/*,.mkv,.mov,.m4v" multiple hidden @change="onFiles">
            </div>
            <div class="map-empty-card" v-else-if="offMapScenes.length">
                <div class="big-icon"><icon name="grid" /></div>
                <h2>Put your scenes on the map</h2>
                <p>Drag scenes from the list on the left, or place them all at once and arrange them later.</p>
                <div class="row"><button class="btn btn-primary" type="button" @click="addAllToMap"><icon name="plus" />Place all {{ offMapScenes.length }} scenes</button></div>
            </div>
            <div class="map-empty-card" v-else>
                <div class="big-icon"><icon name="scissors" /></div>
                <h2>Cut your first scene</h2>
                <p>Pick the part of your video that opens the movie. Each scene you cut shows up here as a card.</p>
                <div class="row"><button class="btn btn-primary" type="button" @click="newScene"><icon name="scissors" />Cut a scene</button></div>
            </div>
        </div>

        <div class="map-legend" v-if="nodes.length > 1">
            <span><i></i>Choice</span>
            <span><i class="ret"></i>Comes back</span>
            <span><i class="next"></i>Continues</span>
        </div>
        <div class="map-zoom" v-if="nodes.length">
            <button class="icon-btn icon-btn-sm" type="button" title="Zoom out" aria-label="Zoom out" @click="zoomAt(1 / 1.2)"><icon name="zoomOut" /></button>
            <span class="zoom-label">{{ zoomLabel }}</span>
            <button class="icon-btn icon-btn-sm" type="button" title="Zoom in" aria-label="Zoom in" @click="zoomAt(1.2)"><icon name="zoomIn" /></button>
            <button class="icon-btn icon-btn-sm" type="button" title="Fit everything (F)" aria-label="Fit everything" @click="fit"><icon name="fit" /></button>
        </div>
    </section>`
};
