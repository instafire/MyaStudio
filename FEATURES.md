# Mya Studio — Complete Feature Specification

This document catalogs every feature of the current Mya Studio application in full detail. Use this as the source of truth when rebuilding — every feature listed here must be present in the new version, or intentionally replaced with something better.

---

## 1. Project Management

### 1.1 Project CRUD
- **Create**: Click "+ New project" button → prompt for title → creates project with default theme color `#3b82f6` (or `#d97706` in the redesign), genre "Interactive story", empty synopsis
- **Rename**: Click "Rename" on project card → prompt for new title → updates in DB
- **Delete**: Click "Delete" → confirm dialog → removes project, all videos, clips, edges, analytics, and orphaned media files from disk
- **Duplicate**: Click "Duplicate" → creates a copy with "(Copy)" or "(Copy N)" appended to title → clones all videos (with new IDs), clips (with new unique_ids), edges (with remapped IDs), and start_clip_id

### 1.2 Project Settings
- **Theme color**: Color picker input → stored in DB → used as accent color in published player
- **Genre**: Text input (max 48 chars) → shown in feed card metadata
- **Synopsis**: Textarea (max 280 chars) → shown in feed card description
- **Start clip**: Set which clip plays first when the movie starts → fallback for publish if no opening sequence defined

### 1.3 Project List View
- Grid of project cards (responsive: 1 col mobile, 2 col tablet, 3 col desktop)
- Each card shows: title, creation date, hover-revealed action buttons (Export, Duplicate, Rename, Delete)
- Click card → loads the project and navigates to the upload view

### 1.4 Project Import/Export
- **Export**: Downloads a JSON file containing: project settings, all videos, all clips, all edges
- **Import**: File picker for `.json` → validates structure → creates new project with imported data → remaps all IDs to avoid conflicts

---

## 2. Media Upload

### 2.1 Video Upload
- File picker accepts `video/*` MIME types
- 800 MB file size limit (configured in multer)
- On upload:
  1. File saved to `public/videos/{timestamp}.{ext}`
  2. ffprobe probes duration
  3. ffmpeg generates thumbnail at 20% timestamp (640×360, JPEG)
  4. Video record inserted into DB
  5. "FULL" source clip auto-created (references the entire video, builder_visible=1)
- Upload progress: spinner overlay during processing

### 2.2 Audio Upload
- File picker accepts `audio/*` MIME types
- Saved to `public/audio/{timestamp}.{ext}`
- No ffprobe or thumbnail needed
- Listed in audio dropdowns throughout the app

### 2.3 Video Management
- Source selector dropdown in Clip Editor and Event Creator
- Shows: filename / duration
- "Remove" button → confirm → deletes video, all derived clips, all associated files (clips, thumbnails, bg_music)

---

## 3. Clip Editing

### 3.1 Clip Creation
- Source video selected → video plays in player with controls
- Set IN point: click "IN" button or press keyboard shortcut → marks start time from current playhead position
- Set OUT point: click "OUT" button → marks end time
- Timeline bar shows: playhead position, IN marker (blue), OUT marker (violet), highlighted region between IN/OUT
- Click on timeline bar → seeks player to that position
- Nudge buttons: `−` and `+` adjust IN/OUT by ±0.1 seconds
- Frame step buttons: `◀` and `▶` (or `[` / `]` keys) adjust by 1/30 second
- Scene name input required before creating
- "Create clip" button → POST to server → ffmpeg renders:
  - Trim: `-ss startTime -t duration`
  - Filter: `hue=s=0` (BW), `colorchannelmixer=...` (sepia), `eq=saturation=2` (vivid)
  - Speed: `setpts=1/speed*PTS` + `atempo=speed` (0.5x–2.0x)
  - Volume: `volume=value` (0.0–2.0)
  - Codec: libx264 + aac, preset ultrafast
  - Output: `public/clips/clip_{uuid}.mp4`
  - Thumbnail generated after render
  - Clip inserted into DB with start_time, end_time, duration (adjusted for speed), builder_visible=1, position (150,150)

### 3.2 Clip Duplication
- Click "Duplicate clip" in Library view
- Cannot duplicate FULL source clips
- Clips the clip's DB record with:
  - New unique_id (UUID)
  - Name appended "Alt" or "Alt N"
  - Position offset (+56, +56)
  - builder_visible = 1
  - All outgoing edges duplicated with remapped IDs

### 3.3 Clip Re-encoding
- Apply new filter, speed, or volume to an existing clip
- Uses the existing clip file as input (no source video needed)
- Replaces the clip file on disk
- Updates filepath, thumbnail, duration in DB
- Old file + old thumbnail cleaned up if unused

