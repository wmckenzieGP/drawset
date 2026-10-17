/** Builds a PDF whose pages are images with a caption band saying so (overlay export). */
import * as mupdf from "mupdf";
import type { ImagePdfPage } from "../types";

/** Height of the caption band above the image, in points. */
export const CAPTION_BAND = 28;

/** PDF string literal in WinAnsi range; anything outside Latin-1 becomes "?". */
function pdfString(s: string): string {
  const safe = [...s].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 255 ? "?" : c)).join("");
  return "(" + safe.replace(/[\\()]/g, (c) => "\\" + c) + ")";
}

export function buildImagePdf(pages: ImagePdfPage[], title: string): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  for (const p of pages) {
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, p.width, p.height], false);
    const dst = pix.getPixels();
    for (let i = 0, j = 0; i < p.data.length; i += 4, j += 3) {
      dst[j] = p.data[i];
      dst[j + 1] = p.data[i + 1];
      dst[j + 2] = p.data[i + 2];
    }
    const image = doc.addImage(new mupdf.Image(pix));
    pix.destroy();
    const w = p.pageWidth;
    const h = p.pageHeight;
    const lines = p.caption.slice(0, 2);
    const text = lines.map((l, k) => `BT /F1 ${k === 0 ? 10 : 8} Tf 8 ${h + CAPTION_BAND - 12 - k * 11} Td ${pdfString(l)} Tj ET`).join("\n");
    const content = `q 1 1 1 rg 0 0 ${w} ${h + CAPTION_BAND} re f Q\nq ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\nq 0 g\n${text}\nQ\n`;
    const resources = { Font: { F1: font }, XObject: { Im0: image } };
    const page = doc.addPage([0, 0, w, h + CAPTION_BAND], 0, resources, content);
    doc.insertPage(-1, page);
  }
  const info = doc.getTrailer().get("Info");
  const infoObj = info.isNull() ? doc.addObject(doc.newDictionary()) : info;
  infoObj.put("Title", doc.newString(title));
  infoObj.put("Subject", doc.newString("Image-based overlay: pixels, not vector content"));
  infoObj.put("Producer", doc.newString("Drawset"));
  if (info.isNull()) doc.getTrailer().put("Info", infoObj);
  const buf = doc.saveToBuffer("garbage,compress");
  const bytes = buf.asUint8Array().slice();
  buf.destroy();
  doc.destroy();
  return bytes;
}
