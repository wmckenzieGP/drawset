import * as mupdf from "mupdf";
import type { Raster } from "./pdfjs";

export function openMupdf(bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  if (!doc) throw new Error("not a PDF");
  return doc;
}

/** Render a page including annotations with MuPDF; RGBA pixels on white. */
export function renderMupdf(bytes: Uint8Array, pageIndex: number, scale: number): Raster {
  const doc = openMupdf(bytes);
  const page = doc.loadPage(pageIndex);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth();
  const h = pix.getHeight();
  const src = pix.getPixels();
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    data[i * 4] = src[j];
    data[i * 4 + 1] = src[j + 1];
    data[i * 4 + 2] = src[j + 2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