### 3.4 Clip Deletion
- Cannot delete FULL source clips directly (use "Remove" on the source video instead)
- Deleting a clip: removes DB record, cleans up references (edges, analytics, start_clip_id), removes orphaned asset files

### 3.5 Batch Operations
- **Select mode**: Toggle button in Library sidebar
- Checkboxes on each clip row
- Floating action bar shows count and batch buttons:
  - **Delete**: Removes all selected clips
  - **Rename**: Prompt for prefix + suffix → applied to clip names
  - **Re-encode**: Applies current filter/speed/volume settings to all selected clips (sequential ffmpeg processing)
  - **Mute**: Sets mute_audio=1 on all selected clips

### 3.6 Clip Properties
- **Name**: Editable inline in Library, saves via API
- **Thumbnail**: "Capture thumbnail" button → captures current player position as thumbnail
- **Duration**: Displayed in list views
- **Type badge**: "Event" for event clips, "Full" for source clips

---

## 4. Visual Graph Builder

### 4.1 Canvas
- Grid-patterned background for spatial reference
- **Pan**: Click and drag empty space on canvas
- **Zoom**: Scroll wheel or +/- buttons (range: 0.5x to 2.5x)
- **Reset**: Reset button → zooms to 1x, centers pan
- **Fit**: Fit button → auto-calculates zoom/pan to show all nodes
- Transform layer: CSS `translate` + `scale` with `will-change: transform` for GPU acceleration

### 4.2 Graph Nodes
- Each clip on the canvas becomes a node card:
  - Thumbnail image (or dark placeholder if none)
  - Play icon overlay centered on thumbnail
  - Clip name in footer
  - Badges: "Start" (green), "Dead end" (gold), "Loose" (default), "Event" (indigo), "Full" (emerald)
  - Connection counts: "N out / M in"
  - Width: 220px, height: 130px
- **Drag**: Click and drag node body to reposition
- **Select**: Click node → highlights border + opens inspector panel
- **Deselect**: Click selected node again or click empty canvas
- **Double-click**: Opens the clip in the Logic view
- **Connection handles**: Input handle (left edge, white), Output handle (right edge, blue with crosshair cursor)

### 4.3 Connection Lines
- SVG cubic bezier curves between output handle of source node to input handle of target node
- Dynamic path calculation based on node positions
- **Dragging connection**: Drag from output handle → rubber-band line follows mouse → release on target node
- Line styling: 3px stroke, blue `rgba(0,153,255,0.88)` with drop-shadow glow
- Return-path lines: dashed stroke, gold color
- Arrowhead markers at end of each line

### 4.4 Edge Labels on Graph
- SVG text elements at midpoint of each connection line
- Show choice label (or auto-fallback: "Choice", "Next scene", "End movie")
- Amber "Return" badge for return_to_main edges
- **Double-click label** → prompt to edit label text inline → saves via API
- Text has stroke halo for readability over any background

### 4.5 Builder Sidebars
- **Left sidebar (collapsible)**: Search input + two lists:
  - "On canvas" — clips currently visible in the graph, with "Remove" button per item
  - "Clip library" — clips NOT on canvas, with "+" add button
- **Right inspector (collapsible)**: When a node is selected:
  - Node name display + "Edit logic" button
  - Action buttons: "Set as start", "Clear start", "Open in library", "Play from here"
  - Mini video preview player
  - Preview buttons: "Preview current build", "Preview from selected"
  - Audio settings: bg_music dropdown, mute checkbox + "Save audio" button
  - Auto-advance: timeout seconds input + target clip selector
  - Edge editor: list of outgoing edges from selected node, each with:
    - Label input, color picker, action type selector
    - Target clip selector (for "target" actions)
    - Return-to-main checkbox
    - Set/Require variable inputs
    - Thumbnail override (preview + capture button)
    - Save and Delete buttons

### 4.6 Auto-Layout Algorithm
- BFS (Breadth-First Search) from start_clip_id
- Levels assigned by distance from root
- Nodes grouped by level → arranged in columns
- Each level spaced 360px apart horizontally, nodes within level 180px apart vertically

### 4.7 Node Position Persistence
- Positions saved via "Save layout" button or Ctrl+S
- Batch POST of all clip x/y coordinates
- Undo: Ctrl+Z restores previous position snapshot (up to 50 snapshots)

---

## 5. Edge (Choice) System

