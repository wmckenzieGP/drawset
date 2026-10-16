/**
 * Page scales in the PDF: viewports (/VP) holding rectilinear measure dictionaries (/Measure /RL), the way
 * other PDF editors store calibrations. Measurement annotations carry the same /Measure dictionary.
 */
import * as mupdf from "mupdf";
import { areaUnitLabel, scaleFromMeasure, scaleLabel, scaleRatioText, unitsPerPoint, type PageScale } from "../../markup/measure";
import { transformRect, invert, type Matrix, type Rect } from "../../markup/geometry";

/** Name Drawset gives its own full-page viewport. */
export const VIEWPORT_NAME = "Drawset scale";

function num(o: mupdf.PDFObject): number | null {
  return o.isNumber() ? o.asNumber() : null;
}

/** Reads a /Measure dictionary (only /RL, rectilinear). */
export function readMeasure(measure: mupdf.PDFObject): PageScale | null {
  if (!measure.isDictionary()) return null;
  const sub = measure.get("Subtype");
  if (sub.isName() && sub.asName() !== "RL") return null;
  const r = measure.get("R").isString() ? measure.get("R").asString() : null;
  const x = measure.get("X");
  const first = x.isArray() && x.length ? x.get(0) : mupdf.PDFObject.Null;
  const unit = first.isDictionary() && first.get("U").isString() ? first.get("U").asString() : null;
  const c = first.isDictionary() ? num(first.get("C")) : null;
  const d = first.isDictionary() ? num(first.get("D")) : null;
  return scaleFromMeasure(r, unit, c, d);
}

/** Builds a /Measure /RL dictionary for `s`. */
export function measureObject(doc: mupdf.PDFDocument, s: PageScale): mupdf.PDFObject {
  const fmt = (unit: string, c: number) => {
    const d = doc.newDictionary();
    d.put("Type", doc.newName("NumberFormat"));
    d.put("U", doc.newString(unit));
    d.put("C", doc.newReal(c));
    d.put("D", doc.newInteger(Math.pow(10, s.precision)));
    d.put("F", doc.newName("D"));
    d.put("RT", doc.newString(""));
    d.put("RD", doc.newString("."));
    d.put("SS", doc.newString(","));
    const a = doc.newArray();
    a.push(d);
    return a;
  };
  const m = doc.newDictionary();
  m.put("Type", doc.newName("Measure"));
  m.put("Subtype", doc.newName("RL"));
  m.put("R", doc.newString(scaleRatioText(s)));
  m.put("X", fmt(s.displayUnit, unitsPerPoint(s)));
  m.put("D", fmt(s.displayUnit, 1));
  m.put("A", fmt(areaUnitLabel(s.displayUnit), 1));
  return m;
}

/** User-space box of the page's crop box. */
function pageUserBox(page: mupdf.PDFPage): Rect {
  const ctm = page.getTransform() as Matrix;
  return transformRect(page.getBounds() as Rect, invert(ctm));
}

function covers(bbox: number[], box: Rect): boolean {
  if (bbox.length !== 4) return false;
  const [x0, y0, x1, y1] = [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3]), Math.max(bbox[0], bbox[2]), Math.max(bbox[1], bbox[3])];
  const tol = 2;
  return x0 <= box[0] + tol && y0 <= box[1] + tol && x1 >= box[2] - tol && y1 >= box[3] - tol;
}

function bboxOf(vp: mupdf.PDFObject): number[] {
  const b = vp.get("BBox");
  if (!b.isArray()) return [];
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) out.push(b.get(i).isNumber() ? b.get(i).asNumber() : 0);
  return out;
}

/**
 * The page's scale: the last viewport (readers search /VP from the end) that covers most of the page and has
 * a rectilinear measure. Smaller viewports (detail views at other scales) are not the page scale.
 */
export function readPageScale(page: mupdf.PDFPage): PageScale | null {
  const vps = page.getObject().get("VP");
  if (!vps.isArray()) return null;
  const box = pageUserBox(page);
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  let found: PageScale | null = null;
  for (let i = 0; i < vps.length; i++) {
    const vp = vps.get(i).resolve();
    if (!vp.isDictionary()) continue;
    const b = bboxOf(vp);
    const big = b.length === 4 && Math.abs((b[2] - b[0]) * (b[3] - b[1])) >= area * 0.5;
    if (!big && !covers(b, box)) continue;
    const s = readMeasure(vp.get("Measure"));
    if (s) found = s;
  }
  return found;
}

/**
 * Sets (or with null removes) the page scale. Viewports covering the whole page are replaced by Drawset's;
 * smaller ones (detail views drawn at other scales) are kept after it, so they still win inside their area.
 */
export function writePageScale(doc: mupdf.PDFDocument, page: mupdf.PDFPage, s: PageScale | null) {
  const pageObj = page.getObject();
  const old = pageObj.get("VP");
  const box = pageUserBox(page);
  const keep: mupdf.PDFObject[] = [];
  if (old.isArray()) {
    for (let i = 0; i < old.length; i++) {
      const vp = old.get(i);
      const d = vp.resolve();
      if (d.isDictionary() && covers(bboxOf(d), box)) continue;
      keep.push(vp);
    }
  }
  const arr = doc.newArray();
  if (s) {
    const vp = doc.newDictionary();
    vp.put("Type", doc.newName("Viewport"));
    const b = doc.newArray();
    for (const v of box) b.push(doc.newReal(Math.round(v * 1000) / 1000));
    vp.put("BBox", b);
    vp.put("Name", doc.newString(`${VIEWPORT_NAME} ${scaleLabel(s)}`));
    vp.put("Measure", measureObject(doc, s));
    arr.push(vp);
  }
  for (const k of keep) arr.push(k);
  if (arr.length) pageObj.put("VP", arr);
  else pageObj.delete("VP");
}

/** readPageScale that treats a malformed viewport as no scale. */
export function safePageScale(page: mupdf.PDFPage): PageScale | null {
  try {
    return readPageScale(page);
  } catch {
    return null;
  }
}
