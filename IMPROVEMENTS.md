# Improvements & Bug Report

Generated from code review. Organized by priority for future implementation.

---

## Critical Bugs

### 1. `setTimeout` Race Condition in Published Player `loadClip`

- **File**: `lib/published-player.js` lines 488-524
- **Problem**: `loadClip` uses `setTimeout(() => { ... }, 220)`. If called rapidly (user clicks choices quickly, or `onClipEnded` fires near a choice trigger), previous timeout is never cleared. Each call creates a new timeout without cancelling the old one.
- **Impact**: Player loads wrong clip, skips clips, or shows one clip while video element plays another.
- **Fix**: Store timeout ID, clear before setting new:
  ```js
  if (this._loadTimeout) clearTimeout(this._loadTimeout);
  this._loadTimeout = setTimeout(() => { ... }, 220);
  ```

### 2. Dead Analytics API Call in Published Player

- **File**: `lib/published-player.js` lines 615-619
- **Problem**: Published player fires `POST /api/analytics/track` on every choice. When opened standalone (from export, different server, local file), this API call always fails. `.catch(() => {})` swallows the error silently.
- **Impact**: Analytics tracking for published movies provides zero data.
- **Fix**: Store events in localStorage and batch-submit, or make endpoint configurable from publish build step.

---

## High Severity

### 3. `.toFixed(1)` on Null Duration

- **File**: `public/index.html` lines 1112, 1250
- **Problem**: `{{ c.duration.toFixed(1) }}` — if `c.duration` is `null`/`undefined`, this throws `TypeError` and crashes Vue render.
- **Impact**: Clip list renders crash for clips with missing duration data.
- **Fix**: `{{ (c.duration || 0).toFixed(1) }}s`

### 4. `ffprobeStatic.path` May Be Undefined

- **File**: `server.js` line 33
- **Problem**: `ffprobe-static` npm package exports differ across versions — some export path as string directly, others as `{ path: '...' }`.
- **Impact**: `ffmpeg.setFfprobePath(undefined)` silently fails or causes ffprobe operations to error.
- **Fix**:
  ```js
  const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path;
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
  ```

### 5. `v-if` + `v-for` on Same Element

- **File**: `public/index.html` line 1486
- **Problem**: `<option v-for="clip in fullGraphNodes" :value="clip.unique_id" v-if="clip.unique_id !== selectedBuilderNodeId">` — Vue 3 warns about this anti-pattern.
- **Impact**: Unpredictable behavior in edge cases.
- **Fix**: Use computed filter + `<template v-for>` wrapper.

---

## Medium Severity

### 6. Clipboard Write Without Error Handling

- **File**: `public/index.html` line 3107
- **Problem**: `navigator.clipboard.writeText(text)` returns a promise that rejects on HTTPS failure or permission denial. Toast always shows "Copied!" even on failure.
- **Fix**: Make async, try/catch, fallback to `document.execCommand('copy')`.

### 7. Toast Timer on Unmounted Component

- **File**: `public/index.html` line 2378
- **Problem**: `setTimeout(() => this.toast.show = false, 3000)` — if component unmounts within 3 seconds, `this` is destroyed. Memory leak + Vue warning.
- **Fix**: Store timer ID, clear in `beforeUnmount`.

### 8. All Choices Locked = Viewer Stuck

- **File**: `lib/published-player.js` lines 581-586
- **Problem**: When all choices require unset variables (`unlocked.length === 0`), the choice panel shows with every option greyed out. User cannot proceed.
- **Fix**: When `unlocked.length === 0`, don't show the choice panel — let the clip naturally end.

### 9. Timeout Auto-Advance Sets Sequence Index Backward

- **File**: `public/index.html` lines 3549-3556
- **Problem**: `previewPlaylistIndex` is recalculated for timeout targets. If target is earlier in sequence, index goes backward. When `onPreviewEnded` fires, it increments past the target.
- **Fix**: When `timeout_to_id` is set, don't recalculate playlist index — use `loadPreviewClip` directly.

