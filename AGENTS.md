# Repository Guidelines

## Project Structure & Module Organization
This repository is a small Node.js app centered on [`server.js`](server.js), which defines the Express API, SQLite schema, upload handling, and ffmpeg clip/export logic. Static UI and generated media live under `public/`:

- `public/index.html`: browser entry point
- `public/videos`, `public/audio`: uploaded source files
- `public/clips`, `public/thumbnails`, `public/subtitles`, `public/exports`: generated/user media
- `lib/security.js`: local-network, upload, import-column, and asset-path guards

Runtime data is stored in `database.sqlite` in the repository by default; `MYA_DATABASE_PATH` can override this intentionally. Helper startup logic lives in `start-mya-studio.ps1`. Treat `node_modules/`, log files, and generated media (including subtitles) as build/runtime artifacts, not source.

## Build, Test, and Development Commands
- `npm install`: installs Express, SQLite, ffmpeg bindings, and upload dependencies.
- `.\start-mya-studio.ps1`: preferred local launcher on Windows; selects a working JS runtime automatically.
- `.\start-mya-studio.ps1 -Detach`: runs the server in the background and writes `.mya-server.out.log` / `.mya-server.err.log`.
- `node server.js`: direct startup if your local Node runtime is healthy.

The studio listens on `HOST`/`PORT` (default `127.0.0.1:3000`) and the feed on `FEED_HOST`/`FEED_PORT` (default `127.0.0.1:3001`). Both hosts must be loopback addresses and the ports must be valid and distinct. The APIs are unauthenticated, so do not expose them to non-local networks; CORS is restricted to local origins on those ports. Uploads are limited to supported media file types and 800 MB.

## Coding Style & Naming Conventions
Match the existing code style in `server.js`: 4-space indentation, semicolons, CommonJS `require`, and concise route handlers. Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for environment-driven constants, and descriptive API paths such as `/api/create_event_clip`. Keep filesystem paths rooted with `path.join(__dirname, ...)`.

## Testing Guidelines
Automated tests live in `tests/` and run with `npm test`. Keep them green after touching `lib/`, upload handling, import/export, or the publish path. For UI changes in `public/index.html`, also verify manually by:

1. Starting the app locally.
2. Uploading a sample video/audio file.
3. Creating a clip or event clip and confirming generated files appear under `public/`.
4. Checking for database or ffmpeg errors in the console or `.mya-server.err.log`.

If you add tests, place them in a dedicated `tests/` directory and include them in the `npm test` script.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so no repository-specific commit convention could be verified. Use short, imperative commit subjects such as `Add guard for missing clip metadata`. PRs should include a clear summary, manual verification steps, linked issue/task if applicable, and screenshots when `public/index.html` behavior changes.

## Branches and Pull Requests

- Keep review work on an isolated `review/...` branch; never push review commits directly to the default branch.
- Open a draft pull request with a concise summary and reproducible verification results; do not merge it as part of a review.
- Use the configured GitHub integration and avoid credential-bearing scripts or helpers with hard-coded file lists.
