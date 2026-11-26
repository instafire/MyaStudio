// Story engine and story check: the rules every published movie plays by.
const test = require('node:test');
const assert = require('node:assert/strict');
const Story = require('../public/player/story-core.js');

function twoDoors(overrides = {}) {
    return {
        startSceneId: 'hall',
        scenes: [
            { id: 'hall', name: 'Hallway', src: 'hall.mp4', duration: 10 },
            { id: 'red', name: 'Red door', src: 'red.mp4', duration: 5, ending: { title: 'Through the red door' } },
            { id: 'garden', name: 'Garden', src: 'garden.mp4', duration: 5, ending: { title: 'The secret garden' } }
        ],
        choicePoints: [{
            id: 'p1', sceneId: 'hall', time: 7, timeLimit: 8, prompt: 'Which way?',
            choices: [
                { id: 'c-red', label: 'Red door', action: 'scene', to: 'red' },
                { id: 'c-garden', label: 'Garden', action: 'scene', to: 'garden', isDefault: true }
            ]
        }],
        ...overrides
    };
}

test('engine starts at the start scene and opens choices at their time', () => {
    const engine = Story.createEngine(twoDoors());
    assert.deepEqual(engine.start(), { type: 'play', sceneId: 'hall', time: 0 });
    assert.equal(engine.pointDue(3), null);
    const due = engine.pointDue(7.01);
    assert.equal(due.type, 'choices');
    assert.equal(due.point.prompt, 'Which way?');
    assert.deepEqual(due.choices.map(choice => choice.id), ['c-red', 'c-garden']);
    // A point only opens once per visit.
    assert.equal(engine.pointDue(7.5), null);
});

test('choosing plays the target scene and its ending is reported with its title', () => {
    const engine = Story.createEngine(twoDoors());
    engine.start();
    engine.pointDue(7.2);
    assert.deepEqual(engine.choose('p1', 'c-red'), { type: 'play', sceneId: 'red', time: 0 });
    const end = engine.sceneEnded();
    assert.equal(end.type, 'end');
    assert.equal(end.ending.title, 'Through the red door');
    assert.equal(end.ending.key, 'scene:red');
    assert.equal(engine.state.journey.length, 1);
    assert.equal(engine.state.journey[0].label, 'Red door');
});

test('timer default prefers the default choice, else the first available one', () => {
    const engine = Story.createEngine(twoDoors());
    engine.start();
    const due = engine.pointDue(7.2);
    assert.equal(engine.defaultChoice(due.point, due.choices).id, 'c-garden');
    const noDefault = Story.createEngine(twoDoors({
        choicePoints: [{ id: 'p1', sceneId: 'hall', time: 7, timeLimit: 5, choices: [{ id: 'a', label: 'A', to: 'red' }, { id: 'b', label: 'B', to: 'garden' }] }]
    }));
    noDefault.start();
    const point = noDefault.pointDue(8);
    assert.equal(noDefault.defaultChoice(point.point, point.choices).id, 'a');
});

test('a choice point skipped by seeking still opens when the scene ends', () => {
    const engine = Story.createEngine(twoDoors());
    engine.start();
    engine.seek(9.9);
    // Seeking past it does not mark it as fired...
    const due = engine.sceneEnded();
    assert.equal(due.type, 'choices');
    assert.equal(due.point.id, 'p1');
});

test('shuffle reorders the choices with the injected random source', () => {
    const engine = Story.createEngine(twoDoors({
        choicePoints: [{ id: 'p1', sceneId: 'hall', time: 1, shuffle: true, choices: [{ id: 'a', label: 'A', to: 'red' }, { id: 'b', label: 'B', to: 'garden' }] }]
    }), { random: () => 0 });
    engine.start();
    assert.deepEqual(engine.pointDue(1.1).choices.map(choice => choice.id), ['b', 'a']);
});

