// Help: how interactive movies work in MyaStudio, plus keyboard shortcuts.
import { store } from '../store.js';

export const HelpModal = {
    name: 'HelpModal',
    setup() {
        const close = () => { store.helpOpen = false; };
        return { close };
    },
    template: `
    <modal title="How MyaStudio works" size="lg" @close="close">
        <div class="help-diagram" aria-hidden="true">
            <div class="box">Scene<small>a piece of video</small></div>
            <div class="arrow">→</div>
            <div class="box">Choices<small>buttons viewers press</small></div>
            <div class="arrow">→</div>
            <div class="box">Next scene<small>or an ending</small></div>
        </div>
        <div class="help-terms">
            <div><b>Media</b><span>The videos (and music) you upload. Nothing leaves your computer until you publish.</span></div>
            <div><b>Scene</b><span>A part of a video, cut in the cutter. Each scene is a card on the story map.</span></div>
            <div><b>Start scene</b><span>Where the movie begins. The first scene you cut becomes the start automatically.</span></div>
            <div><b>Choices</b><span>Buttons that appear near the end of a scene. Each one leads to another scene, or ends the movie. Add a countdown and a default pick, Netflix style.</span></div>
            <div><b>Continue</b><span>The scene flows straight into another one, with no choice. Good for joining paths back together.</span></div>
            <div><b>Ending</b><span>A scene that finishes the movie. Name your endings; viewers see how many they've found.</span></div>
            <div><b>Come back here</b><span>A choice that takes a short detour, then returns to the scene it came from.</span></div>
            <div><b>Remember / Only if</b><span>Choices can remember a flag ("has_key"), and later choices can show only if that flag is set (or not set, with "!has_key").</span></div>
        </div>
        <div class="publish-grid" style="gap: 16px">
            <div class="stack">
                <h3 class="section-title" style="margin:0">Story map</h3>
                <div class="shortcut-list">
                    <span class="kbd">Drag card</span><span>Move a scene</span>
                    <span class="kbd">Drag dot</span><span>Connect a choice to a scene</span>
                    <span class="kbd">Scroll</span><span>Pan around</span>
                    <span class="kbd">Ctrl + scroll</span><span>Zoom</span>
                    <span class="kbd">Delete</span><span>Delete the selected scene</span>
                    <span class="kbd">Esc</span><span>Deselect</span>
                    <span class="kbd">Ctrl + Enter</span><span>Preview</span>
                    <span class="kbd">?</span><span>This help</span>
                </div>
            </div>
            <div class="stack">
                <h3 class="section-title" style="margin:0">Cutter and player</h3>
                <div class="shortcut-list">
                    <span class="kbd">Space</span><span>Play / pause</span>
                    <span class="kbd">I / O</span><span>Set scene start / end</span>
                    <span class="kbd">← →</span><span>Move 1s (Shift: 5s)</span>
                    <span class="kbd">, .</span><span>Move one frame</span>
                    <span class="kbd">1 – 9</span><span>Pick a choice while watching</span>
                    <span class="kbd">B</span><span>Back to the previous choice</span>
                </div>
            </div>
        </div>
        <p class="hint">Looking for GIF export, batch tools or the AI story agent? They're still in the <a href="/classic.html">classic editor</a>, which works on the same projects.</p>
    </modal>`
};
