# Repository Guidelines

## Project Structure & Module Organization
This repository is a small Node.js app centered on [`server.js`](server.js), which defines the Express API, SQLite schema, upload handling, and ffmpeg clip/export logic. Static UI and generated media live under `public/`:

- `public/index.html`: browser entry point
- `public/videos`, `public/audio`: uploaded source files
- `public/clips`, `public/thumbnails`, `public/exports`: generated outputs

Runtime data is stored in `database.sqlite`. Helper startup logic lives in `start-mya-studio.ps1`. Treat `node_modules/`, log files, and generated media as build/runtime artifacts, not source.

## Build, Test, and Development Commands
- `npm install`: installs Express, SQLite, ffmpeg bindings, and upload dependencies.
- `.\start-mya-studio.ps1`: preferred local launcher on Windows; selects a working JS runtime automatically.
- `.\start-mya-studio.ps1 -Detach`: runs the server in the background and writes `.mya-server.out.log` / `.mya-server.err.log`.
- `node server.js`: direct startup if your local Node runtime is healthy.

The app listens on `HOST` and `PORT`; defaults are `127.0.0.1` and `3000`.

## Coding Style & Naming Conventions
Match the existing code style in `server.js`: 4-space indentation, semicolons, CommonJS `require`, and concise route handlers. Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for environment-driven constants, and descriptive API paths such as `/api/create_event_clip`. Keep filesystem paths rooted with `path.join(__dirname, ...)`.

## Testing Guidelines
Automated tests live in `tests/` and run with `npm test` (`node --test tests/published-player.test.js tests/movie-agent.test.js`). Keep them green after touching `lib/` or the publish path. For UI changes in `public/index.html`, also verify manually by:

1. Starting the app locally.
2. Uploading a sample video/audio file.
3. Creating a clip or event clip and confirming generated files appear under `public/`.
4. Checking for database or ffmpeg errors in the console or `.mya-server.err.log`.

If you add tests, place them in a dedicated `tests/` directory and wire a real `npm test` script before merging.

## Commit & Pull Request Guidelines
Git history is not available in this workspace, so no repository-specific commit convention could be verified. Use short, imperative commit subjects such as `Add guard for missing clip metadata`. PRs should include a clear summary, manual verification steps, linked issue/task if applicable, and screenshots when `public/index.html` behavior changes.

## Pushing to GitHub (learned 2026-10-01)

- `git push origin main` over HTTPS has no auth on this VM (fails asking for a username).
- Push via the Git Data API using the vault `custom.github` credential through
  `dynamic_credentials.add_surrogate_to_request` (see `/opt/hatch/skills/skill-creator/bin`).
- The old helper `/tmp/myatest/gh_push_myastudio.py` uses a HARDCODED file list —
  it silently drops new files. Never use it for commits that add files.
- Correct flow: build the tree from `git ls-tree -r --name-only <commit>`, upload
  every file as a blob, create the commit, then PATCH `/repos/instafire/MyaStudio/git/refs/heads/main`
  (note: `refs` plural). The API needs FULL 40-char SHAs everywhere — short SHAs 422.
- After pushing, `git fetch origin main && git reset --hard origin/main` to sync,
  then verify new files exist on the remote tree before claiming done.