test('continue-to links play scenes back to back', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [
            { id: 'a', name: 'A', src: 'a.mp4', duration: 3, next: 'b' },
            { id: 'b', name: 'B', src: 'b.mp4', duration: 3, ending: { title: 'Fin' } }
        ]
    });
    engine.start();
    assert.deepEqual(engine.sceneEnded(), { type: 'play', sceneId: 'b', time: 0 });
    assert.equal(engine.sceneEnded().ending.title, 'Fin');
});

test('come-back-here detours return just after a mid-scene moment', () => {
    const engine = Story.createEngine({
        startSceneId: 'main',
        scenes: [
            { id: 'main', name: 'Main', src: 'm.mp4', duration: 20, ending: { title: 'Done' } },
            { id: 'photo', name: 'Photo', src: 'p.mp4', duration: 3 }
        ],
        choicePoints: [{ id: 'm1', sceneId: 'main', time: 5, choices: [{ id: 'look', label: 'Look', to: 'photo', returnHere: true }, { id: 'keep', label: 'Keep watching', action: 'dismiss' }] }]
    });
    engine.start();
    engine.pointDue(5.05);
    engine.choose('m1', 'look');
    const back = engine.sceneEnded();
    assert.equal(back.sceneId, 'main');
    assert.ok(back.time > 5 && back.time <= 5.1 + 1e-9);
    assert.equal(back.showPointId, undefined);
    // The moment does not fire again after coming back.
    assert.equal(engine.pointDue(back.time + 0.2), null);
});

test('come-back-here at the end of a scene reopens its choices like a menu', () => {
    const engine = Story.createEngine({
        startSceneId: 'menu',
        scenes: [
            { id: 'menu', name: 'Menu', src: 'm.mp4', duration: 6 },
            { id: 'a', name: 'A', src: 'a.mp4', duration: 3 },
            { id: 'out', name: 'Out', src: 'o.mp4', duration: 3, ending: { title: 'Bye' } }
        ],
        choicePoints: [{ id: 'menu-pt', sceneId: 'menu', time: 5.8, choices: [{ id: 'see-a', label: 'See A', to: 'a', returnHere: true }, { id: 'leave', label: 'Leave', to: 'out' }] }]
    });
    engine.start();
    engine.pointDue(5.9);
    engine.choose('menu-pt', 'see-a');
    const back = engine.sceneEnded();
    assert.equal(back.sceneId, 'menu');
    assert.equal(back.showPointId, 'menu-pt');
    const reopened = engine.openPoint('menu-pt');
    assert.equal(reopened.type, 'choices');
    assert.ok(engine.state.visitedChoices['see-a']);
});

test('keep watching closes the choices without leaving the scene', () => {
    const engine = Story.createEngine({
        startSceneId: 'main',
        scenes: [{ id: 'main', name: 'Main', src: 'm.mp4', duration: 10, ending: { title: 'Done' } }, { id: 'x', name: 'X', src: 'x.mp4', duration: 2 }],
        choicePoints: [{ id: 'p', sceneId: 'main', time: 3, choices: [{ id: 'go', label: 'Go', to: 'x', returnHere: true }, { id: 'stay', label: 'Keep watching', action: 'dismiss' }] }]
    });
    engine.start();
    engine.pointDue(3.1);
    assert.deepEqual(engine.choose('p', 'stay'), { type: 'resume' });
    assert.equal(engine.state.sceneId, 'main');
});

