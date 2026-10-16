# Progress

**Current item:** T1.18 Tier 1 release (waiting on S3 for the Windows build)
**Last finished:** T1.17 print
**Next up:** T2.8 snapping (Tier 2 continues while S3 is blocked)

## How to install
Download `Drawset-Setup-<version>.exe` from the latest GitHub Release (https://github.com/wmckenziegp/drawset/releases) and run it. Windows SmartScreen may warn because the installer is not code-signed: choose "More info" then "Run anyway".

## Known issues
- CI and release workflows are not installed yet: GitHub refused them because the build's access lacks the `workflow` permission. They are in `ci-workflows/` for William to copy into `.github/workflows/`.
- Pages inserted from another file bring their markups but not form fields or links to other pages in that file.

## Log
- S1: Saved SPEC.md unchanged; wrote CLAUDE.md, PLAN.md, DECISIONS.md and this file.
- S2: `npm run fixtures` writes six PDFs (dense A1 with 20,000 paths, 1:100 calibration sheet with calibration.json, 200-page labelled set with 10 planted terms, scanned page, annotated PDF with vendor private keys and a review-state reply, form PDF). `tests/unit/fixtures.test.ts` checks them in MuPDF and pdf.js. BIG=1 makes a ~100 MB set.
- S3: blocked. Pushing `.github/workflows/*` is refused without the `workflow` permission, by git and by the GitHub API. Files kept in `ci-workflows/`; asked William to add them.
- T1.1–T1.2: shell, engine worker and RPC done earlier; unit tests open every fixture in Node, e2e opens the 200-page set (first page under 2 s).
- T1.4–T1.6: e2e covers thumbnails, bookmarks, label lookup (M-42), rotate view, zoom/fit, search for all planted terms, text select and copy. Fixed the rotate-view shortcut to match the menu (Ctrl+Shift+Plus/Minus).
- T1.7–T1.10: `roundtrip.test.ts` writes all 17 markup types to a blank page, checks the ISO keys per type, reads them back, and compares pdf.js with MuPDF renders. Found and fixed: image stamps read back as stamps; a crash reading polygons without /BE.
- T1.11–T1.12: unit tests for move/resize/vertex/hit-test/copy/lock/delete with undo/redo; e2e draws every shape tool, moves and resizes, edits properties and saves. Ctrl shortcuts now work from lists and sliders in the panel.
- T1.13: `preserve.test.ts` edits two annotations in the annotated fixture, saves incrementally, and checks every other key (including BSI* and unknown keys) is unchanged and the original bytes are a prefix.
- T1.14: flatten removes every markup annotation; pdf.js render after equals render before (<0.2% pixels). E2E checks the confirmation (cancel changes nothing).
- T1.15: CSV test checks every row against the model; cells that would run as spreadsheet formulas get a leading apostrophe; text columns sort with a collator; ties no longer reorder when a row is edited. E2E: 5,000 markups, virtualised rows, p95 frame under 50 ms, filter, status, export. 500 markups save in well under 3 s.
- T1.16: unit tests for reorder/rotate/delete/insert blank/insert from file/extract with undo, checked in MuPDF and pdf.js. Found and fixed: inserted pages lost their markups (MuPDF's graftPage drops /Annots).
- T1.17: e2e checks the print view has the chosen pages at actual size (A1 = 841 × 594 mm).
- T2.1: page scales (metric 1:1–1:1000 presets, imperial presets, or two picked points and a known length) for one page, all pages or a range; precision and display units; stored as /VP viewports with /Measure /RL (R, X, D, A number formats). Full-page viewports are replaced; smaller detail viewports are kept. Scale changes are one undo step and recalculate measurements. The calibration fixture measures within 0.1%.
- T2.2: length, polylength, area with cutouts (polygon-clipping, analytic tests incl. overlapping and partly outside cutouts), perimeter, count and angle, each with a caption drawn into its appearance stream. Written as /Line /IT /LineDimension, /PolyLine /IT /PolyLineDimension, /Polygon /IT /PolygonDimension with /Measure; values identical after reopening. Measurements panel shows the page scale, the selection and page totals.
- T2.3: Markups List has a Measurement column and totals by type and unit; Export quantities writes unrounded values plus totals (unit test checks totals equal the sum). Fixed a layout bug where a wide toolbar pushed the right panel off screen.
- T2.4: Erase and Redact tools (drag an area) and "Mark all for redaction" on search results create pending /Redact annotations that can be saved, reviewed and removed. "Review and apply redactions" applies them all with MuPDF (text removed, image pixels cleared, line art wholly inside removed; black box for redactions, blank for erase) and saves in full, never incrementally. Unit and e2e tests check the text is absent from MuPDF and pdf.js extraction while neighbouring text stays.
- T2.5: Tools > Overlay pages… compares any two pages from any open files: shared ink black, red-only and blue-only in colour, with show/hide toggles and two-point alignment (scale, rotation and shift). Unit test: identical pages give zero colour, different pages give both colours, the alignment maps both point pairs exactly. Export writes an image-only PDF with a caption saying it is image-based; checked in MuPDF and pdf.js (text, image XObject, render).
- T2.6: Tool Chest panel (left panel, and Edit > Add to Tool Chest). Tools draw with their saved properties or place an exact copy (switchable per tool); sets, recents, rename/delete, JSON export and import; kept in the app's local storage. Unit test: for all 20 drawable kinds, a tool taken through JSON export and import places a markup whose properties equal the original's, in memory and after writing and reading both from a PDF. E2E covers draw, copy, export, import and persistence after reload.
- T2.7: Reply threads in the Properties panel (reply to a markup or to a reply, edit, delete; each an undo step) and in the Markups List (Replies column, expandable reply rows, Show replies, filter matches reply text, CSV Replies column). Written as /Text with /IRT and /RT /R, an empty appearance, and updated in place on incremental save. Tests: thread written and read back with its shape, pdf.js sees the same /IRT chain, page renders unchanged in MuPDF and pdf.js, edit/delete keep the rest; nested replies from other editors without /NM read correctly; /RT /Group is not a reply.
