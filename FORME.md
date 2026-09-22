# FORME.md — Mya Studio Explained for Humans

> **Author's note:** This document is written for people who don't write code for a living. If you're a founder, designer, product manager, or just curious about how this thing works under the hood — this is for you. There's no assumption that you know what a "server" is or what "npm install" does. Every technical term is explained the first time it appears.
>
> If you DO write code for a living, the TL;DR is in `AGENTS.md`.

---

## 1. The Big Picture — What Is Mya Studio?

**Mya Studio is a tool that lets anyone create "choose-your-own-adventure" style videos.** You upload a regular video, cut it into scenes, connect those scenes with clickable choices (like "Go left" or "Open the door"), and then publish the whole thing as a playable interactive movie that runs in any web browser.

Think of it like **iMovie meets "Bandersnatch"** — the Netflix movie where you made decisions for the main character. Mya Studio gives you the same power, but for your own videos. No coding required.

### What problem does it solve?

Before Mya Studio, if you wanted to make an interactive video, your options were:
- **Expensive enterprise tools** like Eko or Wirewax that cost thousands per year
- **Coding it yourself** with JavaScript frameworks like Twine (which doesn't handle video well)
- **Hacky workarounds** like uploading separate YouTube videos and using YouTube Cards

Mya Studio is **free, open-source, and runs on your own computer**. You own everything you make. There's no subscription, no cloud dependency, and no third-party platform taking a cut.

### Who is it for?

- **Teachers** who want to create interactive lessons with branching quiz paths
- **YouTubers** who want to make multi-ending videos for their audience
- **Filmmakers** experimenting with interactive storytelling
- **Marketers** building interactive product demos
- **Game designers** prototyping dialogue trees and narrative choices
- **Anyone** who's ever thought "what if this video had a different ending?"

### The user journey, in plain words

Here's how someone uses Mya Studio, from start to finish:

1. **They start the app** on their computer — it opens a local web page (like opening a document in Google Docs, but it runs from their own machine)
2. **They create a project** and give it a name — this is like opening a new folder for a film project
3. **They upload video files** — MP4 files, exactly like uploading to YouTube
4. **They cut clips** from the video — trimming a 10-minute video down to specific moments, like cutting a film reel
5. **They build a story graph** — this is the secret sauce. They drag scenes onto a canvas and draw lines between them. Each line represents a choice the viewer will make: "If they click 'Explore the cave', they go to Scene B. If they click 'Turn back', they go to Scene C."
6. **They add logic** — they can set variables that track the viewer's choices ("Did they pick up the key earlier?") and lock or unlock choices based on those variables ("You can only open the door if you picked up the key.")
7. **They preview the movie** — test it right in the browser, clicking through choices like a real viewer
8. **They publish** — Mya Studio generates a standalone folder with an HTML file. They can upload this to any website, email it to someone, or put it on a USB drive. It plays on any device with a browser.

### The restaurant analogy

Imagine Mya Studio is a **restaurant kitchen with a storefront**.

- **The kitchen (server.js)** is where all the real work happens: chopping ingredients (processing videos with ffmpeg), cooking meals (rendering clips), plating dishes (generating output files), and keeping the pantry organized (the database).
- **The front-of-house (index.html)** is the menu and dining area — what customers see and interact with. It's a Vue.js app (think of it as a well-trained waiter who remembers everyone's order).
- **The display kitchen (the Graph Builder)** is like a sushi bar where customers can watch the chef work. It shows the story as a visual map of connected scenes — "here's the path you built, here's where choices split off."
- **The takeout counter (published-player.js)** packages up a completed meal so customers can take it home. It generates a self-contained HTML file — like a bento box with everything inside, no restaurant required.
- **The pantry (database.sqlite)** is a filing cabinet where every order, ingredient list, and recipe is stored. It's the SQLite database.
- **The walk-in cooler (public/videos, public/clips, public/thumbnails, public/exports)** stores the physical ingredients — the raw video files, processed clips, thumbnail images, and finished exports. These are folders on your hard drive.

The whole system runs on a single computer. There's no cloud kitchen, no delivery network, no central server. You're the chef, the owner, and the only customer — until you decide to share your creations.

---

## 2. Technical Architecture — The Blueprint

Here's the system drawn as a simple map. Read it top to bottom:

```
┌──────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                              │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │  Mya Studio App      │  │  Interactive Feed (port 3001)    │  │
│  │  (port 3000)         │  │  A scrolling gallery of          │  │
│  │  Where you build     │  │  published movies                │  │
│  │  your interactive    │  │                                  │  │
│  │  movie               │  │                                  │  │
│  └──────────┬───────────┘  └──────────────┬───────────────────┘  │
└─────────────┼─────────────────────────────┼──────────────────────┘
              │                             │
              ▼                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    NODE.JS SERVER (server.js)                     │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  The Kitchen │  │  The Filing  │  │  The Prep Station      │  │
│  │  (API Routes)│  │  Cabinet     │  │  (SQLite Database)     │  │
│  │              │  │  (File System)│  │                        │  │
│  │  Handles     │  │              │  │  Stores:               │  │
│  │  uploads,    │  │  Stores raw  │  │  - Projects            │  │
│  │  clip cuts,  │  │  videos,     │  │  - Video metadata      │  │
│  │  renders,    │  │  clips,      │  │  - Clip data           │  │
│  │  publish     │  │  thumbnails, │  │  - Edge connections    │  │
│  │              │  │  exports     │  │  - Analytics           │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────────────────┘  │
│         │                 │                                       │
│         ▼                 ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  FFMPEG (The Video Processing Engine)                        │ │
│  │  - Cuts clips from source videos                             │ │
│  │  - Applies filters (black & white, sepia, vivid)             │ │
│  │  - Adjusts speed and volume                                  │ │
│  │  - Generates thumbnails                                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    PUBLISHED OUTPUT                                │
│                                                                   │
│  public/exports/[movie-name]/                                     │
│  ├── index.html        ← Standalone player (no server needed)     │
│  ├── manifest.json     ← PWA manifest (lets it work offline)      │
│  ├── clips/            ← All the video clips for this movie       │
│  ├── audio/            ← Background music files                   │
│  └── vendor/           ← Vue.js runtime (the player engine)       │
│                                                                   │
│  This folder can be uploaded to ANY web server.                   │
└──────────────────────────────────────────────────────────────────┘
```

