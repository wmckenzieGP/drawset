/**
 * Fixture generator: writes the test PDFs into ./fixtures (or the folder given as argv[2]).
 *
 *   dense-a1.pdf        A1 landscape sheet with about 20,000 vector paths and a title block
 *   calibration.pdf     A3 sheet drawn at 1:100 with known dimensions (see calibration.json)
 *   secured.pdf         the form fixture with an open password "drawset" and permissions password "owner-pw" (print only)
 *   restricted.pdf      the form fixture without an open password; permissions password "owner-pw"; printing and form filling only
 *   calibration-rev.pdf the same sheet revised: a new 60 x 30 pt box at (700, 500) and a new line (900,150)-(1000,150)
 *   set-200.pdf         200-page A1 set with page labels M-001…, bookmarks and planted search terms
 *   scanned.pdf         one page holding a single raster image and no text
 *   annotated.pdf       existing annotations of several types, with unknown and vendor private keys
 *   form.pdf            AcroForm with a text field, a check box, a choice field and a radio group
 *
 * Usage: npm run fixtures            (BIG=1 makes set-200 roughly 100 MB with embedded noise images)
 */
import * as mupdf from "mupdf";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "fixtures";
mkdirSync(outDir, { recursive: true });

const MM = 72 / 25.4;
const A1: [number, number] = [841 * MM, 594 * MM];
const A3: [number, number] = [420 * MM, 297 * MM];

/** Deterministic pseudo-random numbers so fixtures are identical on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

function helvetica(doc: mupdf.PDFDocument) {
  return doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
}

function pdfString(s: string) {
  return "(" + s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")";
}

function text(x: number, y: number, size: number, s: string) {
  return `BT /F1 ${f(size)} Tf ${f(x)} ${f(y)} Td ${pdfString(s)} Tj ET\n`;
}

function save(doc: mupdf.PDFDocument, name: string) {
  const bytes = doc.saveToBuffer("compress,garbage").asUint8Array();
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${(bytes.length / 1048576).toFixed(1)} MB`);
}

/** A drawing-like sheet: border, grid, ducts (polylines), fittings (circles), dimension ticks, title block. */
function drawingContent(w: number, h: number, paths: number, seed: number, title: string, sheet: string, extraText: string[] = []) {
  const r = rng(seed);
  const parts: string[] = [];
  parts.push("0 G 1.2 w 20 20 " + f(w - 40) + " " + f(h - 40) + " re S\n");
  let count = 1;
  parts.push("0.6 0.6 0.6 RG 0.25 w\n");
  // structural grid
  for (let x = 60; x < w - 60 && count < paths; x += 40) {
    parts.push(`${f(x)} 40 m ${f(x)} ${f(h - 40)} l S\n`);
    count++;
  }
  for (let y = 60; y < h - 60 && count < paths; y += 40) {
    parts.push(`40 ${f(y)} m ${f(w - 40)} ${f(y)} l S\n`);
    count++;
  }
  const kappa = 0.5523;
  while (count < paths) {
    const kind = r();
    const x = 60 + r() * (w - 420);
    const y = 60 + r() * (h - 120);
    if (kind < 0.55) {
      // duct / pipe run
      parts.push(`${f(r() * 0.4)} ${f(r() * 0.4)} ${f(0.3 + r() * 0.6)} RG ${f(0.3 + r() * 1.2)} w ${f(x)} ${f(y)} m`);
      let cx = x;
      let cy = y;
      const segs = 2 + Math.floor(r() * 4);
      for (let i = 0; i < segs; i++) {
        if (i % 2 === 0) cx += (r() - 0.5) * 120;
        else cy += (r() - 0.5) * 120;
        parts.push(` ${f(cx)} ${f(cy)} l`);
      }
      parts.push(" S\n");
    } else if (kind < 0.8) {
      const rad = 2 + r() * 6;
      const k = rad * kappa;
      parts.push(
        `0 G 0.4 w ${f(x + rad)} ${f(y)} m ${f(x + rad)} ${f(y + k)} ${f(x + k)} ${f(y + rad)} ${f(x)} ${f(y + rad)} c ` +
          `${f(x - k)} ${f(y + rad)} ${f(x - rad)} ${f(y + k)} ${f(x - rad)} ${f(y)} c ` +
          `${f(x - rad)} ${f(y - k)} ${f(x - k)} ${f(y - rad)} ${f(x)} ${f(y - rad)} c ` +
          `${f(x + k)} ${f(y - rad)} ${f(x + rad)} ${f(y - k)} ${f(x + rad)} ${f(y)} c S\n`,
      );
    } else {
      const bw = 4 + r() * 30;
      const bh = 4 + r() * 20;
      parts.push(`0.2 G 0.3 w ${f(x)} ${f(y)} ${f(bw)} ${f(bh)} re S\n`);
    }
    count++;
  }
  // title block
  const tbx = w - 380;
  parts.push(`0 G 1 w ${f(tbx)} 20 360 160 re S ${f(tbx)} 80 m ${f(w - 20)} 80 l S ${f(tbx + 240)} 20 m ${f(tbx + 240)} 80 l S\n`);
  parts.push("0 g " + text(tbx + 10, 150, 16, "DRAWSET TEST PROJECT"));
  parts.push(text(tbx + 10, 120, 12, title));
  parts.push(text(tbx + 10, 95, 9, "Scale 1:100 @ A1   Date 16/10/2026"));
  parts.push(text(tbx + 250, 45, 20, sheet));
  parts.push(text(tbx + 10, 45, 9, "Sheet number"));
  extraText.forEach((t, i) => parts.push(text(80, h - 80 - i * 18, 12, t)));
  return { content: parts.join(""), paths: count };
}

