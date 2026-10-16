# Plan

Each item is about 2 hours or less. Tick `[x]` when its acceptance criteria pass; mark `[deferred]` with what was tried and what is left.

## Setup
- [x] S1 SPEC.md, CLAUDE.md, PLAN.md, PROGRESS.md, DECISIONS.md. *Accept:* files exist in the repo root.
- [x] S2 Fixture generator (`npm run fixtures`). *Accept:* produces dense A1 (~20,000 paths), calibration sheet, 200-page set with planted search terms, scanned page, annotated PDF (several types, unknown and Revu-style private keys), form PDF; a unit test opens each with MuPDF and pdf.js.
- [ ] S3 (blocked: GitHub refuses workflow files without the `workflow` permission; files wait in `ci-workflows/`) GitHub Actions. *Accept:* `ci.yml` runs typecheck, lint, unit and Playwright tests on Ubuntu and builds the NSIS installer on windows-latest; `release.yml` attaches the installer to a GitHub Release on `v*` tags.

## Tier 1 — Core editor (release v0.1)
- [x] T1.1 App scaffold: Vite + React + strict TS, ESLint, Vitest, Playwright, dark theme shell with menu bar, toolbar, side panels and status bar. *Accept:* typecheck/lint pass; smoke test loads the shell.
- [x] T1.2 PdfEngine interface, MuPDF core, Web Worker + RPC. Open, page sizes, labels, outline, tile render, structured text. *Accept:* unit tests open all fixtures in Node; render returns pixels; worker opens a file in the browser test.
- [ ] T1.3 Electron shell: app:// protocol, open/save/save-as dialogs, save in place, recent files, PDF file association, single instance, print. *Accept:* `npm run build:electron` bundles; windows CI job produces `Drawset-Setup-*.exe`.
- [x] T1.4 Viewer core: tabs, open by dialog / drag-drop / recent, continuous scroll, tiled rendering with low-res preview first, wheel zoom, fit page, fit width, pan (space-drag, middle mouse). *Accept:* e2e opens the 200-page fixture and shows page 1 in < 2 s; zoom and fit commands change scale as expected.
- [x] T1.5 Navigation: thumbnails panel, go to page number or label, rotate view, bookmarks panel, marquee zoom. *Accept:* e2e: clicking a thumbnail/bookmark scrolls to that page; label lookup works; rotate view turns pages 90°.
- [x] T1.6 Text search with highlighted results; text select and copy. *Accept:* search finds every planted term in the 200-page fixture; copied text equals source text.
- [x] T1.7 Markup model, undo/redo command stack, overlay renderer, appearance-stream writer, save/reopen round trip for rectangle. *Accept:* unit tests write a rectangle, reopen with MuPDF and pdf.js, check /Subtype /Rect /AP /NM /T /Subj /CreationDate.
- [x] T1.8 Shape tools: rectangle, ellipse, line, arrow, polyline, polygon, cloud, pen, highlighter; reuse mode; Shift ortho/45°. *Accept:* each type round-trips with correct dictionary keys (/IC, /BS /D, /CA, /BE, /Vertices, /LE, /InkList, Multiply for highlighter); pdf.js render matches MuPDF render within tolerance.
- [x] T1.9 Text tools: text box, callout, note; text highlight, underline, strikethrough. *Accept:* /FreeText with /DA and /RC; callout /IT /FreeTextCallout + /CL; /Text with /Popup; text markups with /QuadPoints from the text selection; all round-trip and render in pdf.js.
- [x] T1.10 Stamps (original built-in set, custom image stamps) and image markup. *Accept:* /Stamp with vector /AP for built-ins and image /AP for custom/image; round-trip and pdf.js render.
- [x] T1.11 Editing: select, marquee-select, move, resize, edit vertices, delete, copy/paste, duplicate, lock. *Accept:* unit tests of editing commands incl. undo/redo; e2e moves and resizes a markup and undoes it.
- [x] T1.12 Properties panel: colour, fill, opacity, line width, dash, line ends, font and size, author, subject, comment, status. *Accept:* each change is one undoable command; status writes a /StateModel /Review reply on save.
- [x] T1.13 Load and preserve existing annotations (incl. Revu-style private keys), save in place (incremental) and save a copy. *Accept:* annotated fixture edited and saved keeps every annotation and every unknown key byte-for-byte equal; incremental save appends to the original bytes.
- [x] T1.14 Flatten markups with confirmation. *Accept:* after flatten, no markup annotations remain and pdf.js render matches pre-flatten render.
- [x] T1.15 Markups List: columns, sort, filter, click to zoom, bulk status, CSV export; smooth with 5,000 markups. *Accept:* CSV equals the model exactly (unit test); e2e scrolls a 5,000-markup list; saving 500 markups < 3 s.
- [x] T1.16 Page management: reorder by dragging thumbnails, rotate, delete, insert blank or from file, extract, combine, split by range. *Accept:* unit tests produce valid PDFs (reopen in MuPDF and pdf.js), page counts/order/rotation correct, markups stay with their pages; every op undoable.
- [x] T1.17 Print with or without markups, fit to page or actual size. *Accept:* print view renders the right pages at the right size; e2e checks the print DOM.
- [ ] T1.18 Tier 1 release: full suite, screenshots, tier report, tag v0.1, installer on the Release.

