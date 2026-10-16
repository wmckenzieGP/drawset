import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { pageMatrix } from "../../src/engine/core/decorations";
import type { Decoration } from "../../src/engine/types";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { openPdfjs, renderPdfjs } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const dec = (items: Decoration["items"], extra: Partial<Decoration> = {}): Decoration => ({ rotate: 0, items, fontSize: 9, colour: [0, 0, 0], margin: 28.35, watermark: null, ...extra });

/** Lines of text on a page with their page-space boxes (MuPDF). */
function lines(doc: mupdf.PDFDocument, i: number) {
  const out: { text: string; bbox: number[] }[] = [];
  const st = doc.loadPage(i).toStructuredText("");
  const json = JSON.parse(st.asJSON()) as { blocks: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] }[] };
  for (const b of json.blocks) for (const l of b.lines ?? []) out.push({ text: l.text, bbox: [l.bbox.x, l.bbox.y, l.bbox.x + l.bbox.w, l.bbox.y + l.bbox.h] });
  return out;
}

async function pdfjsText(bytes: Uint8Array, page: number) {
  const pj = await openPdfjs(bytes);
  const tc = await (await pj.getPage(page + 1)).getTextContent();
  await pj.destroy();
  return tc.items.map((it) => ("str" in it ? it.str : "")).join("\n");
}

describe("headers, footers and watermarks", () => {
  it("page matrix matches MuPDF's for every rotation and an offset crop box", () => {
    const doc = new mupdf.PDFDocument();
    const p = doc.addPage([10, 20, 610, 420], 0, {}, "");
    p.put("CropBox", [30, 40, 500, 400]);
    doc.insertPage(-1, p);
    for (const r of [0, 90, 180, 270]) {
      p.put("Rotate", r);
      const page = doc.loadPage(0) as mupdf.PDFPage;
      const m = pageMatrix(page, r);
      expect(m.ctm.map((v) => v + 0)).toEqual(page.getTransform().map((v) => v + 0));
      expect([0, 0, m.width, m.height]).toEqual(page.getBounds());
    }
  });

  it("writes text at the six positions as separate streams, saves incrementally, and MuPDF and pdf.js read it", async () => {
    const e = new EngineCore();
    const src = read("set-200.pdf");
    const info = e.open(src, "set-200.pdf");
    const w = info.pages[0].bounds[2];
    const h = info.pages[0].bounds[3];
    const items: Decoration["items"] = [
      { pos: "tl", text: "Hospital Stage 2" },
      { pos: "tc", text: "CONFIDENTIAL" },
      { pos: "tr", text: "Sheet M-001" },
      { pos: "bl", text: "set-200.pdf" },
      { pos: "bc", text: "Page 1 of 200" },
      { pos: "br", text: "16/10/2026" },
    ];
    const changed = e.setDecorations(info.docId, { 0: dec(items), 1: dec([{ pos: "bc", text: "Page 2 of 200" }]) }, '{"version":1}');
    expect(changed).toEqual([0, 1]);
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T" }, "incremental");
    expect(Buffer.from(res.bytes.subarray(0, src.length)).equals(Buffer.from(src))).toBe(true);
    expect(res.info.headerFooter).toBe('{"version":1}');

    const doc = openMupdf(res.bytes);
    const ls = lines(doc, 0);
    const at = (t: string) => ls.find((l) => l.text === t)!.bbox;
    const m = 28.35;
    // left edges at the margin, right edges at the margin, centred text centred, headers on top, footers at the bottom
    expect(at("Hospital Stage 2")[0]).toBeCloseTo(m, 0);
    // (glyph boxes include side bearings, so allow a point)
    expect(Math.abs(w - at("Sheet M-001")[2] - m)).toBeLessThan(1);
    expect(Math.abs((at("CONFIDENTIAL")[0] + at("CONFIDENTIAL")[2]) / 2 - w / 2)).toBeLessThan(1.5);
    expect(at("Hospital Stage 2")[1]).toBeGreaterThan(m - 4);
    expect(at("Hospital Stage 2")[3]).toBeLessThan(m + 12);
    expect(at("Page 1 of 200")[3]).toBeGreaterThan(h - m - 1);
    expect(at("Page 1 of 200")[3]).toBeLessThan(h - m + 4);
    // the page's own content streams are untouched; ours are tagged
    const contents = doc.loadPage(0).getObject().get("Contents");
    expect(contents.length).toBe(3);
    expect(contents.get(0).get("DrawsetData").get("Role").asName()).toBe("HeaderFooter");
    expect(contents.get(2).readStream().asString()).toContain("/Artifact <</Type /Pagination /Subtype /Footer>> BDC");
    const pjText = await pdfjsText(res.bytes, 0);
    for (const it of items) expect(pjText).toContain(it.text);
    expect(await pdfjsText(res.bytes, 1)).toContain("Page 2 of 200");
    expect(await pdfjsText(res.bytes, 2)).not.toContain("Page 3");

    // replacing and removing leave only the original content
    e.setDecorations(res.info.docId, { 0: dec([{ pos: "tc", text: "REVISED" }]), 1: null }, null);
    const again = e.save(res.info.docId, { pages: identityPages(res.info), upserts: [], deletes: [], defaultAuthor: "T" }, "incremental");
    const d2 = openMupdf(again.bytes);
    expect(lines(d2, 0).map((l) => l.text)).toContain("REVISED");
    expect(lines(d2, 0).map((l) => l.text)).not.toContain("Hospital Stage 2");
    expect(lines(d2, 1).map((l) => l.text)).not.toContain("Page 2 of 200");
    const c1 = d2.loadPage(1).getObject().get("Contents");
    expect(c1.isArray() ? c1.length : 1).toBe(1);
    expect(again.info.headerFooter).toBeNull();
  });

  it("puts headers at the top of rotated pages as they are shown", () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    // view the page rotated 90° (a saved page rotation not yet in the file)
    e.setDecorations(info.docId, { 0: dec([{ pos: "tl", text: "TOP LEFT" }], { rotate: 90 }) }, null);
    const res = e.save(info.docId, { pages: [{ index: 0, rotate: 90 }], upserts: [], deletes: [], defaultAuthor: "T" }, "full");
    const doc = openMupdf(res.bytes);
    const l = lines(doc, 0).find((x) => x.text === "TOP LEFT")!;
    expect(l).toBeTruthy();
    expect(l.bbox[0]).toBeCloseTo(28.35, 0);
    expect(l.bbox[3]).toBeLessThan(45);
    // upright: wider than tall
    expect(l.bbox[2] - l.bbox[0]).toBeGreaterThan(l.bbox[3] - l.bbox[1]);
  });

  it("draws a translucent diagonal watermark that both renderers show, over the drawing without hiding it", async () => {
    const e = new EngineCore();
    const src = read("calibration.pdf");
    const info = e.open(src, "calibration.pdf");
    e.setDecorations(info.docId, { 0: dec([], { watermark: { text: "DRAFT", fontSize: 0, colour: [1, 0, 0], opacity: 0.25, angle: 45 } }) }, null);
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T" }, "incremental");
    const body = openMupdf(res.bytes).loadPage(0).getObject().get("Contents").get(2).readStream().asString();
    expect(body).toContain("/Subtype /Watermark");
    expect(body).toContain("/DrawsetWm gs");
    const gs = openMupdf(res.bytes).loadPage(0).getObject().get("Resources").get("ExtGState").get("DrawsetWm");
    expect(gs.get("ca").asNumber()).toBeCloseTo(0.25);
    for (const r of [renderMupdf(res.bytes, 0, 0.5), await renderPdfjs(res.bytes, 0, 0.5)]) {
      // pinkish pixels (red at 25%) appear; none are fully red
      let pink = 0;
      let solid = 0;
      for (let i = 0; i < r.data.length; i += 4) {
        const [R, G, B] = [r.data[i], r.data[i + 1], r.data[i + 2]];
        if (R > 230 && G > 150 && G < 220 && B > 150 && B < 220) pink++;
        if (R > 200 && G < 60 && B < 60) solid++;
      }
      expect(pink).toBeGreaterThan(2000);
      expect(solid).toBe(0);
    }
    // text of the drawing is still extractable and the watermark text is there too
    const t = lines(openMupdf(res.bytes), 0).map((l) => l.text).join(" ");
    expect(t).toContain("DRAFT");
  });
});

