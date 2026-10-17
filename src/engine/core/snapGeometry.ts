/** Collects a page's vector geometry for snapping: straight segments and curve end points, in page space. */
import * as mupdf from "mupdf";
import type { SnapGeometry } from "../types";

/** Enough for very dense sheets; beyond this the rest of the page is not snappable (and says so). */
export const MAX_SEGMENTS = 400_000;

export function collectSnapGeometry(list: mupdf.DisplayList): SnapGeometry {
  const segs: number[] = [];
  const pts: number[] = [];
  let truncated = false;
  const walkPath = (path: mupdf.Path, ctm: mupdf.Matrix) => {
    if (truncated) return;
    const [a, b, c, d, e, f] = ctm;
    const tx = (x: number, y: number) => x * a + y * c + e;
    const ty = (x: number, y: number) => x * b + y * d + f;
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    const seg = (x0: number, y0: number, x1: number, y1: number) => {
      if (x0 === x1 && y0 === y1) return;
      if (segs.length / 4 >= MAX_SEGMENTS) {
        truncated = true;
        return;
      }
      segs.push(tx(x0, y0), ty(x0, y0), tx(x1, y1), ty(x1, y1));
    };
    path.walk({
      moveTo(x, y) {
        cx = sx = x;
        cy = sy = y;
        pts.push(tx(x, y), ty(x, y));
      },
      lineTo(x, y) {
        seg(cx, cy, x, y);
        cx = x;
        cy = y;
      },
      curveTo(_x1, _y1, _x2, _y2, x3, y3) {
        pts.push(tx(x3, y3), ty(x3, y3));
        cx = x3;
        cy = y3;
      },
      closePath() {
        seg(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
      },
    });
  };
  const dev = new mupdf.Device({
    fillPath: (path, _eo, ctm) => walkPath(path, ctm),
    strokePath: (path, _stroke, ctm) => walkPath(path, ctm),
  });
  list.run(dev, mupdf.Matrix.identity);
  dev.close();
  dev.destroy();
  return { segments: new Float64Array(segs), points: new Float64Array(pts), truncated };
}
