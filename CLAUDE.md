# Drawset — working notes for Claude

1. Read PROGRESS.md and PLAN.md first. They say where the build is and what is next.
2. Read only the SPEC.md sections you need for the current item (SPEC.md is the original brief, kept unchanged).
3. Follow the autonomy rules in SPEC.md: decide, log the decision in DECISIONS.md, keep building. Stop and ask only for the four critical cases (something only William can provide, cost or licence change, destructive git/release actions, a Tier 1 feature impossible after two different approaches).
4. Every item: build with tests, run the area unit tests plus a Playwright smoke test, tick it in PLAN.md, add 2–5 lines to PROGRESS.md, commit and push.
5. Australian English in the UI and docs. Never use Bluebeam or Revu names or artwork in the app.

## Commands
- `npm run dev` — web build in Vite (http://localhost:5173)
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest, quiet), `npm run e2e` (Playwright Chromium)
- `npm run fixtures` — regenerate test PDFs into `fixtures/` (git-ignored)
- Cloud sessions: `export ELECTRON_SKIP_BINARY_DOWNLOAD=1` before `npm ci`. The installer is only built in CI.

## Layout
- `src/engine/` PdfEngine interface (`types.ts`), MuPDF core (`core/`), Web Worker and RPC client.
- `src/markup/` markup model, geometry, PDF appearance-stream writer, canvas drawing.
- `src/features/*` UI by feature. `src/state/` Zustand stores and undo.
- `electron/` thin shell. `scripts/` fixture generator. `tests/unit`, `tests/e2e`.