### 5.1 Edge Properties
Each edge (choice) stores:
- `from_id` — source clip unique_id
- `to_id` — target clip unique_id (null for "next" or "end" actions)
- `label` — choice text shown to viewer
- `text_color` — hex color for the choice label
- `trigger_time` — seconds into the clip when this choice appears
- `logic_id` — groups choices into blocks (same logic_id = same trigger moment)
- `return_to_main` — if true, push source clip to history stack before navigating
- `set_var` — variable key to set when this choice is taken
- `req_var` — variable key that must be set for this choice to be visible
- `action_type` — "target" (go to clip), "next" (next in sequence), "end" (end movie)
- `thumbnail` — optional custom thumbnail override

### 5.2 Edge Creation
- **Builder drag-connect**: Drag from output handle to target node
  - Auto-generates label from target clip name
  - Creates edge with default trigger_time (clip duration − 0.2s)
  - If edge with same from_id + logic_id + to_id exists → updates instead of duplicates
- **Builder quick connect**: Dropdown in inspector + "Add" button
- **Logic view**: Create choice blocks at specific timestamps

### 5.3 Action Types
1. **target** (Go to clip): Requires `to_id`. Navigates to specified clip. If `return_to_main` is true, saves current clip + time to history stack before navigating.
2. **next** (Go to next scene): Advances to the next clip in the opening sequence. No `to_id` needed.
3. **end** (End movie): Shows "End of Sequence" toast. No `to_id` needed.

### 5.4 Variable System
- **setVar**: When viewer makes this choice, `gameState[variableName] = true` is set
- **reqVar**: This choice is only clickable (unlocked) if `gameState[variableName] === true`
- Variables persist for the entire viewing session
- Used for: conditional story paths, key/door mechanics, tracking viewer choices

