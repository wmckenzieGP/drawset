import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { layoutText, textBoxHeight } from "../../src/markup/appearance";
import { DEFAULT_STYLE } from "../../src/markup/model";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { mk, plan } from "./helpers/markups";

function blankPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

describe("vertical text alignment", () => {
  const box: [number, number, number, number] = [100, 100, 300, 300];
  const first = (valign: 0 | 1 | 2, text = "Two\nlines") => layoutText("Helvetica", 12, text, box, 3, 0, valign)[0].y;

  it("puts the lines at the top, in the middle or at the bottom of the box", () => {
    const spare = box[3] - box[1] - textBoxHeight("Helvetica", 12, "Two\nlines", box[2] - box[0], 3);
    expect(first(1) - first(0)).toBeCloseTo(spare / 2, 6);
    expect(first(2) - first(0)).toBeCloseTo(spare, 6);
  });

  it("text taller than its box starts at the top", () => {
    const tall = Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n");
    expect(first(2, tall)).toBeCloseTo(first(0, tall), 6);
  });

  it("is saved with the text box, drawn where it was put, and read back", () => {
    const e = new EngineCore();
    const info = e.open(blankPdf(), "blank.pdf");
    const m = mk("textbox", { rect: [100, 100, 300, 400], contents: "Bottom", style: { ...DEFAULT_STYLE, color: null, textColor: [0, 0, 0], valign: 2 } });
    const res = e.save(info.docId, plan(info, [m]), "incremental");
    const o = openMupdf(res.bytes).loadPage(0).getAnnotations()[0].getObject();
    expect(JSON.parse(o.get("DrawsetData").asString()).valign).toBe(2);
    expect(res.markups.find((x) => x.id === m.id)!.style.valign).toBe(2);
    // the words are in the bottom tenth of the box, not the top
    const r = renderMupdf(res.bytes, 0, 1);
    const dark = (y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 100; x < 300; x++) if (r.data[(y * r.width + x) * 4] < 100) n++;
      return n;
    };
    expect(dark(370, 400)).toBeGreaterThan(20);
    expect(dark(100, 370)).toBe(0);
  });
});
