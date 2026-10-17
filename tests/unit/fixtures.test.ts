import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { openMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, openPdfjs } from "./helpers/pdfjs";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

describe("fixtures", () => {
  it("dense A1 sheet is A1 and dense", () => {
    const doc = openMupdf(read("dense-a1.pdf"));
    const b = doc.loadPage(0).getBounds();
    expect(Math.round(((b[2] - b[0]) * 25.4) / 72)).toBe(841);
    expect(Math.round(((b[3] - b[1]) * 25.4) / 72)).toBe(594);
  });

  it("200-page set has labels, bookmarks and planted terms", async () => {
    const bytes = read("set-200.pdf");
    const doc = openMupdf(bytes);
    expect(doc.countPages()).toBe(200);
    expect(doc.loadPage(0).getLabel()).toBe("M-1");
    expect(doc.loadOutline()?.length).toBe(4);
    const planted = JSON.parse(readFileSync("fixtures/set-200.json", "utf8")).planted as Record<string, number>;
    expect(Object.keys(planted).length).toBe(10);
    for (const [term, page] of Object.entries(planted)) {
      expect(doc.loadPage(page).search(term, undefined).length).toBe(1);
    }
    const pj = await openPdfjs(bytes);
    expect(pj.numPages).toBe(200);
    await pj.destroy();
  });

  it("annotated fixture has several types and private keys", async () => {
    const bytes = read("annotated.pdf");
    const doc = openMupdf(bytes);
    const annots = doc.loadPage(0).getAnnotations();
    const types = annots.map((a) => a.getType());
    for (const t of ["Square", "Line", "FreeText", "Text", "Polygon", "Ink", "Highlight"]) expect(types).toContain(t);
    const sq = annots.find((a) => a.getType() === "Square")!;
    expect(sq.getObject().get("BSILayer").asString()).toBe("Services Review");
    const pj = await annotationsPdfjs(bytes, 0);
    expect(pj.length).toBeGreaterThanOrEqual(8);
  });

  it("form fixture has four fields (five widgets)", () => {
    const doc = openMupdf(read("form.pdf"));
    expect(doc.loadPage(0).getWidgets().length).toBe(5);
  });

  it("scanned page has no text", () => {
    const doc = openMupdf(read("scanned.pdf"));
    expect(doc.loadPage(0).toStructuredText("").asText().trim()).toBe("");
  });

  it("calibration sheet has known dimensions", () => {
    const known = JSON.parse(readFileSync("fixtures/calibration.json", "utf8"));
    expect(known.pointsPerMetre).toBeCloseTo((10 * 72) / 25.4, 9);
  });
});