### 5.5 Edge Thumbnail Override
- Each edge can have a custom thumbnail URL
- Used as choice card artwork in the published player (instead of the target clip's thumbnail)
- Can be captured from the target clip at a specific timestamp
- Falls back to target clip's thumbnail if not set

---

## 6. Event Clips

### 6.1 Event Clip Creation
- Similar to regular clip creation but includes embedded choices
- Source video selector + IN/OUT trim + name input
- Choice editor: up to 4 choices per event, each with:
  - Color picker, label input
  - Action type selector (target/next/end)
  - Target clip selector (for target actions)
  - Return-to-main checkbox
  - Set variable, Require variable inputs
- Choices auto-placed at `triggerTime = duration − 0.2s` (near the end)
- Output: `public/clips/event_{uuid}.mp4`
- Marked `is_event_clip = 1` in DB

### 6.2 Event Clip Editing
- Click "Edit" on an event in the sidebar
- Loads existing event clip + its outgoing edges
- Can rename the clip and modify all choices
- Changes saved via `/api/update_event_logic` (replaces all edges)

### 6.3 Event Clip Playtesting
- Click "Playtest" → opens full-screen test player
- Video plays → when near the end, choice overlay appears
- Click choices → simulates navigation (including return-to-main)
- "Skip to return" button during sub-clip playback
- Close button returns to event editor

### 6.4 Event Clip in the Published Player
- When a viewer reaches the end of an event clip, choices appear
- If `return_to_main` is true, navigating to the chosen clip saves the event clip's position (time=0) to the history stack
- When the sub-clip ends, the player returns to the event clip at time 0 (start)

---

## 7. Timeline Logic

### 7.1 Logic View Layout
- **Toolbar**: Graph map button, Play from here button, scene selector dropdown, Edit/Live sim toggle
- **Audio bar**: BG music selector, upload button, mute checkbox, timeout seconds input, Save button
- **Video player**: Plays the selected clip
- **Timeline panel**: Zoom slider, timeline with choice block markers
- **Right sidebar**: List of choice moments + variable usage summary

### 7.2 Choice Blocks
- Block = one or more choices that appear at the same trigger time
- Placed on the timeline via "+ Choice at current time" button
- Each block shows trigger time and choice count
- Click a block to open the editor

### 7.3 Block Editor
- Trigger time display
- Choice cards (up to 4 per block), each with:
  - Color picker, label input
  - Action type selector
  - Target clip selector (with thumbnail preview)
  - Return checkbox
  - Set variable, Require variable inputs
- Add option button (up to 4)
- Save, Cancel, Delete block buttons

### 7.4 Test Mode (Live Sim)
- Toggle button switches between Edit and Live Sim modes
- In Live Sim: play the clip → choices fire at their trigger times → click to navigate
- Supports: return-to-main, sub-clip playback, Skip to return button
- Returns to the logic source clip when sub-clip ends

### 7.5 Graph Mode
- Tree visualization showing the selected clip and all its direct children
- Nodes connected by SVG bezier curves with arrow markers
- Edge labels shown on connections
- Double-click a child node to select it as the new logic source
- Auto-layout: root on left, children arranged rightward

### 7.6 Variable Usage Tracker
- Scans all edges for set_var and req_var values
- Displays a list in the sidebar showing each variable, how many times it's set, and how many times it's required
- Badges: "S" (set), "R" (required)

### 7.7 Auto-Advance / Timeout
- Configured per clip: seconds + target clip (or fallback to next in sequence)
- If the viewer doesn't make a choice within the timeout period, auto-navigate
- Target can be a specific clip (timeout_to_id) or next in sequence

---

## 8. Preview Engine

### 8.1 Studio Preview
- Full-screen overlay that plays the interactive movie
- Processes logic blocks dynamically from current edges
- Handles: target choices, next/end actions, return-to-main, variables (set/req)
- Choice cards show hover preview videos of the target clip
- Viewport size presets (Compact, Large, Cinema) and video fit modes (Fit, Fill, Stretch)
- Esc to close

### 8.2 Preview from Anywhere
- "Play from here" button in: Builder inspector, Library view, Logic view
- Starts preview from the selected clip (finds its index in the sequence)

### 8.3 Choice Hover Preview
- Hovering over a choice card plays a short preview of the target clip
- Preview starts at a calculated offset (8% into clip for source clips, 12% for others)
- All other preview videos pause when one starts
- Used in: Event playtest, Logic test mode, and the main Preview engine

---

## 9. Publishing

### 9.1 Interactive Export
- Generates a self-contained folder at `public/exports/{exportName}/`
- Folder contents:
  - `index.html` — standalone player (generated by `buildPublishedPlayerHtml`)
  - `manifest.json` — PWA manifest for offline support
  - `clips/` — copies of all video clips used in the movie
  - `audio/` — copies of background music files
  - `vendor/` — Vue.js runtime (`vue.global.prod.js`)

### 9.2 Publish Settings
- **Theme color**: Inherited from project settings, used as player accent
- **Movie title**: Editable before publishing
- **Genre + Synopsis**: From project settings, shown in feed
- **Opening sequence**: Ordered list of clips, drag-to-reorder (HTML5 drag and drop)
  - If empty → falls back to project's start_clip_id
  - If no start clip → publish is blocked with warning

### 9.3 Publish Warnings
- "Set a start clip or add scenes to the opening sequence" — if neither exists
- "N clip(s) are disconnected" — clips not reachable from any edge
- "N clip(s) end without outgoing choices" — dead-end detection

### 9.4 Published Player Features
- **Dark cinematic theme**: Warm near-black background, amber accent (customizable via theme_color)
- **Video player**: Autoplays through the sequence, fades between clips
- **Choice cards**: Appear at trigger points as overlay cards with:
  - Target clip thumbnail (or edge custom thumbnail)
  - Choice label styled with configured color
  - Locked state (greyed out + grayscale) if reqVar not satisfied
- **Variable tracking**: setVar/reqVar logic for conditional choices
- **Return-to-main**: History stack for sub-clip navigation
- **Background music**: Per-clip audio overlay
- **Save/Load**: localStorage saves current position, game state, and history
- **Loading spinner**: During clip transitions
- **Volume control**: Slider + mute button in bottom-right corner, persisted in localStorage
- **Auto-advance timeout**: If configured on clip, navigates after N seconds of inactivity

### 9.5 MP4 Linear Export
- Select a path through the story (at least 2 clips)
- Optional crossfade toggle
- Server concatenates clips using ffmpeg concat demuxer
- Output: `public/exports/linear_{projectId}_{timestamp}.mp4`
- Download link returned to browser

### 9.6 Export Management
- List of recent builds in Publish view
- Click link → opens published player
- Delete button → removes export folder + DB record

---

## 10. Interactive Feed (Port 3001)

### 10.1 Feed Display
- Vertical scroll-snap layout (one movie per viewport)
- Each slide shows:
  - Background: blurred poster image
  - Device frame with embedded iframe player (lazy loaded, only when ±1 slide away)
  - Movie title, genre, synopsis
  - Metrics: scenes, choices, runtime, views
  - Like button + like count
  - "Copy player link" button
  - "Open standalone player" link
  - "Jump back into studio" link
  - Published date + export name

### 10.2 Feed Auto-Refresh
- Polls `/api/feed/items` every 15 seconds
- Updates the movie list without full page reload
- Preserves current scroll position when items change

### 10.3 Engagement Tracking
- **View**: Tracks view per unique session (sessionStorage) + increments view_count
- **Like**: Toggles like state (localStorage) + increments/decrements like_count
- Engagement data sent to `/api/feed/engage`
- Metrics update in real-time on the current slide

### 10.4 Feed Navigation
- Mouse wheel scroll, touch swipe
- Up/Down arrow buttons
- Keyboard: ArrowUp/ArrowDown or J/K keys
- IntersectionObserver for active slide detection

---

## 11. Choice Analytics

### 11.1 Analytics Tracking
- Choice clicks tracked from published players via `POST /api/analytics/track`
- Stores: project_id, choice label, target clip ID, timestamp
- Tracked per-project

### 11.2 Analytics Dashboard
- Bar chart showing choice labels and their click counts
- Sorted by count descending
- Progress bar visualization relative to max count
- Color-coded by project theme color
- Refresh button
- Reset button (with confirmation)

---

## 12. Advanced Editor

### 12.1 View Structure
- Three-column layout: clip sidebar (collapsible, 12rem) | main area | properties panel (collapsible, 16rem)
- Top toolbar: Back button, source video selector, clip count, Save button
- Main area: preview player (top) + timeline (bottom)

### 12.2 Timeline
- Zoomable (100%–800%), scrollable
- Ruler with time labels at each second
- Clip blocks as colored rectangles with clip name labels
- Drag handles on left (IN) and right (OUT) edges for trimming
- Playhead: red vertical line, click to seek, drag to scrub
- Snap toggle: snaps clip edges to nearby clip boundaries and playhead position
- Waveform image generation via ffmpeg `showwavespic`
- Thumbnail strip loading via `/api/clip/thumbnails`

### 12.3 Properties Panel
- Clip name input
- Filter selector, speed slider, volume slider
- Action buttons: Duplicate, Open in Builder, Open in Logic

---

## 13. AI Assistant

### 13.1 AI Modal
- Accessible via "✨ AI" button in the global toolbar
- Three sections: AI Settings, Story Outline Generator, Variable Validation

### 13.2 AI Settings
- Provider selector: Local (Ollama) or OpenAI API
- For Ollama: host URL input, model selector (llama3.2:3b, llama3.2:1b, mistral)
- For OpenAI: API key input (password field), model selector (gpt-4o-mini, gpt-4o)
- Test button → verifies connection
- Save button → persists to `.ai-settings.json`

### 13.3 Story Outline Generator
- Premise input field
- Genre dropdown: Mystery, Thriller, Comedy, Romance, Sci-Fi, Horror, Educational
- Tone selector: Neutral, Light, Dark, Humorous
- Scene count: 3, 5, or 8
- Generate button → calls `/api/ai/generate`
- Result displays as formatted outline: scene names, descriptions, choices with setVar/reqVar

### 13.4 Variable Validation
- Scan button → calls `/api/ai/validate`
- Reports:
  - Set but never checked variables (amber warning)
  - Required but never set variables (red error)
  - AI-suggested new variables based on choice labels (green suggestion)

### 13.5 AI Provider Architecture
- `callAiProvider(prompt, settings)` function handles both Ollama and OpenAI
- Settings stored in `.ai-settings.json` at project root
- Auto-formats markdown code blocks from AI responses

---

## 14. UI/UX System

### 14.1 Design System
- **Dark warm theme**: Background `#0c0a09`, text `#faf5eb`, accent `#d97706` (amber)
- **Typography**: Figtree (headings), DM Sans (body), JetBrains Mono (labels)
- **Glass panels**: Semi-transparent dark surfaces with blur backdrop
- **Primary buttons**: White pill buttons with amber glow on hover
- **Secondary buttons**: Dark frosted pills with amber border on hover
- **Inputs**: Rounded dark controls with amber focus rings
- **Ambient effects**: Warm radial gradients, subtle grid overlay, film grain texture

### 14.2 Keyboard Shortcuts
| Keys | Action |
|---|---|
| `Esc` | Close preview/modal/overlay |
| `Space` | Play/pause video (in clipper, library, event creator) |
| `B` | Switch to Builder view |
| `L` | Switch to Logic view |
| `P` | Start Preview |
| `1`–`8` | Navigate to workflow views |
| `Ctrl+Z` / `Cmd+Z` | Undo last position change |
| `Ctrl+S` / `Cmd+S` | Save positions + audio settings |
| `[` | Frame step backward (1/30s) |
| `]` | Frame step forward (1/30s) |

### 14.3 Player Size Presets
- **Compact**: `min-height: clamp(13rem, 32vh, 24rem)`
- **Large**: `min-height: clamp(16rem, 46vh, 32rem)`
- **Cinema**: `min-height: clamp(19rem, 54vh, 40rem)`
Persisted in localStorage.

### 14.4 Video Fit Modes
- **Fit** (contain): Video maintains aspect ratio with letterboxing
- **Fill** (cover): Video fills container, may crop edges
- **Stretch** (fill): Video stretches to fill container, may distort
Persisted in localStorage.

### 14.5 Toast Notifications
- Fixed bottom-right position
- Auto-dismiss after 3 seconds
- Types: success (green) and error (red)
- Timer tracked and cleared on component unmount

### 14.6 Processing Overlay
- Full-screen dark overlay with spinning animation
- Shown during: upload, clip creation, event creation, re-encode, MP4 export
- Text: "Processing..."
- Z-index: 250 (above all other UI)

### 14.7 Film Grain Overlay
- Fixed full-screen SVG noise texture at 3.5% opacity
- Applied via CSS `background-image` with SVG inline data URI
- Z-index: 1 (between background and content)
- Adds cinematic texture to all views

---

## 15. Published Player (Standalone)

### 15.1 Player Architecture
- Single HTML file with embedded CSS + JavaScript
- Uses Vue 3 global build (loaded from `./vendor/vue.global.prod.js`)
- Story data (clips, logic blocks, sequence) embedded as JavaScript variables via `serializeInlineJson`
- Project ID embedded for save/load key scoping
- No server required after export

### 15.2 Player Lifecycle
1. **Mount**: Check localStorage for save data → if exists, restore position + game state
2. **Start**: Load first clip in sequence → play video
3. **Playback**: Video plays, `timeupdate` event checks for:
   - Active choice blocks at current time
   - Timeout auto-advance
4. **Choices**: When block trigger time reached → pause video → show choice overlay
5. **Navigation**: Choice clicked → process variables → navigate to target clip (or next/end)
6. **Return**: If return_to_main → push to history stack before navigating → when sub-clip ends → pop from stack → restore
7. **End**: When sequence ends → clear save data → show ending message

### 15.3 Save/Load System
- Saves to `localStorage['studio_save_' + projectId]`
- Stored data: `{ currentId, currentTime, gameState, historyStack, playlistIndex }`
- Loaded on mount → restores exact position
- Cleared on movie end or "end" action choices

### 15.4 Choice UI
- Cards appear as overlay when triggered
- Each card shows: thumbnail (custom edge thumbnail → target clip thumbnail → fallback), label, locked state
- Hover: no hover preview (studio-only feature)
- Locked choices: greyed out, grayscale, cursor not-allowed
- Auto-select: if only 1 choice is unlocked → automatically select it

### 15.5 Fade Transitions
- 200ms fade-out → swap video source → play → 60ms delay → 200ms fade-in
- CSS `opacity` transition on `.video-layer` element

### 15.6 Volume Control
- Mute/unmute button (🔇/🔊/🔉 based on state)
- Range slider (0–100 → mapped to 0.0–1.0)
- Persisted in `localStorage['studio_vol_' + projectId]`
- Affects both video and background music

### 15.7 Loading Indicator
- Spinner overlay during clip transitions
- CSS animation: rotating border circle
- Fades out when video starts playing

### 15.8 Graceful Handling
- All-choices-locked: if all choices in a block are locked by reqVar, the video continues playing instead of showing stuck overlay
- Play errors: shows tap-to-play overlay if autoplay is blocked

---

## 16. Keyboard Shortcuts (Full List)

| Keys | Context | Action |
|---|---|---|
| `Esc` | Any | Close preview, test event, logic overlay |
| `Space` | Clipper, Library, Event Creator | Play/pause video |
| `Ctrl+Z` | Builder | Undo last node position change |
| `Ctrl+S` | Any | Save node positions + audio settings |
| `B` | Any | Jump to Builder view |
| `L` | Any | Jump to Logic view |
| `P` | Any | Start Preview |
| `1` | Any | Jump to Upload view |
| `2` | Any | Jump to Clipper view |
| `3` | Any | Jump to Library view |
| `4` | Any | Jump to Event Creator view |
| `5` | Any | Jump to Builder view |
| `6` | Any | Jump to Logic view |
| `7` | Any | Jump to Stats view |
| `8` | Any | Jump to Publish view |
| `[` | Clipper, Event Creator | Frame step backward (1/30s) |
| `]` | Clipper, Event Creator | Frame step forward (1/30s) |

---

## 17. Audio System

### 17.1 Background Music
- Per-clip: each clip can have a background music file assigned
- Audio files uploaded via the upload route (auto-detected by MIME type)
- Music plays on loop during clip playback
- Crossfades when transitioning to next clip's music
- Volume: 0.3 (hardcoded for background music)

### 17.2 Mute Control
- Per-clip: `mute_audio` flag mutes the original clip audio
- Works independently of background music
- Applued to video element's `.muted` property

---

## 18. Database Schema

### 18.1 Tables

**projects**
| Column | Type | Default |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| title | TEXT | |
| theme_color | TEXT | '#3b82f6' |
| genre | TEXT | 'Interactive story' |
| synopsis | TEXT | '' |
| start_clip_id | TEXT | NULL |
| created_at | DATETIME | CURRENT_TIMESTAMP |

**videos**
| Column | Type |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| project_id | INTEGER |
| filename | TEXT |
| filepath | TEXT |
| thumbnail | TEXT |
| duration | REAL |
| created_at | DATETIME |

**clips**
| Column | Type | Default |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| unique_id | TEXT UNIQUE | |
| project_id | INTEGER | |
| name | TEXT | |
| filepath | TEXT | |
| thumbnail | TEXT | |
| source_video_id | INTEGER | |
| duration | REAL | |
| start_time | REAL | 0 |
| end_time | REAL | |
| logic_name | TEXT | |
| timeout_to_id | TEXT | |
| timeout_seconds | REAL | |
| bg_music | TEXT | |
| bg_music_url | TEXT | |
| mute_audio | INTEGER | 0 |
| is_event_clip | INTEGER | 0 |
| x | REAL | 0 |
| y | REAL | 0 |
| builder_visible | INTEGER | 0 |

**edges**
| Column | Type | Default |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| project_id | INTEGER | |
| from_id | TEXT | |
| to_id | TEXT | |
| label | TEXT | |
| text_color | TEXT | '#ffffff' |
| trigger_time | REAL | |
| logic_id | TEXT | |
| return_to_main | INTEGER | 0 |
| set_var | TEXT | |
| req_var | TEXT | |
| action_type | TEXT | 'target' |
| thumbnail | TEXT | |

**analytics**
| Column | Type |
|---|---|
| id | INTEGER PK AUTOINCREMENT |
| project_id | INTEGER |
| choice_label | TEXT |
| target_clip_id | TEXT |
| timestamp | DATETIME |

**published_movies**
| Column | Type | Default |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| export_name | TEXT UNIQUE | |
| project_id | INTEGER | |
| title | TEXT | |
| synopsis | TEXT | '' |
| genre | TEXT | 'Interactive story' |
| poster_path | TEXT | |
| theme_color | TEXT | '#3b82f6' |
| clip_count | INTEGER | 0 |
| choice_count | INTEGER | 0 |
| duration | REAL | 0 |
| view_count | INTEGER | 0 |
| like_count | INTEGER | 0 |
| published_at | DATETIME | CURRENT_TIMESTAMP |
| updated_at | DATETIME | CURRENT_TIMESTAMP |

### 18.2 Migration System
- Migrations run on every server startup
- Each ALTER TABLE is wrapped in try/catch (silently fails if column already exists)
- Columns are added incrementally as features were developed
- Current migrations handle: start_clip_id, bg_music, mute_audio, is_event_clip, x/y positions, builder_visible, logic_id, return_to_main, set_var, req_var, text_color, action_type, thumbnail

### 18.3 Data Validation
- Project title required, trimmed
- Clip name required, trimmed
- Theme color validated against `/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i`
- Genre max 48 chars, synopsis max 280 chars
- Time values clamped to clip duration
- Speed validated 0.5–2.0
- Volume validated >= 0
- Filter validated against allowed set

---

## 19. File Organization

```
MyaStudio/
├── server.js                  ← Express server (~2,100 lines)
├── package.json               ← Dependencies
├── start-mya-studio.ps1       ← Windows launcher
├── database.sqlite            ← Auto-created SQLite DB
├── .ai-settings.json          ← AI provider config
├── .mya-server.pid            ← Process ID (detached mode)
├── .mya-server.out.log        ← Server stdout (detached mode)
├── .mya-server.err.log        ← Server stderr (detached mode)
│
├── lib/
│   └── published-player.js    ← Player HTML generator (~670 lines)
│
├── public/
│   ├── index.html             ← Vue 3 SPA (~4,300 lines)
│   ├── landing.html           ← Marketing page
│   ├── vendor/
│   │   └── vue.global.prod.js ← Vue runtime (shipped with exports)
│   ├── feed/
│   │   └── index.html         ← Feed page (vanilla JS)
│   ├── videos/                ← Uploaded source videos
│   ├── audio/                 ← Uploaded audio files
│   ├── clips/                 ← Rendered clips
│   ├── thumbnails/            ← Generated thumbnails
│   └── exports/               ← Published movies
│
├── tests/
│   └── published-player.test.js  ← 2 test cases
│
├── AGENTS.md                  ← Developer instructions
├── DESIGN.md                  ← Design system
├── FORME.md                   ← Human-readable architecture doc
├── IMPROVEMENTS.md            ← Bug list + feature backlog
└── node_modules/              ← Dependencies
```

---

## 20. API Route Complete Reference

### Projects
```
GET    /api/projects
POST   /api/projects                          body: { title }
POST   /api/project/duplicate                 body: { id }
POST   /api/project/rename                    body: { id, title }
POST   /api/project/delete                    body: { id }
POST   /api/project/settings                  body: { id, color, genre, synopsis }
POST   /api/project/start_clip                body: { projectId, clipId }
```

### Upload
```
POST   /api/upload                            multipart: file, projectId
```

### Videos
```
GET    /api/videos?projectId=N
GET    /api/audio
POST   /api/delete_video                      body: { projectId, id }
```

### Clips
```
POST   /api/clip                              body: { projectId, sourceId, start, end, name, filter, speed, volume }
POST   /api/clip/duplicate                    body: { projectId, id }
POST   /api/clip/update                       body: { projectId, id, name }
POST   /api/clip/thumbnail                    body: { projectId, id, time }
POST   /api/clip/audio                        body: { projectId, unique_id, bgMusic, muteAudio, timeoutToId, timeoutSeconds }
POST   /api/clip/reencode                     body: { projectId, id, filter, speed, volume }
POST   /api/delete_clip                       body: { projectId, unique_id }
POST   /api/clip/positions                    body: { projectId, updates }
POST   /api/clip/builder                      body: { projectId, clipId, visible }

POST   /api/clips/batch_delete                body: { projectId, ids }
POST   /api/clips/batch_rename                body: { projectId, ids, prefix, suffix }
POST   /api/clips/batch_reencode              body: { projectId, ids, filter, speed, volume }
POST   /api/clips/batch_audio                 body: { projectId, ids, bgMusic, muteAudio }
```

### Event Clips
```
POST   /api/create_event_clip                 body: { projectId, sourceId, start, end, name, choices }
POST   /api/update_event_logic                body: { projectId, clipId, name, choices }
```

### Edges
```
POST   /api/builder/connect                   body: { projectId, fromId, toId, label, color, returnToMain, setVar, reqVar, actionType }
POST   /api/edge/update                       body: { projectId, id, toId, label, color, returnToMain, setVar, reqVar, actionType }
POST   /api/edge/delete                       body: { projectId, id }
POST   /api/edge/thumbnail                    body: { projectId, id, thumbUrl, time }
```

### Logic
```
POST   /api/save_logic_block                  body: { projectId, fromId, logicId, triggerTime, choices, bgMusic, muteAudio }
POST   /api/delete_logic_block                body: { projectId, logicId, fromId, triggerTime }
```

### Story
```
GET    /api/story?projectId=N                 → { clips: [...], edges: [...] }
```

### Analytics
```
POST   /api/analytics/track                   body: { projectId, label, target }
GET    /api/analytics/:projectId
POST   /api/analytics/reset                   body: { projectId }
```

### Publishing
```
POST   /api/publish                           body: { projectId, title, sequence }
POST   /api/export/mp4                        body: { projectId, path, crossfade }
GET    /api/exports
POST   /api/delete_export                     body: { name }
```

### Feed
```
GET    /api/feed/items                        → { items: [...], studioUrl, feedUrl }
POST   /api/feed/engage                       body: { exportName, action, liked }
```

### AI
```
GET    /api/ai/settings
PUT    /api/ai/settings                       body: { provider, model, apiKey, ollamaHost }
POST   /api/ai/test                           body: { provider, model, apiKey, ollamaHost }
POST   /api/ai/generate                       body: { premise, genre, targetScenes, tone }
POST   /api/ai/suggest/choices                body: { projectId, clipId }
POST   /api/ai/validate                       body: { projectId }
```

### Advanced Editor
```
POST   /api/clip/thumbnails                   body: { projectId, clipId, interval }
POST   /api/clip/waveform                     body: { projectId, clipId, samples }
```

---

## 21. Edge Cases and Behaviors

### What happens when:
- **Video file missing on disk**: DB record exists but file is deleted → reconcileMediaRecords() on startup removes orphaned records
- **Published movie folder missing**: reconcilePublishedMovies() removes orphaned DB records
- **ffmpeg render fails**: "Render Failed" error returned, no DB change
- **Autoplay blocked (published player)**: Tap-to-play overlay shown with play button
- **All choices locked by reqVar**: Video continues playing (clip naturally ends)
- **No start clip and no sequence**: Publish is blocked with warning message
- **Duplicate export name**: DB UNIQUE constraint on export_name, overwrites on conflict with ON CONFLICT DO UPDATE
- **Concurrent edits (same project, two tabs)**: SQLite's `BEGIN IMMEDIATE TRANSACTION` prevents write conflicts
- **Rapid clip load calls (published player)**: Timeout tracking prevents race conditions
