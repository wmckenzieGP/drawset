import { displayMatrix, invert, transformRect, type Matrix, type Rect } from "../../markup/geometry";
import { isContinuous, isPaired, type PageEntry, type PageMode, type Rotation } from "../../state/store";

export const PAGE_GAP = 16;
export const PAD = 24;

export interface PageLayout {
  /** The page's index in the document (not its position in `Layout.pages`). */
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
  /** The pages shown, top to bottom (left to right within a row): every page, or one page or pair at a time. */
  pages: PageLayout[];
  width: number;
  height: number;
  mode: PageMode;
}

/** The shown page with document index `i`. */
export function pageByIndex(layout: Layout, i: number): PageLayout | undefined {
  const guess = layout.pages[i];
  if (guess && guess.index === i) return guess;
  return layout.pages.find((p) => p.index === i);
}

/** The first page of the page or pair a single-page layout shows when `current` is the current page. */
export function shownFrom(mode: PageMode, current: number): number {
  return isPaired(mode) ? current - (current % 2) : current;
}

/** Pages to move by for the next or previous page in this layout. */
export const pageStep = (mode: PageMode) => (isPaired(mode) ? 2 : 1);

export function pageRotation(entry: PageEntry, viewRot: Rotation): number {
  return (entry.rotation + viewRot) % 360;
}

export function computeLayout(pages: PageEntry[], scale: number, viewRot: Rotation, viewportW: number, mode: PageMode = "continuous", current = 0): Layout {
  const from = isContinuous(mode) ? 0 : Math.max(0, Math.min(shownFrom(mode, current), pages.length - 1));
  const to = isContinuous(mode) ? pages.length : Math.min(pages.length, from + (isPaired(mode) ? 2 : 1));
  const sized = pages.slice(from, to).map((entry, k) => {
    const rot = pageRotation(entry, viewRot);
    const m = displayMatrix(entry.info.bounds, scale, rot);
    const r = transformRect(entry.info.bounds, m);
    return { index: from + k, entry, rot, m, w: r[2] - r[0], h: r[3] - r[1] };
  });
  // rows of one page, or of two side by side (pages 1 and 2, 3 and 4, ...)
  const perRow = isPaired(mode) ? 2 : 1;
  const rows: (typeof sized)[] = [];
  for (let i = 0; i < sized.length; i += perRow) rows.push(sized.slice(i, i + perRow));
  const rowW = (r: typeof sized) => r.reduce((a, p) => a + p.w, 0) + PAGE_GAP * (r.length - 1);
  const maxW = rows.reduce((a, r) => Math.max(a, rowW(r)), 0);
  const width = Math.max(viewportW, maxW + 2 * PAD);
  let y = PAD;
  const out: PageLayout[] = [];
  for (const r of rows) {
    const h = Math.max(...r.map((p) => p.h));
    // pages in a row share their top edge; a pair is centred as a whole; a lone last page of a pair layout sits in the left column
    const full = perRow === 2 && r.length === 1 && rows.length > 1 ? rowW([r[0], r[0]]) : rowW(r);
    let x = (width - full) / 2;
    for (const p of r) {
      out.push({ index: p.index, entry: p.entry, x, y, w: p.w, h: p.h, rot: p.rot, m: p.m, inv: invert(p.m) });
      x += p.w + PAGE_GAP;
    }
    y += h + PAGE_GAP;
  }
  return { pages: out, width, height: Math.max(y - PAGE_GAP + PAD, 0), mode };
}

/** First and last position in `layout.pages` intersecting [top, bottom] (binary search). */
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
