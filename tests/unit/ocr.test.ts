import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as mupdf from "mupdf";
import { createWorker, type Worker } from "tesseract.js";
import { EngineCore } from "../../src/engine/core/engineCore";
import type { OcrPage } from "../../src/engine/types";
import { wordsFrom, setRecogniserFactory, type Recogniser, type TesseractPage } from "../../src/features/ocr/recognise";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { diffFraction, openPdfjs, renderPdfjs } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const truth = JSON.parse(readFileSync("fixtures/scanned-text.json", "utf8")) as { lines: { x: number; y: number; size: number; text: string }[] };

// tesseract.js in Node with the same bundled English data the app ships
let worker: Worker | null = null;
async function tesseract(): Promise<Worker> {
  worker ??= await createWorker("eng", 1, { langPath: resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int"), gzip: true, cacheMethod: "none" });
  return worker;
}
const nodeRecogniser = async (): Promise<Recogniser> => {
  const w = await tesseract();
  return {
    recognise: async (png) => wordsFrom((await w.recognize(Buffer.from(png), {}, { blocks: true, text: false })).data as unknown as TesseractPage),
    close: async () => {},
  };
};
afterAll(async () => {
  await worker?.terminate();
  setRecogniserFactory(null);
});

async function recognisePage(e: EngineCore, docId: string, page: number): Promise<OcrPage> {
  const img = e.ocrImage(docId, page, 300, 7000);
  const words = await (await nodeRecogniser()).recognise(img.png);
  return { matrix: img.matrix, words };
}

const pageText = (bytes: Uint8Array) => (openMupdf(bytes).loadPage(0) as mupdf.PDFPage).toStructuredText("").asText();

describe("text recognition", () => {
  it("renders a scanned page for recognition with a matrix back to user space", () => {
    const e = new EngineCore();
    const info = e.open(read("scanned-text.pdf"), "scanned-text.pdf");
    expect(e.textCounts(info.docId, [0])).toEqual([0]);
    const img = e.ocrImage(info.docId, 0, 300, 7000);
    const [, , w, h] = info.pages[0].bounds;
    expect(img.width).toBe(Math.round((w * 300) / 72));
    expect(img.height).toBe(Math.round((h * 300) / 72));
    expect(Buffer.from(img.png.subarray(1, 4)).toString()).toBe("PNG");
    // pixel (0, 0) is the top-left corner of the page: user space (0, height)
    expect(img.matrix[4]).toBeCloseTo(0, 3);
    expect(img.matrix[5]).toBeCloseTo(h, 3);
    // a very large sheet is capped
    expect(e.ocrImage(info.docId, 0, 300, 2000).width).toBe(2000);
  });

  it("adds an invisible, searchable text layer that MuPDF and pdf.js read at the right place, saved incrementally", async () => {
    const e = new EngineCore();
    const src = read("scanned-text.pdf");
    const info = e.open(src, "scanned-text.pdf");
    const ocr = await recognisePage(e, info.docId, 0);
    const all = ocr.words.map((w) => w.text).join(" ");
    for (const word of ["GENERAL", "NOTES", "MILLIMETRES", "SCALE", "INSTALLATION", "DUCTWORK", "4254", "HOSPITAL", "M-042", "REVISION"]) expect(all).toContain(word);

    expect(e.setOcrLayer(info.docId, { 0: ocr })).toEqual([0]);
    expect(e.textCounts(info.docId, [0])[0]).toBeGreaterThan(150);
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T" }, "incremental");
    expect(Buffer.from(res.bytes.subarray(0, src.length)).equals(Buffer.from(src))).toBe(true);

    // MuPDF finds every line where it is printed
    const text = pageText(res.bytes);
    expect(text).toContain("ALL DIMENSIONS ARE IN MILLIMETRES");
    expect(text).toContain("HOSPITAL STAGE 2");
    const ph = info.pages[0].bounds[3];
    for (const line of truth.lines) {
      const first = line.text.split(" ")[0];
      const hits = e.search(res.info.docId, line.text.split(" ").slice(0, 2).join(" "), 0, 0);
      expect(hits.length, line.text).toBeGreaterThan(0);
      const q = hits[0].quads[0];
      // the quad (page space, y down) spans Helvetica's ascent and descent: about 1.43 em, a fifth of it below the baseline
      const height = q[5] - q[1];
      expect(Math.abs(q[0] - line.x), `${first} x`).toBeLessThan(4);
      expect(Math.abs(height - 1.43 * line.size), `${first} size`).toBeLessThan(line.size * 0.12);
      expect(Math.abs(q[5] - 0.22 * height - (ph - line.y)), `${first} baseline`).toBeLessThan(line.size * 0.15);
    }

    // pdf.js reads the same words at the same places
    const pj = await openPdfjs(res.bytes);
    const content = await (await pj.getPage(1)).getTextContent();
    const items = content.items as { str: string; transform: number[] }[];
    const joined = items.map((i) => i.str).join(" ");
    expect(joined).toContain("MILLIMETRES");
    expect(joined).toContain("HOSPITAL");
    const hospital = items.find((i) => i.str.includes("HOSPITAL"))!;
    const line = truth.lines.find((l) => l.text.startsWith("HOSPITAL"))!;
    expect(Math.abs(hospital.transform[4] - line.x)).toBeLessThan(4);
    expect(Math.abs(hospital.transform[5] - line.y)).toBeLessThan(line.size * 0.35);
    await pj.destroy();

    // the layer is invisible: the page looks exactly as it did
    expect(diffFraction(renderMupdf(src, 0, 0.5), renderMupdf(res.bytes, 0, 0.5))).toBe(0);
    expect(diffFraction(await renderPdfjs(src, 0, 0.5), await renderPdfjs(res.bytes, 0, 0.5))).toBeLessThan(0.0001);
    // and the scan is still the page's only image
    const doc = openMupdf(res.bytes);
    const contents = (doc.loadPage(0) as mupdf.PDFPage).getObject().get("Contents");
    expect(contents.isArray()).toBe(true);
    expect(contents.length).toBe(3);
  }, 60000);

  it("replacing the layer keeps one copy; undoing it puts back the layer the file had", async () => {
    const e = new EngineCore();
    const info = e.open(read("scanned-text.pdf"), "scanned-text.pdf");
    const ocr = await recognisePage(e, info.docId, 0);
    e.setOcrLayer(info.docId, { 0: ocr });
    const saved = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T" }, "incremental");
    const count = (b: Uint8Array) => pageText(b).split("MILLIMETRES").length - 1;
    expect(count(saved.bytes)).toBe(1);
    // reading the page again replaces the file's layer rather than adding a second one
    const before = e.textCounts(saved.info.docId, [0])[0];
    const again = { ...ocr, words: ocr.words.map((w) => (w.text === "MILLIMETRES" ? { ...w, text: "METRES" } : w)) };
    expect(e.setOcrLayer(saved.info.docId, { 0: again })).toEqual([0]);
    expect(e.textCounts(saved.info.docId, [0])[0]).toBe(before - 5);
    // undo: back to the file's own layer
    expect(e.setOcrLayer(saved.info.docId, { 0: null })).toEqual([0]);
    const back = e.save(saved.info.docId, { pages: identityPages(saved.info), upserts: [], deletes: [], defaultAuthor: "T" }, "full");
    expect(count(back.bytes)).toBe(1);
  }, 60000);

  it("places words correctly on a rotated page", async () => {
    // a 600 x 400 page shown rotated 90°, with text written upwards so it reads upright on screen
    const doc = new mupdf.PDFDocument();
    const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    const res = doc.addObject({ Font: { F: font } });
    const page = doc.addPage([0, 0, 600, 400], 90, res, "BT /F 40 Tf 0 1 -1 0 300 80 Tm (CONCRETE SLAB) Tj ET");
    doc.insertPage(-1, page);
    const e = new EngineCore();
    const info = e.open(doc.saveToBuffer("").asUint8Array().slice(), "rot.pdf");
    const ocr = await recognisePage(e, info.docId, 0);
    expect(ocr.words[0].text).toBe("CONCRETE");
    e.setOcrLayer(info.docId, { 0: ocr });
    // the page's own text and the recognised text are found at the same place
    const hits = e.search(info.docId, "CONCRETE", 0, 0);
    expect(hits).toHaveLength(2);
    const [a, b] = hits.map((h) => h.quads[0]);
    for (let i = 0; i < 8; i++) expect(Math.abs(a[i] - b[i]), `corner ${i}`).toBeLessThan(4);
  }, 60000);

  it("turns tesseract's blocks into words with baselines and drops noise", () => {
    const words = wordsFrom({
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  baseline: { x0: 0, y0: 100, x1: 1000, y1: 110, has_baseline: true },
                  words: [
                    { text: "DOOR", confidence: 90, bbox: { x0: 0, y0: 60, x1: 100, y1: 101 } },
                    { text: "~", confidence: 90, bbox: { x0: 120, y0: 60, x1: 130, y1: 101 } },
                    { text: "D01", confidence: 10, bbox: { x0: 200, y0: 60, x1: 300, y1: 101 } },
                    { text: "SCHEDULE", confidence: 80, bbox: { x0: 900, y0: 70, x1: 1000, y1: 115 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(words.map((w) => w.text)).toEqual(["DOOR", "SCHEDULE"]);
    expect(words[0].baseline).toBeCloseTo(100.5, 5);
    expect(words[1].baseline).toBeCloseTo(109.5, 5);
  });
});

describe("recognising through the app state", () => {
  it("adds the text layer as one undoable step that the engine follows, skipping pages with text", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, undo, redo, useApp, isDirty } = await import("../../src/state/store");
    const { runOcr } = await import("../../src/features/ocr/ocr");
    await import("../../src/state/documents");
    setRecogniserFactory(nodeRecogniser);
    const core = useNodeEngine();
    const info = core.open(read("scanned-text.pdf"), "scanned-text.pdf");
    const blank = core.addBlankPage(info.docId, 595, 842);
    const key = addTab({ ...info, pageCount: 2, pages: [...info.pages, blank] }, "scanned-text.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    const settle = () => new Promise((r) => setTimeout(r, 0));
    const progress: number[] = [];

    const res = await runOcr(key, [0], { skipText: true, onProgress: (p) => progress.push(p.done) });
    expect(res).toMatchObject({ pages: 1, skipped: 0 });
    expect(res!.words).toBeGreaterThan(25);
    expect(progress).toEqual([0, 1]);
    expect(tab().undo.at(-1)?.label).toBe("Recognise text");
    expect(isDirty(tab())).toBe(true);
    await settle();
    expect(core.search(info.docId, "MILLIMETRES", 0, 1)).toHaveLength(1);

    // a page that now has text is skipped... unless it was recognised in this session
    expect(await runOcr(key, [0], { skipText: true })).toMatchObject({ pages: 1, skipped: 0 });
    await settle();
    expect(core.search(info.docId, "MILLIMETRES", 0, 1)).toHaveLength(1);
    undo(key);

    undo(key);
    await settle();
    expect(tab().state.ocr).toBeUndefined();
    expect(core.search(info.docId, "MILLIMETRES", 0, 1)).toHaveLength(0);
    redo(key);
    await settle();
    expect(core.search(info.docId, "MILLIMETRES", 0, 1)).toHaveLength(1);

    // cancelling leaves nothing behind
    undo(key);
    const cancelled = await runOcr(key, [0], { cancelled: () => true });
    expect(cancelled).toBeNull();
    expect(tab().state.ocr).toBeUndefined();
  }, 90000);
});
