/** pdf.js as an independent second renderer for tests (Node, via @napi-rs/canvas). */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

export async function openPdfjs(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useSystemFonts: false, disableFontFace: true });
  const doc = await task.promise;
  return Object.assign(doc, { destroy: () => task.destroy() });
}

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Render a page with annotations (appearance streams) at the given scale; returns RGBA pixels. */
export async function renderPdfjs(bytes: Uint8Array, pageIndex: number, scale: number): Promise<Raster> {
  const doc = await openPdfjs(bytes);
  const page = await doc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale });
  const w = Math.round(vp.width);
  const h = Math.round(vp.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  const img = ctx.getImageData(0, 0, w, h);
  await doc.destroy();
  return { width: w, height: h, data: img.data };
}

export async function annotationsPdfjs(bytes: Uint8Array, pageIndex: number) {
  const doc = await openPdfjs(bytes);
  const page = await doc.getPage(pageIndex + 1);
  const annots = await page.getAnnotations();
  await doc.destroy();
  return annots as Array<Record<string, any>>;
}

/**
 * Compare two rasters of equal size. Returns the fraction of pixels whose max channel difference exceeds `tol`.
 * Anti-aliasing differs between renderers, so callers allow a small fraction.
 */
export function diffFraction(a: Raster, b: Raster, tol = 64): number {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  let bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const d = Math.max(Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]));
      if (d > tol) bad++;
    }
  }
  return bad / (w * h);
}
