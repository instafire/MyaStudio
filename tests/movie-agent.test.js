const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildFallbackMoviePlan,
    buildMovieAgentPrompt,
    normalizeMoviePlan
} = require('../lib/movie-agent');

function makeClip(index, overrides = {}) {
    return {
        unique_id: `clip-${index}`,
        name: `Scene ${index}`,
        filepath: `/clips/clip-${index}.mp4`,
        thumbnail: `/thumbnails/clip-${index}.jpg`,
        duration: 8 + index,
        source_video_id: index % 3,
        is_event_clip: 0,
        tags: '',
        notes: '',
        ...overrides
    };
}

const project = {
    id: 4,
    title: 'Agent Test',
    genre: 'Mystery',
    synopsis: 'A viewer shapes the outcome.'
};

test('offline movie agent creates return branches and alternate endings from real clips', () => {
    const clips = [
        makeClip(1, { name: 'FULL: main-story.mp4', duration: 100 }),
        ...Array.from({ length: 8 }, (_, index) => makeClip(index + 2))
    ];
    const plan = buildFallbackMoviePlan({
        project,
        clips,
        videos: [{ id: 1 }, { id: 2 }, { id: 3 }],
        premise: 'A mystery changes with every decision.',
        genre: 'Mystery',
        tone: 'cinematic',
        targetScenes: 7
    });

    assert.equal(plan.startClipId, 'clip-1');
    assert.equal(plan.scenes.length, 7);
    assert.equal(plan.decisions.length, 3);
    assert.equal(plan.decisions[0].choices.length, 2);
    assert.ok(plan.decisions[0].choices.every(choice => choice.returnToMain));
    assert.ok(plan.decisions[1].choices.every(choice => choice.returnToMain));
    assert.ok(plan.decisions[2].choices.every(choice => !choice.returnToMain));
    assert.deepEqual(
        plan.decisions[2].choices.map(choice => choice.label),
        ['Choose the quiet ending', 'Choose the bold ending']
    );
    assert.ok(plan.decisions.flatMap(decision => decision.choices).every(choice => !/Scene \d/.test(choice.label)));
    assert.equal(plan.analysis.endings, 2);
    assert.equal(new Set(plan.scenes.map(scene => scene.clipId)).size, plan.scenes.length);
});

test('offline movie agent keeps an even request playable by selecting an odd scene count', () => {
    const clips = [
        makeClip(1, { name: 'FULL: main.mp4', duration: 60 }),
        ...Array.from({ length: 8 }, (_, index) => makeClip(index + 2))
    ];
    const plan = buildFallbackMoviePlan({ project, clips, videos: [], targetScenes: 8 });

    assert.equal(plan.scenes.length, 7);
    assert.ok(plan.scenes.every(scene => plan.decisions.some(decision =>
        decision.fromClipId === scene.clipId || decision.choices.some(choice => choice.toClipId === scene.clipId)
    )));
});

test('movie agent prompt inventories every supplied clip and forbids invented IDs', () => {
    const clips = [makeClip(1), makeClip(2), makeClip(3)];
    const prompt = buildMovieAgentPrompt({ project, clips, videos: [{ id: 1 }], targetScenes: 3 });

    clips.forEach(clip => assert.match(prompt, new RegExp(clip.unique_id)));
    assert.match(prompt, /Never invent IDs/);
    assert.match(prompt, /returnToMain=true/);
});

test('movie agent rejects plans that reference clips outside the project', () => {
    const clips = [makeClip(1), makeClip(2), makeClip(3)];
    const plan = normalizeMoviePlan({
        title: 'Invalid',
        startClipId: 'invented-id',
        scenes: clips.map(clip => ({ clipId: clip.unique_id, role: 'branch' })),
        decisions: []
    }, { project, clips, videos: [] });

    assert.equal(plan, null);
});
