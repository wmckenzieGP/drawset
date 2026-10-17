import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { apply, type Pt } from "../../src/markup/geometry";
import { ContentSnapIndex, segmentIntersection, snapPoint } from "../../src/features/viewer/snap";
import { mk } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const cal = JSON.parse(readFileSync("fixtures/calibration.json", "utf8"));

function indexFor(bytes: Uint8Array, name: string) {
  const e = new EngineCore();
  const info = e.open(bytes, name);
  return { info, index: new ContentSnapIndex(e.snapGeometry(info.docId, 0)) };
}

const none = { markups: null, content: null, grid: null, origin: [0, 0] as Pt };

describe("snapping", () => {
  it("snaps to the drawing's line end points exactly (calibration sheet)", () => {
    const { info, index } = indexFor(read("calibration.pdf"), "calibration.pdf");
    const ctm = info.pages[0].ctm;
    for (const key of ["horizontal", "vertical", "hypotenuse"]) {
      for (const end of ["from", "to"]) {
        const target = apply(ctm, cal[key][end]);
        const near: Pt = [target[0] + 2.2, target[1] - 1.7];
        const hit = snapPoint(near, 5, { ...none, content: index });
        expect(hit?.kind).toBe("endpoint");
        // the sheet's content stream rounds to two decimals, so the drawn line ends are within 0.01 pt of the analytic ones
        expect(Math.abs(hit!.pt[0] - target[0])).toBeLessThan(0.01);
        expect(Math.abs(hit!.pt[1] - target[1])).toBeLessThan(0.01);
      }
    }
    // the room's corners too
    const r = cal.room.rect;
    const corner = apply(ctm, [r[2], r[3]]);
    const hit = snapPoint([corner[0] - 3, corner[1] + 3], 6, { ...none, content: index });
    expect(Math.abs(hit!.pt[0] - corner[0])).toBeLessThan(0.01);
    expect(Math.abs(hit!.pt[1] - corner[1])).toBeLessThan(0.01);
    // out of reach: no snap
    expect(snapPoint([corner[0] - 30, corner[1] + 30], 6, { ...none, content: index })).toBeNull();
  });

  it("snaps to where two drawn lines cross, and to end points exactly", () => {
    const doc = new mupdf.PDFDocument();
    // an X: (100,100)-(300,250) and (100,250)-(300,100) cross at (200,175) in user space; a line inside a transformed group
    doc.insertPage(-1, doc.addPage([0, 0, 400, 400], 0, {}, "1 w 100 100 m 300 250 l S 100 250 m 300 100 l S q 2 0 0 2 10 20 cm 12.25 30.5 m 40.75 30.5 l S Q"));
    const { info, index } = indexFor(doc.saveToBuffer("").asUint8Array().slice(), "x.pdf");
    for (const user of [[34.5, 81], [91.5, 81]] as Pt[]) {
      const target = apply(info.pages[0].ctm, user);
      const hit = snapPoint([target[0] + 1.5, target[1] - 2], 6, { ...none, content: index });
      expect(hit).toEqual({ pt: target, kind: "endpoint" });
    }
    const target = apply(info.pages[0].ctm, [200, 175]);
    const hit = snapPoint([target[0] + 3, target[1] + 2], 6, { ...none, content: index });
    expect(hit?.kind).toBe("intersection");
    expect(hit!.pt[0]).toBeCloseTo(target[0], 9);
    expect(hit!.pt[1]).toBeCloseTo(target[1], 9);
    expect(segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [10, 10], [0, 10], [10, 0])).toEqual([5, 5]);
  });

  it("snaps to markup vertices before the grid, and to the grid otherwise", () => {
    const poly = mk("polygon", { points: [[100.125, 200.5], [180.25, 210.75], [150, 260]] });
    const box = mk("rectangle", { rect: [300, 300, 350, 340] });
    const o = { ...none, markups: [poly, box], grid: 10, origin: [0, 0] as Pt };
    expect(snapPoint([181, 212], 4, o)).toEqual({ pt: [180.25, 210.75], kind: "vertex" });
    expect(snapPoint([348, 338], 4, o)).toEqual({ pt: [350, 340], kind: "vertex" });
    expect(snapPoint([243.4, 77.9], 4, o)).toEqual({ pt: [240, 80], kind: "grid" });
    // the grid starts at the page origin
    expect(snapPoint([243.4, 77.9], 4, { ...o, origin: [5, 5] })!.pt).toEqual([245, 75]);
  });

  it("indexes and queries a dense A1 sheet quickly", () => {
    const t0 = performance.now();
    const { index } = indexFor(read("dense-a1.pdf"), "dense-a1.pdf");
    const built = performance.now() - t0;
    expect(index.g.segments.length / 4).toBeGreaterThan(20000);
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) snapPoint([100 + i * 7, 200 + i * 5], 6, { ...none, content: index });
    const perQuery = (performance.now() - t1) / 200;
    expect(built).toBeLessThan(3000);
    expect(perQuery).toBeLessThan(8);
  });
});
