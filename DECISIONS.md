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

## 17. Overlay compares page content, and shared ink is drawn black
Overlay renders each page's content without markups, at the same pixels per point, so drawings at one scale line up without alignment. Each pixel's ink is split into what both pages share (drawn black) and what only one page has (drawn red or blue), so identical pages show no colour even along anti-aliased edges. The export is an image of that view in a new PDF whose caption and document subject say it is image-based; nothing in the open documents changes, so there is nothing to undo.

## 18. Tool Chest tools keep properties, not identity
A tool stores the markup's kind, geometry, style, subject, text, note icon, stamp or image, and measurement cutouts. Author, dates, review status, lock and replies belong to each markup, so a placed copy gets the current author and fresh dates. Measurements take the scale of the page they are placed on, since a value at another page's scale would be wrong. Tools for stamps, images, text boxes, callouts, notes and counts start in copy mode (click to place), others in drawing mode; each tool can be switched. Text highlights and redactions cannot be tools because they depend on what is under them. The chest is stored in the app's local storage on this computer; sets move between computers as JSON files (format "drawset-toolset", version 1, images as base64).

## 19. Replies are invisible /Text annotations in one flat thread per markup
Each reply is a /Text annotation with /IRT (the markup, or the reply it answers), /RT /R, author, dates, /NM and an empty appearance stream, so viewers that understand /IRT list it under its markup and viewers that do not draw no stray note icon. Replies to replies keep their /IRT chain in the file and show indented in Drawset; the whole chain belongs to the first markup. Deleting a reply deletes the replies that answer it. Status changes stay separate /StateModel /Review annotations and are not listed as replies.

## 20. Snapping order and tolerance
Within 8 screen pixels the nearest markup vertex or drawing end point wins; only when there is none does a crossing of two drawing lines count; only when there is neither does the grid apply. Curves offer their end points but not intersections. Snapping is off while Shift constrains an angle or Alt is held, and freehand pen, highlighter, text and zoom tools never snap. MuPDF reads content-stream numbers in single precision, so a snapped point equals the drawn coordinate to about 1e-5 pt.

## 21. Page labels are written as one prefix per page
Labels read from title blocks are arbitrary text, so /PageLabels gives each page its own range with the label as /P and no numbering style; every viewer shows exactly that text. When pages are reordered or deleted in a file that has its own labels, the labels are rewritten for the new order so each stays with its sheet. Generated bookmarks replace the old ones (undoable) and point at the page objects with /Fit.

## 22. Form values live in the undo history; the engine follows
Filled values are part of the undoable document state (only the fields that differ from the file). A store subscriber sends just the changed values to the engine, which sets them with MuPDF's widget API and regenerates their appearance streams, so the page, thumbnails, print and save all show the same values. Clicking a check box or radio button on the page toggles it; text and list fields are edited in the Forms panel rather than in place, which keeps one editing path and one undo step per field. Typing in one text field within 1.5 s is one undo step. Flattening forms is a separate command from flattening markups, asks first, and removes /AcroForm along with the widgets. Signature fields and buttons are listed but not filled.

## 23. Headers, footers and watermarks are separate, tagged content streams
Each decorated page gets a "q" stream before its own content and one stream after it holding a "Q", our text and the watermark, all tagged /DrawsetData << /Role /HeaderFooter >> and wrapped in /Artifact /Pagination marked content (Header, Footer, Watermark), so text extraction and accessibility tools can skip them. The page's own streams are never rewritten, which keeps incremental saves small and makes removal exact. The settings are stored as JSON in the catalogue under /DrawsetData /HeaderFooter. {date} is fixed when the settings are applied (dd/mm/yyyy), so opening a file never changes it. The watermark is drawn over the drawing with transparency rather than under it, because many drawings paint an opaque white background that would hide anything beneath.

## 24. Links are markups; a click follows them
Links are edited like other markups so they get undo, the Markups List and the Properties panel for free. MuPDF leaves links out of its annotation list for pages it loads, so Drawset writes link dictionaries directly. With the Select tool a plain click follows a link, as in any PDF viewer; Shift-click (or the Link tool) selects it for editing. Web links open in the browser only after a confirmation and only for http, https and mailto, so a document cannot launch anything else. File links are stored relative to the document when typed that way and resolved against its folder; PDF targets use /GoToR with a page, other files /Launch (Drawset itself only opens PDFs). Back and Forward record jumps (links, bookmarks, Go to page), not scrolling.

## 25. Security: AES-256 only, permissions enforced at save
New security is always 256-bit AES (PDF 2.0, readable by current PDF viewers); older RC4 and AES-128 are not offered because they are weak. When only an open password is set, it is also the permissions password, so whoever can open the file can change it. Restrictions need a permissions password different from the open password. Drawset honours a file's restrictions: markups need the annotate permission, form values the form permission, and anything touching pages or content (and any security change) needs full rights, asked for as the permissions password when saving. Edits are allowed on screen and only checked at save, because nothing reaches the file before then. Passwords stay in the engine worker's memory and are never written to disk; commas are refused because MuPDF's save options cannot carry them.
