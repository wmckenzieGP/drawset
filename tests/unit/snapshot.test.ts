import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EngineCore } from "../../src/engine/core/engineCore";
import { displayMatrix, transformRect, type Rect } from "../../src/markup/geometry";
import { snapshotArea, snapshotScale } from "../../src/features/snapshot/snapshot";
import { diffFraction } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

describe("snapshots", () => {
  it("take only the part of the area on the page, at 300 dpi unless the picture would be too big", () => {
    expect(snapshotArea([0, 0, 595, 842], [-50, 100, 200, 300])).toEqual([0, 100, 200, 300]);
    expect(snapshotArea([0, 0, 595, 842], [600, 100, 700, 300])).toBeNull();
    expect(snapshotScale([0, 0, 200, 100])).toBeCloseTo(300 / 72, 6);
    // a whole A0 sheet is held to 6000 pixels across
    expect(snapshotScale([0, 0, 3370, 2384]) * 3370).toBeCloseTo(6000, 3);
  });

  it("a page turned in Drawset is drawn back the way its markups see it, so the area matches", () => {
    const e = new EngineCore();
    const info = e.open(new Uint8Array(readFileSync("fixtures/calibration.pdf")), "calibration.pdf");
    const b = info.pages[0].bounds;
    const area: Rect = [b[0] + (b[2] - b[0]) * 0.2, b[1] + (b[3] - b[1]) * 0.3, b[0] + (b[2] - b[0]) * 0.5, b[1] + (b[3] - b[1]) * 0.6];
    const tile = transformRect(area, displayMatrix(b, 1, 0));
    const before = e.render({ docId: info.docId, page: 0, scale: 1, rotate: 0, tile });
    let ink = 0;
    for (let i = 0; i < before.data.length; i += 4) if (before.data[i] < 128) ink++;
    expect(ink, "the area has drawing in it").toBeGreaterThan(100);
    for (const turn of [90, 180, 270]) {
      const pages = identityPages(info).map((p) => ({ ...p, rotate: (info.pages[0].rotate + turn) % 360 }));
      const copy = e.open(e.saveCopy(info.docId, { pages, upserts: [], deletes: [], defaultAuthor: "Test" }), "copy.pdf");
      const after = e.render({ docId: copy.docId, page: 0, scale: 1, rotate: (360 - turn) % 360, tile, annots: true });
      expect([after.width, after.height]).toEqual([before.width, before.height]);
      expect(diffFraction(before, after), `turned ${turn}`).toBeLessThan(0.01);
      e.close(copy.docId);
    }
  });
});
