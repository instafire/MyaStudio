# MyaStudio

> A local-first studio for making interactive, choose-your-own-adventure movies from your own footage, like the interactive specials on Netflix.

Upload your videos, cut them into scenes, connect the scenes with choices, preview every path, and publish a self-contained player you can share as a link, embed on a site, or download as a zip.

---

## ✨ What you can do

- **One editing screen.** Media and scenes on the left, a visual story map in the middle, settings for whatever you select on the right. No tab-hopping.
- **Cut scenes fast.** A full-screen cutter with a filmstrip, draggable start/end handles, frame stepping, loop playback and keyboard shortcuts (`I` / `O`). After each cut the next one starts where the last ended, so you can slice a whole video in a row.
- **Automatic shot detection.** "Find shot changes" marks every cut in your footage (handles snap to them) and can turn each shot into a scene in one click. Or use a whole video as one scene instantly, with no re-encode.
- **Drag to connect.** Drag from a choice's dot to another scene. Every scene ends one of three ways: **Choices**, **Continue** to another scene, or an **Ending** with a name.
- **Netflix-style choices.** Optional question, a countdown bar, a default pick when time runs out, shuffle, and pause-while-choosing. Moments during a scene can offer quick detours that come back ("Come back here afterwards") or a "Keep watching" option.
- **Remember & unlock.** Choices can set a flag (`has_key`) and later choices can appear only if it's set, or not set (`!has_key`).
- **Live story check.** Dead ends, choices that go nowhere, unreachable scenes, endless loops and flags that are never set are flagged as you work, with a "Show me" link to each one.
- **Preview = what viewers get.** Preview runs the exact player that gets published, from the start or from any scene.
- **A player viewers enjoy.** Choices appear over the playing video, scenes switch without black gaps (the next possible scenes are preloaded), viewers can go back to their last choice, resume where they left off, and the end screen shows which ending they found and how many are left.
- **Publish anywhere.** One click builds a folder with `index.html`, `story.json`, the player and only the footage viewers can reach. Copy the link, copy an embed `<iframe>`, or download a `.zip` for any static host or a USB stick. Viewer choice stats show up in the publish panel.
- **Local & private.** Everything lives in SQLite and on your disk. No accounts, no cloud.

The previous editor is still available at `/classic.html` (GIF export, batch tools, the AI story agent) and works on the same projects.

---

## 🚀 Getting started

**Requirements:** Node.js 18.17 or newer (CI uses Node 20) and a modern browser. FFmpeg and FFprobe are bundled through `ffmpeg-static` / `ffprobe-static`.

```bash
git clone https://github.com/instafire/MyaStudio.git
cd MyaStudio
npm install
npm start            # or: node server.js
```

On Windows you can also run `.\start-mya-studio.ps1 -Detach`.

- **Studio:** http://127.0.0.1:3000
- **Feed of published movies:** http://127.0.0.1:3001

New here? Click **Try the sample story** on the home screen for a ready-made two-door movie with a timer and two named endings.

## 🎬 Making a movie

1. **New movie**, then drop your videos onto the window (or the Media tab).
2. The cutter opens on your first upload. Set a start and end, name the scene, **Add scene**. Repeat, or use **Find shot changes**.
3. On the story map, pick what happens when each scene ends: **Choices**, **Continue** or **Ending**. Drag from a choice's dot to the scene it leads to.
4. Fine-tune in the right panel: choice text, when choices appear, countdown and default, music, captions.
5. **Preview** to watch every path. Fix anything the story check flags.
6. **Publish**, then share the link, embed it, or download the zip.

---

## ⌨️ Keyboard shortcuts