test('flags unlock choices, including "only if not" requirements', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [
            { id: 'a', name: 'A', src: 'a.mp4', duration: 4 },
            { id: 'b', name: 'B', src: 'b.mp4', duration: 4 },
            { id: 'c', name: 'C', src: 'c.mp4', duration: 4, ending: { title: 'C' } },
            { id: 'd', name: 'D', src: 'd.mp4', duration: 4, ending: { title: 'D' } }
        ],
        choicePoints: [
            { id: 'p1', sceneId: 'a', time: 3, choices: [{ id: 'key', label: 'Take key', to: 'b', setFlag: 'has_key' }, { id: 'skip', label: 'Walk on', to: 'b' }] },
            { id: 'p2', sceneId: 'b', time: 3, choices: [{ id: 'open', label: 'Open door', to: 'c', requireFlag: 'has_key' }, { id: 'knock', label: 'Knock', to: 'd', requireFlag: '!has_key' }] }
        ]
    });
    engine.start();
    engine.pointDue(3.1);
    engine.choose('p1', 'key');
    assert.deepEqual(engine.pointDue(3.1).choices.map(choice => choice.id), ['open']);
    engine.start();
    engine.pointDue(3.1);
    engine.choose('p1', 'skip');
    assert.deepEqual(engine.pointDue(3.1).choices.map(choice => choice.id), ['knock']);
});

test('a choice point whose choices are all locked is skipped instead of trapping the viewer', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 4, ending: { title: 'End' } }, { id: 'b', name: 'B', src: 'b.mp4', duration: 2 }],
        choicePoints: [{ id: 'p', sceneId: 'a', time: 2, choices: [{ id: 'x', label: 'Secret', to: 'b', requireFlag: 'never' }] }]
    });
    engine.start();
    assert.equal(engine.pointDue(2.5), null);
    assert.equal(engine.sceneEnded().type, 'end');
});

test('go back rewinds to the last decision and restores flags', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 8 }, { id: 'b', name: 'B', src: 'b.mp4', duration: 3, ending: { title: 'B' } }],
        choicePoints: [{ id: 'p', sceneId: 'a', time: 6, choices: [{ id: 'x', label: 'X', to: 'b', setFlag: 'took_x' }] }]
    });
    engine.start();
    engine.pointDue(6.1);
    engine.choose('p', 'x');
    assert.equal(engine.state.flags.took_x, true);
    assert.equal(engine.canGoBack(), true);
    const back = engine.goBack();
    assert.equal(back.sceneId, 'a');
    assert.equal(back.showPointId, 'p');
    assert.ok(back.time < 6);
    assert.equal(engine.state.flags.took_x, undefined);
    assert.equal(engine.state.journey.length, 0);
});

test('legacy main sequences and "next" choices still play in order', () => {
    const engine = Story.createEngine({
        playlist: ['one', 'two'],
        scenes: [{ id: 'one', name: '1', src: '1.mp4', duration: 4 }, { id: 'two', name: '2', src: '2.mp4', duration: 4 }],
        choicePoints: [{ id: 'p', sceneId: 'one', time: 2, choices: [{ id: 'n', label: 'Next', action: 'next' }] }]
    });
    assert.equal(engine.start().sceneId, 'one');
    engine.pointDue(2.1);
    assert.equal(engine.choose('p', 'n').sceneId, 'two');
    assert.equal(engine.sceneEnded().type, 'end');
});

test('legacy clip timeouts are followed', () => {
    const engine = Story.createEngine({
        startSceneId: 'a',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 30, timeout: { seconds: 4, to: 'b' } }, { id: 'b', name: 'B', src: 'b.mp4', duration: 2 }]
    });
    engine.start();
    assert.deepEqual(engine.timeoutTarget(), { seconds: 4, to: 'b' });
    assert.equal(engine.followTimeout().sceneId, 'b');
});

test('progress snapshots restore the viewer where they left off', () => {
    const engine = Story.createEngine(twoDoors());
    engine.start();
    engine.pointDue(7.2);
    engine.choose('p1', 'c-red');
    const saved = JSON.parse(JSON.stringify(engine.snapshot(2.5)));
    const fresh = Story.createEngine(twoDoors());
    const resumed = fresh.restore(saved);
    assert.equal(resumed.sceneId, 'red');
    assert.ok(resumed.time >= 0 && resumed.time < 2.5);
    assert.equal(fresh.state.journey.length, 1);
});

