# Tier reports

## Tier 2: takeoff and review (v0.2), 16 October 2026

**State:** all Tier 2 features are built and tested (T2.1 to T2.8). The v0.1 and v0.2 tags and the
Windows installer wait for the CI and release workflows, which GitHub would not let the build add
(see "Waiting on William" below).

### What is new
- **Calibration** (T2.1): preset metric and imperial scales or two picked points, per page, for all
  pages or a range, with display unit and decimal places. Stored as a full-page /VP viewport with
  /Measure /RL, so other editors read the same scale.
- **Measurements** (T2.2): length, polylength, area with cutouts, perimeter, count and angle, with
  captions in the appearance stream, standard dimension intents and /Measure dictionaries. Values
  recalculate when the page scale changes, in the same undo step.
- **Quantities** (T2.3): Measurement column and totals in the Markups List, and a quantities CSV
  with unrounded values and totals per type and unit.
- **Erase and redact** (T2.4): areas or search results become pending /Redact annotations that can
  be saved and reviewed; applying them removes the content and rewrites the whole file.
- **Overlay pages** (T2.5): any two open pages in red and blue, shared content in black, toggles,
  two-point alignment, and export as an image-based PDF whose caption says so.
- **Tool Chest** (T2.6): save a markup as a tool (draw with its properties or place a copy), sets,
  recents, JSON export and import, kept on this computer.
- **Replies** (T2.7): threaded replies written as /IRT /RT /R, shown in Properties and as expandable
  rows in the Markups List.
- **Snapping** (T2.8): markup vertices, a millimetre grid, and the drawing's own line ends and
  intersections, switched in the status bar; Alt held draws without snapping.

### Tests at the end of Tier 2
- Typecheck and lint clean.
- 75 unit tests in 14 files (Node, MuPDF in-process; pdf.js as the independent check for every
  writer): all pass.
- 23 browser tests (Chromium, the app's own engine in a Web Worker): all pass.
- Accuracy: calibration-sheet lengths, areas and perimeters measure within 0.1%; analytic area and
  cutout cases match exactly up to MuPDF's single-precision storage (about 1e-7 relative).
- Performance checks still met: first page of the 200-page set under 2 s; Markups List with 5,000
  markups p95 frame under 50 ms; saving 500 markups under 3 s.

### Screenshots
`docs/screenshots/`: `markups.png`, `measurements.png`, `replies-toolchest.png`, `overlay.png`.

### Known issues and limits
- Imperial lengths show decimal feet or inches, not feet-and-inches (DECISIONS.md 14).
- Erase and redact remove line art only when it lies wholly inside the area; MuPDF cannot cut
  paths (DECISIONS.md 16).
- Overlay export is an image, by design; it is labelled as such on the page and in the document
  subject.

### Waiting on William
- Add `ci-workflows/ci.yml` and `ci-workflows/release.yml` to `.github/workflows/` (the build's
  GitHub access lacks the `workflow` permission). Then the Windows installer is built in CI, which
  completes T1.3, and v0.1 and v0.2 can be tagged with the installer attached to each Release.

## Tier 1: core editor (v0.1)

**State:** every Tier 1 feature except the Windows installer build is done and tested (T1.1, T1.2,
T1.4 to T1.17). The Electron app bundles locally; the installer and the v0.1 tag wait for the
workflows above.

Highlights: tabs and continuous tiled viewing, thumbnails, bookmarks, page labels, search and
text copy; 17 markup types written as standard annotations with appearance streams and read back
exactly; editing with undo and redo; Properties panel; incremental save that keeps every unknown
key from other editors byte for byte; flatten with confirmation; Markups List with CSV export;
page operations; print.