## Tier 2 — Takeoff and review (release v0.2)
- [x] T2.1 Calibration: two-point or preset scale (metric 1:1–1:1000, imperial), page or range, precision and units, stored as /VP /Measure /RL. *Accept:* calibration fixture measures within 0.1%; /VP valid after reopen.
- [x] T2.2 Measurements: length, polylength, area with cutouts, perimeter, count, angle; captions; Measurements panel; recalculation on scale change. *Accept:* analytic area/length tests; /IT dimension intents with /Measure; values identical after reopen.
- [x] T2.3 Measurement columns and totals in the Markups List; quantities CSV. *Accept:* CSV totals equal the sum of measurements.
- [x] T2.4 Erase and redact (area and searched text) with review before applying. *Accept:* text under the area is absent from extraction after apply.
- [x] T2.5 Overlay pages: two pages, red/blue, two-point alignment, toggles, export as image-based PDF labelled as such. *Accept:* overlay of identical pages shows no colour difference; export opens in pdf.js.
- [x] T2.6 Tool Chest: save markup as tool, sets, recents, JSON import/export. *Accept:* a tool reproduces the original markup's properties exactly.
- [x] T2.7 Replies: threaded replies (/IRT /RT /R) shown in the Markups List. *Accept:* replies round-trip and display.
- [x] T2.8 Snapping: markup vertices and grid, then page vector endpoints/intersections. *Accept:* snapped points equal target coordinates.
- [ ] T2.9 Tier 2 release v0.2. (Suite, screenshots, tier report and PR to main done; tag and installer wait on S3.)

## Tier 3 — Only if ahead (release v0.3)
- [x] T3.1 Compare documents (raster diff, clouds listed as markups). *Accept:* a revised sheet gets one cloud around each change and none elsewhere; identical pages get none.
- [ ] T3.2 Split view with synced pan, zoom and page.
- [ ] T3.3 Page labels from a title-block region; bookmarks from labels.
- [ ] T3.4 Forms: fill, save, flatten.
- [ ] T3.5 Headers, footers and watermarks with date, file name, page label and "page n of N" variables.
- [ ] T3.6 Hyperlinks: link an area to a page, a file or a URL, with back navigation.
- [ ] T3.7 Security: add or remove an open password and permission restrictions.
- [ ] T3.8 Crash recovery: journal unsaved markups every 60 s and offer to restore after a crash.
- [ ] T3.9 OCR: invisible text layer for scanned pages with tesseract.js.
- [ ] T3.5 Headers, footers and watermarks with variables.
- [ ] T3.6 Hyperlinks to page, file or URL with back navigation.
- [ ] T3.7 Security: open password and permissions.
- [ ] T3.8 Crash recovery journal every 60 s.
- [ ] T3.9 OCR text layer with tesseract.js.
- [ ] T3.10 Tier 3 release v0.3 and final report.
