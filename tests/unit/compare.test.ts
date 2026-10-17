import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { diffRegions } from "../../src/features/overlay/overlayMath";
import { compareClouds, pixelRectToPage } from "../../src/features/overlay/compare";
import { transformRect, type Rect } from "../../src/markup/geometry";
import { openMupdf } from "./helpers/mupdf";
import { mk, plan } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

const contains = (outer: Rect, inner: Rect) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

describe("compare documents", () => {
  it("identical revisions give no changes; added content gives one cloud around each change", () => {
    const e = new EngineCore();
    const a = e.open(read("calibration-rev.pdf"), "rev-B.pdf");
    const b = e.open(read("calibration.pdf"), "rev-A.pdf");
    const scale = 1;
    const ra = e.render({ docId: a.docId, page: 0, scale, rotate: 0 });
    const rb = e.render({ docId: b.docId, page: 0, scale, rotate: 0 });
    expect(diffRegions(rb.data, rb.data, rb.width, rb.height)).toEqual([]);

    const regions = diffRegions(ra.data, rb.data, ra.width, ra.height);
    expect(regions).toHaveLength(2);
    const bounds = a.pages[0].bounds;
    const areas = regions.map((r) => pixelRectToPage(r, bounds, scale)).sort((x, y) => x[0] - y[0]);
    const ctm = a.pages[0].ctm;
    const box = transformRect([700, 500, 760, 530], ctm);
    const line = transformRect([900, 149.5, 1000, 150.5], ctm);
    expect(contains(areas[0], box)).toBe(true);
    expect(contains(areas[1], line)).toBe(true);
    // tight: each cloud is no more than a cell plus the margin bigger than the change on each side
    expect(areas[0][2] - areas[0][0]).toBeLessThan(60 + 2 * (8 + 6) + 1);
  });

  it("clouds are written as standard cloudy polygons listed with what they were compared against", () => {
    const clouds = compareClouds("p0", [[100, 100, 200, 160]], "rev-A.pdf page 1");
    expect(clouds).toHaveLength(1);
    expect(clouds[0].kind).toBe("cloud");
    expect(clouds[0].subject).toBe("Compare");
    expect(clouds[0].contents).toBe("Change 1 of 1, compared with rev-A.pdf page 1");
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "c.pdf");
    const res = e.save(info.docId, plan(info, clouds.map((c) => ({ ...mk("cloud"), ...c }))), "incremental");
    const annot = (openMupdf(res.bytes).loadPage(0) as mupdf.PDFPage).getAnnotations().find((x) => x.getType() === "Polygon")!;
    expect(annot.getObject().get("BE").get("S").asName()).toBe("C");
    expect(res.markups.find((m) => m.subject === "Compare")?.contents).toContain("compared with");
  });
});
