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
- [x] T3.2 Split view with synced pan, zoom and page. *Accept:* scrolling or zooming one pane moves the other to the same page, spot and zoom; sync can be turned off.
- [x] T3.3 Page labels from a title-block region; bookmarks from labels. *Accept:* every sheet of the 200-page set is labelled from its title block; /PageLabels and /Outlines read back in MuPDF and pdf.js.
- [x] T3.4 Forms: fill, save, flatten. *Accept:* text, check box, choice and radio fields filled in Drawset read back with the same values and appearances in MuPDF and pdf.js; flattening leaves no widgets and the page looks the same.
- [x] T3.5 Headers, footers and watermarks with date, file name, page label and "page n of N" variables. *Accept:* text at the six positions and a diagonal watermark appear on every chosen page in MuPDF and pdf.js with the right page numbers and labels; they follow page moves, can be removed, and the original content streams are untouched.
- [x] T3.6 Hyperlinks: link an area to a page, a file or a URL, with back navigation. *Accept:* links drawn in Drawset are standard /Link annotations that MuPDF and pdf.js follow to the same page, address or file; links from other files are read and edited in place; Back and Forward return through visited pages.
- [x] T3.7 Security: add or remove an open password and permission restrictions. *Accept:* protected files open with their password; new passwords and permissions (AES-256) are honoured by MuPDF and pdf.js; restricted files need the permissions password before Drawset changes them; security can be removed.
- [x] T3.8 Crash recovery: journal unsaved markups every 60 s and offer to restore after a crash. *Accept:* after an unclean exit the next start lists each document with unsaved changes; restoring reopens the file and brings back markups, page order, rotation, labels, bookmarks, form values and headers as one undo step; saving or closing on purpose removes the journal.
- [x] T3.9 OCR: invisible text layer for scanned pages with tesseract.js. Accept: a scanned sheet's notes are found by search in Drawset, MuPDF and pdf.js at the printed position; the page renders unchanged; undoable; works offline.
- [x] T3.10 Tier 3 release v0.3 and final report. (Tag and installer wait on the workflows, S3.)

## Tier 4 — Familiar workflow (after first use, 18/10/2026)
William's first use: Drawset should work like the markup app his team already uses (same keys, same places, same page layouts), keeping Drawset's own names and icons.
- [x] F1 Markups moved past the page edge stay selectable: dropped on another page they move to it (saved there once); otherwise they stay on their page. *Accept:* e2e drags a text box onto page 2 and selects it again; unit test saves it on page 2 with nothing left on page 1.
- [x] F2 Page layouts: single page (Ctrl+4), continuous (Ctrl+5), side by side (Ctrl+6), continuous side by side (Ctrl+7), with page keys (Page Up/Down, Ctrl+Left/Right, Home, End). *Accept:* e2e checks one page, then a pair, then the column, and page steps.
- [x] F3 Mouse wheel zooms or scrolls per layout (single: zoom, continuous: scroll by default), Ctrl swaps, switch on the navigation bar and in Preferences; scrolling past a single page turns to the next. *Accept:* e2e scroll, Ctrl+zoom, switch, page turn, remembered after reload.
- [x] F4 Shortcuts from one key map, matching the familiar keys for every command Drawset has; menus, tooltips and the F1 list read it. *Accept:* e2e presses tool and panel keys and finds them in menus and the list.
- [x] F5 Layout: menus File, Edit, View, Document, Tools, Window, Help; navigation bar under the document; status bar with Grid, Snap, Content, Markup, Reuse, Sync, sheet size, scale and pointer position; panels in bars on both sides, movable by right-click; bars can be hidden (F4, F8, F9). *Accept:* e2e moves a panel and toggles panels by key.
- [x] F6 Bring forward / to front, send backward / to back (Ctrl+J, Ctrl+Shift+J, Ctrl+[, Ctrl+Shift+[), saved as the /Annots order. *Accept:* unit test saves and reads back the new order.
- [x] F7 Bookmarks: add (Ctrl+B), rename, delete and drag to reorder.
- [x] F8 Group and ungroup markups (Ctrl+G, Ctrl+Shift+G); Ctrl+drag copies; Ctrl+Shift+drag copies in a straight line.
- [ ] F9 Text box: autosize (Alt+Z), typewriter tool (W); highlight tool draws a freehand highlight away from text. *(autosize and highlight done 18/10; typewriter open)*
- [x] F10 More markup tools with their keys: arc (Shift+C), dimension (Shift+L), Cloud+ (K), radius (Shift+Alt+U), diameter (Shift+Alt+D), volume (Shift+Alt+V). *(flag (Shift+F) left out until William says what he uses it for)*
- [x] F11 Format painter (Ctrl+Shift+C), plus align (Ctrl+Alt+L/E/R/T/M/B) and flip (Ctrl+Alt+H/V). Spaces/layers wait for William's next round of use.
- [x] F12 Right-click menus on markups, the page, selected text and while drawing, with the familiar commands in the familiar places. *Accept:* e2e right-clicks each kind and runs commands from them.
- [x] F13 Paste lands at the pointer (on whichever page it is over, kept on the page); Paste in place (Ctrl+Shift+V); pictures and text copied in other programs paste and drop onto pages. *Accept:* e2e pastes across pages, at the edge, in place, from the system clipboard and by dropping a file.
- [x] F14 Everyday editing: arrow keys nudge (Shift for 10), Esc deselects, Enter or F2 edits text, double-click opens the comment, hovering shows who made a markup and when. *Accept:* e2e for each.
- [x] F15 Freehand pen that joins strokes drawn close together into one markup, smooth curves, and an eraser that rubs out parts of pen strokes. *Accept:* e2e draws, joins, undoes each stroke and erases part and all of a stroke.
- [x] F16 Signatures: draw, type or use a photo or scan; kept on this computer; placed with a click or a dragged box, with the name and date underneath if wanted. *Accept:* e2e makes each kind, places it, saves and reads the picture back from the file.
- [x] F17 Pressing the wheel (or Space, or the Pan tool) and dragging moves the page every way, past where scrolling stops, as long as some of it stays in the window; wheel zoom keeps the dragged position; fit and go-to-page put it back. *Accept:* e2e drags a fitted page in all four directions, to the limit and back, zooms over a dragged page, and pans sideways with Space and the Pan tool.
- [x] F18 Markups may hang off the page edge and over the next page: moving and nudging no longer pull them back; the part off the page is drawn and can be clicked. *Accept:* e2e moves a text box half past two edges, picks it by its overhang and draws a callout past the edge; unit test saves and reads one back.
- [x] F19 Alt+Z keeps a text box's or callout's lines wrapped where they are and shrinks the box around them. *Accept:* unit test: same lines, box as wide as the widest.
- [x] F20 Markups move exactly with the page while scrolling (no lag and spring back). *Accept:* e2e checks the markup layer moves with the page before it is drawn again.
- [x] F21 Dragging a callout by its text box moves the box and the leader's bend while the arrow tip stays where it points; dragging the leader (or moving it with other markups) moves it all. *Accept:* unit test for the move; e2e drags the box, undoes, and drags the leader.