### 10. Redundant Migrations

- **File**: `server.js` lines 80-108
- **Problem**: ALTER TABLE migrations exist for columns already defined in CREATE TABLE statements. They silently fail on every startup (caught by try/catch).
- **Impact**: Cluttered startup, maintenance trap for future developers.
- **Fix**: Remove redundant ALTER TABLE statements from the migration array.

### 11. Preview Engine `v.play()` Without `.catch()`

- **File**: `public/index.html` line 3520
- **Problem**: `v.play()` in `loadPreviewClip` has no `.catch()`. Browsers commonly block autoplay — the rejection is unhandled.
- **Impact**: Silent black screen in preview when autoplay is blocked.
- **Fix**: Add `.catch(() => { this.isLoading = false; this.awaitingInteraction = true; })`.

### 12. `editEvent` Sets Wrong `videoUrl`

- **File**: `public/index.html` line 3070
- **Problem**: Editing an event sets `videoUrl` to the event clip's filepath, but `clipStart`/`clipEnd` keep their old values. Timeline markers don't match the clip range.
- **Fix**: Set `clipStart = 0; clipEnd = c.duration` in edit mode.

---

## Low Severity

### 13. CSS Class Duplication

- **File**: `public/index.html` lines 285, 524
- **Problem**: `.choice-card-overlay` defined twice — second override depends on CSS source order.
- **Fix**: Use modifier class `.choice-card-overlay.is-preview`.

### 14. Unused `returnToMain` Field

- **File**: `public/index.html` line 3400
- **Problem**: `saveLogicBlock` sends `returnToMain` in request body, server never uses it (return is per-choice, not per-block).
- **Fix**: Remove from request body.

### 15. `testEventClip` Uses Stale Edges

- **File**: `public/index.html` line 3113
- **Problem**: Playtesting an event after editing uses cached `this.edges` — new choices not reflected until `refreshData` completes.
- **Fix**: Add `await this.$nextTick()` before filtering.

### 16. Return Time Can Exceed Clip Duration

- **File**: `lib/published-player.js` lines 632-638
- **Problem**: `time + 0.1` can exceed clip duration for late trigger points. Browser clamps to duration → clip immediately ends → potential infinite loop.
- **Fix**: `Math.min(time + 0.1, duration - 0.1)`.

### 17. `confirm()`/`alert()` Block Event Loop

- **File**: `public/index.html` — 8 locations
- **Problem**: Synchronous dialog APIs block JS event loop. Inconsistent with app's toast-based UX.
- **Fix**: Replace with `showToast()` / custom modal dialog.

---

## Previously Implemented Features

### Phase 1 Features (deployed)
- Keyboard shortcuts (B/L/P/1-8/Ctrl+Z/Ctrl+S)
- Zoom-to-fit in Builder
- SVG edge labels on graph (builder + logic modes)
- Play from here everywhere (Library + Logic views)
- Progress indicator for ffmpeg ops (spinner overlay)
- Choice thumbnail override (per-edge custom thumbnail)
- Timeout-to-next logic (auto-advance after N seconds)

### Bug Fixes (already applied)
- Preview engine `previewIsPlayingSubClip` state leak
- Drag uses `clip.unique_id` instead of `clip.id`
- Logic graph displays `next`/`end` action edges
- Logic test nested return overwrites `onended`
- Ctrl+S optimistic toast (now awaits saves)
- Published player timeout loop (`_timeoutFired` flag)
- Preview engine timeout loop (`_previewTimeoutFired` flag)

### Second Round Features (deployed)
- Auto-select single choice (published player + preview engine)
- Loading indicator between clips (published player spinner)
- Frame-accurate seek (`[`/`]` keys + buttons in clipper)
- Clip re-encoding (filter/speed/volume without re-cutting source)
- Project export/import (JSON dump + restore)

---

*Generated from comprehensive code review of `index.html`, `server.js`, `lib/published-player.js`. All findings verified against actual source code.*