| Where | Keys | Action |
|---|---|---|
| Story map | `Delete` | Delete the selected scene |
| | `F` | Fit everything on screen |
| | `Esc` | Deselect |
| | `Ctrl` + `Enter` | Preview (from the selected scene) |
| | `Ctrl` + scroll | Zoom |
| | `?` | Help |
| Cutter | `Space` | Play / pause |
| | `I` / `O` | Set scene start / end at the playhead |
| | `←` / `→` | Move 1 s (`Shift`: 5 s) |
| | `,` / `.` | Move one frame |
| | `L` | Loop the selection |
| | `Enter` | Add the scene |
| Player | `Space` / `K` | Play / pause |
| | `1` – `9` | Pick a choice |
| | `B` | Back to the previous choice |
| | `M`, `C`, `F` | Mute, captions, full screen |

---

## 🔒 Security & deployment

MyaStudio is a local-only server with no authentication, so it must never be exposed directly to a network you don't trust:

- **Loopback only.** `HOST` / `FEED_HOST` default to `127.0.0.1` and the server refuses any other bind address. `PORT` / `FEED_PORT` must be decimal ports 1–65535.
- **Reverse proxy, not a public bind.** To reach the studio from outside the machine, put a reverse proxy (nginx, an SSH `-R` tunnel) in front of the loopback ports and set `TRUSTED_ORIGINS` to the public origin(s), e.g. `TRUSTED_ORIGINS=https://myastudio.example.com`. Browser requests from other origins are rejected, and state-changing API requests must use JSON or multipart media bodies.
- **Embedding.** Published movies under `/exports/` may be framed by other sites (so the embed code works); the studio itself stays same-origin only.
- **Uploads.** Media uploads accept video/audio files only (`.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`, `.m4v`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.aac`), up to 800 MB; files over 90 MB upload in 5 MB chunks so proxies with body limits don't reject them. Subtitles accept `.vtt` / `.srt`. Stored media paths are confined to `public/`; project imports whitelist their SQL columns and remap references.
- **Errors.** Unexpected server errors return a generic message; detail stays in the server log.
- **Database location.** `database.sqlite` in the working directory, or set `MYA_DB_PATH`.

---

## 📁 Project structure

```
├── server.js                  # Express API, SQLite schema, ffmpeg rendering, publishing
├── lib/
│   ├── story.js               # Builds the shared story format from database rows
│   ├── published-player.js    # HTML page that hosts the player (published + preview)
│   ├── zip.js                 # Dependency-free zip writer for downloads
│   ├── security.js            # Host/port/origin checks, headers, upload validation
│   ├── movie-agent.js         # AI / offline story planner (classic editor)
│   └── subtitles.js           # SRT → WebVTT
├── public/
│   ├── index.html             # Studio shell
│   ├── studio/                # Studio app (Vue 3, no build step)
│   │   ├── main.js, store.js, api.js, util.js, icons.js, studio.css
│   │   └── components/        # hub, editor, library, storymap, inspector, cutter, preview, publish, help
│   ├── player/                # The viewer: copied into every published movie
│   │   ├── story-core.js      # Story format, playback engine and story check (also used by the server)
│   │   ├── mya-player.js      # Player UI
│   │   └── mya-player.css
│   ├── classic.html           # Previous editor
│   ├── feed/                  # Feed of published movies (port 3001)
│   └── videos/ clips/ audio/ thumbnails/ subtitles/ exports/   # your media (git-ignored)
└── tests/                     # node:test suites, including an end-to-end API test
```

### Story format

Published movies ship a `story.json` (version 2): `scenes` (video, poster, duration, `next`, `ending`), and `choicePoints` (scene, time, prompt, countdown, shuffle, pause, and `choices` with `action` of `scene`, `end`, `dismiss` or the legacy `next`). See the header of `public/player/story-core.js` for the full shape.

---

## 🧪 Tests

```bash
npm test
```

Covers the playback engine and story check, story building, the published page, security helpers, the zip writer, and an end-to-end run against a real server (sample story, scene settings, choices, preview, publish, zip, upload, cut, re-trim and shot detection) on a temporary database.

---

## 📄 License

[MIT](LICENSE)