function makeDenseA1() {
  const doc = new mupdf.PDFDocument();
  const res = { Font: { F1: helvetica(doc) } };
  const { content, paths } = drawingContent(A1[0], A1[1], 20000, 7, "MECHANICAL SERVICES LEVEL 1", "M-101", [
    "Supply air duct 600x400 to AHU-01",
  ]);
  doc.insertPage(-1, doc.addPage([0, 0, A1[0], A1[1]], 0, res, content));
  save(doc, "dense-a1.pdf");
  return paths;
}

/** Calibration sheet at 1:100 on A3: 1 m on site = 10 mm on paper. */
function makeCalibration() {
  const doc = new mupdf.PDFDocument();
  const res = { Font: { F1: helvetica(doc) } };
  const m = 10 * MM; // points per metre at 1:100
  const ox = 60;
  const oy = 120;
  const parts: string[] = ["0 G 1 w\n"];
  // 10.000 m horizontal line
  parts.push(`${f(ox)} ${f(oy)} m ${f(ox + 10 * m)} ${f(oy)} l S\n`);
  parts.push("0 g " + text(ox, oy - 16, 10, "A-B horizontal 10.000 m"));
  // 5.000 m vertical line
  parts.push(`${f(ox + 12 * m)} ${f(oy)} m ${f(ox + 12 * m)} ${f(oy + 5 * m)} l S\n`);
  parts.push(text(ox + 12 * m + 6, oy, 10, "C-D vertical 5.000 m"));
  // 8 m x 4 m room (32 m2) with a 2 m x 1 m cutout (net 30 m2)
  const rx = ox;
  const ry = oy + 6 * m;
  parts.push(`${f(rx)} ${f(ry)} ${f(8 * m)} ${f(4 * m)} re S\n`);
  parts.push(`${f(rx + 3 * m)} ${f(ry + 1.5 * m)} ${f(2 * m)} ${f(1 * m)} re S\n`);
  parts.push(text(rx, ry + 4 * m + 8, 10, "Room 8.000 x 4.000 m = 32.000 m2, cutout 2.000 x 1.000 m, net 30.000 m2"));
  // 3-4-5 triangle diagonal 5.000 m
  const tx = ox + 15 * m;
  const ty = oy + 6 * m;
  parts.push(`${f(tx)} ${f(ty)} m ${f(tx + 3 * m)} ${f(ty)} l ${f(tx + 3 * m)} ${f(ty + 4 * m)} l h S\n`);
  parts.push(text(tx, ty - 16, 10, "Triangle 3-4-5 m, hypotenuse 5.000 m"));
  // scale bar
  for (let i = 0; i < 5; i++) {
    parts.push(`${i % 2 === 0 ? "0 g" : "1 g"} ${f(ox + i * m)} 60 ${f(m)} 6 re B\n`);
  }
  parts.push("0 g " + text(ox, 44, 9, "0      1      2      3      4      5 m   SCALE 1:100 @ A3"));
  parts.push(text(ox, A3[1] - 40, 14, "DRAWSET CALIBRATION SHEET"));
  doc.insertPage(-1, doc.addPage([0, 0, A3[0], A3[1]], 0, res, parts.join("")));
  save(doc, "calibration.pdf");
  const rev = new mupdf.PDFDocument();
  const revParts = [...parts, "q 0 g 700 500 60 30 re f Q q 0 G 1 w 900 150 m 1000 150 l S Q\n"];
  rev.insertPage(-1, rev.addPage([0, 0, A3[0], A3[1]], 0, { Font: { F1: helvetica(rev) } }, revParts.join("")));
  save(rev, "calibration-rev.pdf");
  const known = {
    scale: "1:100",
    pointsPerMetre: m,
    horizontal: { from: [ox, oy], to: [ox + 10 * m, oy], metres: 10 },
    vertical: { from: [ox + 12 * m, oy], to: [ox + 12 * m, oy + 5 * m], metres: 5 },
    room: { rect: [rx, ry, rx + 8 * m, ry + 4 * m], areaM2: 32, cutout: [rx + 3 * m, ry + 1.5 * m, rx + 5 * m, ry + 2.5 * m], netAreaM2: 30, perimeterM: 24 },
    hypotenuse: { from: [tx, ty], to: [tx + 3 * m, ty + 4 * m], metres: 5 },
    note: "Coordinates are PDF user space (origin bottom-left).",
  };
  writeFileSync(join(outDir, "calibration.json"), JSON.stringify(known, null, 2));
}