### The building tour

Let's walk through each room.

**The Front Desk (Express.js on port 3000)**

When you open http://127.0.0.1:3000 in your browser, you're talking to a small program called **Express.js**. It's the receptionist. It takes your request ("I want to see the studio page") and serves you the right file. When you click a button ("Upload this video"), it routes that action to the right handler.

There's actually a **second receptionist on port 3001** — the Feed server. It serves a completely separate page (`public/feed/index.html`) that shows published movies in a vertical scroll layout, like TikTok for interactive videos. It exists on a different port so the feed can stay open while you're in the studio.

> **Why two servers?** The feed is meant to be a passive display — something you'd put on a second monitor or a lobby TV. It auto-refreshes every 15 seconds to pick up new publications. Keeping it on a separate port means it can be served independently, and someone can view the feed without accessing the studio.

**The Order Counter (API Routes)**

When the receptionist receives an action ("create a clip", "save a choice"), it passes it to one of the **API route handlers**. These are like order tickets: each one is designed for a specific task. There are about 40 different order tickets, each handling one thing:
- `/api/upload` — "here's a video file, save it"
- `/api/clip` — "cut a piece from this video"
- `/api/builder/connect` — "draw a line between these two scenes"
- `/api/publish` — "package everything into a standalone player"

**The Pantry (SQLite Database)**

All the information about projects, clips, scenes, choices, and analytics is stored in a single file called `database.sqlite`. Think of it as a filing cabinet with labeled folders:
- **Projects drawer** — each project's name, theme color, genre
- **Videos drawer** — what videos were uploaded and where they're stored
- **Clips drawer** — each scene you cut, with timing info and thumbnail
- **Edges drawer** — the connections between scenes (every choice is an "edge")
- **Analytics drawer** — how viewers clicked through published movies

> **Why SQLite?** SQLite is like a notebook you keep in your pocket versus a library database that requires a librarian (PostgreSQL) or an online service (Supabase, Firebase). Since Mya Studio runs entirely on one person's computer, SQLite is perfect — it's just a file. No server to install, no cloud service to pay for. The trade-off? Only one person can use it at a time, and it doesn't scale to millions of users. That's fine for a tool that's designed for individual creators.

**The Video Processing Station (ffmpeg)**

This is where the heavy lifting happens. **ffmpeg** is a power tool for processing video files — think of it as a combination of a film cutter, a color grader, and a sound mixer, all in one.

When you cut a clip, ffmpeg:
1. Opens the source video file
2. Jumps to the start time you selected
3. Reads video frames and audio for the duration you specified
4. Optionally applies a filter (black and white, sepia, color boost)
5. Adjusts the speed (slow motion or fast forward)
6. Adjusts the volume
7. Writes a new MP4 file to the `public/clips/` folder

This is the most computationally expensive part of the system. Cutting a 30-second clip takes about 5-15 seconds depending on your computer's processor. The spinner overlay you see ("Processing...") is Mya Studio's way of saying "the chef is cooking, it'll be ready soon."

**The Takeout Packager (lib/published-player.js)**

This is a 540-line file that does **one thing**, but does it carefully: it generates a complete, self-contained HTML file for a published interactive movie.

