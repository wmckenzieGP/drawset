/** Pure helpers for overlaying two pages: alignment from point pairs and red/blue compositing. */
import type { Matrix, Pt } from "../../markup/geometry";
import type { RGB } from "../../markup/model";

/**
 * Similarity transform (uniform scale, rotation, translation) taking b1→a1 and b2→a2.
 * Drawings at different scales or slightly rotated scans line up from two matching points.
 */
export function alignFromPoints(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Matrix {
  const vb: Pt = [b2[0] - b1[0], b2[1] - b1[1]];
  const va: Pt = [a2[0] - a1[0], a2[1] - a1[1]];
  const lb = Math.hypot(vb[0], vb[1]);
  const la = Math.hypot(va[0], va[1]);
  if (lb < 1e-9 || la < 1e-9) return [1, 0, 0, 1, a1[0] - b1[0], a1[1] - b1[1]];
  const s = la / lb;
  const ang = Math.atan2(va[1], va[0]) - Math.atan2(vb[1], vb[0]);
  const c = s * Math.cos(ang);
  const d = s * Math.sin(ang);
  // [x', y'] = [c -d; d c] [x, y] + t, written as the canvas/PDF matrix [a b c d e f] = [c d -d c e f]
  const e = a1[0] - (c * b1[0] - d * b1[1]);
  const f = a1[1] - (d * b1[0] + c * b1[1]);
  return [c, d, -d, c, e, f];
}

/**
 * Combines two RGBA images of the same size. Each page's ink (how dark a pixel is) is split into the part both
 * pages share, drawn neutral, and the part only one page has, drawn in that page's colour. Identical pages
 * therefore show no colour at all, anti-aliased edges included. A hidden page contributes nothing.
 */
export function compositeOverlay(a: Uint8ClampedArray, b: Uint8ClampedArray, out: Uint8ClampedArray, colourA: RGB, colourB: RGB, showA: boolean, showB: boolean) {
  const ca = colourA.map((v) => 1 - v);
  const cb = colourB.map((v) => 1 - v);
  for (let i = 0; i < out.length; i += 4) {
    const ia = showA ? 1 - (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) / 255 : 0;
    const ib = showB ? 1 - (0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]) / 255 : 0;
    const shared = Math.min(ia, ib);
    const ra = ia - shared;
    const rb = ib - shared;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(255 * (1 - shared) * (1 - ra * ca[k]) * (1 - rb * cb[k]));
    out[i + 3] = 255;
  }
}

/** How much colour (|R−B| style difference) a composite holds: 0 means no differences are shown. */
export function colourfulness(img: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i];
    const g = img[i + 1];
    const b = img[i + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
    n++;
  }
  return n ? sum / n / 255 : 0;
}
