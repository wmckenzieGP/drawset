import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { bboxOf, type Pt, type Quad } from "../../src/markup/geometry";
import { openMupdf } from "./helpers/mupdf";
import { openPdfjs, renderPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

async function pdfjsText(bytes: Uint8Array) {
  const doc = await openPdfjs(bytes);
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  await doc.destroy();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}
const mupdfText = (bytes: Uint8Array) => (openMupdf(bytes).loadPage(0) as mupdf.PDFPage).toStructuredText("").asText();

const quadsRect = (qs: Quad[]) => bboxOf(qs.flatMap((q) => [[q[0], q[1]], [q[6], q[7]]] as Pt[]));

describe("redaction and erase", () => {
  it("text under a redaction or an erase is gone from extraction; other text stays", async () => {
    const src = read("calibration.pdf");
    const e = new EngineCore();
    const info = e.open(src, "calibration.pdf");
    const title = e.search(info.docId, "DRAWSET CALIBRATION SHEET", 0, 0)[0].quads;
    const ab = e.search(info.docId, "A-B horizontal", 0, 0)[0].quads;
    const redact = mk("redact", { quads: title, rect: quadsRect(title) });
    const erase = mk("erase", { rect: quadsRect(ab) });
    // first save the pending redactions: they are ordinary /Redact annotations and remove nothing yet
    const pending = e.save(info.docId, plan(info, [redact, erase]), "incremental");
    expect(mupdfText(pending.bytes)).toContain("DRAWSET CALIBRATION SHEET");
    expect(pending.markups.map((m) => m.kind).sort()).toEqual(["erase", "redact"]);
    const subtypes = (openMupdf(pending.bytes).loadPage(0) as mupdf.PDFPage).getAnnotations().map((a) => a.getType());
    expect(subtypes.filter((s) => s === "Redact").length).toBe(2);

    const applied = e.save(pending.info.docId, { ...plan(pending.info, []), applyRedactions: true }, "incremental");
    // not an incremental update: the old content must not survive in an earlier revision
    expect(Buffer.from(applied.bytes.subarray(0, pending.bytes.length)).equals(Buffer.from(pending.bytes))).toBe(false);
    for (const text of [mupdfText(applied.bytes), await pdfjsText(applied.bytes)]) {
      expect(text).not.toContain("CALIBRATION SHEET");
      expect(text).not.toContain("A-B horizontal");
      expect(text).toContain("C-D vertical");
    }
    expect(applied.markups.filter((m) => m.kind === "redact" || m.kind === "erase")).toEqual([]);
    // redaction leaves a black box, erase leaves the area blank
    const r = await renderPdfjs(applied.bytes, 0, 1);
    const px = (p: Pt) => {
      const i = (Math.round(p[1]) * r.width + Math.round(p[0])) * 4;
      return [r.data[i], r.data[i + 1], r.data[i + 2]];
    };
    const tr = quadsRect(title);
    expect(px([(tr[0] + tr[2]) / 2, (tr[1] + tr[3]) / 2])).toEqual([0, 0, 0]);
    const er = quadsRect(ab);
    expect(px([(er[0] + er[2]) / 2, (er[1] + er[3]) / 2])).toEqual([255, 255, 255]);
  });

  it("redacts every hit of a search", async () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const planted = JSON.parse(readFileSync("fixtures/set-200.json", "utf8")).planted as Record<string, number>;
    const [term, pageIdx] = Object.entries(planted)[0];
    const hits = e.search(info.docId, term, pageIdx, pageIdx);
    expect(hits.length).toBe(1);
    const m = mk("redact", { quads: hits[0].quads, rect: quadsRect(hits[0].quads) });
    const p = plan(info, []);
    p.upserts = [{ markup: m, page: pageIdx }];
    p.applyRedactions = true;
    const res = e.save(info.docId, p, "full");
    expect(e.search(res.info.docId, term, 0, 199)).toEqual([]);
    expect(e.search(res.info.docId, "PLANTED-TERM-", 0, 199).length).toBe(Object.keys(planted).length - 1);
  });
});