test('upcoming scenes list the default choice first for preloading', () => {
    const engine = Story.createEngine(twoDoors());
    engine.start();
    assert.deepEqual(engine.upcomingScenes(), ['garden', 'red']);
});

test('story check: a finished story is ready and counts its endings', () => {
    const result = Story.analyzeStory(twoDoors());
    assert.equal(result.ready, true);
    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 0);
    assert.equal(result.stats.endings, 2);
    assert.equal(result.stats.choices, 2);
});

test('story check: flags missing start, dead ends, unfinished choices and loops', () => {
    assert.equal(Story.analyzeStory({ scenes: [] }).issues[0].code, 'no-scenes');
    const noStart = Story.analyzeStory({ scenes: [{ id: 'a', name: 'A', src: 'a', duration: 2 }] });
    assert.ok(noStart.issues.some(issue => issue.code === 'no-start'));
    assert.equal(noStart.ready, false);

    const messy = Story.analyzeStory({
        startSceneId: 'a',
        scenes: [
            { id: 'a', name: 'A', src: 'a', duration: 5 },
            { id: 'b', name: 'B', src: 'b', duration: 5 },
            { id: 'c', name: 'C', src: 'c', duration: 5, next: 'd' },
            { id: 'd', name: 'D', src: 'd', duration: 5, next: 'c' },
            { id: 'lonely', name: 'Lonely', src: 'l', duration: 5, ending: { title: 'x' } }
        ],
        choicePoints: [{ id: 'p', sceneId: 'a', time: 4, choices: [{ id: '1', label: 'To B', to: 'b' }, { id: '2', label: '', to: null }, { id: '3', label: 'Loop', to: 'c' }] }]
    });
    const codes = messy.issues.map(issue => issue.code);
    assert.ok(codes.includes('dead-end'), 'B ends the movie without being an ending');
    assert.ok(codes.includes('no-target'), 'the empty choice goes nowhere');
    assert.ok(codes.includes('no-label'), 'the empty choice has no text');
    assert.ok(codes.includes('loop'), 'C and D continue into each other forever');
    assert.ok(codes.includes('unreachable'), 'Lonely is not connected');
    assert.equal(messy.ready, false);
});

test('story check: a menu where every choice comes back is a trap, and unset flags are caught', () => {
    const result = Story.analyzeStory({
        startSceneId: 'menu',
        scenes: [{ id: 'menu', name: 'Menu', src: 'm', duration: 4 }, { id: 'a', name: 'A', src: 'a', duration: 2 }],
        choicePoints: [{ id: 'p', sceneId: 'menu', time: 3.8, choices: [{ id: 'x', label: 'A', to: 'a', returnHere: true, requireFlag: 'ghost' }] }]
    });
    const codes = result.issues.map(issue => issue.code);
    assert.ok(codes.includes('menu-trap'));
    assert.ok(codes.includes('flag-never-set'));
});

test('normalizeStory drops broken references instead of throwing', () => {
    const story = Story.normalizeStory({
        startSceneId: 'missing',
        scenes: [{ id: 'a', name: 'A', src: 'a.mp4', duration: 3, next: 'ghost' }, { id: 'a', name: 'Duplicate', src: 'dup.mp4' }],
        choicePoints: [{ id: 'p', sceneId: 'ghost', time: 1, choices: [] }, { id: 'q', sceneId: 'a', time: 1, choices: [{ label: 'Nowhere', to: 'ghost' }] }],
        themeColor: 'red; background: url(x)'
    });
    assert.equal(story.scenes.length, 1);
    assert.equal(story.scenes[0].next, null);
    assert.equal(story.startSceneId, null);
    assert.equal(story.choicePoints.length, 1);
    assert.equal(story.choicePoints[0].choices[0].incomplete, true);
    assert.equal(story.themeColor, '#3b82f6');
});
