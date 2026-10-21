import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { blendOf, buildAppearance } from "../../src/markup/appearance";
import { appearanceToPdf } from "../../src/markup/pdfAppearance";
import { paintedStyle } from "../../src/markup/arrange";
import { DEFAULT_STYLE, type Markup } from "../../src/markup/model";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { renderPdfjs, type Raster } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

const IDENTITY: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

/** An A4 page with a black band across it (page space y 140 to 160), to see what shows through a markup. */
function bandPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, "0 0 0 rg 0 682 595 20 re f"));
  return doc.saveToBuffer("").asUint8Array().slice();
}

const pixel = (r: Raster, x: number, y: number) => Array.from(r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3));

function save(m: Markup) {
  const e = new EngineCore();
  const info = e.open(bandPdf(), "band.pdf");
  const res = e.save(info.docId, plan(info, [m]), "incremental");
  const doc = openMupdf(res.bytes);
  const o = doc.loadPage(0).getAnnotations().find((a) => a.getObject().get("NM").asString() === m.id)!.getObject();
  return { bytes: res.bytes, o, back: res.markups.find((x) => x.id === m.id)! };
}

describe("line and fill opacity, and the Highlight option", () => {
  it("a box's fill and outline take their own opacity on screen and in the file", () => {
    const m = mk("rectangle", { style: { ...DEFAULT_STYLE, fill: [0, 0.5, 1], opacity: 0.8, fillOpacity: 0.3 } });
    const ap = buildAppearance(m);
    expect([ap.opacity, ap.fillOpacity]).toEqual([0.8, 0.3]);
    // without its own fill opacity, the fill follows the line's
    expect(buildAppearance(mk("rectangle", { style: { ...DEFAULT_STYLE, opacity: 0.6 } })).fillOpacity).toBe(0.6);
    // kinds without a fill of their own ignore it (a line's arrowheads follow the line)
    expect(buildAppearance(mk("arrow", { points: [[0, 0], [50, 0]], style: { ...DEFAULT_STYLE, opacity: 0.7, fillOpacity: 0.2 } })).fillOpacity).toBe(0.7);
  });

  it("a text box's text keeps the line opacity when its fill has its own", () => {
    const m = mk("textbox", { contents: "Level 3", style: { ...DEFAULT_STYLE, fill: [1, 1, 0.8], opacity: 1, fillOpacity: 0.25 } });
    const pdf = appearanceToPdf(buildAppearance(m), IDENTITY);
    expect(pdf.usesTextGState).toBe(true);
    expect(pdf.content).toContain("q /GS1 gs\nBT");
    // the same opacity for both needs no second state
    expect(appearanceToPdf(buildAppearance(mk("textbox", { contents: "x", style: { ...DEFAULT_STYLE, opacity: 0.5 } })), IDENTITY).usesTextGState).toBe(false);
  });

  it("Highlight is offered for shapes, lines and text; the pen and the always-blended kinds are left alone", () => {
    const hl = { ...DEFAULT_STYLE, blend: "Multiply" as const };
    expect(blendOf(mk("cloud", { style: hl }))).toBe("Multiply");
    expect(blendOf(mk("rectangle"))).toBe("Normal");
    expect(blendOf(mk("pen", { style: hl }))).toBe("Normal");
    expect(blendOf(mk("highlight"))).toBe("Multiply");
    expect(blendOf(mk("volume"))).toBe("Multiply");
  });

  it("the format painter carries fill opacity and Highlight", () => {
    const src = mk("rectangle", { style: { ...DEFAULT_STYLE, fill: [1, 1, 0], fillOpacity: 0.4, blend: "Multiply" } });
    const out = paintedStyle(src, mk("cloud"));
    expect([out.fillOpacity, out.blend]).toEqual([0.4, "Multiply"]);
  });

  it("saves /CA, /ca and /BM as PDF 2.0 defines them, reads them back, and both viewers draw it the same", async () => {
    const m = mk("rectangle", { rect: [100, 100, 300, 200], style: { ...DEFAULT_STYLE, color: [0, 0, 1], width: 2, fill: [1, 1, 0], opacity: 0.8, fillOpacity: 0.5, blend: "Multiply" } });
    const { bytes, o, back } = save(m);
    expect(o.get("CA").asNumber()).toBeCloseTo(0.8, 3);
    expect(o.get("ca").asNumber()).toBeCloseTo(0.5, 3);
    expect(o.get("BM").asName()).toBe("Multiply");
    const gs = o.get("AP").get("N").get("Resources").get("ExtGState").get("GS0");
    expect(gs.get("CA").asNumber()).toBeCloseTo(0.8, 3);
    expect(gs.get("ca").asNumber()).toBeCloseTo(0.5, 3);
    expect(gs.get("BM").asName()).toBe("Multiply");
    expect(back.style.opacity).toBeCloseTo(0.8, 3);
    expect(back.style.fillOpacity).toBeCloseTo(0.5, 3);
    expect(back.style.blend).toBe("Multiply");

    // the black band shows through the highlighted fill, in MuPDF and in pdf.js
    for (const r of [renderMupdf(bytes, 0, 1), await renderPdfjs(bytes, 0, 1)]) {
      expect(Math.max(...pixel(r, 200, 150))).toBeLessThan(60);
      // and beside the band, a pale yellow at half strength
      const [red, green, blue] = pixel(r, 200, 120);
      expect(red).toBeGreaterThan(230);
      expect(green).toBeGreaterThan(230);
      expect(blue).toBeGreaterThan(100);
      expect(blue).toBeLessThan(160);
    }
  });

  it("without Highlight a solid fill covers what is under it, and no blend or fill opacity keys are written", async () => {
    const m = mk("rectangle", { rect: [100, 100, 300, 200], style: { ...DEFAULT_STYLE, fill: [1, 1, 0] } });
    const { bytes, o, back } = save(m);
    for (const k of ["CA", "ca", "BM"]) expect(o.get(k).isNull(), k).toBe(true);
    expect(back.style.fillOpacity).toBeUndefined();
    expect(back.style.blend).toBeUndefined();
    const [red, green, blue] = pixel(renderMupdf(bytes, 0, 1), 200, 150);
    expect([red > 230, green > 230, blue < 40]).toEqual([true, true, true]);
  });
});
