/**
 * Headers, footers and watermarks: written as extra content streams on each page, marked as pagination
 * artifacts, so they can be replaced or removed without touching the page's own content.
 */
import * as mupdf from "mupdf";
import { invert, type Matrix } from "../../markup/geometry";
import { textWidth } from "../../markup/appearance";
import { winAnsiLiteral } from "../../markup/pdfAppearance";
import type { Decoration } from "../types";

const FONT = "DrawsetHelv";
const GS = "DrawsetWm";
const n = (v: number) => String(Math.round(v * 1000) / 1000);

function isOurs(o: mupdf.PDFObject): boolean {
  const r = o.resolve();
  if (!r.isDictionary() && !r.isStream()) return false;
  const d = r.get("DrawsetData");
  return d.isDictionary() && d.get("Role").isName() && d.get("Role").asName() === "HeaderFooter";
}

/** Page-space transform for the page shown with rotation `rotate` (MuPDF's page.getTransform for that rotation). */
export function pageMatrix(page: mupdf.PDFPage, rotate: number): { ctm: Matrix; width: number; height: number } {
  const obj = page.getObject();
  const box = (obj.getInheritable("CropBox").isArray() ? obj.getInheritable("CropBox") : obj.getInheritable("MediaBox")).asJS() as number[];
  const media = obj.getInheritable("MediaBox").asJS() as number[];
  // the crop box is clipped to the media box
  const x0 = Math.max(Math.min(box[0], box[2]), Math.min(media[0], media[2]));
  const y0 = Math.max(Math.min(box[1], box[3]), Math.min(media[1], media[3]));
  const x1 = Math.min(Math.max(box[0], box[2]), Math.max(media[0], media[2]));
  const y1 = Math.min(Math.max(box[1], box[3]), Math.max(media[1], media[3]));
  const w = x1 - x0;
  const h = y1 - y0;
  const r = ((rotate % 360) + 360) % 360;
  // user space -> unrotated, top-down; then turn clockwise
  const base: Matrix = [1, 0, 0, -1, -x0, y1];
  const turn: Matrix = r === 90 ? [0, 1, -1, 0, h, 0] : r === 180 ? [-1, 0, 0, -1, w, h] : r === 270 ? [0, -1, 1, 0, 0, w] : [1, 0, 0, 1, 0, 0];
  const ctm: Matrix = [
    base[0] * turn[0] + base[1] * turn[2],
    base[0] * turn[1] + base[1] * turn[3],
    base[2] * turn[0] + base[3] * turn[2],
    base[2] * turn[1] + base[3] * turn[3],
    base[4] * turn[0] + base[5] * turn[2] + turn[4],
    base[4] * turn[1] + base[5] * turn[3] + turn[5],
  ];
  return r === 90 || r === 270 ? { ctm, width: h, height: w } : { ctm, width: w, height: h };
}

/** The content (in page space, y down) for one page's decoration. */
export function decorationContent(dec: Decoration, width: number, height: number): string {
  const out: string[] = [];
  const colour = (c: [number, number, number]) => `${c.map(n).join(" ")} rg`;
  const top = dec.items.filter((i) => i.pos[0] === "t" && i.text);
  const bottom = dec.items.filter((i) => i.pos[0] === "b" && i.text);
  const line = (text: string, pos: string, y: number) => {
    const w = textWidth("Helvetica", dec.fontSize, text);
    const x = pos[1] === "l" ? dec.margin : pos[1] === "c" ? (width - w) / 2 : width - dec.margin - w;
    return `1 0 0 -1 ${n(x)} ${n(y)} Tm ${winAnsiLiteral(text)} Tj`;
  };
  for (const [items, sub, y] of [
    [top, "Header", dec.margin + dec.fontSize * 0.72],
    [bottom, "Footer", height - dec.margin],
  ] as const) {
    if (!items.length) continue;
    out.push(`/Artifact <</Type /Pagination /Subtype /${sub}>> BDC BT /${FONT} ${n(dec.fontSize)} Tf ${colour(dec.colour)}`);
    for (const it of items) out.push(line(it.text, it.pos, y));
    out.push("ET EMC");
  }
  const wm = dec.watermark;
  if (wm?.text) {
    const a = (wm.angle * Math.PI) / 180;
    // "fit": as large as fits across the page at that angle, with a margin
    const unit = textWidth("Helvetica", 1, wm.text);
    const fit = Math.min((0.8 * width) / Math.max(1e-6, Math.abs(Math.cos(a)) * unit + Math.abs(Math.sin(a)) * 0.7), (0.8 * height) / Math.max(1e-6, Math.abs(Math.sin(a)) * unit + Math.abs(Math.cos(a)) * 0.7));
    const size = wm.fontSize > 0 ? wm.fontSize : Math.max(6, Math.min(fit, 400));
    const w = unit * size;
    // counter-clockwise on screen in y-down space
    out.push(
      `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC q /${GS} gs ${n(Math.cos(a))} ${n(-Math.sin(a))} ${n(Math.sin(a))} ${n(Math.cos(a))} ${n(width / 2)} ${n(height / 2)} cm`,
      `BT /${FONT} ${n(size)} Tf ${colour(wm.colour)} 1 0 0 -1 ${n(-w / 2)} ${n(size * 0.36)} Tm ${winAnsiLiteral(wm.text)} Tj ET Q EMC`,
    );
  }
  return out.join("\n");
}

