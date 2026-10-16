/**
 * Snapping: markup vertices, the grid, and the page's own drawing (line end points and intersections).
 * Everything is in page space; the tolerance comes from the zoom so it is a fixed number of screen pixels.
 */
import RBush from "rbush";
import { engine } from "../../engine/client";
import type { SnapGeometry } from "../../engine/types";
import { rectPoints, type Pt, type Rect } from "../../markup/geometry";
import { BOX_KINDS, type Markup } from "../../markup/model";

export type SnapKind = "vertex" | "endpoint" | "intersection" | "grid";

export interface SnapResult {
  pt: Pt;
  kind: SnapKind;
}

interface Seg {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  i: number;
}

/** A page's drawing, indexed for snapping. */
export class ContentSnapIndex {
  private segTree = new RBush<Seg>();
  private ptTree = new RBush<Seg>();
  constructor(readonly g: SnapGeometry) {
    const s = g.segments;
    const segs: Seg[] = [];
    for (let k = 0, i = 0; k < s.length; k += 4, i++) segs.push({ minX: Math.min(s[k], s[k + 2]), minY: Math.min(s[k + 1], s[k + 3]), maxX: Math.max(s[k], s[k + 2]), maxY: Math.max(s[k + 1], s[k + 3]), i });
    this.segTree.load(segs);
    const p = g.points;
    const pts: Seg[] = [];
    for (let k = 0, i = 0; k < p.length; k += 2, i++) pts.push({ minX: p[k], minY: p[k + 1], maxX: p[k], maxY: p[k + 1], i });
    this.ptTree.load(pts);
  }

  segment(i: number): [Pt, Pt] {
    const s = this.g.segments;
    return [
      [s[i * 4], s[i * 4 + 1]],
      [s[i * 4 + 2], s[i * 4 + 3]],
    ];
  }

  segmentsNear(p: Pt, r: number, limit = 400): number[] {
    return this.segTree
      .search({ minX: p[0] - r, minY: p[1] - r, maxX: p[0] + r, maxY: p[1] + r })
      .slice(0, limit)
      .map((x) => x.i);
  }

  pointsNear(p: Pt, r: number): Pt[] {
    const pts = this.g.points;
    return this.ptTree.search({ minX: p[0] - r, minY: p[1] - r, maxX: p[0] + r, maxY: p[1] + r }).map((x) => [pts[x.i * 2], pts[x.i * 2 + 1]] as Pt);
  }
}

/** Snap targets a markup offers: its vertices (frame corners for boxes). */
export function markupVertices(m: Markup): Pt[] {
  if (m.kind === "foreign" || m.hidden) return [];
  if (BOX_KINDS.has(m.kind)) return rectPoints(m.rect);
  const out = [...m.points];
  if (m.kind === "callout") out.push(...rectPoints(m.rect));
  for (const c of m.measure?.cutouts ?? []) out.push(...c);
  return out;
}

/** Intersection of segments ab and cd, or null when they do not cross (or are parallel). */
export function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]];
  const s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12 * Math.hypot(...r) * Math.hypot(...s) || den === 0) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export interface SnapOptions {
  /** Markups on the page to snap to (the one being edited left out). */
  markups: Markup[] | null;
  content: ContentSnapIndex | null;
  /** Grid spacing in points, null for no grid; the grid starts at `origin`. */
  grid: number | null;
  origin: Pt;
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/**
 * The point `p` snaps to within `tol`: the nearest markup vertex or drawing end point, else the nearest
 * intersection of drawing lines, else the nearest grid point. Null when nothing is in reach.
 */
export function snapPoint(p: Pt, tol: number, o: SnapOptions): SnapResult | null {
  let best: SnapResult | null = null;
  let bestD = tol * tol;
  const consider = (pt: Pt, kind: SnapKind) => {
    const dd = d2(pt, p);
    if (dd <= bestD) {
      bestD = dd;
      best = { pt: [pt[0], pt[1]], kind };
    }
  };
  if (o.markups) {
    const box: Rect = [p[0] - tol, p[1] - tol, p[0] + tol, p[1] + tol];
    for (const m of o.markups) {
      const r = m.rect;
      if (BOX_KINDS.has(m.kind) && (r[0] > box[2] || r[2] < box[0] || r[1] > box[3] || r[3] < box[1])) continue;
      for (const v of markupVertices(m)) consider(v, "vertex");
    }
  }
  if (o.content) {
    const segs = o.content.segmentsNear(p, tol);
    for (const i of segs) {
      const [a, b] = o.content.segment(i);
      consider(a, "endpoint");
      consider(b, "endpoint");
    }
    for (const q of o.content.pointsNear(p, tol)) consider(q, "endpoint");
    if (!best && segs.length > 1) {
      const lines = segs.slice(0, 120).map((i) => o.content!.segment(i));
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const x = segmentIntersection(lines[i][0], lines[i][1], lines[j][0], lines[j][1]);
          if (x) consider(x, "intersection");
        }
      }
    }
  }
  if (!best && o.grid && o.grid > 0) {
    const g = o.grid;
    const q: Pt = [o.origin[0] + Math.round((p[0] - o.origin[0]) / g) * g, o.origin[1] + Math.round((p[1] - o.origin[1]) / g) * g];
    return { pt: q, kind: "grid" };
  }
  return best;
}

// ---------- page drawing cache ----------

const indexes = new Map<string, ContentSnapIndex | "loading" | "failed">();

/** The page's drawing index, or null while it is still being collected (the caller redraws on `onReady`). */
export function contentIndex(docId: string, page: number, onReady: () => void): ContentSnapIndex | null {
  const key = `${docId}:${page}`;
  const v = indexes.get(key);
  if (v instanceof ContentSnapIndex) return v;
  if (v) return null;
  indexes.set(key, "loading");
  engine()
    .snapGeometry(docId, page)
    .then((g) => {
      indexes.set(key, new ContentSnapIndex(g));
      onReady();
    })
    .catch(() => indexes.set(key, "failed"));
  return null;
}

/** Forget a document's drawing indexes (after a save the page content may differ). */
export function forgetContentIndexes(docId: string) {
  for (const k of [...indexes.keys()]) if (k.startsWith(`${docId}:`)) indexes.delete(k);
}
