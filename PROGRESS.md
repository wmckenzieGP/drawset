# Progress

**Current item:** T1.18 Tier 1 release (waiting on S3 for the Windows build)
**Last finished:** T1.17 print
**Next up:** Tier 2 from T2.1 while S3 is blocked

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