describe("headers and footers through the app state", () => {
  it("fill in variables per page, follow page moves, and undo removes them", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, undo, useApp } = await import("../../src/state/store");
    const { applyHeaderFooter } = await import("../../src/features/headerFooter/HeaderFooterDialog");
    const { defaultSpec, decorationsFor } = await import("../../src/features/headerFooter/hf");
    const { movePages } = await import("../../src/features/pages/pageOps");
    const core = useNodeEngine();
    const info = core.open(read("set-200.pdf"), "set-200.pdf");
    const key = addTab(info, "set-200.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    const text = async (i: number) => {
      await new Promise((r) => setTimeout(r, 0));
      return lines(core.pdf(info.docId), i).map((l) => l.text);
    };
    applyHeaderFooter(key, { ...defaultSpec(), date: "16/10/2026", text: { tr: "{label}", bc: "Page {page} of {pages}", bl: "{file} {date}" }, range: { from: 1, to: 3 } });
    expect(await text(0)).toEqual(expect.arrayContaining(["M-1", "Page 1 of 200", "set-200.pdf 16/10/2026"]));
    expect(await text(2)).toContain("Page 3 of 200");
    expect(await text(3)).not.toContain("Page 4 of 200");
    expect([...decorationsFor(tab()).values()].filter(Boolean)).toHaveLength(3);

    // move the first page to third place: numbers follow the new order
    movePages(key, [tab().state.pages[0].id], 3);
    expect(await text(0)).toContain("Page 3 of 200");
    expect(await text(1)).toContain("Page 1 of 200");

    undo(key);
    undo(key);
    expect(await text(0)).not.toContain("Page 1 of 200");
    expect(core.pdf(info.docId).loadPage(0).getObject().get("Contents").isArray()).toBe(false);
  });
});
