import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { CAPTION_BAND } from "../../src/engine/core/imagePdf";
import { alignFromPoints, colourfulness, compositeOverlay } from "../../src/features/overlay/overlayMath";
import { apply, type Pt } from "../../src/markup/geometry";
import { openMupdf } from "./helpers/mupdf";
import { openPdfjs, renderPdfjs } from "./helpers/pdfjs";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const RED: [number, number, number] = [1, 0, 0];
const BLUE: [number, number, number] = [0, 0, 1];

function renderPage(e: EngineCore, docId: string, page: number, scale: number) {
  return e.render({ docId, page, scale, rotate: 0 });
}

describe("overlay", () => {
  it("two-point alignment maps both pairs exactly (scale, rotation and shift)", () => {
    const b1: Pt = [10, 20];
    const b2: Pt = [110, 20];
    // the second drawing is at half size, rotated 90° and moved
    const a1: Pt = [300, 400];
    const a2: Pt = [300, 450];
    const m = alignFromPoints(a1, a2, b1, b2);
    const p1 = apply(m, b1);
    const p2 = apply(m, b2);
    expect(p1[0]).toBeCloseTo(a1[0], 9);
    expect(p1[1]).toBeCloseTo(a1[1], 9);
    expect(p2[0]).toBeCloseTo(a2[0], 9);
    expect(p2[1]).toBeCloseTo(a2[1], 9);
  });

  it("identical pages show no colour; a changed page shows red and blue where they differ", () => {
    const e = new EngineCore();
    const a = e.open(read("calibration.pdf"), "a.pdf");
    const ra = renderPage(e, a.docId, 0, 0.5);
    const out = new Uint8ClampedArray(ra.data.length);
    compositeOverlay(ra.data, ra.data, out, RED, BLUE, true, true);
    expect(colourfulness(out)).toBe(0);
    // there is ink, so the zero is not just a blank page
    expect(out.some((v, i) => i % 4 !== 3 && v < 128)).toBe(true);

    const b = e.open(read("dense-a1.pdf"), "b.pdf");
    const rb = renderPage(e, b.docId, 0, 0.5);
    const w = Math.min(ra.width, rb.width);
    const h = Math.min(ra.height, rb.height);
    const crop = (r: { width: number; data: Uint8ClampedArray }) => {
      const c = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) c.set(r.data.subarray(y * r.width * 4, y * r.width * 4 + w * 4), y * w * 4);
      return c;
    };
    const ca = crop(ra);
    const cb = crop(rb);
    const diff = new Uint8ClampedArray(w * h * 4);
    compositeOverlay(ca, cb, diff, RED, BLUE, true, true);
    expect(colourfulness(diff)).toBeGreaterThan(0.001);
    let red = 0;
    let blue = 0;
    for (let i = 0; i < diff.length; i += 4) {
      if (diff[i] > 200 && diff[i + 2] < 80) red++;
      if (diff[i + 2] > 200 && diff[i] < 80) blue++;
    }
    expect(red).toBeGreaterThan(0);
    expect(blue).toBeGreaterThan(0);

    // hiding page B leaves page A alone in red
    const onlyA = new Uint8ClampedArray(w * h * 4);
    compositeOverlay(ca, cb, onlyA, RED, BLUE, true, false);
    for (let i = 0; i < onlyA.length; i += 4) expect(onlyA[i]).toBe(255);
  });

  it("exports an image-only PDF with a caption saying so, readable by MuPDF and pdf.js", async () => {
    const e = new EngineCore();
    const a = e.open(read("calibration.pdf"), "a.pdf");
    const r = renderPage(e, a.docId, 0, 0.5);
    const pw = a.pages[0].bounds[2] - a.pages[0].bounds[0];
    const ph = a.pages[0].bounds[3] - a.pages[0].bounds[1];
    const bytes = e.imagePdf([{ width: r.width, height: r.height, data: r.data, pageWidth: pw, pageHeight: ph, caption: ["Overlay (image-based, not vector): red a.pdf p1, blue b.pdf p1", "Created 16/10/2026"] }], "Overlay a.pdf / b.pdf");

    const doc = openMupdf(bytes);
    expect(doc.countPages()).toBe(1);
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const b = page.getBounds();
    expect(b[2] - b[0]).toBeCloseTo(pw, 3);
    expect(b[3] - b[1]).toBeCloseTo(ph + CAPTION_BAND, 3);
    expect(page.toStructuredText("").asText()).toContain("image-based, not vector");
    const xobjs = page.getObject().get("Resources").get("XObject");
    expect(xobjs.get("Im0").get("Subtype").asName()).toBe("Image");
    expect(doc.getTrailer().get("Info").get("Subject").asString()).toMatch(/Image-based/);

    const pdoc = await openPdfjs(bytes);
    const pp = await pdoc.getPage(1);
    const text = (await pp.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(text).toContain("image-based, not vector");
    await pdoc.destroy();
    // pdf.js draws the image: the area below the caption has ink
    const ras = await renderPdfjs(bytes, 0, 0.5);
    let dark = 0;
    for (let i = 0; i < ras.data.length; i += 4) if (ras.data[i] < 100) dark++;
    expect(dark).toBeGreaterThan(100);
  });
});
