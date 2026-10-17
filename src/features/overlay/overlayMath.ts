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

export interface DiffOptions {
  /** Ink difference (0–1) a pixel needs to count as changed. */
  threshold?: number;
  /** Cell size in pixels: changes are found per cell, which ignores single-pixel anti-aliasing noise. */
  cell?: number;
  /** Changed pixels a cell needs. */
  minPixels?: number;
  /** Cells within this many cells of each other join one region. */
  join?: number;
  /** Regions smaller than this many cells are dropped. */
  minCells?: number;
}

/**
 * Areas where two same-size RGBA images differ, as pixel rectangles [x0, y0, x1, y1]. Nearby changes are
 * joined into one region so a revised detail gets one cloud rather than dozens.
 */
export function diffRegions(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, o: DiffOptions = {}): [number, number, number, number][] {
  const thr = (o.threshold ?? 0.35) * 255;
  const cell = o.cell ?? 8;
  const minPixels = o.minPixels ?? 3;
  const join = o.join ?? 3;
  const minCells = o.minCells ?? 1;
  const cw = Math.ceil(w / cell);
  const ch = Math.ceil(h / cell);
  const counts = new Uint16Array(cw * ch);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    const cy = ((y / cell) | 0) * cw;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      if (Math.abs(la - lb) > thr) counts[cy + ((x / cell) | 0)]++;
    }
  }
  const hot = new Uint8Array(cw * ch);
  for (let k = 0; k < hot.length; k++) hot[k] = counts[k] >= minPixels ? 1 : 0;
  // flood fill over hot cells, treating cells within `join` as neighbours
  const label = new Int32Array(cw * ch).fill(-1);
  const out: [number, number, number, number][] = [];
  const stack: number[] = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || label[start] >= 0) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let n = 0;
    label[start] = out.length;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      const cx = k % cw;
      const cy = (k / cw) | 0;
      n++;
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (let dy = -join; dy <= join; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= ch) continue;
        for (let dx = -join; dx <= join; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cw) continue;
          const nk = ny * cw + nx;
          if (hot[nk] && label[nk] < 0) {
            label[nk] = out.length;
            stack.push(nk);
          }
        }
      }
    }
    if (n >= minCells) out.push([x0 * cell, y0 * cell, Math.min(w, (x1 + 1) * cell), Math.min(h, (y1 + 1) * cell)]);
  }
  return mergeOverlapping(out);
}

/** Joins rectangles that overlap after growing (regions joined across a diagonal can still overlap). */
function mergeOverlapping(rs: [number, number, number, number][]): [number, number, number, number][] {
  const list = rs.slice();
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
          list[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          list.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return list;
}
