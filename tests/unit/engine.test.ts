import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EngineCore } from "../../src/engine/core/engineCore";
import { openMupdf } from "./helpers/mupdf";
import { annotationsPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

describe("engine core", () => {
  it("opens the 200-page set with labels and outline", () => {
    const e = new EngineCore();
    const t0 = performance.now();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const first = e.render({ docId: info.docId, page: 0, scale: 0.4, rotate: 0 });
    const ms = performance.now() - t0;
    expect(info.pageCount).toBe(200);
    expect(info.pages[4].label).toBe("M-5");
    expect(info.outline.map((o) => o.page)).toEqual([0, 50, 100, 150]);
    expect(first.width).toBeGreaterThan(100);
    expect(ms).toBeLessThan(2000);
  });

  it("renders a tile with the requested size and rotation", () => {
    const e = new EngineCore();
    const info = e.open(read("dense-a1.pdf"), "dense-a1.pdf");
    const tile = e.render({ docId: info.docId, page: 0, scale: 1, rotate: 90, tile: [0, 0, 256, 256] });
    expect(tile.width).toBe(256);
    expect(tile.height).toBe(256);
    const whole = e.render({ docId: info.docId, page: 0, scale: 0.1, rotate: 90 });
    // rotated A1 landscape becomes portrait
    expect(whole.height).toBeGreaterThan(whole.width);
  });

  it("reads existing annotations including status and private keys", () => {
    const e = new EngineCore();
    const info = e.open(read("annotated.pdf"), "annotated.pdf");
    const ms = e.readMarkups(info.docId);
    const kinds = ms.map((m) => m.kind).sort();
    expect(kinds).toEqual(["arrow", "cloud", "highlight", "note", "note", "pen", "rectangle", "textbox"].sort());
    const sq = ms.find((m) => m.kind === "rectangle")!;
    expect(sq.status).toBe("Accepted");
    expect(sq.author).toBe("Other Reviewer");
    expect(sq.id).toBe("fixture-square-1");
    expect(sq.style.fill).toEqual([1, 1, 0]);
  });

  it("finds planted search terms", () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const planted = JSON.parse(readFileSync("fixtures/set-200.json", "utf8")).planted as Record<string, number>;
    const hits = e.search(info.docId, "PLANTED-TERM-", 0, 199);
    expect(hits.map((h) => h.page)).toEqual(Object.values(planted).sort((a, b) => a - b));
    const [term, page] = Object.entries(planted)[3];
    expect(e.search(info.docId, term, page - 2, page + 2).map((h) => h.page)).toEqual([page]);
  });

  it("selects and copies text", () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    const hits = e.search(info.docId, "DRAWSET CALIBRATION SHEET", 0, 0);
    const q = hits[0].quads[0];
    const sel = e.selectText(info.docId, 0, [q[0] + 0.5, (q[1] + q[5]) / 2], [q[6] - 0.5, (q[3] + q[7]) / 2]);
    expect(sel.text.trim()).toBe("DRAWSET CALIBRATION SHEET");
  });

  it("writes a rectangle with standard keys and a Drawset appearance", async () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    const m = mk("rectangle", { style: { ...mk("rectangle").style, fill: [0, 0, 1], opacity: 0.5, dash: [4, 2] }, contents: "Check", status: "Accepted" });
    const res = e.save(info.docId, plan(info, [m]), "incremental");
    const orig = read("calibration.pdf");
    // incremental: the original bytes are a prefix of the saved file
    expect(Buffer.from(res.bytes.subarray(0, orig.length)).equals(Buffer.from(orig))).toBe(true);
    const doc = openMupdf(res.bytes);
    const annots = doc.loadPage(0).getAnnotations();
    const sq = annots.find((a) => a.getType() === "Square")!;
    const o = sq.getObject();
    expect(o.get("NM").asString()).toBe(m.id);
    expect(o.get("T").asString()).toBe("Test Author");
    expect(o.get("Subj").asString()).toBe("rectangle");
    expect(o.get("Contents").asString()).toBe("Check");
    expect(o.get("CreationDate").asString()).toBe("D:20261016010203Z");
    expect(o.get("CA").asNumber()).toBe(0.5);
    expect(o.get("BS").get("S").asName()).toBe("D");
    expect(o.get("IC").toString()).toBe("[0 0 1]");
    expect(o.get("AP").get("N").readStream().asString()).toContain("/GS0 gs");
    expect(o.get("DrawsetData").asString()).toContain('"kind":"rectangle"');
    const state = annots.find((a) => a.getObject().get("StateModel").isName())!;
    expect(state.getObject().get("State").asName()).toBe("Accepted");
    expect(state.getObject().get("IRT").asIndirect()).toBe(o.asIndirect());
    // reading back gives the same markup
    const back = res.markups.find((x) => x.id === m.id)!;
    expect(back.kind).toBe("rectangle");
    expect(back.status).toBe("Accepted");
    for (let i = 0; i < 4; i++) expect(back.rect[i]).toBeCloseTo(m.rect[i], 3);
    const pj = await annotationsPdfjs(res.bytes, 0);
    const pjSq = pj.find((a) => a.subtype === "Square")!;
    expect(pjSq.id).toBeDefined();
    expect(pjSq.titleObj?.str ?? pjSq.title).toBe("Test Author");
  });
});
