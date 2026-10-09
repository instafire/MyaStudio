# MyaStudio

> A full-featured, local-first studio for creating branching choose-your-own-adventure interactive movies and video narratives.

MyaStudio lets creators upload source videos, cut reusable clips, place timed interactive choices on scenes, manage branching outcomes, and export self-contained, zero-dependency HTML5 players or browse published stories in an interactive vertical feed.

---

## ✨ Features

- **Project Hub**: Multi-project management with themes, synopses, genres, and metadata.
- **Precision Video Editor**: Frame-by-frame trimming (`I` / `O` shortcuts), live playhead scrub, jump to marks, and A⇄B selection loops.
- **Visual Story Builder & Logic Graph**: Connect scenes with timed decision overlays, return branches, conditional variables (`set_var`, `req_var`), and alternate endings.
- **AI Story Outliner & Movie Agent**: Generate branching movie outlines and automatically scaffold project scene trees from source footage.
- **GIF Export**: Fast GIF extraction directly from trimmed clips or timeline selections.
- **Standalone HTML5 Movie Publisher**: Export completely portable, single-folder HTML5 player packages with embedded choice logic, keyboard navigation, and seekable timelines.
- **Interactive Feed**: Secondary standalone feed on port `3001` listing all published interactive movies.
- **Local & Private**: All data is stored locally in SQLite and on the local filesystem. No mandatory cloud accounts or subscriptions.
- **Media uploads**: Common MP4/MOV/WebM/MKV/AVI video formats and MP3/WAV/M4A/AAC/OGG/Opus/FLAC audio formats are accepted (maximum file size: 800 MB).

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- Standard web browser (Chrome, Edge, Firefox, Safari)

> **Note**: Bundled static FFmpeg and FFprobe binaries are included automatically via `ffmpeg-static` and `ffprobe-static` dependencies.

### Installation

```bash
# Clone the repository
git clone https://github.com/instafire/MyaStudio.git
cd MyaStudio

# Install dependencies
npm install
```

### Running MyaStudio

**Direct startup:**
```bash
node server.js
```
or
```bash
npm start
```

**On Windows (automatic runtime detection & background detach):**
```powershell
.\start-mya-studio.ps1 -Detach
```

### Access URLs

- **Studio Interface**: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- **Interactive Feed**: [http://127.0.0.1:3001](http://127.0.0.1:3001)

Both services bind to loopback only by default and reject non-loopback `HOST` or `FEED_HOST` values; their browser APIs accept CORS requests only from configured local origins. The app does not provide user authentication, so do not expose either port to a network or place it behind a public proxy without adding an authenticated access layer. `PORT` and `FEED_PORT` must be distinct valid TCP ports. The SQLite file defaults to `database.sqlite` in the repository; set `MYA_DATABASE_PATH` only when you intentionally want it stored elsewhere.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause video |
| `I` | Mark In-point |
| `O` | Mark Out-point |
| `[` / `]` | Step 1 frame back / forward |
| `A` | Toggle A⇄B selection loop |
| `M` | Add timeline marker |
| `Ctrl + K` | Open Command Palette |
| `1` – `7` | Switch workflow tabs |
| `?` | Show Shortcuts overlay |

---

## 📁 Project Structure

```
├── lib/
│   ├── movie-agent.js         # AI story planning & tree normalization
│   ├── security.js            # Loopback, CORS, upload and media-path guards
│   └── published-player.js    # Standalone HTML player generator
├── public/
│   ├── index.html             # Main MyaStudio web app
│   ├── feed/                  # Interactive feed UI
│   ├── vendor/                # Vendor scripts (Vue 3 production bundle)
│   ├── videos/                # Uploaded source videos (.gitkeep)
│   ├── clips/                 # Rendered video clips (.gitkeep)
│   ├── audio/                 # Background audio tracks (.gitkeep)
│   ├── subtitles/             # Uploaded/converted subtitle tracks (ignored runtime data)
│   ├── thumbnails/            # Generated video posters (.gitkeep)
│   └── exports/               # Exported standalone HTML players (.gitkeep)
├── tests/
│   ├── movie-agent.test.js    # Movie agent unit tests
│   ├── published-player.test.js # Published player unit tests
│   └── security.test.js       # Network, upload, path and import regressions
├── server.js                  # Express application, SQLite database & API routes
├── package.json               # Project manifest & dependencies
└── start-mya-studio.ps1       # Windows launcher script
```

---

## 🧪 Running Tests

```bash
npm test
```

---

## 📄 License

[MIT](LICENSE)
