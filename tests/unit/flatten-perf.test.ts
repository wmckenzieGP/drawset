import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { openMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, diffFraction, renderPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";
import type { Markup } from "../../src/markup/model";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const MARKUP_TYPES = new Set(["Square", "Circle", "Line", "PolyLine", "Polygon", "Ink", "FreeText", "Text", "Highlight", "Underline", "StrikeOut", "Stamp", "Popup"]);

function markupAnnots(bytes: Uint8Array) {
  const doc = openMupdf(bytes);
  let n = 0;
  for (let p = 0; p < doc.countPages(); p++) {
    const annots = (doc.loadPage(p) as mupdf.PDFPage).getObject().get("Annots");
    if (!annots.isArray()) continue;
    for (let i = 0; i < annots.length; i++) if (MARKUP_TYPES.has(annots.get(i).resolve().get("Subtype").asName())) n++;
  }
  return n;
}

describe("flatten", () => {
  it("burns markups into the page so it looks the same in pdf.js and no markup annotations remain", async () => {
    const e = new EngineCore();
    const info = e.open(read("annotated.pdf"), "annotated.pdf");
    const extra = [mk("rectangle", { rect: [300, 300, 420, 380], style: { ...mk("rectangle").style, fill: [0.2, 0.6, 1] } }), mk("cloud", { points: [[100, 450], [250, 450], [250, 560], [100, 560]] })];
    const before = e.save(info.docId, plan(info, extra), "full");
    const ref = await renderPdfjs(before.bytes, 0, 0.75);
    const after = e.save(before.info.docId, { ...plan(before.info, []), flatten: true }, "full");
    expect(markupAnnots(after.bytes)).toBe(0);
    expect(after.markups.filter((m) => m.kind !== "foreign")).toEqual([]);
    expect((await annotationsPdfjs(after.bytes, 0)).length).toBe(0);
    const flat = await renderPdfjs(after.bytes, 0, 0.75);
    // pdf.js does not draw hidden state replies or closed popups either, so pixels agree closely
    expect(diffFraction(ref, flat)).toBeLessThan(0.002);
  });
});

describe("performance", () => {
  it("saves 500 markups in under 3 s", () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const kinds = ["rectangle", "cloud", "arrow", "textbox", "pen"] as const;
    const ms: { markup: Markup; page: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const k = kinds[i % kinds.length];
      const x = 50 + (i % 20) * 30;
      const y = 50 + Math.floor(i / 20) * 20;
      const m = mk(k, {
        rect: [x, y, x + 25, y + 15],
        points: k === "cloud" ? [[x, y], [x + 25, y], [x + 25, y + 15], [x, y + 15]] : k === "arrow" ? [[x, y], [x + 25, y + 15]] : [],
        inks: k === "pen" ? [[[x, y], [x + 10, y + 10], [x + 25, y]]] : [],
        contents: k === "textbox" ? `Item ${i}` : "",
      });
      ms.push({ markup: m, page: i % 50 });
    }
    const t0 = performance.now();
    const res = e.save(info.docId, { ...plan(info, []), upserts: ms }, "incremental");
    const took = performance.now() - t0;
    expect(res.markups.length).toBe(500);
    expect(took).toBeLessThan(3000);
  });
});
