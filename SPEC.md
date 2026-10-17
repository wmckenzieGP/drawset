Role and mission
You are the lead engineer building Drawset (working title), a Windows desktop PDF editor for construction drawings, modelled on the core tools of Bluebeam Revu 21. You have 5 days and the usage of one Claude Pro plan. Build a focused, reliable core, not the whole Revu feature set, and work autonomously under the autonomy rules below.
Who it is for. I am a building services engineer. I review construction drawing sets, mark up design changes, measure quantities and compare revisions. I exchange marked-up PDFs with project managers and consultants who use Bluebeam Revu. My typical files are A1/A0 sheets, 20–300 pages per set and 5–150 MB, with dense vector content.
Priorities, in order:
1. Open large drawing sets and move through them fast.
2. Mark up drawings with standard PDF annotations that Revu and Acrobat users open unchanged.
3. Manage pages: reorder, rotate, insert, delete, extract, combine and split.
4. Measure at a calibrated scale and export quantities.
5. Compare revisions and redact or erase content.
6. Everything else, only if time allows.
Success means that on day 5 I can install Drawset from a GitHub Release and open my drawings. I can mark them up, manage pages and measure, then send the files to Revu users without anything being lost. A smaller app that works completely beats a bigger one that half works.
Decisions
These choices are fixed so no usage goes on re-deciding them. Log every other decision you make in DECISIONS.md and keep going.
Area
Choice
Reason
Name and branding
Drawset (working title), with an original name, icons and visual design. Never use the Bluebeam or Revu names, logos, icons or artwork.
Matching features is fine. Copying branding is not.
Platform
A Windows desktop app built from a browser-based core. Files stay on my computer, with no uploads and no telemetry.
Where I work.
App shell
Electron with electron-builder, producing an NSIS installer. Keep the shell thin: file dialogs, save in place, recent files, print and PDF file association.
No Rust toolchain, and the most reliable Windows build.
Build and delivery
GitHub Actions runs tests on Ubuntu and builds the installer on windows-latest. Each finished tier is tagged and published as a GitHub Release with the installer attached.
I install from Releases. Nothing gets built on my PC.
Cloud development
Develop and test the web build in Playwright Chromium. Set ELECTRON_SKIP_BINARY_DOWNLOAD=1 in the cloud session, because packaging only happens in CI.
Saves time and usage.
Front end
TypeScript (strict), React, Vite and Zustand, with Radix primitives for menus and dialogs.
Mainstream and quick to build.
PDF engine
MuPDF.js (the mupdf npm package) in a Web Worker, behind a small PdfEngine interface. No engine comparison spike.
One engine renders, writes annotations, redacts and saves. Its AGPL licence suits personal and internal use.
Markup layer
Pages render as canvas tiles. Markups draw on a separate overlay layer, using rbush for hit-testing and polygon-clipping for area cutouts.
Fast and simple.
Independent check
pdf.js (pdfjs-dist) as a second renderer in tests.
Proves other viewers see the same markups.
Units and locale
Metric first (mm, m, m²), 1:100-style scales, A-series paper, DD/MM/YYYY and Australian English.
Australian projects.
Autonomy rules
Work without asking me. Make every decision yourself, log it in DECISIONS.md, and keep building. I will not be watching, and I will not approve phases.
Stop and ask me only when something is critical:
1. The work needs something only I can provide, such as an account, payment, a credential, or a GitHub permission or approval.
2. It would cost money, or add a paid dependency or one that changes the licence.
3. It could destroy work, such as force-pushing, rewriting main, or deleting branches, releases or the repo.
4. A Tier 1 feature is impossible with this stack after two genuinely different approaches.
When you stop, send one message saying exactly what you need and why. Then carry on with any item that isn't blocked.
Never stop for design choices, library choices within these decisions, failing tests you can fix, or a hard Tier 2 or Tier 3 feature.
Time-box every item. If an item fails three attempts or takes far longer than its share of the time, mark it deferred in PLAN.md with what you tried and what is left. Then move on to the next item.
Report without waiting. At the end of each tier, write the report into PROGRESS.md, tag and publish the release, and start the next tier straight away.
Engineering rules
Interoperability with Revu and Acrobat matters more than any single feature. A markup that looks right in Drawset but wrong in another viewer counts as a bug.
PDF interoperability
• Save every markup as a standard ISO 32000-2 annotation with an appearance stream (/AP), using this mapping:
Drawset markup
PDF annotation
Key details
Rectangle, ellipse
/Square, /Circle
/IC fill, /BS dash, /CA opacity
Cloud
/Polygon or /Square
/BE << /S /C /I n >> cloudy border
Polygon, polyline
/Polygon, /PolyLine
/Vertices
Line, arrow
/Line
/LE line endings
Text box
/FreeText
/DA, /RC rich text
Callout
/FreeText
/IT /FreeTextCallout with /CL
Note
/Text
Icon and popup
Highlight, underline, strikethrough
Text-markup subtypes
/QuadPoints
Pen, highlighter
/Ink
Multiply blend for the highlighter
Stamp, image
/Stamp
Image or vector /AP
Length, polylength, area, perimeter
/Line, /PolyLine, /Polygon
/IT /LineDimension, /PolyLineDimension or /PolygonDimension, plus /Measure
Redaction
/Redact
Applied with true content removal
• Store page scales as viewports (/VP holding /Measure /RL dictionaries) so Revu reads my calibrations.
• Write statuses as review-state replies (/StateModel /Review) and replies as /IRT with /RT /R. Always fill in author /T, subject /Subj, /Contents, dates and a unique /NM.
• Keep Drawset-only data in one namespaced private key per annotation.
• Preserve every key you do not understand, including Bluebeam's private keys, exactly as written.
• Save incrementally by default, with a separate “Save a copy” command. Never rasterise vector content unless I choose an image export. Flatten is permanent, so ask for confirmation first.
Performance targets (mid-range laptop)
• A 200-page, 100 MB set shows its first page within 2 s.
• Pan and zoom stay smooth, and a dense A1 sheet is sharp within 1 s.
• All PDF work runs in a worker, and the interface never freezes for more than 100 ms.
• The Markups List stays smooth with 5,000 markups, and saving 500 markups takes under 3 s.
Accuracy. Geometry uses double precision. Calibrated measurements are within 0.1% of known dimensions, and display rounding never changes stored values.
Code quality
• A feature marked done has no stubs, placeholder UI, mock data or TODOs.
• Every document change is an undoable command.
• Use strict TypeScript, organise code by feature, and keep the engine behind its interface. CI runs typecheck, lint and tests.
Working method
The build carries over between sessions through files in the repo root, and you keep them current. Any session must be able to resume from them alone.
First session
1. Save this prompt, unchanged, as SPEC.md. Write a short CLAUDE.md that says: read PROGRESS.md and PLAN.md first, read only the SPEC.md sections you need, and follow the autonomy rules.
2. Write PLAN.md: break each tier into items of about 2 hours or less, each with a checkbox and testable acceptance criteria. Create PROGRESS.md (current item, last finished, next up, known issues, how to install) and DECISIONS.md.
3. Write a small fixture generator. It should produce a dense A1 sheet (about 20,000 vector paths), a calibration sheet with known dimensions, a 200-page set, a scanned page, a PDF that already has several annotation types, and a form PDF.
4. Set up GitHub Actions to run typecheck, lint, unit and Playwright tests on Ubuntu, build the NSIS installer on windows-latest, and attach it to a GitHub Release whenever a v* tag is pushed.
5. Start Tier 1.
Every item
1. Take the next unchecked item in PLAN.md.
2. Build it with its tests.
3. Verify it: run the unit tests for that area plus a Playwright smoke test. For anything that writes a PDF, reopen the file with MuPDF and with pdf.js, check the annotation dictionaries, and compare the pdf.js rendering with Drawset's.
4. Tick the item, add 2–5 lines to PROGRESS.md, then commit and push.
End of each tier. Run the full test suite and save screenshots of the key screens to docs/screenshots. Write the tier report in PROGRESS.md: what works, how to install it, and known gaps. Tag v0.1, v0.2 or v0.3, confirm the CI release has the installer attached, and start the next tier.
Making Pro usage last
• Work in one session or thread at a time. Don't run parallel threads or agent teams, and use subagents only for short research.
• Keep context small. Read only the parts of files you need, use quiet test reporters, and never print large logs or PDF bytes.
• Run area tests and a smoke test per item. Save the full suite for the end of a tier, and let CI run it on every push.
• Take screenshots only when a feature is finished.
• Commit and push after every item, so a usage-limit pause or a session reset loses nothing.
• When you reach a usage limit, stop at a clean commit. On resume, read PROGRESS.md and continue.
Reference behaviour. When unsure how a feature should behave, follow Revu 21's documented behaviour at support.bluebeam.com. Copy the function, but design Drawset's own interface.
Tier 1 — Core editor (target: end of day 3, release v0.1)
This tier must ship. Everything after it is a bonus.
• Foundation: Vite + React + TypeScript app, the MuPDF.js worker and PdfEngine interface, the Electron shell, CI, the Windows installer release, and the fixture generator.
• Viewer: open files from a dialog, by drag and drop, or from recent files. Multiple documents in tabs, a thumbnails panel, continuous scrolling, and tiled rendering with a low-resolution preview first. Zoom with the mouse wheel, fit page, fit width and marquee zoom. Pan with space-drag or the middle mouse button. Go to a page by number or page label, rotate the view, and read bookmarks in a panel. Text search with highlighted results, text select and copy, and a dark interface.
• Markup tools: rectangle, ellipse, line, arrow, polyline, polygon, cloud, pen, highlighter, text box, callout, note, text highlight, underline and strikethrough, stamps (an original built-in set plus custom image stamps) and image.
• Markup editing: select, marquee-select, move, resize, edit vertices, delete, copy and paste, duplicate and lock. Undo and redo, reuse mode (the tool stays active), and Shift for ortho and 45° snapping.
• Properties panel: colour, fill, opacity, line width, dash, line ends, font and size. Also author, subject, comment and status (Accepted, Rejected, Completed, None).
• Save: save in place (incremental) and save a copy, with standard annotations as specified in the engineering rules. Existing annotations, including Revu-made ones, open, display and edit without losing data. Flatten markups, with a confirmation first.
• Markups List: a panel listing every markup with page, type, subject, author, date, status, comment and colour. Sort, filter, click a row to zoom to its markup, bulk-change status, and export to CSV.
• Page management: reorder pages by dragging thumbnails. Rotate, delete, insert blank pages or pages from a file, extract pages to a new PDF, combine files and split by page range.
• Print: print with or without markups, using fit to page or actual size.
Done when:
• The v0.1 release installs on Windows and opens PDFs.
• Every markup type survives save and reopen, and renders the same in Drawset and pdf.js.
• The fixture with existing annotations keeps all of them, and all unknown keys, after it is edited and saved.
• The 200-page fixture shows its first page within 2 s, and search finds every planted term.
• Page operations produce valid PDFs, and markups stay with their pages.
• The CSV export matches the markups exactly.
Tier 2 — Takeoff and review (target: days 4–5, release v0.2)
Build these in this order, and release whatever is finished by the end of day 5.
1. Calibration: pick two points and enter a known distance, or choose a preset scale (metric 1:1 to 1:1000, plus common imperial scales). Apply the scale to one page or a page range, set precision and display units, and store the scale in the PDF.
2. Measurements: length, polylength, area (with cutouts), perimeter, count and angle. Each shows a caption on the drawing, live readouts appear in a Measurements panel, and the Markups List gains measurement columns with totals by type. Changing the scale recalculates existing measurements, and quantities export to CSV.
3. Erase and redact: erase content inside a drawn area (true removal, used with a text box to replace wording), and redact areas or searched text with a black box. Both are applied through MuPDF's redaction, with a review before applying.
4. Overlay pages: choose two pages from any open files and show them together in contrasting colours (red and blue by default). Align them by picking two matching points on each, and toggle either page on or off. Export the overlay as an image-based PDF, labelled as such.
5. Tool Chest: save a selected markup as a reusable tool with its properties. Tools are grouped into sets, recently used tools are listed, and tool sets can be imported and exported as JSON.
6. Replies: threaded replies on markups, shown in the Markups List.
7. Snapping: snap to markup vertices and a grid, then to vector endpoints and line intersections on the page if MuPDF exposes the path data.
Done when calibration fixtures measure within 0.1%, and areas with cutouts match analytic values. Measurements must show the same values after reopening, with valid /Measure and /VP dictionaries. Text under a redaction or erasure must be absent from text extraction. A Tool Chest tool must reproduce the original markup's properties exactly.
Tier 3 — Only if ahead (release v0.3)
Start these only once Tier 2 is ticked or deferred. Take them in order, and give each a short time-box.
1. Compare documents: find the differences between two aligned revisions with a raster comparison, then cloud each changed area as a markup listed in the Markups List.
2. Split view: two panes side by side, with synced pan, zoom and page.
3. Page labels from a region: draw a box around the sheet number in the title block, and Drawset labels every page from the text in that box. Generate bookmarks from the labels.
4. Forms: fill and save existing form fields, and flatten forms.
5. Headers, footers and watermarks: text with date, file name, page label and “page n of N” variables.
6. Hyperlinks: link an area to a page, a file or a URL, with back navigation.
7. Security: add or remove a password to open, and permission restrictions.
8. Crash recovery: journal unsaved markups every 60 s and offer to restore them after a crash.
9. OCR: an invisible text layer for scanned pages using tesseract.js.
Done when each item passes its own check in PLAN.md, or is deferred with notes.
Scope and definition of done
Not in this build. These are saved for a later version, so don't start any of them: editing existing text in the page content, sets, batch link, slip sheet, batch processing, certificate-based digital signatures, Office conversion, spaces, legends, formula columns, symbol search, live collaboration sessions, an MCP server, AI features and 3D PDFs. For changing wording on a drawing, Tier 2's erase tool plus a text box covers the common case.
The build is done when:
• Every item in PLAN.md is ticked or marked deferred with notes.
• CI is green, and the latest GitHub Release has the Windows installer attached.
• PROGRESS.md ends with a final report covering what works, what was deferred and why, and a suggested order for a later build.
After the build, when I report problems with Drawset files opened in Revu, fix those before adding anything new.
