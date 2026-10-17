/**
 * OCR support: renders a page to a greyscale image for recognition, and writes the recognised words back as
 * an invisible text layer (render mode 3) in a content stream of its own. The page's own content, images
 * included, is never touched or replaced.
 */
import * as mupdf from "mupdf";
import { concat, invert, scaleM, translateM, type Matrix } from "../../markup/geometry";
import { textWidth } from "../../markup/appearance";
import { winAnsiLiteral } from "../../markup/pdfAppearance";
import type { OcrImage, OcrPage } from "../types";
import { ownResources, ownStreams, replaceOwnStreams } from "./decorations";

export const OCR_ROLE = "OCR";
const FONT = "DrawsetOcr";
const n = (v: number) => String(Math.round(v * 100) / 100);

/** The page's printed content (no markups) as a greyscale PNG, with the matrix from image pixels to PDF user space. */
export function renderForOcr(page: mupdf.PDFPage, dpi: number, maxPx: number): OcrImage {
  const b = page.getBounds();
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  const s = Math.min(dpi / 72, maxPx / Math.max(w, h));
  const width = Math.max(1, Math.round(w * s));
  const height = Math.max(1, Math.round(h * s));
  const toPixels = concat(translateM(-b[0], -b[1]), scaleM(s));
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, width, height], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(toPixels as mupdf.Matrix, pix);
  page.runPageContents(dev, mupdf.Matrix.identity);
  dev.close();
  dev.destroy();
  const png = pix.asPNG().slice();
  pix.destroy();
  const ctm = page.getTransform() as Matrix;
  return { png, width, height, matrix: invert(concat(ctm, toPixels)) };
}

/** The content stream for one page's recognised words (drawn in image pixels, mapped by the page's matrix). */
export function ocrContent(p: OcrPage): string {
  const out = [`q ${p.matrix.map(n).join(" ")} cm`, `BT 3 Tr`];
  let size = -1;
  for (const word of p.words) {
    const text = word.text.trim();
    if (!text) continue;
    const [x0, y0, x1] = word.bbox;
    // Helvetica's cap height is about 0.72 em: size the text so its capitals fill the word's height above the baseline
    const fs = Math.max(1, (word.baseline - y0) / 0.72);
    const natural = textWidth("Helvetica", fs, text);
    const tz = natural > 0 ? (100 * (x1 - x0)) / natural : 100;
    if (Math.abs(fs - size) > 0.01) {
      out.push(`/${FONT} ${n(fs)} Tf`);
      size = fs;
    }
    out.push(`${n(tz)} Tz 1 0 0 -1 ${n(x0)} ${n(word.baseline)} Tm ${winAnsiLiteral(text)} Tj`);
  }
  out.push("ET Q");
  return out.join("\n");
}

/**
 * Replaces the recognised-text layer on the given pages; null puts back the layer the page had when opened, if
 * any (`originals` keeps it from the first replacement). Returns the pages that changed.
 */
export function setOcrLayer(doc: mupdf.PDFDocument, pages: Record<number, OcrPage | null>, originals: Map<number, mupdf.PDFObject[]>): number[] {
  const changed: number[] = [];
  let font: mupdf.PDFObject | null = null;
  for (const [key, p] of Object.entries(pages)) {
    const index = Number(key);
    if (index < 0 || index >= doc.countPages()) continue;
    const obj = (doc.loadPage(index) as mupdf.PDFPage).getObject();
    if (!p) {
      const original = originals.get(index);
      if (original && replaceOwnStreams(doc, obj, OCR_ROLE, original)) changed.push(index);
      continue;
    }
    if (!originals.has(index)) originals.set(index, ownStreams(obj, OCR_ROLE));
    replaceOwnStreams(doc, obj, OCR_ROLE, ocrContent(p));
    if (!font) font = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
    ownResources(doc, obj, "Font").put(FONT, font);
    changed.push(index);
  }
  return changed;
}
