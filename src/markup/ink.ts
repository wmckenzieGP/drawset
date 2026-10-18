/** Freehand strokes: thinning out what the pointer gave, drawing it smoothly, and rubbing parts of it out. Pure. */
import { bboxOf, dist, distToSegment, inflate, type Pt, type Rect } from "./geometry";
import { nowIso, type Markup } from "./model";

/** Drops points that lie within `tol` of the line through their neighbours (Ramer–Douglas–Peucker). */
export function simplifyStroke(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > far) [far, worst] = [d, i];
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A smooth curve through every point (Catmull–Rom, as cubic Béziers): pairs of [control 1, control 2, end]
 * after the first point. Strokes of one or two points stay straight.
 */
export function smoothCurve(pts: readonly Pt[]): { start: Pt; curves: [Pt, Pt, Pt][] } | null {
  if (pts.length < 3) return null;
  const curves: [Pt, Pt, Pt][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const [p1, p2] = [pts[i], pts[i + 1]];
    const p3 = pts[i + 2] ?? p2;
    curves.push([
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      [p2[0], p2[1]],
    ]);
  }
  return { start: pts[0], curves };
}

/** Adds points along long segments so no two neighbours are more than `step` apart. */
function densify(pts: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const [a, b] = [pts[i - 1], pts[i]];
      const n = Math.floor(dist(a, b) / step);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out.push(pts[i]);
  }
  return out;
}

const overlaps = (a: Rect, b: Rect) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Rubs out the parts of pen and highlighter strokes within `radius` of the eraser's path from `a` to `b`
 * (a stroke cut through the middle becomes two). Returns the changed markups and the ids of those with nothing
 * left. Locked markups and other editors' drawings are left alone.
 */
export function eraseStrokes(ms: readonly Markup[], a: Pt, b: Pt, radius: number): { changed: Markup[]; removed: string[] } {
  const changed: Markup[] = [];
  const removed: string[] = [];
  const path = bboxOf([a, b]);
  for (const m of ms) {
    if ((m.kind !== "pen" && m.kind !== "highlighter") || m.locked || m.keepAppearance) continue;
    const reach = radius + m.style.width / 2;
    if (!overlaps(inflate(path, reach), m.rect)) continue;
    const hit = (p: Pt) => distToSegment(p, a, b) <= reach;
    let touched = false;
    const inks: Pt[][] = [];
    for (const stroke of m.inks) {
      if (!overlaps(inflate(path, reach), bboxOf(stroke))) {
        inks.push(stroke);
        continue;
      }
      const dense = densify(stroke, Math.max(0.25, reach / 3));
      if (!dense.some(hit)) {
        inks.push(stroke);
        continue;
      }
      touched = true;
      let run: Pt[] = [];
      for (const p of dense) {
        if (hit(p)) {
          if (run.length >= 2) inks.push(simplifyStroke(run, 0.05));
          run = [];
        } else run.push(p);
      }
      if (run.length >= 2) inks.push(simplifyStroke(run, 0.05));
    }
    if (!touched) continue;
    if (!inks.length) removed.push(m.id);
    else changed.push({ ...m, inks, rect: bboxOf(inks.flat()), modified: nowIso() });
  }
  return { changed, removed };
}