/**
 * Replaces Drawset's headers, footers and watermark on the given pages (null removes them) and records the
 * settings in the catalogue so they can be edited after reopening. Returns the pages that changed.
 */
export function setDecorations(doc: mupdf.PDFDocument, pages: Record<number, Decoration | null>, spec: string | null): number[] {
  const changed: number[] = [];
  let font: mupdf.PDFObject | null = null;
  const gsFor = new Map<number, mupdf.PDFObject>();
  for (const [key, dec] of Object.entries(pages)) {
    const index = Number(key);
    if (index < 0 || index >= doc.countPages()) continue;
    const page = doc.loadPage(index) as mupdf.PDFPage;
    const obj = page.getObject();
    const contents = obj.get("Contents");
    const list: mupdf.PDFObject[] = [];
    if (contents.isArray()) for (let i = 0; i < contents.length; i++) list.push(contents.get(i));
    else if (!contents.isNull()) list.push(contents);
    const own = list.filter((c) => !isOurs(c));
    if (own.length === list.length && !dec) continue;
    changed.push(index);
    if (!dec) {
      if (own.length === 1) obj.put("Contents", own[0]);
      else {
        const arr = doc.newArray();
        for (const c of own) arr.push(c);
        obj.put("Contents", arr);
      }
      continue;
    }
    const { ctm, width, height } = pageMatrix(page, dec.rotate);
    const m = invert(ctm);
    const role = { DrawsetData: { Role: doc.newName("HeaderFooter") } };
    const pre = doc.addStream("q\n", role);
    const body = `Q\nq ${m.map(n).join(" ")} cm\n${decorationContent(dec, width, height)}\nQ\n`;
    const post = doc.addStream(body, role);
    const arr = doc.newArray();
    arr.push(pre);
    for (const c of own) arr.push(c);
    arr.push(post);
    obj.put("Contents", arr);
    // resources: our font and opacity, added to the page's own (or inherited) dictionary
    let res = obj.get("Resources");
    if (!res.isDictionary()) {
      const inherited = obj.getInheritable("Resources");
      res = doc.newDictionary();
      if (inherited.isDictionary()) inherited.forEach((v, k) => res.put(k, v));
      obj.put("Resources", res);
    }
    if (!font) font = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
    let fonts = res.get("Font");
    if (!fonts.isDictionary()) {
      fonts = doc.newDictionary();
      res.put("Font", fonts);
    }
    fonts.put(FONT, font);
    if (dec.watermark?.text) {
      const ca = Math.round(dec.watermark.opacity * 1000) / 1000;
      let gs = gsFor.get(ca);
      if (!gs) gsFor.set(ca, (gs = doc.addObject({ Type: "ExtGState", ca, CA: ca })));
      let ext = res.get("ExtGState");
      if (!ext.isDictionary()) {
        ext = doc.newDictionary();
        res.put("ExtGState", ext);
      }
      ext.put(GS, gs);
    }
  }
  const root = doc.getTrailer().get("Root");
  let data = root.get("DrawsetData");
  if (spec !== null && !data.isDictionary()) {
    data = doc.newDictionary();
    root.put("DrawsetData", data);
  }
  if (data.isDictionary()) {
    const cur = data.get("HeaderFooter");
    const before = cur.isString() ? cur.asString() : null;
    if (before !== spec) {
      if (spec === null) data.delete("HeaderFooter");
      else data.put("HeaderFooter", doc.newString(spec));
    }
  }
  return changed;
}

/** The header and footer settings saved in the file, if any. */
export function readDecorationSpec(doc: mupdf.PDFDocument): string | null {
  const data = doc.getTrailer().get("Root").get("DrawsetData");
  if (!data.isDictionary()) return null;
  const v = data.get("HeaderFooter");
  return v.isString() ? v.asString() : null;
}
