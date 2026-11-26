/*
 * MyaStudio story core
 * --------------------
 * One shared, dependency-free module that defines what an interactive movie
 * *is* and how it plays. It is used in three places:
 *
 *   - the published / preview player (browser, <script src="story-core.js">)
 *   - the studio editor, for live "story check" warnings (browser)
 *   - the server, to build and validate stories before publishing (Node)
 *
 * Story format (version 2):
 *
 *   {
 *     version: 2,
 *     id, title, synopsis, genre, themeColor,
 *     startSceneId,
 *     playlist: [sceneId, ...],          // optional legacy "main sequence"
 *     scenes: [{
 *       id, name, src, poster, duration,
 *       subtitles, music, muted,
 *       next: sceneId | null,            // "when this scene ends, continue to"
 *       ending: { title } | null,        // this scene is an ending
 *       timeout: { seconds, to } | null  // legacy: jump after N seconds
 *     }],
 *     choicePoints: [{
 *       id, sceneId, time,               // when the choices appear (seconds)
 *       prompt,                          // optional question shown above the choices
 *       timeLimit,                       // countdown in seconds, 0 = wait
 *       shuffle, pause,                  // shuffle order / pause video while choosing
 *       choices: [{
 *         id, label, action,             // 'scene' | 'end' | 'next' | 'dismiss'
 *         to,                            // target scene for action 'scene'
 *         returnHere,                    // come back to this moment afterwards
 *         setFlag, requireFlag,          // requireFlag may start with '!' (= flag NOT set)
 *         isDefault, image, color
 *       }]
 *     }]
 *   }
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.MyaStory = api;
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const STORY_VERSION = 2;
    // A choice point this close to the end of its scene behaves like an
    // "end of scene" decision: returning to it shows the choices again
    // (a menu / hub), instead of resuming playback right after it.
    const END_POINT_WINDOW = 0.6;
    // scene: play another scene · end: end the movie · next: legacy main
    // sequence · dismiss: close the choices and keep watching this scene.
    const ACTIONS = new Set(['scene', 'end', 'next', 'dismiss']);

    function num(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function str(value) {
        return value === undefined || value === null ? '' : String(value).trim();
    }

    function bool(value) {
        return value === true || value === 1 || value === '1' || value === 'true';
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(num(seconds, 0)));
        const m = Math.floor(total / 60);
        const s = String(total % 60).padStart(2, '0');
        return m + ':' + s;
    }

    function formatTimePrecise(seconds) {
        const value = Math.max(0, num(seconds, 0));
        const m = Math.floor(value / 60);
        const s = (value - m * 60).toFixed(1).padStart(4, '0');
        return m + ':' + s;
    }

    // --- Flags ---------------------------------------------------------------

    function parseRequirement(requireFlag) {
        const raw = str(requireFlag);
        if (!raw) return null;
        if (raw.startsWith('!')) {
            const flag = raw.slice(1).trim();
            return flag ? { flag, negate: true } : null;
        }
        return { flag: raw, negate: false };
    }

    function requirementMet(requireFlag, flags) {
        const req = parseRequirement(requireFlag);
        if (!req) return true;
        const isSet = !!(flags && flags[req.flag]);
        return req.negate ? !isSet : isSet;
    }

    // --- Normalisation ---------------------------------------------------------

    function normalizeChoice(raw, index, pointId) {
        const choice = raw || {};
        let action = str(choice.action).toLowerCase();
        if (action === 'target') action = 'scene';
        if (!ACTIONS.has(action)) action = 'scene';
        const to = str(choice.to) || null;
        return {
            id: str(choice.id) || (pointId + ':' + index),
            label: str(choice.label),
            action,
            to: action === 'scene' ? to : null,
            returnHere: action === 'scene' && bool(choice.returnHere),
            setFlag: str(choice.setFlag) || null,
            requireFlag: str(choice.requireFlag) || null,
            isDefault: bool(choice.isDefault),
            image: str(choice.image) || null,
            color: str(choice.color) || null,
            incomplete: false
        };
    }

    function normalizeScene(raw) {
        const scene = raw || {};
        const timeout = scene.timeout && num(scene.timeout.seconds, 0) > 0 && str(scene.timeout.to)
            ? { seconds: num(scene.timeout.seconds, 0), to: str(scene.timeout.to) }
            : null;
        const ending = scene.ending
            ? { title: str(scene.ending.title) || 'The End' }
            : null;
        return {
            id: str(scene.id),
            name: str(scene.name) || 'Untitled scene',
            src: str(scene.src),
            poster: str(scene.poster) || null,
            duration: Math.max(0, num(scene.duration, 0)),
            subtitles: str(scene.subtitles) || null,
            music: str(scene.music) || null,
            muted: bool(scene.muted),
            next: str(scene.next) || null,
            ending,
            timeout
        };
    }

    // Normalises a story so every consumer sees the same, safe shape.
    // References to scenes that do not exist are cleared (and choices that
    // lose their target are marked `incomplete`) rather than throwing, so a
    // half-finished story can still be previewed and analysed.
    function normalizeStory(raw) {
        const input = raw || {};
        const sceneList = [];
        const seen = new Set();
        (Array.isArray(input.scenes) ? input.scenes : []).forEach(item => {
            const scene = normalizeScene(item);
            if (!scene.id || seen.has(scene.id)) return;
            seen.add(scene.id);
            sceneList.push(scene);
        });
        const ids = new Set(sceneList.map(scene => scene.id));
        sceneList.forEach(scene => {
            if (scene.next && (!ids.has(scene.next))) scene.next = null;
            if (scene.timeout && !ids.has(scene.timeout.to)) scene.timeout = null;
        });

        const points = [];
        const pointIds = new Set();
        (Array.isArray(input.choicePoints) ? input.choicePoints : []).forEach((item, pointIndex) => {
            const point = item || {};
            const sceneId = str(point.sceneId);
            if (!ids.has(sceneId)) return;
            let id = str(point.id) || ('point_' + pointIndex);
            while (pointIds.has(id)) id = id + '_' + pointIndex;
            pointIds.add(id);
            const choices = (Array.isArray(point.choices) ? point.choices : [])
                .map((choice, index) => normalizeChoice(choice, index, id));
            choices.forEach(choice => {
                if (choice.action === 'scene' && (!choice.to || !ids.has(choice.to))) {
                    choice.to = choice.to && ids.has(choice.to) ? choice.to : null;
                    choice.incomplete = true;
                    choice.returnHere = choice.returnHere && !!choice.to;
                }
            });
            points.push({
                id,
                sceneId,
                time: Math.max(0, num(point.time, 0)),
                prompt: str(point.prompt).slice(0, 160),
                timeLimit: Math.max(0, num(point.timeLimit, 0)),
                shuffle: bool(point.shuffle),
                pause: bool(point.pause),
                choices
            });
        });
        points.sort((a, b) => a.time - b.time);

        let startSceneId = str(input.startSceneId);
        const playlist = (Array.isArray(input.playlist) ? input.playlist : [])
            .map(str)
            .filter(id => ids.has(id));
        if (!ids.has(startSceneId)) startSceneId = playlist[0] || '';

        return {
            version: STORY_VERSION,
            id: input.id === undefined || input.id === null ? null : input.id,
            title: str(input.title) || 'Interactive movie',
            synopsis: str(input.synopsis),
            genre: str(input.genre),
            themeColor: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(str(input.themeColor)) ? str(input.themeColor) : '#3b82f6',
            startSceneId: startSceneId || null,
            playlist,
            scenes: sceneList,
            choicePoints: points,
            analytics: input.analytics ? { projectId: input.analytics.projectId } : null
        };
    }

    function indexStory(story) {
        const sceneMap = new Map(story.scenes.map(scene => [scene.id, scene]));
        const pointsByScene = new Map();
        story.choicePoints.forEach(point => {
            if (!pointsByScene.has(point.sceneId)) pointsByScene.set(point.sceneId, []);
            pointsByScene.get(point.sceneId).push(point);
        });
        pointsByScene.forEach(list => list.sort((a, b) => a.time - b.time));
        const pointMap = new Map(story.choicePoints.map(point => [point.id, point]));
        return { sceneMap, pointsByScene, pointMap };
    }

    function isEndPoint(point, scene) {
        if (!point || !scene) return false;
        const duration = num(scene.duration, 0);
        if (!(duration > 0)) return true;
        return point.time >= duration - END_POINT_WINDOW;
    }

    // Every outgoing link of a scene, used for reachability and analysis.
    function sceneLinks(story, index, sceneId) {
        const scene = index.sceneMap.get(sceneId);
        const links = [];
        if (!scene) return links;
        (index.pointsByScene.get(sceneId) || []).forEach(point => {
            point.choices.forEach(choice => {
                if (choice.action === 'scene' && choice.to) {
                    links.push({ kind: 'choice', to: choice.to, point, choice });
                }
            });
        });
        if (scene.next) links.push({ kind: 'next', to: scene.next });
        if (scene.timeout) links.push({ kind: 'timeout', to: scene.timeout.to });
        return links;
    }

    function usesPlaylistNext(story) {
        return story.choicePoints.some(point => point.choices.some(choice => choice.action === 'next'));
    }

    function reachableScenes(story, index) {
        const reachable = new Set();
        const start = story.startSceneId;
        const queue = [];
        if (start) queue.push(start);
        // Legacy main sequences play one after another, so every item counts
        // as reachable once the story has one.
        story.playlist.forEach(id => queue.push(id));
        while (queue.length) {
            const id = queue.shift();
            if (!id || reachable.has(id) || !index.sceneMap.has(id)) continue;
            reachable.add(id);
            sceneLinks(story, index, id).forEach(link => {
                if (!reachable.has(link.to)) queue.push(link.to);
            });
        }
        return reachable;
    }

    // --- Analysis ("story check") ------------------------------------------------

    function analyzeStory(rawStory, options) {
        const opts = options || {};
        const story = normalizeStory(rawStory);
        const index = indexStory(story);
        const issues = [];
        const endings = [];
        const add = (level, code, message, extra) => issues.push(Object.assign({ level, code, message }, extra || {}));
        const sceneName = id => (index.sceneMap.get(id) || {}).name || 'a scene';

        if (!story.scenes.length) {
            add('error', 'no-scenes', 'Add your first scene: upload a video, then cut a scene from it.');
            return finalize();
        }
        if (!story.startSceneId) {
            add('error', 'no-start', 'Choose a start scene so viewers know where the movie begins.');
        }

        const reachable = reachableScenes(story, index);
        const returnTargets = new Set();
        const flagsSet = new Set();
        const flagsRequired = new Map();
        story.choicePoints.forEach(point => point.choices.forEach(choice => {
            if (choice.returnHere && choice.to) returnTargets.add(choice.to);
            if (choice.setFlag) flagsSet.add(choice.setFlag);
            const req = parseRequirement(choice.requireFlag);
            if (req) {
                if (!flagsRequired.has(req.flag)) flagsRequired.set(req.flag, []);
                flagsRequired.get(req.flag).push({ point, choice });
            }
        }));

        // Scenes reached only through "come back here" detours return on their
        // own, and so do scenes that continue into such a detour chain.
        const detourScenes = new Set();
        returnTargets.forEach(id => {
            let cursor = id;
            const guard = new Set();
            while (cursor && !guard.has(cursor)) {
                guard.add(cursor);
                detourScenes.add(cursor);
                const scene = index.sceneMap.get(cursor);
                cursor = scene ? scene.next : null;
            }
        });
        const playlistHasNext = id => {
            const position = story.playlist.indexOf(id);
            return position >= 0 && position < story.playlist.length - 1;
        };

        story.scenes.forEach(scene => {
            const points = index.pointsByScene.get(scene.id) || [];
            const isReachable = reachable.has(scene.id);
            const hasChoices = points.some(point => point.choices.length > 0);

            if (!isReachable && scene.id !== story.startSceneId) {
                add('info', 'unreachable', `"${scene.name}" isn't connected to the story yet, so viewers can't reach it.`, { sceneId: scene.id });
            }

            points.forEach(point => {
                if (!point.choices.length) {
                    add('warning', 'empty-point', `A choice moment in "${scene.name}" has no choices.`, { sceneId: scene.id, pointId: point.id });
                    return;
                }
                if (scene.duration > 0 && point.time > scene.duration + 0.05) {
                    add('info', 'late-point', `Choices in "${scene.name}" are set after the scene ends, so they'll appear on its last frame.`, { sceneId: scene.id, pointId: point.id });
                }
                point.choices.forEach(choice => {
                    if (choice.incomplete) {
                        add('warning', 'no-target', `The choice "${choice.label || 'Untitled'}" in "${scene.name}" doesn't lead anywhere yet.`, { sceneId: scene.id, pointId: point.id, choiceId: choice.id });
                    }
                    if (!choice.label) {
                        add('warning', 'no-label', `A choice in "${scene.name}" has no text, so viewers will see a blank button.`, { sceneId: scene.id, pointId: point.id, choiceId: choice.id });
                    }
                    if (choice.action === 'end') {
                        endings.push({ key: 'choice:' + choice.id, title: choice.label || 'The End', sceneId: scene.id, reachable: isReachable });
                    }
                });
                const playable = point.choices.filter(choice => !choice.incomplete);
                if (playable.length && isEndPoint(point, scene) && playable.every(choice => choice.returnHere)) {
                    add('warning', 'menu-trap', `Every choice in "${scene.name}" comes back to it, so viewers can never move on. Make at least one choice go somewhere new.`, { sceneId: scene.id, pointId: point.id });
                }
                if (point.timeLimit > 0 && !playable.some(choice => choice.isDefault) && playable.length > 1) {
                    add('info', 'no-default', `The timer in "${scene.name}" has no default choice, so the first choice is picked when time runs out.`, { sceneId: scene.id, pointId: point.id });
                }
            });

            const endsMovie = !hasChoices && !scene.next && !scene.timeout;
            if (endsMovie) {
                if (scene.ending) {
                    endings.push({ key: 'scene:' + scene.id, title: scene.ending.title, sceneId: scene.id, reachable: isReachable });
                } else if (!detourScenes.has(scene.id) && !playlistHasNext(scene.id) && isReachable) {
                    endings.push({ key: 'scene:' + scene.id, title: 'The End', sceneId: scene.id, reachable: true, implicit: true });
                    add('warning', 'dead-end', `The movie stops after "${scene.name}". Add choices, continue to another scene, or mark it as an ending.`, { sceneId: scene.id });
                }
            }
        });

        // Endless "continue to" loops with no way out.
        const visitedLoops = new Set();
        story.scenes.forEach(scene => {
            const path = [];
            const onPath = new Set();
            let cursor = scene.id;
            while (cursor && !onPath.has(cursor)) {
                const current = index.sceneMap.get(cursor);
                if (!current) break;
                const hasChoices = (index.pointsByScene.get(cursor) || []).some(point => point.choices.length > 0);
                if (hasChoices || current.ending) { path.length = 0; break; }
                onPath.add(cursor);
                path.push(cursor);
                cursor = current.next;
            }
            if (cursor && onPath.has(cursor)) {
                const loop = path.slice(path.indexOf(cursor));
                const key = loop.slice().sort().join('|');
                if (!visitedLoops.has(key)) {
                    visitedLoops.add(key);
                    add('error', 'loop', `"${sceneName(loop[0])}" continues in an endless loop with no choices to leave it.`, { sceneId: loop[0] });
                }
            }
        });

        flagsRequired.forEach((uses, flag) => {
            if (!flagsSet.has(flag)) {
                uses.forEach(use => add('warning', 'flag-never-set', `The choice "${use.choice.label || 'Untitled'}" needs "${flag}", but no choice ever sets it.`, { sceneId: use.point.sceneId, pointId: use.point.id, choiceId: use.choice.id }));
            }
        });

        return finalize();

        function finalize() {
            const order = { error: 0, warning: 1, info: 2 };
            issues.sort((a, b) => order[a.level] - order[b.level]);
            const reachableSet = story.scenes.length ? reachableScenes(story, index) : new Set();
            const choiceCount = story.choicePoints.reduce((total, point) => total + point.choices.length, 0);
            const realEndings = endings.filter(ending => ending.reachable);
            const errors = issues.filter(issue => issue.level === 'error').length;
            const warnings = issues.filter(issue => issue.level === 'warning').length;
            return {
                issues: opts.includeInfo === false ? issues.filter(issue => issue.level !== 'info') : issues,
                errors,
                warnings,
                ready: errors === 0,
                endings: realEndings,
                stats: {
                    scenes: story.scenes.length,
                    reachableScenes: reachableSet.size,
                    choicePoints: story.choicePoints.length,
                    choices: choiceCount,
                    endings: realEndings.length
                },
                flags: Array.from(new Set(story.choicePoints.flatMap(point => point.choices.flatMap(choice => {
                    const req = parseRequirement(choice.requireFlag);
                    return [choice.setFlag, req && req.flag].filter(Boolean);
                })))).sort()
            };
        }
    }

    // --- Playback engine -------------------------------------------------------
    //
    // A small state machine with no DOM access. The player UI asks it what to
    // do ("a choice point is due", "the scene ended") and receives commands:
    //
    //   { type: 'play', sceneId, time, showPointId? }
    //   { type: 'choices', point, choices }
    //   { type: 'resume' }                  (keep watching the current scene)
    //   { type: 'end', ending: { key, title, kind } }

    function shuffled(list, random) {
        const copy = list.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            const tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
        }
        return copy;
    }

    function createEngine(rawStory, options) {
        const opts = options || {};
        const story = normalizeStory(rawStory);
        const index = indexStory(story);
        const random = typeof opts.random === 'function' ? opts.random : Math.random;
        const state = {
            sceneId: null,
            flags: {},
            returnStack: [],
            playlistIndex: 0,
            journey: [],
            checkpoints: [],
            visitedChoices: {},
            fired: {},
            ended: null
        };

        function scene(id) { return index.sceneMap.get(id) || null; }
        function pointsFor(id) { return index.pointsByScene.get(id) || []; }
        function currentScene() { return scene(state.sceneId); }

        function syncFired(time) {
            const list = pointsFor(state.sceneId);
            const fired = {};
            list.forEach(point => {
                if (point.time < time - 0.05) fired[point.id] = true;
            });
            state.fired = fired;
        }

        function enter(sceneId, time, showPointId) {
            const target = scene(sceneId);
            if (!target) return finish(null);
            state.sceneId = sceneId;
            state.ended = null;
            const startAt = Math.max(0, num(time, 0));
            syncFired(startAt);
            if (showPointId) delete state.fired[showPointId];
            const command = { type: 'play', sceneId, time: startAt };
            if (showPointId) command.showPointId = showPointId;
            return command;
        }

        function start(sceneId) {
            state.flags = {};
            state.returnStack = [];
            state.journey = [];
            state.checkpoints = [];
            state.visitedChoices = {};
            state.ended = null;
            const first = sceneId && scene(sceneId) ? sceneId : (story.startSceneId || story.playlist[0]);
            const playlistPosition = story.playlist.indexOf(first);
            state.playlistIndex = playlistPosition >= 0 ? playlistPosition : 0;
            if (!first) return finish(null);
            return enter(first, 0);
        }

        function availableChoices(point) {
            if (!point) return [];
            return point.choices.filter(choice => !choice.incomplete && requirementMet(choice.requireFlag, state.flags));
        }

        // Called on every time update. Returns a 'choices' command when a
        // choice point should open now, otherwise null. A point that a viewer
        // seeks past still opens: decisions can't be skipped by scrubbing.
        function pointDue(time) {
            const list = pointsFor(state.sceneId);
            for (const point of list) {
                if (state.fired[point.id]) continue;
                if (point.time > time + 0.05) break;
                state.fired[point.id] = true;
                const choices = availableChoices(point);
                if (!choices.length) continue;
                return { type: 'choices', point, choices: point.shuffle ? shuffled(choices, random) : choices };
            }
            return null;
        }

        function openPoint(pointId) {
            const point = index.pointMap.get(pointId);
            if (!point || point.sceneId !== state.sceneId) return null;
            state.fired[point.id] = true;
            const choices = availableChoices(point);
            if (!choices.length) return null;
            return { type: 'choices', point, choices: point.shuffle ? shuffled(choices, random) : choices };
        }

        // Seeking back lets later choice points open again; seeking forward
        // never marks the ones it jumped over as done, so pointDue() opens
        // them straight away: viewers can't skip a decision by scrubbing.
        function seek(time) {
            const target = num(time, 0);
            pointsFor(state.sceneId).forEach(point => {
                if (point.time >= target - 0.05) delete state.fired[point.id];
            });
        }

        function defaultChoice(point, choices) {
            const list = choices || availableChoices(point);
            return list.find(choice => choice.isDefault) || list[0] || null;
        }

        function snapshotForCheckpoint(point) {
            return {
                sceneId: state.sceneId,
                pointId: point.id,
                time: point.time,
                flags: Object.assign({}, state.flags),
                returnStack: state.returnStack.map(item => Object.assign({}, item)),
                playlistIndex: state.playlistIndex,
                journeyLength: state.journey.length
            };
        }

        function finish(sceneOrNull, kind, title, key) {
            const current = sceneOrNull;
            const ending = {
                kind: kind || (current && current.ending ? 'ending' : 'finale'),
                title: title || (current && current.ending ? current.ending.title : 'The End'),
                key: key || (current ? 'scene:' + current.id : 'finale'),
                sceneId: current ? current.id : null
            };
            state.ended = ending;
            return { type: 'end', ending };
        }

        function choose(pointId, choiceId) {
            const point = index.pointMap.get(pointId);
            if (!point) return null;
            const choice = point.choices.find(item => item.id === choiceId);
            if (!choice || choice.incomplete || !requirementMet(choice.requireFlag, state.flags)) return null;
            const from = currentScene();
            state.checkpoints.push(snapshotForCheckpoint(point));
            if (state.checkpoints.length > 60) state.checkpoints.shift();
            if (choice.setFlag) state.flags[choice.setFlag] = true;
            state.visitedChoices[choice.id] = true;
            const target = choice.action === 'scene' ? scene(choice.to) : null;
            state.journey.push({
                sceneId: from ? from.id : null,
                sceneName: from ? from.name : '',
                pointId: point.id,
                choiceId: choice.id,
                label: choice.label || 'Choice',
                result: choice.action === 'end' ? 'Ending' : (choice.action === 'next' || choice.action === 'dismiss' ? 'Kept watching' : (target ? target.name : ''))
            });
            if (state.journey.length > 200) state.journey.shift();

            if (choice.action === 'end') {
                return finish(from, 'ending', from && from.ending ? from.ending.title : (choice.label || 'The End'), 'choice:' + choice.id);
            }
            if (choice.action === 'next') {
                return advancePlaylist();
            }
            if (choice.action === 'dismiss') {
                return { type: 'resume' };
            }
            if (!target) return null;
            if (choice.returnHere && from) {
                const atEnd = isEndPoint(point, from);
                const duration = num(from.duration, 0);
                const resumeAt = atEnd
                    ? Math.max(0, Math.min(point.time, duration > 0 ? duration - 0.05 : point.time))
                    : Math.max(0, Math.min(point.time + 0.1, duration > 0 ? duration - 0.1 : point.time + 0.1));
                state.returnStack.push({ sceneId: from.id, time: resumeAt, pointId: atEnd ? point.id : null });
                if (state.returnStack.length > 30) state.returnStack.shift();
            }
            return enter(target.id, 0);
        }

        function advancePlaylist() {
            state.playlistIndex += 1;
            if (state.playlistIndex < story.playlist.length) {
                return enter(story.playlist[state.playlistIndex], 0);
            }
            return finish(null, 'finale', 'The End', 'finale');
        }

        // The current scene's video reached its end.
        function sceneEnded() {
            const current = currentScene();
            if (!current) return finish(null);
            const pending = pointDue(Number.POSITIVE_INFINITY);
            if (pending) return pending;
            if (current.next) return enter(current.next, 0);
            if (state.returnStack.length) {
                const back = state.returnStack.pop();
                return enter(back.sceneId, back.time, back.pointId || null);
            }
            if (story.playlist.length) {
                const position = story.playlist.indexOf(current.id);
                if (position >= 0 && position >= state.playlistIndex) state.playlistIndex = position;
                if (state.playlistIndex < story.playlist.length - 1 && position >= 0) {
                    return advancePlaylist();
                }
            }
            return finish(current);
        }

        function timeoutTarget() {
            const current = currentScene();
            return current && current.timeout ? current.timeout : null;
        }

        function followTimeout() {
            const timeout = timeoutTarget();
            if (!timeout) return null;
            return enter(timeout.to, 0);
        }

        // Rewind to the most recent decision the viewer made and show it again.
        function goBack() {
            if (!state.checkpoints.length) return null;
            const checkpoint = state.checkpoints.pop();
            state.flags = Object.assign({}, checkpoint.flags);
            state.returnStack = checkpoint.returnStack.map(item => Object.assign({}, item));
            state.playlistIndex = checkpoint.playlistIndex;
            state.journey = state.journey.slice(0, checkpoint.journeyLength);
            return enter(checkpoint.sceneId, Math.max(0, checkpoint.time - 1.5), checkpoint.pointId);
        }

        function snapshot(time) {
            return {
                v: STORY_VERSION,
                sceneId: state.sceneId,
                time: Math.max(0, num(time, 0)),
                flags: Object.assign({}, state.flags),
                returnStack: state.returnStack.slice(),
                playlistIndex: state.playlistIndex,
                journey: state.journey.slice(-50),
                checkpoints: state.checkpoints.slice(-20),
                visitedChoices: Object.assign({}, state.visitedChoices)
            };
        }

        function restore(saved) {
            if (!saved || !scene(saved.sceneId)) return null;
            state.flags = Object.assign({}, saved.flags || {});
            state.returnStack = Array.isArray(saved.returnStack) ? saved.returnStack.filter(item => item && scene(item.sceneId)) : [];
            state.playlistIndex = Math.max(0, num(saved.playlistIndex, 0));
            state.journey = Array.isArray(saved.journey) ? saved.journey : [];
            state.checkpoints = Array.isArray(saved.checkpoints) ? saved.checkpoints.filter(item => item && scene(item.sceneId)) : [];
            state.visitedChoices = Object.assign({}, saved.visitedChoices || {});
            return enter(saved.sceneId, Math.max(0, num(saved.time, 0) - 1));
        }

        // Scenes the viewer may need next, best guesses first, for preloading.
        function upcomingScenes() {
            const current = currentScene();
            if (!current) return [];
            const ids = [];
            const push = id => { if (id && id !== current.id && scene(id) && !ids.includes(id)) ids.push(id); };
            pointsFor(current.id).forEach(point => {
                const choices = availableChoices(point);
                const preferred = defaultChoice(point, choices);
                if (preferred && preferred.action === 'scene') push(preferred.to);
                choices.forEach(choice => { if (choice.action === 'scene') push(choice.to); });
            });
            push(current.next);
            if (state.returnStack.length) push(state.returnStack[state.returnStack.length - 1].sceneId);
            if (current.timeout) push(current.timeout.to);
            if (story.playlist.length && state.playlistIndex + 1 < story.playlist.length) push(story.playlist[state.playlistIndex + 1]);
            return ids;
        }

        return {
            story,
            state,
            scene,
            pointsFor,
            currentScene,
            start,
            availableChoices,
            pointDue,
            openPoint,
            seek,
            defaultChoice,
            choose,
            sceneEnded,
            timeoutTarget,
            followTimeout,
            goBack,
            canGoBack: () => state.checkpoints.length > 0,
            snapshot,
            restore,
            upcomingScenes,
            isEndPoint: point => isEndPoint(point, scene(point && point.sceneId))
        };
    }

    return {
        STORY_VERSION,
        END_POINT_WINDOW,
        normalizeStory,
        analyzeStory,
        createEngine,
        requirementMet,
        parseRequirement,
        reachableScenes: story => {
            const normalized = normalizeStory(story);
            return reachableScenes(normalized, indexStory(normalized));
        },
        formatTime,
        formatTimePrecise
    };
});