function noiseImage(seed: number, size: number) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, size, size], false);
  const px = pix.getPixels();
  const r = rng(seed);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(r() * 256);
  return new mupdf.Image(pix);
}

function make200() {
  const big = process.env.BIG === "1";
  const doc = new mupdf.PDFDocument();
  const font = helvetica(doc);
  const planted: Record<string, number> = {};
  for (let i = 0; i < 200; i++) {
    const extra: string[] = [];
    if (i % 20 === 7) {
      const term = `PLANTED-TERM-${String(i + 1).padStart(3, "0")}`;
      planted[term] = i;
      extra.push(`Coordination note ${term} refer to services schedule`);
    }
    const sheet = `M-${String(i + 1).padStart(3, "0")}`;
    const { content } = drawingContent(A1[0], A1[1], 1500, 100 + i, `MECHANICAL SERVICES SHEET ${i + 1}`, sheet, extra);
    const res: Record<string, unknown> = { Font: { F1: font } };
    let c = content;
    if (big) {
      res.XObject = { Im1: doc.addImage(noiseImage(i, 400)) };
      c = `q 120 0 0 120 60 60 cm /Im1 Do Q\n` + content;
    }
    doc.insertPage(-1, doc.addPage([0, 0, A1[0], A1[1]], 0, res, c));
  }
  doc.setPageLabels(0, "D", "M-", 1);
  // bookmarks: one per 50 sheets
  const outline = doc.outlineIterator();
  for (let i = 0; i < 4; i++) {
    outline.insert({ title: `Sheets ${i * 50 + 1}–${i * 50 + 50}`, uri: doc.formatLinkURI({ type: "Fit", chapter: 0, page: i * 50, x: 0, y: 0, width: 0, height: 0, zoom: 0 }), open: true });
  }
  save(doc, "set-200.pdf");
  writeFileSync(join(outDir, "set-200.json"), JSON.stringify({ planted }, null, 2));
}

function makeScanned() {
  const doc = new mupdf.PDFDocument();
  const w = 1200;
  const h = 850;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  const px = pix.getPixels();
  const r = rng(42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const line = x % 100 < 2 || y % 100 < 2 || Math.abs(x - y) < 2;
      px[y * w + x] = line ? 30 : 235 + Math.floor(r() * 20);
    }
  }
  const img = doc.addImage(new mupdf.Image(pix));
  const pw = A3[0];
  const ph = A3[1];
  doc.insertPage(-1, doc.addPage([0, 0, pw, ph], 0, { XObject: { Im1: img } }, `q ${f(pw)} 0 0 ${f(ph)} 0 0 cm /Im1 Do Q`));
  save(doc, "scanned.pdf");
}

