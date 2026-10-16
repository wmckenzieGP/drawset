# Decisions

Fixed decisions are in SPEC.md ("Decisions"). Everything else is logged here, newest last.

| # | Date | Decision | Why |
|---|------|----------|-----|
| 1 | 16/10/2026 | Work happens on branch `claude/project-thread-paqhll` (the branch this build session was given); releases are tagged from it. `main` is brought up to date by a pull request at each tier end. | The session's git rules only allow pushing to that branch. Tags drive releases regardless of branch. |
| 2 | 16/10/2026 | The MuPDF engine is a plain class (`src/engine/core`) that runs in Node for unit tests and inside the Web Worker for the app. The worker is a thin RPC wrapper. | One code path for tests and app; tests need no browser. |
| 3 | 16/10/2026 | Pages are a virtual list in the app (page id → source document page + extra rotation). Reorder, rotate, delete and insert are pure model edits, so they are undoable like markups. Inserted pages are grafted into the document immediately and the order is applied with `rearrangePages` when saving. | Makes page operations undoable and keeps markups attached to pages by id. |
| 4 | 16/10/2026 | Markups are held in the app model (source of truth while editing) and written to the PDF only on save, matched to existing annotations by object number then /NM. Untouched annotations are never rewritten. | Undo/redo stays in plain JS; unknown and Revu-made keys are preserved because only edited annotations are touched, and only the keys Drawset manages are rewritten. |
| 5 | 16/10/2026 | Drawset writes its own appearance streams for every markup type (content in PDF user space, identity /Matrix) instead of MuPDF's synthesised ones. The same geometry code draws the on-screen overlay. | Control over clouds, highlighter blend mode, measurement captions and stamps, and one geometry source for screen and file. |
| 6 | 16/10/2026 | Page tiles render page content and form widgets only; markups draw on the overlay canvas from the model. Annotation types Drawset does not model are shown from their own /AP rendered by MuPDF. | Editing markups never needs a page re-render; foreign annotations still look exactly as their author made them. |
| 7 | 16/10/2026 | Drawset-only data is stored in one private key per annotation, `/DrawsetData`, holding a JSON string. | Spec asks for one namespaced private key. |
| 8 | 16/10/2026 | Saving with a changed page structure (reorder, delete, insert) clears undo history; saving markups or rotations only keeps it. | Page sources are re-based on the saved document. |
| 9 | 16/10/2026 | Electron serves the built app from a custom `app://` protocol. | MuPDF's WebAssembly and module workers need a real origin; `file://` blocks them. |
| 10 | 16/10/2026 | Printing renders each page (with or without markups) to a high-resolution image in a print-only view and uses the system print dialog. | Electron cannot print a PDF directly; rasterising for the printer does not change the file. |

## 11. CSV cells that look like formulas get a leading apostrophe
Markups from other people's files can contain text such as `=HYPERLINK(...)`, which Excel would run when the CSV is opened. Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'` unless the whole cell is a plain number. Spreadsheets show the text unchanged.

## 12. Imported pages bring their markups, not form fields or page links
MuPDF's `graftPage` copies page content but not /Annots, so annotations are grafted separately with /P rewritten. Widgets need the source file's AcroForm and links to its other pages would drag the whole source page tree along, so those two are left behind.

## 13. How measurements are stored
Length, polylength and area/perimeter use the ISO dimension intents (/LineDimension, /PolyLineDimension, /PolygonDimension) with a /Measure /RL copy of the page scale, so other editors list them as measurements. There is no standard intent for counts and angles: a count is an /Ink annotation with one single-point stroke per item, and an angle is a three-vertex /PolyLine with no intent; both carry their kind in /DrawsetData and draw correctly anywhere from their appearance streams. /Contents holds the displayed value (what other editors show), followed by the user's comment; the comment and area cutouts are kept in /DrawsetData. Values are recomputed from geometry and scale, never read back from /Contents.

## 14. Page scale lives on the page, measurements follow it
Each page has at most one scale (its full-page viewport). Setting a scale updates every measurement on that page in the same undo step. A measurement read from another editor uses its own /Measure; without one it uses the page's. Imperial feet-and-inches display (12'-6") is not offered; imperial scales show decimal feet or inches.

## 15. Area fills multiply
Area measurements default to a pale solid fill drawn with the Multiply blend mode, so the drawing stays visible underneath and captions stay readable (an opacity-based fill also fades the caption).

## 16. Redactions are pending annotations until applied, and applying rewrites the whole file
Erase and redact areas are saved as /Redact annotations (erase marked in /DrawsetData) so they can be reviewed, shared and removed. Applying uses MuPDF's redaction per annotation: text removed, image pixels cleared, and line art removed only when wholly inside the area (MuPDF cannot cut paths). The save that applies them is a full, garbage-collected rewrite, because an incremental save would keep the removed content in the file's earlier revision.