Think of it as a bento box chef. It:
1. Copies all the video clips into an export folder
2. Copies the background audio
3. Copies the Vue.js player engine (so viewers don't need an internet connection)
4. Embeds the story data (what choices connect to what, what variables matter) as JavaScript data
5. Generates an `index.html` file that contains everything — the player, the movie, all the logic

The result is a folder you could put on a USB drive, hand to someone, and they could open the HTML file on any computer and play your interactive movie. No server needed. No internet needed. Just a browser.

> **Why generate a file instead of hosting it?** This was a deliberate choice. Most interactive video platforms (like Eko or H5P) require you to use their hosting. If they go out of business, your content dies with them. By generating a standalone HTML file, Mya Studio ensures your interactive movies outlive the tool that created them. This is the same philosophy as "save as PDF" — the file is independent of the program that made it.

### Architectural decisions worth understanding

**Why a single HTML file for the studio?**

The entire studio interface (`public/index.html`) is one giant file — 3,700+ lines of HTML, CSS, and JavaScript. This is unusual. Most web apps split their code into many small files. The reason: simplicity. There's no build step, no bundler, no compilation step. You edit the file, refresh the browser, and your change is there. For a tool that's meant to be easy to hack on, this is a feature, not a bug.

The trade-off is that the file is very long and hard to navigate. Finding the right piece of code requires searching. Future versions would benefit from splitting it into separate files, but that requires a build tool (like Vite or Webpack) which adds complexity.

**Why Vue.js without a build step?**

Vue.js is a JavaScript framework for building user interfaces — think of it as a set of pre-built LEGO blocks for creating interactive web pages. Normally, Vue requires a build step (a program that processes your code before it can run). But Mya Studio uses a special "global build" file (`vue.global.prod.js`) that works directly in the browser with zero setup. This is like buying an already-assembled LEGO castle versus buying the box of bricks and instructions. It takes away some flexibility but makes instant setup possible.

**Why ffmpeg and not a cloud video service?**

ffmpeg is a free, open-source command-line tool that can process almost any video format. It's installed on your computer and works offline. The alternative would be using a cloud service like AWS Elemental or Google Cloud Video Intelligence, which would:
- Require an internet connection
- Cost money per minute of video processed
- Mean your videos are uploaded to someone else's server
- Add latency for upload+processing+download

By bundling ffmpeg directly (via the `ffmpeg-static` npm package, which includes a pre-compiled ffmpeg binary), Mya Studio keeps everything local, private, and free.

---

## 3. Codebase Structure — The Filing System

Here's the project folder at a glance:

```
MyaStudio/
├── server.js                  ← THE BRAIN (1,700+ lines)
├── package.json               ← Shopping list for dependencies
├── start-mya-studio.ps1       ← Easy launcher for Windows
├── database.sqlite            ← Filing cabinet (auto-created)
├── AGENTS.md                  ← Developer cheat sheet
├── DESIGN.md                  ← Visual style guide
├── IMPROVEMENTS.md            ← Bug list & feature backlog
├── lib/
│   └── published-player.js    ← Takeout packager (540 lines)
├── public/
│   ├── index.html             ← The studio app (3,700+ lines)
│   ├── landing.html           ← Marketing page
│   ├── vendor/
│   │   └── vue.global.prod.js ← Pre-built Vue.js runtime
│   ├── feed/
│   │   └── index.html         ← The feed app (1,000 lines)
│   ├── videos/                ← Your uploaded videos go here
│   ├── audio/                 ← Your uploaded audio goes here
│   ├── clips/                 ← Rendered clips go here
│   ├── thumbnails/           ← Thumbnail images go here
│   └── exports/               ← Published movies go here
├── tests/
│   └── published-player.test.js  ← Tests for the packager
└── node_modules/              ← Dependencies (auto-created)
```

### What each folder is for

**`server.js`** — The Head Chef

This is the most important file. It does everything:
- Starts the web server (the receptionist)
- Creates the database (the filing cabinet)
- Defines all the API routes (the order tickets)
- Handles video upload and processing (the cooking)
- Manages the database (the pantry inventory)
- Generates published movies (the takeout packaging)

When the server starts up, here's what happens in order:
1. It sets up ffmpeg and ffprobe (finds the video processing tools)
2. It creates the necessary folders if they don't exist
3. It opens (or creates) the SQLite database
4. It creates the database tables if they don't exist
5. It runs database migrations to add any new columns
6. It cleans up orphaned records (clips whose files have been deleted)
7. It starts listening on port 3000 (and 3001 for the feed)

> **Why is everything in one file?** Same reason as the studio interface: simplicity. For a tool like this, having everything in one file makes it easier to understand the whole system at once. The trade-off is that the file is very long (1,700+ lines) and any change requires scrolling through a lot of code. Future improvements would split it into separate files by function: `routes/`, `db/`, `services/`.

**`lib/published-player.js`** — The Takeout Packager

This is a focused, self-contained file with a single job: generate the HTML for a published interactive movie. It contains:
- `buildPublishedPlayerHtml()` — the main function (540 lines) that produces the entire player
- `serializeInlineJson()` — a helper that safely embeds data (clips, choices, logic) into HTML without breaking the page

The published player it generates is a complete Vue.js application with:
- A video player that automatically plays through the sequence
- Choice overlays that appear at the right moments
- A save/load system that remembers where the viewer left off
- Background music support
- Variable tracking for conditional choices
- Volume controls (added in a recent update)

**`public/index.html`** — The Studio

This is the main user interface, written as a single-page Vue.js application. It's organized into "views" that the user switches between using buttons in the top navigation bar:

| View | What it does | Like... |
|---|---|---|
| Projects | Lists all projects, lets you create/rename/duplicate/delete | A project dashboard |
| Upload | Lets you select and import video/audio files | The import screen |
| Editor | Cuts clips from source videos with trim markers | A video editor timeline |
| Events | Creates special "event clips" with embedded choices | A branching point editor |
| Library | Browse, rename, re-encode, and manage all clips | A media bin |
| Builder | The visual graph editor — drag nodes and draw connections | A flowchart tool |
| Logic | Set up choice timings and variables on a timeline | A logic editor |
| Stats | View analytics from published movies | A report dashboard |
| Publish | Set the sequence, preview, and export the movie | The publishing desk |

**`public/feed/index.html`** — The Feed

A separate mini-app that displays published movies in a vertical swipe feed. It auto-refreshes every 15 seconds to show new publications. Each movie gets a card with:
- The movie poster image
- Title, genre, and synopsis
- Scene count, choice count, and duration
- View and like counts
- A link to open the standalone player

> **Why a separate HTML file instead of reusing the Vue app?** The feed is meant to be lightweight and fast-loading. It doesn't need the full Vue framework — it's just a static display that fetches data from the API and renders it. Using vanilla JavaScript for the feed means it loads instantly even on slow connections.

**`public/vendor/vue.global.prod.js`** — The Secret Ingredient

This is a pre-compiled, minified version of the Vue.js framework. "Pre-compiled" means it's ready to use immediately — no build step needed. "Minified" means it's been compressed to be as small as possible (about 35KB instead of the full 300KB+ source). It's the engine that powers both the studio app and the published player.

**`tests/published-player.test.js`** — The Quality Check

A small test file that verifies the published player generator works correctly. It checks:
- That special HTML characters (like `<`, `>`, `&`) are properly escaped so they don't break the generated page
- That the published player HTML contains the right structural elements

Currently there are only 2 tests. More would be better, but these cover the most critical path — the published player is the final output of the entire system, so if it breaks, nothing works.

### Entry points — where things start

| Action | Starting point | What happens next |
|---|---|---|
| Starting the app | `start-mya-studio.ps1` or `node server.js` | `server.js` loads, sets up everything, starts listening on ports 3000 and 3001 |
| Opening the studio | Browser → `http://localhost:3000` | `server.js` serves `public/index.html` as a static file |
| Opening the feed | Browser → `http://localhost:3001` | `server.js` serves `public/feed/index.html` |
| Publishing a movie | Click "Build & Publish" in the studio | Studio sends data to `/api/publish` → `server.js` copies files → `lib/published-player.js` generates HTML → files written to `public/exports/[name]/` |
| Running tests | `npm test` | Node runs `tests/published-player.test.js` |

---

## 4. Connections & Data Flow — How Things Talk to Each Other

Let's follow three core user actions through the entire system. Each one traces a different path through the architecture.

### Action 1: User uploads a video

```
User clicks "Import to project"
         │
         ▼
  [The Upload View] in index.html
  ── Creates a FormData object (a package containing the file)
  ── Sends a POST request to /api/upload
         │
         ▼
  [The Receptionist] Express.js in server.js
  ── Checks: "Does the project exist?"
  ── Checks: "Is it a video or audio file?"
  ── If it's audio: saves to public/audio/, returns success, done.
  ── If it's video: saves to public/videos/ with a timestamp-based filename
         │
         ▼
  [The Prep Station] ffmpeg
  ── Probes the video to measure its duration (how long is this video?)
  ── Generates a thumbnail image at the 20% mark (a preview frame)
         │
         ▼
  [The Filing Cabinet] SQLite database
  ── Inserts a record into the "videos" table:
     { filename, filepath, thumbnail, duration, project_id }
  ── Inserts a record into the "clips" table:
     A "FULL:" clip representing the entire video (for reuse)
         │
         ▼
  [Back to the Browser]
  ── The server responds: { success: true, type: 'video' }
  ── The studio tells the user: "Imported!"
  ── The studio refreshes its data (re-fetches videos, clips, etc.)
```

**What could go wrong:**
- **File too large** The upload limit is 800 MB. If someone tries to upload a 2 GB file, they'll get a polite error and nothing bad happens.
- **Invalid format** The server accepts whatever the browser sends. If the file isn't a valid video, ffprobe will fail to measure its duration, and the thumbnail generation will fail. The file is still saved, but duration is 0 and there's no thumbnail.
- **Disk full** If the hard drive is full, the file won't save. The upload fails with a generic error.

### Action 2: User creates a clip (cuts a scene from a video)

```
User clicks "Create clip" in the Editor
         │
         ▼
  [The Editor View] in index.html
  ── Gathers: source video ID, start time, end time, clip name
  ── Gathers optional settings: filter (none/BW/sepia/vivid), speed, volume
  ── Sends everything as JSON POST to /api/clip
         │
         ▼
  [The Receptionist] Express.js
  ── Validates: does the source video exist? does the project exist?
  ── Validates: is the start time before the end time? (basic sanity check)
  ── Validates: is the filter one of the four allowed options? (security check)
  ── Validates: is the speed between 0.5x and 2.0x?
         │
         ▼
  [The Kitchen] ffmpeg
  ── This is where the magic happens. ffmpeg runs a command like:
     "Open this video file. Skip to 0:45. Read 30 seconds of it.
      Speed it up to 1.5x. Apply a sepia filter. Write the result
      to public/clips/clip_abc123.mp4"
  ── This takes 5-60 seconds depending on clip length and your CPU
  ── While ffmpeg runs, the server waits... and waits... until it finishes
         │
         ▼
  [Quality Check] ffmpeg continues
  ── If ffmpeg succeeds: "Render complete!"
     ── Generate a thumbnail from the new clip
     ── Save the clip data to the database
     ── Respond to the browser: { success: true }
  ── If ffmpeg fails: "Render Failed"
     ── Respond to the browser with an error
```

**What could go wrong:**
- **The `responded` flag pattern** — The clip creation routes use a boolean called `responded` to prevent the server from accidentally replying twice. This matters because ffmpeg has two possible exit paths: success ("end" event) and failure ("error" event). Only one should ever fire, but the code defensively handles both. If you ever see "Render Failed" when the clip actually rendered, this is the first place to look.
- **Race condition warning** — There's a known bug where `loadClip` in the published player uses `setTimeout` without clearing it. If you click choices quickly in the published player, old timeouts can fire after new ones have started, loading the wrong clip. This was documented in `IMPROVEMENTS.md` as a critical bug to fix.

### Action 3: User publishes the movie

```
User clicks "Build & Publish"
         │
         ▼
  [The Publish View] in index.html
  ── Gathers: project settings, movie title, opening sequence
  ── Sends everything as JSON POST to /api/publish
         │
         ▼
  [The Kitchen] Express.js in server.js
  ── Creates a folder: public/exports/[movie-title]/
  ── Creates sub-folders: clips/, audio/, vendor/
         │
         ▼
  [Copying Ingredients]
  ── Copies the Vue.js runtime to vendor/vue.global.prod.js
     (this is what makes the player work — it's the engine)
  ── For each clip used in the movie:
     ── Copies the video file to the clips/ folder
     ── Copies the thumbnail to the clips/ folder
     ── If there's background music, copies it to the audio/ folder
         │
         ▼
  [Packing the Box] lib/published-player.js
  ── `buildPublishedPlayerHtml()` is called with:
     ── The safe title (special characters escaped)
     ── The theme color (for the player's accent)
     ── All clips data (filenames, durations, thumbnails)
     ── All logic blocks (choices, triggers, variables)
     ── The opening sequence (which clips play first)
  ── It generates a complete HTML file with:
     ── CSS styling (dark theme, look-and-feel matching the studio)
     ── Vue.js template code (the player interface)
     ── JavaScript that wires everything together
     ── Embedded data (clips, choices, logic) using safe serialization
         │
         ▼
  [The Filing Cabinet]
  ── Writes the generated HTML to index.html in the export folder
  ── Writes a manifest.json (for PWA support — lets it behave like an app)
  ── Updates the published_movies table with metadata
         │
         ▼
  [Back to the Browser]
  ── Response comes back with a URL to the published player
  ── The studio shows: "Build Complete!" with a link
  ── The feed picks it up within 15 seconds (it auto-refreshes)
```

**What could go wrong:**
- **Vue runtime missing** — The publish process needs `public/vendor/vue.global.prod.js`. If it's been deleted, publishing will fail with "Local Vue runtime is missing." This file is checked into the repository, so if you clone fresh, you need to make sure it's there.
- **Disk space** — Published movies can be large (all those video clips copied into the export folder). If the drive runs out of space, the process fails mid-way, leaving a partial export folder.
- **The embed safety** — The published player contains embedded data (clip names, choice labels, etc.) that could theoretically contain characters that break HTML (`<`, `>`, `&`). The `serializeInlineJson` function carefully escapes these. If a clip name includes HTML, it won't break the player.

### Authentication flow

There isn't one.

Mya Studio doesn't have user accounts, logins, or passwords. It's a local application that runs on your own computer. When you start it, it's accessible to anyone on your local network (if they know the IP address). This is fine for a local tool, but if you were to deploy it to the internet, anyone could access your projects.

> **Why no authentication?** Because the first design principle is simplicity. Adding user accounts means: a users table, a sign-up/sign-in system, password hashing, session management, and all the complexity that comes with it. For a local tool that one person uses, none of this is needed. It would be like putting a lock on your home filing cabinet — useful in an office, silly in your own bedroom.

If you wanted to add authentication, you'd need to:
1. Create a `users` table in the database
2. Add sign-up and sign-in routes
3. Add middleware that checks for a valid session on every API call
4. Change all the routes to filter by user ID (currently they filter by project ID)
5. Handle password resets, session expiry, etc.

---

## 5. Technology Choices — The Toolbox

| Technology | What It Does Here | Why This One | Watch Out For |
|-----------|------------------|-------------|---------------|
| **Node.js** | The foundation — it's the program that runs all the JavaScript code. Think of it as the operating system for your app's logic. | The creator knows JavaScript, and Node lets you run JS anywhere — on a server, on a desktop, even on a Raspberry Pi. Popular alternatives like Python (Django) or Ruby (Rails) would have forced learning a new language. | Node is single-threaded — it does one thing at a time, very fast. For video processing (which takes seconds), this means the server can't handle other requests while ffmpeg is running. Future versions should offload processing to a queue. |
| **Express.js** | The web server — it's the receptionist that accepts browser requests and routes them to the right handler. | It's the most popular Node.js web framework. Almost every Node developer knows it. It's minimalist — doesn't impose a lot of structure, which is good for a small project. | Express 5 has subtle differences from Express 4. The error handling middleware works differently. If you're debugging a "why isn't my error being caught" issue, check the Express version. |
| **SQLite** | The database — a single file on disk that stores all project data. Think of it as a spreadsheet that speaks SQL. | Zero setup. No server to install. No cloud service to configure. The database is just a file (`database.sqlite`) that gets created automatically when the app starts. Perfect for a single-user desktop tool. | SQLite doesn't handle concurrent writes well. If two browser tabs are both making changes, you can get "database is locked" errors. The code uses `BEGIN IMMEDIATE TRANSACTION` to minimize this. It's also not suitable for scaling to thousands of users — at that point you'd switch to PostgreSQL. |
| **ffmpeg** | The video processing engine — it cuts, filters, speeds up, and analyzes video files. | It's the industry standard for video processing. It's free, open-source, incredibly powerful, and handles practically every video format. No cloud service can match its flexibility at this price point. | ffmpeg is complex and has a steep learning curve. The commands used here are simple by ffmpeg standards. If you need to add new effects, you'll need to learn ffmpeg filter syntax. Also, ffmpeg is CPU-intensive — processing a 4K video will max out your processor. |
| **ffmpeg-static** | A pre-packaged version of ffmpeg that comes with the Node.js package. | Without this, users would need to install ffmpeg separately on their system. This package bundles a compiled ffmpeg binary, so it just works after `npm install`. | The bundled version might not have all codecs. If someone has a rare video format, it might not process correctly. |
| **Vue.js** | The UI framework — it creates the interactive interface for both the studio and the published player. | Vue is known for being easy to pick up. Its template syntax (using `{{ }}` and `v-if`, `v-for` etc.) is more intuitive than React's JSX for developers who aren't frontend specialists. The global build (`vue.global.prod.js`) works without any build tools, which is critical for this project's zero-setup philosophy. | The studio is a single 3,700+ line file — not how Vue is typically used. Normally you'd split a Vue app into many small component files. The monolith approach works but makes the code hard to navigate. |
| **fluent-ffmpeg** | A JavaScript wrapper that makes it easier to build ffmpeg commands. | Writing raw ffmpeg commands is like writing assembly language — powerful but error-prone. fluent-ffmpeg gives you nice JavaScript methods like `.setStartTime()`, `.videoCodec()`, `.audioFilters()` that are much easier to read and maintain. | The wrapper can't cover every ffmpeg feature. For unusual operations, you may need to drop down to raw ffmpeg arguments using `.outputOptions()`. |
| **Multer** | The file upload handler — it receives uploaded files from the browser and saves them to disk. | It's the standard Express middleware for handling `multipart/form-data` (the format browsers use for file uploads). Rock solid and well-tested. | The upload limit is set to 800 MB. If you need to allow larger files, you'd change `fileSize: 1024 * 1024 * 800` in `server.js`. Going much higher might run into OS-level file size limits or browser timeout issues. |
| **UUID** | Generates unique IDs for clips (like a serial number for each scene). | Each clip needs a unique identifier that won't conflict with any other clip, ever. UUIDs look like `a1b2c3d4-e5f6-7890-abcd-ef1234567890` and are practically guaranteed to be unique. | The IDs are stored as text strings. They're 36 characters long. They're not user-friendly — you can't type one from memory. That's fine for internal use but not great for things like share links. |
| **Tailwind CSS** | A CSS framework used only in the studio app (not the published player). It provides pre-built style classes. | Tailwind lets you style things quickly by adding classes directly in the HTML, without writing custom CSS. The classes are terse (like `p-4`, `text-sm`, `flex`) but predictable. | The published player doesn't use Tailwind (it has custom CSS to keep the export self-contained). The studio's Tailwind is loaded via CDN (`cdn.tailwindcss.com`), which means the studio requires internet access for styling on first load. |

---

## 6. Environment & Configuration

Mya Studio has very little configuration — one of its design goals is to "just work" without setup.

### What's configurable

| Variable | What it controls | Default value | When you'd change it |
|---------|-----------------|---------------|---------------------|
| `HOST` | The network address the studio listens on | `127.0.0.1` (only your computer) | Set to `0.0.0.0` to allow other devices on your network to access the studio. Useful if you want to preview on a phone or tablet. |
| `PORT` | The port number for the studio | `3000` | If port 3000 is already taken by another program, set this to something else like `3005`. |
| `FEED_HOST` | The network address the feed listens on | Same as `HOST` | Only needed if you want the feed on a different network interface than the studio. |
| `FEED_PORT` | The port number for the feed | `3001` (or `HOST + 1` if PORT is not 3000) | If port 3001 is taken, set this to something else. |
| `STUDIO_PUBLIC_ORIGIN` | The public URL of the studio (used in feed links) | Auto-detected from `HOST` and `PORT` | If you're running behind a reverse proxy or on a different domain, set this to the public URL. |
| `FEED_PUBLIC_ORIGIN` | The public URL of the feed | Auto-detected from `FEED_HOST` and `FEED_PORT` | Same as above, for the feed. |

### Where to change things

All configuration is done through **environment variables**. On Windows, you'd set them with:
```powershell
$env:PORT = "3005"
$env:HOST = "0.0.0.0"
node server.js
```

Or with the PowerShell launcher:
```powershell
$env:PORT = "3005"; .\start-mya-studio.ps1
```

> **What's an environment variable?** Think of it as a sticky note on your computer that programs can read. "PORT=3005" means "when any program asks what port to use, tell them 3005."

### How different "environments" work

Because Mya Studio is a local tool, there's no development/staging/production distinction. There's just "your computer." The same code and the same configuration work the same way every time you run it.

If you wanted to set up a public demo server, you'd:
1. Run the server on a machine with a public IP (like a VPS from DigitalOcean or Linode)
2. Set `HOST=0.0.0.0` so it accepts connections from the internet
3. Set `STUDIO_PUBLIC_ORIGIN` to your public domain
4. Make sure port 3000 and 3001 are open in the firewall
5. **Consider adding authentication first** since anyone on the internet would have full access to your projects

### The trickiest configuration: the launcher script

`start-mya-studio.ps1` solves a real problem: on some Windows machines, the regular `node` command doesn't work (it might be broken by another program, or the wrong version). The launcher script checks multiple locations for a working Node.js runtime:

1. The official Node.js installation (`C:\Program Files\nodejs\node.exe`)
2. An Electron-based app called "Antigravity" that has Node bundled (this was the creator's primary setup)
3. Playwright's bundled Node.js (another tool that comes with its own Node)

This is a Windows-specific workaround. On macOS or Linux, you'd just type `node server.js` and it would work.

### The database file

The database (`database.sqlite`) is created in the project root folder. If you delete it, the app will recreate it on next startup — but you'll lose all your projects. The media files (videos, clips, thumbnails, exports) are in the `public/` folders and are NOT deleted when the database is recreated.

> **Backup advice:** To back up everything, copy two things:
> 1. `database.sqlite` (all your project data)
> 2. `public/videos/` and `public/audio/` (uploaded media — clips and thumbnails can be regenerated, but source files can't)

---

## 7. Lessons Learned — The War Stories

### Major bugs encountered

**The `previewIsPlayingSubClip` state leak**

*What happened:* The preview engine had a flag called `previewIsPlayingSubClip` that was set to `true` when a viewer followed a "return path" (a choice that says "go to this sub-clip and come back"). But it was never reset when the viewer made a subsequent non-return choice. So after returning from a sub-clip, taking another choice would incorrectly trigger the "return to parent" flow, sending viewers to the wrong scene.

*Why it happened:* The preview engine was added in stages. First came the published player, then the preview was built to mimic it. In the published player, the flag works differently because it's reset by the video's `onended` event. The preview engine didn't have the same cleanup because it was a port, not a rewrite.

*How it was fixed:* Added a single line: `this.previewIsPlayingSubClip = false;` at the start of `makePreviewChoice()`. This resets the flag before any choice processing, which is the correct default state. Each return choice sets it to `true` explicitly when needed.

*How to avoid:* When porting logic from one system to another (published player → preview engine), trace every state variable through all possible paths. A flag that's set in one place and cleared in another is fragile — it's better to derive it from other state (like "is the history stack empty?") than to track it independently.

**The setTimeout race condition**

*What happened:* The published player's `loadClip` function has a 220ms delay (it uses `setTimeout`) to create a smooth fade transition between clips. If the viewer clicked a choice and then immediately clicked another, or if the video ended at the exact same moment as a choice trigger, TWO `setTimeout` callbacks would be in flight simultaneously. The second one would overwrite video state set by the first, causing clips to load out of sequence or the player to show the wrong scene.

*Why it happened:* The `setTimeout` was added for visual polish (the fade effect) without considering that `loadClip` could be called again before the timeout fires. It's a classic JavaScript footgun — `setTimeout` is fire-and-forget by default. You have to explicitly manage it.

*How it was fixed:* Added `_loadTimeout` tracking. Before setting a new timeout, the code now clears any existing one: `if (this._loadTimeout) clearTimeout(this._loadTimeout);`. The timeout reference is stored and nulled after it fires.

*How to avoid:* Any time you use `setTimeout` or `setInterval`, ask yourself: "Can this function be called again before the timer fires?" If the answer is yes, you must cancel the previous timer first. This is such a common bug that some frameworks (React, Vue) have built-in mechanisms for it.

### Pitfalls and landmines

**The `v-if` and `v-for` trap**

Vue.js has a rule: don't use `v-if` and `v-for` on the same HTML element. They conflict because Vue needs to know which items to loop over before it can decide whether to show them. The code had:
```html
<option v-for="clip in fullGraphNodes" v-if="clip.unique_id !== selectedBuilderNodeId">
```

This worked in Vue 2 but produces a warning in Vue 3. The fix was using a computed property that filters the list before the loop — much cleaner and doesn't fight Vue's rendering engine.

**The migrating schema problem**

The database has a migration system that runs on every server start. Initially, migrations were added for columns that already existed in the `CREATE TABLE` statements. These migrations silently failed because the column already existed. This isn't dangerous (the `try/catch` swallows the error), but it creates noise and confusion. Someone adding a real migration later might not know which ones actually ran.

The fix: remove all migrations for columns that are already in the `CREATE TABLE` statements. Keep only the migrations for columns that were added after the initial table creation.

**The ffprobe path mystery**

The `ffprobe-static` npm package changed its export format between versions. Some versions export the path directly as a string, others as an object with a `.path` property. The code originally checked `ffprobeStatic.path` which worked for one format but not the other. The fix was to detect the format: "if it's a string, use it directly; if it's an object, use `.path`."

This is a lesson about depending on third-party packages — their internal structure can change without warning. Always add a type check when accessing properties that might not exist.

### Discoveries

**What worked well**

- **The single-file architecture** for both the studio and server. For a project of this scope, the simplicity of "edit one file, refresh the browser" is worth the file length. It made rapid iteration possible.
- **The SQLite + file system combo** for storage. No database server to install, no cloud storage to configure. Everything is just files on disk.
- **The global Vue build** for both the studio and the published player. It eliminates build tools entirely and makes the published player truly self-contained.
- **The scroll-snap feed** using vanilla CSS. The feed (`public/feed/index.html`) uses `scroll-snap-type: y mandatory` for the slide effect — zero JavaScript, smooth scrolling, works on mobile. This was a great example of letting CSS do the heavy lifting.

**What didn't work well**

- **The monolith approach for Vue.** While the single-file approach is simple, 3,700+ lines in one file is too much. Finding the right method or template requires constant searching. A future version should split into at least 5-7 files by view.
- **The `responded` flag pattern.** Using a boolean flag to prevent double-responses in async code is fragile. A better approach would be a wrapper function that guarantees single-response, or using Express 5's improved error handling.
- **ffmpeg error messages.** When ffmpeg fails, its error messages are cryptic and technical. The app doesn't surface them to the user, which makes debugging difficult. A future improvement would capture ffmpeg's stderr output and show it in the UI.

**If I were starting over**

I would still choose the same stack (Node.js + Express + SQLite + Vue.js + ffmpeg), but I would:
1. Split the Vue app into components from day one (even 5 files instead of 1)
2. Use a proper test framework and write tests alongside the code
3. Add a processing queue for ffmpeg operations so the server stays responsive during renders
4. Use TypeScript instead of plain JavaScript (catches null reference bugs at compile time)
5. Add an `AGENTS.md` from the start (it was invaluable for keeping an LLM-based assistant on track)

### Engineering wisdom that emerged

**The database migration pattern.** The code runs ALL migrations on every startup, with each wrapped in a `try/catch` that silently ignores "column already exists" errors. This is a pragmatic approach for a local tool, but it's not how professional applications work. Production systems use versioned migrations (a `_migrations` table that tracks which have run). The current approach works because the error is harmless, but it's technical debt.

**Consistent error handling.** Every API route follows the same pattern: wrap everything in a `try/catch`, call `sendApiError()` on failure. This is a good pattern — it means every route returns consistent error responses. But it's boilerplate-heavy. A more elegant approach would be a single Express error-handling middleware that catches all thrown errors automatically.

**The importance of `catch(() => {})` with a comment.** Several places in the code silently catch errors (like the analytics tracking in the published player). These were added because the operation is "nice to have, not critical." But silent catches make debugging impossible. A better practice is: catch, but log the error (even to `console.warn`). That way, development issues are visible, but failures don't break the user experience.

---

## 8. Quick Reference Card

### How to run the project

**Step 1: Make sure Node.js is installed**

Open a terminal (Command Prompt or PowerShell) and type:
```powershell
node --version
```

If you see a version number (like `v20.0.0`), you're good. If you see an error, download Node.js from https://nodejs.org and install it.

**Step 2: Install dependencies**

In the project folder, run:
```powershell
npm install
```

This downloads all the packages the app needs. It might take 30-60 seconds the first time.

**Step 3: Start the server**

The easiest way:
```powershell
.\start-mya-studio.ps1
```

Or directly:
```powershell
node server.js
```

**Step 4: Open the studio**

Open your browser and go to:
```
http://127.0.0.1:3000
```

**Step 5: Open the feed (optional)**

Open a second tab:
```
http://127.0.0.1:3001
```

### Running in the background

```powershell
.\start-mya-studio.ps1 -Detach
```

This starts the server and immediately returns you to the command prompt. The server continues running in the background. To stop it, either:
- Find the process ID in `.mya-server.pid` and kill it, or
- Restart your computer

### Key URLs

| What | URL |
|---|---|
| Mya Studio (the app) | http://127.0.0.1:3000 |
| Interactive Feed | http://127.0.0.1:3001 |
| Published movie (example) | http://127.0.0.1:3000/exports/my_movie/index.html |

### Important files

| File | Why it matters |
|---|---|
| `server.js` | Everything starts here. If the server won't start, check this file. |
| `public/index.html` | The entire studio interface. Most user-facing changes happen here. |
| `lib/published-player.js` | Generates published movies. If export looks wrong, check here. |
| `database.sqlite` | All your projects. Back this up! |
| `.mya-server.err.log` | Error logs when running in detached mode. Check this if something breaks silently. |

### Most common commands

```powershell
npm install              # Install or update dependencies
node server.js           # Start the server
.\start-mya-studio.ps1   # Start with auto-runtime detection
npm test                 # Run the test suite (2 tests)
```

### When something breaks

| Problem | Likely cause | What to try |
|---|---|---|
| Server won't start, port in use | Another program on port 3000 | Set `$env:PORT = "3005"` before starting |
| "Cannot find module" error | Dependencies not installed | Run `npm install` |
| Video upload fails | File too large | Files must be under 800 MB |
| Clip rendering fails | Corrupted video file | Try a different video file |
| Published player doesn't show choices | Vue runtime missing | Check `public/vendor/vue.global.prod.js` exists |
| Feed doesn't show new movies | Autorefresh not triggered | Wait up to 15 seconds, or refresh the page |
| Database error | Corrupted database | Stop server, delete `database.sqlite`, restart (you'll lose projects) |
| "ffmpeg not found" error | ffmpeg-static not installed | Run `npm install` to reinstall dependencies |

### How to get help

Since Mya Studio is a personal/local tool, there's no support team. But here's what you can do:

1. **Check the error logs** — If running detached, look in `.mya-server.err.log`
2. **Check the terminal** — The server prints errors to the console. Scroll up.
3. **Search the code** — Most issues are caused by configuration or file paths. Search `server.js` for the error message.
4. **Reach out to the developer** — This was created by a solo developer (amanh). Open an issue on GitHub or reach out through the repository.

---
*This document was generated from a comprehensive analysis of the Mya Studio codebase. It reflects the state of the project as of May 2026.*
