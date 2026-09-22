const MAX_AGENT_SCENES = 12;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || min));
}

function cleanText(value, maxLength = 120) {
    return String(value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function humanizeClipName(value) {
    const cleaned = cleanText(value, 80)
        .replace(/^FULL:\s*/i, '')
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return 'Untitled scene';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function clipDuration(clip) {
    const value = Number(clip && clip.duration);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function clipStoryScore(clip) {
    const duration = clipDuration(clip);
    const isFull = /^FULL:/i.test(String(clip && clip.name || ''));
    const hasNotes = cleanText(clip && clip.notes, 400).length > 0;
    const hasTags = cleanText(clip && clip.tags, 200).length > 0;
    const usefulLength = duration >= 1 && duration <= 45;
    return (isFull ? -30 : 0)
        + (clip && Number(clip.is_event_clip) === 1 ? 5 : 0)
        + (hasNotes ? 8 : 0)
        + (hasTags ? 6 : 0)
        + (usefulLength ? 12 : 0)
        + Math.min(duration, 30) / 10;
}

function pickStartClip(clips) {
    const fullClips = clips.filter(clip => /^FULL:/i.test(String(clip.name || '')));
    const candidates = fullClips.length ? fullClips : clips;
    return [...candidates].sort((a, b) => clipDuration(b) - clipDuration(a))[0] || null;
}

function pickDiverseClips(clips, count, excludedIds = []) {
    const excluded = new Set(excludedIds);
    const candidates = clips
        .filter(clip => clip && clip.unique_id && !excluded.has(clip.unique_id))
        .sort((a, b) => clipStoryScore(b) - clipStoryScore(a));
    const bySource = new Map();
    candidates.forEach(clip => {
        const key = clip.source_video_id == null ? 'unassigned' : String(clip.source_video_id);
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(clip);
    });

    const selected = [];
    const groups = [...bySource.values()];
    while (selected.length < count && groups.some(group => group.length > 0)) {
        for (const group of groups) {
            if (selected.length >= count) break;
            const clip = group.shift();
            if (clip) selected.push(clip);
        }
    }
    return selected;
}

function makeScene(clip, role, summary) {
    return {
        clipId: clip.unique_id,
        name: humanizeClipName(clip.name),
        role,
        summary: cleanText(summary, 180),
        sourceVideoId: clip.source_video_id == null ? null : clip.source_video_id,
        duration: clipDuration(clip)
    };
}

function makeChoice(clip, label, returnToMain, setVar) {
    return {
        toClipId: clip.unique_id,
        label: cleanText(label, 72),
        returnToMain: !!returnToMain,
        setVar: cleanText(setVar, 48).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
        reqVar: '',
        actionType: 'target'
    };
}

function buildFallbackStoryLanguage({ project, premise, genre, tone }) {
    const storyGenre = cleanText(genre || project.genre || 'Interactive story', 48) || 'Interactive story';
    const storyTone = cleanText(tone || 'cinematic', 32) || 'cinematic';
    const storyPremise = cleanText(
        premise || project.synopsis || `A ${storyTone} interactive story assembled from the uploaded footage in ${project.title}.`,
        280
    );
    const storySignals = `${storyGenre} ${storyTone} ${storyPremise}`.toLowerCase();
    let title = `${project.title}: Choose the Outcome`;
    if (/romance|romantic|lover|intimate|date|desire/.test(storySignals)) title = 'A Night of Choices';
    else if (/horror|terror|haunt|fear/.test(storySignals)) title = 'No Way Back';
    else if (/thriller|mystery|crime|danger/.test(storySignals)) title = 'The Turning Point';
    else if (/comedy|comic|funny/.test(storySignals)) title = 'A Matter of Timing';

    return {
        title: cleanText(title, 80),
        genre: storyGenre,
        tone: storyTone,
        premise: storyPremise,
        decisions: [
            {
                prompt: 'Which path should the story take?',
                labels: ['Take the careful path', 'Follow the unexpected lead'],
                summaries: [
                    'A measured detour deepens the connection before the central story resumes.',
                    'An unexpected turn changes the mood before returning to the central story.'
                ]
            },
            {
                prompt: 'What should happen next?',
                labels: ['Hold onto the moment', 'Raise the stakes'],
                summaries: [
                    'The characters stay with the moment, then rejoin the main timeline.',
                    'A bolder choice raises the stakes before the main timeline continues.'
                ]
            }
        ],
        endingPrompt: 'How should the story end?',
        endingLabels: ['Choose the quiet ending', 'Choose the bold ending'],
        endingSummaries: [
            'A restrained final beat resolves the story on a quieter note.',
            'A decisive final beat delivers the story\'s boldest outcome.'
        ]
    };
}

function buildFallbackMoviePlan({ project, clips, videos, premise, genre, tone, targetScenes = 7 }) {
    const usableClips = (clips || []).filter(clip => clip && clip.unique_id && clip.filepath);
    if (usableClips.length < 3) {
        const error = new Error('The movie agent needs at least 3 usable clips to create viewer choices.');
        error.statusCode = 400;
        throw error;
    }

    const requestedCount = Math.round(clamp(targetScenes, 3, MAX_AGENT_SCENES));
    const availableCount = Math.min(requestedCount, usableClips.length);
    const sceneCount = availableCount > 3 && availableCount % 2 === 0 ? availableCount - 1 : availableCount;
    const startClip = pickStartClip(usableClips);
    const supporting = pickDiverseClips(usableClips, sceneCount - 1, [startClip.unique_id]);
    const endings = supporting.slice(-2);
    const branches = supporting.slice(0, Math.max(0, supporting.length - endings.length));
    const story = buildFallbackStoryLanguage({ project, premise, genre, tone });
    const scenes = [
        makeScene(startClip, 'main', `Opening and continuous main story: ${story.premise}`)
    ];
    branches.forEach((clip, index) => {
        const language = story.decisions[Math.floor(index / 2)] || story.decisions[story.decisions.length - 1];
        scenes.push(makeScene(clip, 'branch', language.summaries[index % 2]));
    });
    endings.forEach((clip, index) => {
        scenes.push(makeScene(clip, 'ending', story.endingSummaries[index]));
    });

    const decisions = [];
    const branchGroups = [];
    for (let index = 0; index < branches.length; index += 2) {
        const group = branches.slice(index, index + 2);
        if (group.length === 2) branchGroups.push(group);
    }
    branchGroups.slice(0, 2).forEach((group, index) => {
        const language = story.decisions[index];
        decisions.push({
            fromClipId: startClip.unique_id,
            prompt: language.prompt,
            triggerRatio: index === 0 ? 0.24 : 0.52,
            choices: group.map((clip, choiceIndex) => makeChoice(
                clip,
                language.labels[choiceIndex],
                true,
                `decision_${index + 1}_${choiceIndex + 1}`
            ))
        });
    });

    decisions.push({
        fromClipId: startClip.unique_id,
        prompt: story.endingPrompt,
        triggerRatio: decisions.length > 1 ? 0.82 : 0.68,
        choices: endings.map((clip, index) => makeChoice(
            clip,
            story.endingLabels[index],
            false,
            `ending_${index + 1}`
        ))
    });

    return {
        version: 1,
        title: story.title,
        synopsis: story.premise,
        genre: story.genre,
        tone: story.tone,
        startClipId: startClip.unique_id,
        scenes,
        decisions,
        analysis: {
            sourceVideosScanned: (videos || []).length,
            clipsScanned: usableClips.length,
            selectedScenes: scenes.length,
            decisionMoments: decisions.length,
            returnBranches: decisions.slice(0, -1).reduce((total, decision) => total + decision.choices.length, 0),
            endings: endings.length
        }
    };
}

function buildMovieAgentPrompt({ project, clips, videos, premise, genre, tone, targetScenes }) {
    const catalog = clips.map((clip, index) => {
        const notes = cleanText(clip.notes, 140);
        const tags = cleanText(clip.tags, 80);
        return [
            `${index + 1}. id=${clip.unique_id}`,
            `name=${JSON.stringify(humanizeClipName(clip.name))}`,
            `duration=${clipDuration(clip).toFixed(2)}s`,
            `source=${clip.source_video_id == null ? 'none' : clip.source_video_id}`,
            `type=${Number(clip.is_event_clip) === 1 ? 'choice-scene' : (/^FULL:/i.test(String(clip.name || '')) ? 'full-source' : 'clip')}`,
            tags ? `tags=${JSON.stringify(tags)}` : '',
            notes ? `notes=${JSON.stringify(notes)}` : ''
        ].filter(Boolean).join(' | ');
    }).join('\n');

    return `Create a playable interactive movie plan using only the supplied clip IDs.
Project: ${cleanText(project.title, 80)}
Premise: ${cleanText(premise || project.synopsis || 'Infer a coherent story from the media catalog.', 280)}
Genre: ${cleanText(genre || project.genre || 'Interactive story', 48)}
Tone: ${cleanText(tone || 'cinematic', 32)}
Target selected scenes: ${Math.round(clamp(targetScenes, 3, MAX_AGENT_SCENES))}
Uploaded source videos scanned: ${(videos || []).length}
Usable clips scanned: ${clips.length}

Rules:
1. Use one long or full-source clip as startClipId and the continuous main story when possible.
2. Create 2 or 3 decision moments on the main story.
3. Early choices should set returnToMain=true so the selected branch plays and the main story resumes.
4. The final decision must offer at least 2 ending clips with returnToMain=false.
5. Use only exact clip IDs from the catalog. Never invent IDs.
6. Keep choice labels short, concrete, and distinct.
7. Return JSON only with this shape:
{
  "title": "...",
  "synopsis": "...",
  "genre": "...",
  "tone": "...",
  "startClipId": "clip-id",
  "scenes": [{ "clipId": "clip-id", "role": "main|branch|ending", "summary": "..." }],
  "decisions": [{
    "fromClipId": "clip-id",
    "prompt": "...",
    "triggerRatio": 0.25,
    "choices": [{
      "toClipId": "clip-id",
      "label": "...",
      "returnToMain": true,
      "setVar": "path_name",
      "reqVar": "",
      "actionType": "target"
    }]
  }]
}

Media catalog:
${catalog}`;
}

function normalizeMoviePlan(rawPlan, context) {
    if (!rawPlan || typeof rawPlan !== 'object') return null;
    const clips = context.clips || [];
    const clipMap = new Map(clips.map(clip => [clip.unique_id, clip]));
    const startClipId = cleanText(rawPlan.startClipId, 100);
    if (!clipMap.has(startClipId)) return null;

    const scenes = [];
    const sceneIds = new Set();
    const rawScenes = Array.isArray(rawPlan.scenes) ? rawPlan.scenes : [];
    rawScenes.slice(0, MAX_AGENT_SCENES).forEach(scene => {
        const clipId = cleanText(scene && scene.clipId, 100);
        if (!clipMap.has(clipId) || sceneIds.has(clipId)) return;
        const clip = clipMap.get(clipId);
        const role = ['main', 'branch', 'ending'].includes(scene.role) ? scene.role : 'branch';
        scenes.push(makeScene(clip, role, scene.summary || 'Selected by the movie agent.'));
        sceneIds.add(clipId);
    });
    if (!sceneIds.has(startClipId)) {
        scenes.unshift(makeScene(clipMap.get(startClipId), 'main', 'The continuous main story.'));
        sceneIds.add(startClipId);
    }
    if (scenes.length < 3) return null;

    const decisions = [];
    const rawDecisions = Array.isArray(rawPlan.decisions) ? rawPlan.decisions : [];
    rawDecisions.slice(0, 4).forEach((decision, decisionIndex) => {
        const fromClipId = cleanText(decision && decision.fromClipId, 100);
        if (!clipMap.has(fromClipId)) return;
        const choices = [];
        const rawChoices = Array.isArray(decision.choices) ? decision.choices : [];
        rawChoices.slice(0, 4).forEach((choice, choiceIndex) => {
            const toClipId = cleanText(choice && choice.toClipId, 100);
            if (!clipMap.has(toClipId) || toClipId === fromClipId) return;
            const actionType = ['target', 'next', 'end'].includes(choice.actionType) ? choice.actionType : 'target';
            choices.push({
                toClipId,
                label: cleanText(choice.label || `Choice ${choiceIndex + 1}`, 72) || `Choice ${choiceIndex + 1}`,
                returnToMain: actionType === 'target' && !!choice.returnToMain,
                setVar: cleanText(choice.setVar, 48).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
                reqVar: cleanText(choice.reqVar, 48).replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
                actionType
            });
            if (!sceneIds.has(toClipId) && scenes.length < MAX_AGENT_SCENES) {
                const role = choice.returnToMain ? 'branch' : 'ending';
                scenes.push(makeScene(clipMap.get(toClipId), role, 'Selected by the movie agent.'));
                sceneIds.add(toClipId);
            }
        });
        if (choices.length >= 2) {
            decisions.push({
                fromClipId,
                prompt: cleanText(decision.prompt || `Decision ${decisionIndex + 1}`, 100),
                triggerRatio: clamp(decision.triggerRatio, 0.12, 0.9),
                choices
            });
        }
    });
    if (!decisions.length || !decisions.some(decision => decision.choices.some(choice => !choice.returnToMain))) return null;

    return {
        version: 1,
        title: cleanText(rawPlan.title || `${context.project.title}: Interactive Cut`, 80),
        synopsis: cleanText(rawPlan.synopsis || context.project.synopsis, 280),
        genre: cleanText(rawPlan.genre || context.project.genre || 'Interactive story', 48),
        tone: cleanText(rawPlan.tone || context.tone || 'cinematic', 32),
        startClipId,
        scenes,
        decisions,
        analysis: {
            sourceVideosScanned: (context.videos || []).length,
            clipsScanned: clips.length,
            selectedScenes: scenes.length,
            decisionMoments: decisions.length,
            returnBranches: decisions.reduce((total, decision) => total + decision.choices.filter(choice => choice.returnToMain).length, 0),
            endings: decisions.reduce((total, decision) => total + decision.choices.filter(choice => !choice.returnToMain).length, 0)
        }
    };
}

module.exports = {
    MAX_AGENT_SCENES,
    buildFallbackMoviePlan,
    buildMovieAgentPrompt,
    humanizeClipName,
    normalizeMoviePlan
};
