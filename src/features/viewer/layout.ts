import { displayMatrix, invert, transformRect, type Matrix, type Rect } from "../../markup/geometry";
import type { PageEntry, Rotation } from "../../state/store";

export const PAGE_GAP = 16;
export const PAD = 24;

export interface PageLayout {
  index: number;
  entry: PageEntry;
  /** Position of the page box in content coordinates (CSS px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Total rotation shown (view + page). */
  rot: number;
  /** page space → page-local CSS px */
  m: Matrix;
  inv: Matrix;
}

export interface Layout {
  pages: PageLayout[];
  width: number;
  height: number;
}

export function pageRotation(entry: PageEntry, viewRot: Rotation): number {
  return (entry.rotation + viewRot) % 360;
}

export function computeLayout(pages: PageEntry[], scale: number, viewRot: Rotation, viewportW: number): Layout {
  const sized = pages.map((entry) => {
    const rot = pageRotation(entry, viewRot);
    const m = displayMatrix(entry.info.bounds, scale, rot);
    const r = transformRect(entry.info.bounds, m);
    return { entry, rot, m, w: r[2] - r[0], h: r[3] - r[1] };
  });
  const maxW = sized.reduce((a, p) => Math.max(a, p.w), 0);
  const width = Math.max(viewportW, maxW + 2 * PAD);
  let y = PAD;
  const out: PageLayout[] = sized.map((p, index) => {
    const l: PageLayout = { index, entry: p.entry, x: (width - p.w) / 2, y, w: p.w, h: p.h, rot: p.rot, m: p.m, inv: invert(p.m) };
    y += p.h + PAGE_GAP;
    return l;
  });
  return { pages: out, width, height: y - PAGE_GAP + PAD };
}

/** First and last page index intersecting [top, bottom] (binary search). */
export function visibleRange(layout: Layout, top: number, bottom: number): [number, number] {
  const ps = layout.pages;
  if (ps.length === 0) return [0, -1];
  let lo = 0;
  let hi = ps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ps[mid].y + ps[mid].h < top) lo = mid + 1;
    else hi = mid;
  }
  let last = lo;
  while (last + 1 < ps.length && ps[last + 1].y <= bottom) last++;
  return [lo, last];
}

/** The page under a content-space point, or the nearest one vertically. */
export function pageAt(layout: Layout, x: number, y: number, strict = true): PageLayout | null {
  const [a, b] = visibleRange(layout, y - 1, y + 1);
  for (let i = Math.max(0, a - 1); i <= Math.min(layout.pages.length - 1, b + 1); i++) {
    const p = layout.pages[i];
    if (y >= p.y && y <= p.y + p.h && (!strict || (x >= p.x && x <= p.x + p.w))) return p;
  }
  return null;
}

export function pageRectInContent(p: PageLayout, r: Rect): Rect {
  const d = transformRect(r, p.m);
  return [d[0] + p.x, d[1] + p.y, d[2] + p.x, d[3] + p.y];
}