function makeAnnotated() {
  const doc = new mupdf.PDFDocument();
  const res = { Font: { F1: helvetica(doc) } };
  const { content } = drawingContent(A3[0], A3[1], 600, 3, "ANNOTATED FIXTURE", "M-201", ["Existing markups made by another reviewer"]);
  doc.insertPage(-1, doc.addPage([0, 0, A3[0], A3[1]], 0, res, content));
  doc.insertPage(-1, doc.addPage([0, 0, A3[0], A3[1]], 0, res, text(60, 700, 14, "Second page with a note")));
  const page = doc.loadPage(0);
  const when = new Date(Date.UTC(2026, 9, 1, 2, 30, 0));
  const stamp = (a: mupdf.PDFAnnotation, nm: string, subj: string) => {
    a.setAuthor("Other Reviewer");
    a.setSubject(subj);
    a.setCreationDate(when);
    a.setModificationDate(when);
    a.setName(nm);
  };
  const sq = page.createAnnotation("Square");
  sq.setRect([100, 100, 260, 200]);
  sq.setColor([1, 0, 0]);
  sq.setInteriorColor([1, 1, 0]);
  sq.setBorderWidth(2);
  sq.setOpacity(0.8);
  sq.setContents("Check duct clearance");
  stamp(sq, "fixture-square-1", "Rectangle");
  sq.update();
  // vendor-style private keys and an unknown key that must survive editing
  const sqo = sq.getObject();
  sqo.put("BSIColumnData", doc.newArray());
  sqo.get("BSIColumnData").push(doc.newString("Mechanical"));
  sqo.get("BSIColumnData").push(doc.newString("Level 1"));
  sqo.put("BSILayer", doc.newString("Services Review"));
  sqo.put("XUnknownNumber", doc.newReal(3.25));
  const unknownDict = doc.newDictionary();
  unknownDict.put("Keep", doc.newName("Me"));
  unknownDict.put("Nested", doc.newArray());
  unknownDict.get("Nested").push(doc.newInteger(1));
  unknownDict.get("Nested").push(doc.newInteger(2));
  sqo.put("XUnknownDict", unknownDict);

  const ln = page.createAnnotation("Line");
  ln.setLine([300, 150], [500, 250]);
  ln.setLineEndingStyles("None", "ClosedArrow");
  ln.setColor([0, 0, 1]);
  ln.setBorderWidth(1.5);
  ln.setContents("Relocate riser");
  stamp(ln, "fixture-line-1", "Arrow");
  ln.update();

  const ft = page.createAnnotation("FreeText");
  ft.setRect([100, 300, 320, 360]);
  ft.setDefaultAppearance("Helv", 12, [0, 0, 0]);
  ft.setContents("Existing text box comment");
  stamp(ft, "fixture-freetext-1", "Text Box");
  ft.update();

  const note = page.createAnnotation("Text");
  note.setRect([600, 100, 620, 120]);
  note.setContents("Sticky note from consultant");
  note.setIcon("Comment");
  note.setColor([1, 0.8, 0]);
  stamp(note, "fixture-note-1", "Note");
  note.update();

  const poly = page.createAnnotation("Polygon");
  poly.setVertices([
    [700, 300],
    [850, 300],
    [850, 420],
    [700, 420],
  ]);
  poly.setColor([1, 0, 0]);
  poly.setBorderEffect("Cloudy");
  poly.setBorderEffectIntensity(1);
  stamp(poly, "fixture-cloud-1", "Cloud");
  poly.update();

  const ink = page.createAnnotation("Ink");
  ink.setInkList([
    [
      [400, 500],
      [420, 520],
      [450, 510],
      [480, 540],
    ],
  ]);
  ink.setColor([0, 0.6, 0]);
  ink.setBorderWidth(2);
  stamp(ink, "fixture-ink-1", "Pen");
  ink.update();

  // Highlight over the title block text "DRAWSET TEST PROJECT"
  const hits = page.search("DRAWSET TEST PROJECT", undefined);
  if (hits.length > 0) {
    const hl = page.createAnnotation("Highlight");
    hl.setQuadPoints(hits[0]);
    hl.setColor([1, 1, 0]);
    stamp(hl, "fixture-highlight-1", "Highlight");
    hl.update();
  }

  // A review-state reply on the square (as other PDF editors write it)
  const state = page.createAnnotation("Text");
  state.setRect([100, 100, 120, 120]);
  state.setContents("Accepted set by Other Reviewer");
  stamp(state, "fixture-state-1", "Status");
  const so = state.getObject();
  so.put("IRT", sqo);
  so.put("State", doc.newName("Accepted"));
  so.put("StateModel", doc.newName("Review"));
  state.setFlags(mupdf.PDFAnnotation.IS_HIDDEN | mupdf.PDFAnnotation.IS_NO_ZOOM | mupdf.PDFAnnotation.IS_NO_ROTATE | mupdf.PDFAnnotation.IS_PRINT);
  state.update();

  const page2 = doc.loadPage(1);
  const n2 = page2.createAnnotation("Text");
  n2.setRect([60, 600, 80, 620]);
  n2.setContents("Note on page 2");
  stamp(n2, "fixture-note-2", "Note");
  n2.update();

  save(doc, "annotated.pdf");
}

