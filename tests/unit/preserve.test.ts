import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { translate } from "../../src/markup/edit";
import type { Markup } from "../../src/markup/model";
import { openMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, renderPdfjs } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const MANAGED = new Set(["Rect", "AP", "NM", "T", "Subj", "Contents", "CreationDate", "M", "F", "CA", "ca", "C", "IC", "BS", "Border", "RD", "BE", "IT", "L", "LE", "Vertices", "InkList", "BM", "DA", "DS", "RC", "Q", "CL", "QuadPoints", "Name", "Open", "DrawsetData", "Popup", "P"]);

/** Every annotation dictionary on every page keyed by /NM (or object number), as key → serialised value. */
function snapshot(bytes: Uint8Array) {
  const doc = openMupdf(bytes);
  const out = new Map<string, Map<string, string>>();
  for (let p = 0; p < doc.countPages(); p++) {
    const annots = (doc.loadPage(p) as mupdf.PDFPage).getObject().get("Annots");
    if (!annots.isArray()) continue;
    for (let i = 0; i < annots.length; i++) {
      const ref = annots.get(i);
      const o = ref.resolve();
      const id = o.get("NM").isString() ? o.get("NM").asString() : `obj${ref.asIndirect()}`;
      const keys = new Map<string, string>();
      o.forEach((v, k) => keys.set(String(k), v.toString()));
      out.set(id, keys);
    }
  }
  return out;
}

describe("preserving existing annotations", () => {
  it("keeps every annotation and every unknown key after editing and saving in place", async () => {
    const src = read("annotated.pdf");
    const before = snapshot(src);
    const e = new EngineCore();
    const info = e.open(src, "annotated.pdf");
    const recs = e.readMarkups(info.docId);
    const square = recs.find((m) => m.id === "fixture-square-1")!;
    const cloud = recs.find((m) => m.id === "fixture-cloud-1")!;
    const moved = { ...translate({ ...square, pageId: "x" } as Markup, 20, 15), modified: new Date().toISOString() };
    const recoloured = { ...cloud, pageId: "x", style: { ...cloud.style, color: [0, 0.4, 1] as [number, number, number] }, contents: "Revised", modified: new Date().toISOString() } as Markup;
    const res = e.save(
      info.docId,
      { pages: identityPages(info), upserts: [{ markup: moved, page: square.pageIndex }, { markup: recoloured, page: cloud.pageIndex }], deletes: [], defaultAuthor: "Tester" },
      "incremental",
    );

    // incremental: original bytes untouched
    expect(Buffer.from(res.bytes.subarray(0, src.length)).equals(Buffer.from(src))).toBe(true);

    const after = snapshot(res.bytes);
    for (const [id, keys] of before) {
      const now = after.get(id);
      expect(now, `annotation ${id} survives`).toBeDefined();
      for (const [k, v] of keys) {
        if (MANAGED.has(k) && (id === "fixture-square-1" || id === "fixture-cloud-1")) continue;
        expect(now!.get(k), `${id} /${k}`).toBe(v);
      }
    }
    // Revu-style and unknown keys on the edited square are exactly as they were
    const sq = after.get("fixture-square-1")!;
    for (const k of ["BSIColumnData", "BSILayer", "XUnknownNumber", "XUnknownDict"]) expect(sq.get(k)).toBe(before.get("fixture-square-1")!.get(k));
    // the edits landed
    const back = res.markups.find((m) => m.id === "fixture-square-1")!;
    expect(back.rect[0]).toBeCloseTo(square.rect[0] + 20, 2);
    expect(res.markups.find((m) => m.id === "fixture-cloud-1")!.contents).toBe("Revised");
    // the state reply is still attached
    expect(back.status).toBe("Accepted");

    // pdf.js still reads the file with the same number of annotations
    const pj0 = await annotationsPdfjs(src, 0);
    const pj1 = await annotationsPdfjs(res.bytes, 0);
    expect(pj1.length).toBe(pj0.length);
    const r = await renderPdfjs(res.bytes, 0, 0.5);
    expect(r.width).toBeGreaterThan(0);
  });

  it("save a copy leaves the open document and its object numbers alone", async () => {
    const src = read("annotated.pdf");
    const e = new EngineCore();
    const info = e.open(src, "annotated.pdf");
    const recs = e.readMarkups(info.docId);
    const copy = await Promise.resolve(e.saveCopy(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "Tester" }));
    const back = new EngineCore();
    const ci = back.open(copy, "copy.pdf");
    const recs2 = back.readMarkups(ci.docId);
    expect(recs2.map((m) => m.id).sort()).toEqual(recs.map((m) => m.id).sort());
    expect(e.readMarkups(info.docId).map((m) => m.objNum)).toEqual(recs.map((m) => m.objNum));
  });
});