function makeSecured() {
  const src = mupdf.Document.openDocument(readFileSync(join(outDir, "form.pdf")), "application/pdf").asPDF()!;
  // /P: reserved bits set; print (bit 3) and, for restricted.pdf, form filling (bit 9)
  const P = (bits: number) => (~0xf3f & ~0x3) | (1 << 9) | bits;
  for (const [name, opts] of [
    ["secured.pdf", `encrypt=aes-256,user-password=drawset,owner-password=owner-pw,permissions=${P(1 << 2)}`],
    ["restricted.pdf", `encrypt=aes-256,owner-password=owner-pw,permissions=${P((1 << 2) | (1 << 8))}`],
  ] as const) {
    const bytes = src.saveToBuffer(`compress,garbage,${opts}`).asUint8Array();
    writeFileSync(join(outDir, name), bytes);
    console.log(`${name}: ${(bytes.length / 1048576).toFixed(1)} MB`);
  }
}

function makeForm() {
  const doc = new mupdf.PDFDocument();
  const helv = helvetica(doc);
  const res = { Font: { F1: helv } };
  const content = "0 g " + text(60, 760, 16, "Drawset form fixture") + text(60, 700, 11, "Project name") + text(60, 650, 11, "Approved") + text(60, 600, 11, "Discipline") + text(60, 550, 11, "Stage") + text(200, 550, 11, "Concept") + text(300, 550, 11, "Tender");
  const pageObj = doc.addPage([0, 0, 595, 842], 0, res, content);
  doc.insertPage(-1, pageObj);
  const pageRef = doc.findPage(0);
  const tx = doc.addObject({ Type: "Annot", Subtype: "Widget", FT: "Tx", T: doc.newString("project_name"), Rect: [160, 690, 400, 712], F: 4, DA: doc.newString("/Helv 11 Tf 0 g"), V: doc.newString("Hospital Stage 2"), P: pageRef, MK: { BC: [0, 0, 0] } });
  const cb = doc.addObject({ Type: "Annot", Subtype: "Widget", FT: "Btn", T: doc.newString("approved"), Rect: [160, 642, 176, 658], F: 4, V: doc.newName("Off"), AS: doc.newName("Off"), P: pageRef, MK: { BC: [0, 0, 0], CA: doc.newString("4") }, DA: doc.newString("/ZaDb 0 Tf 0 g") });
  const ch = doc.addObject({ Type: "Annot", Subtype: "Widget", FT: "Ch", Ff: 131072, T: doc.newString("discipline"), Rect: [160, 590, 400, 612], F: 4, Opt: [doc.newString("Mechanical"), doc.newString("Electrical"), doc.newString("Hydraulic")], V: doc.newString("Mechanical"), DA: doc.newString("/Helv 11 Tf 0 g"), P: pageRef, MK: { BC: [0, 0, 0] } });
  // radio group "stage": two kids with their own on-states
  const radio = doc.addObject({ FT: "Btn", Ff: 49152, T: doc.newString("stage"), V: doc.newName("Off"), Kids: [] });
  const kid = (on: string, x: number) => {
    const ap = (body: string) => doc.addStream(body, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 14, 14] });
    return doc.addObject({ Type: "Annot", Subtype: "Widget", Parent: radio, Rect: [x, 545, x + 14, 559], F: 4, AS: doc.newName("Off"), P: pageRef, MK: { BC: [0, 0, 0], CA: doc.newString("l") }, DA: doc.newString("/ZaDb 0 Tf 0 g"), AP: { N: { [on]: ap("q 0 G 1 w 1 1 12 12 re S 0 g 4 4 6 6 re f Q"), Off: ap("q 0 G 1 w 1 1 12 12 re S Q") } } });
  };
  const k1 = kid("Concept", 180);
  const k2 = kid("Tender", 280);
  radio.get("Kids").push(k1);
  radio.get("Kids").push(k2);
  pageRef.put("Annots", [tx, cb, ch, k1, k2]);
  const zadb = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "ZapfDingbats" });
  doc.getTrailer().get("Root").put("AcroForm", doc.addObject({ Fields: [tx, cb, ch, radio], DA: doc.newString("/Helv 0 Tf 0 g"), DR: { Font: { Helv: helv, ZaDb: zadb } }, NeedAppearances: false }));
  const page = doc.loadPage(0);
  for (const w of page.getWidgets()) w.update();
  save(doc, "form.pdf");
}

const t0 = Date.now();
const densePaths = makeDenseA1();
console.log(`dense-a1 paths: ${densePaths}`);
makeCalibration();
make200();
makeScanned();
makeAnnotated();
makeForm();
makeSecured();
console.log(`fixtures written to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
