/** Pure editing operations on markups: move, scale, vertex edits and hit-testing. */
import { arcPoints, buildAppearance, calloutLeader, markupBounds, textWidth } from "./appearance";
import { dimensionLine } from "./measure";
import { bboxOf, dist, distToSegment, inflate, pointInPolygon, type Pt, type Quad, type Rect } from "./geometry";
import { BOX_KINDS, nowIso, type Markup } from "./model";

/** Recomputes rect for kinds whose geometry lives in points/inks/quads. */
export function withDerivedRect(m: Markup): Markup {
  if (BOX_KINDS.has(m.kind) || m.kind === "callout" || m.keepAppearance) return m;
  let pts: Pt[] = [];
  if (m.points.length) pts = m.points;
  else if (m.inks.length) pts = m.inks.flat();
  else if (m.quads.length) pts = m.quads.flatMap((q) => [[q[0], q[1]], [q[6], q[7]]] as Pt[]);
  return pts.length ? { ...m, rect: bboxOf(pts) } : m;
}

export function translate(m: Markup, dx: number, dy: number): Markup {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  return {
    ...m,
    rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy],
    points: m.points.map(mv),
    inks: m.inks.map((s) => s.map(mv)),
    quads: m.quads.map((q) => q.map((v, i) => v + (i % 2 === 0 ? dx : dy)) as Quad),
    measure: m.measure ? { ...m.measure, cutouts: m.measure.cutouts.map((c) => c.map(mv)) } : undefined,
    modified: nowIso(),
  };
}

/** A callout's text box moved on its own: the box and the leader's bend go with it, the arrow tip stays where it points. */
export function moveCalloutBox(m: Markup, dx: number, dy: number): Markup {
  const moved = translate(m, dx, dy);
  return m.points.length ? { ...moved, points: [m.points[0], ...moved.points.slice(1)] } : moved;
}

/** Maps every coordinate from box `from` to box `to` (resize). */
export function scaleBetween(m: Markup, from: Rect, to: Rect): Markup {
  const sx = (to[2] - to[0]) / (from[2] - from[0] || 1);
  const sy = (to[3] - to[1]) / (from[3] - from[1] || 1);
  const map = (p: Pt): Pt => [to[0] + (p[0] - from[0]) * sx, to[1] + (p[1] - from[1]) * sy];
  const r1 = map([m.rect[0], m.rect[1]]);
  const r2 = map([m.rect[2], m.rect[3]]);
  return {
    ...m,
    rect: [Math.min(r1[0], r2[0]), Math.min(r1[1], r2[1]), Math.max(r1[0], r2[0]), Math.max(r1[1], r2[1])],
    points: m.points.map(map),
    inks: m.inks.map((s) => s.map(map)),
    quads: m.quads.map((q) => {
      const a = map([q[0], q[1]]);
      const b = map([q[2], q[3]]);
      const c = map([q[4], q[5]]);
      const d = map([q[6], q[7]]);
      return [...a, ...b, ...c, ...d] as Quad;
    }),
    measure: m.measure ? { ...m.measure, cutouts: m.measure.cutouts.map((c) => c.map(map)) } : undefined,
    modified: nowIso(),
  };
}

export function setVertex(m: Markup, index: number, p: Pt): Markup {
  const points = m.points.slice();
  points[index] = p;
  return withDerivedRect({ ...m, points, modified: nowIso() });
}

/** Whether the markup supports vertex handles. */
export function vertexHandles(m: Markup): Pt[] {
  if (m.keepAppearance) return [];
  switch (m.kind) {
    case "line":
    case "arrow":
    case "polyline":
    case "polygon":
    case "cloud":
    case "callout":
    case "length":
    case "polylength":
    case "area":
    case "perimeter":
    case "count":
    case "angle":
    case "arc":
    case "dimension":
    case "volume":
    case "radius":
    case "diameter":
      return m.points;
    default:
      return [];
  }
}

export function canResize(m: Markup): boolean {
  return !["line", "arrow", "polyline", "polygon", "cloud", "highlight", "underline", "strikeout", "note", "length", "polylength", "area", "perimeter", "count", "angle", "arc", "dimension", "volume", "radius", "diameter"].includes(m.kind);
}

/** Hit test in page space with tolerance `tol` (points). */
export function hitTest(m: Markup, p: Pt, tol: number): boolean {
  if (m.hidden) return false;
  const b = inflate(markupBounds(m), tol);
  if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return false;
  const w = m.style.width / 2 + tol;
  switch (m.kind) {
    case "count":
      return m.points.some((q) => dist(q, p) <= Math.max(4, m.style.fontSize * 0.45) + tol) || pointInRect(p, captionBounds(m));
    case "area":
    case "volume":
    case "perimeter":
      if ((m.kind !== "perimeter" && m.style.fill) || pointInPolygon(p, m.points)) return true;
      for (let i = 0; i < m.points.length; i++) if (distToSegment(p, m.points[i], m.points[(i + 1) % m.points.length]) <= w) return true;
      return false;
    case "length":
    case "polylength":
    case "angle":
      if (pointInRect(p, captionBounds(m))) return true;
      for (let i = 1; i < m.points.length; i++) if (distToSegment(p, m.points[i - 1], m.points[i]) <= w) return true;
      return false;
    case "dimension": {
      if (pointInRect(p, captionBounds(m)) || m.points.length < 2) return true;
      const { a, b, a2, b2 } = dimensionLine(m.points);
      return [[a, a2], [b, b2], [a2, b2]].some(([x, y]) => distToSegment(p, x, y) <= w);
    }
    case "radius":
    case "diameter": {
      if (pointInRect(p, captionBounds(m)) || m.points.length < 2) return true;
      const [c, e] = m.points;
      if (m.style.fill && dist(p, c) <= dist(c, e)) return true;
      return Math.abs(dist(p, c) - dist(c, e)) <= w || distToSegment(p, m.kind === "diameter" ? [2 * c[0] - e[0], 2 * c[1] - e[1]] : c, e) <= w;
    }
    case "arc": {
      const pts = arcPoints(m);
      for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= w) return true;
      return false;
    }
    case "line":
    case "arrow":
    case "polyline":
      for (let i = 1; i < m.points.length; i++) if (distToSegment(p, m.points[i - 1], m.points[i]) <= w) return true;
      return false;
    case "polygon":
    case "cloud":
      if (m.style.fill && pointInPolygon(p, m.points)) return true;
      for (let i = 0; i < m.points.length; i++) if (distToSegment(p, m.points[i], m.points[(i + 1) % m.points.length]) <= w + (m.kind === "cloud" ? 8 : 0)) return true;
      return false;
    case "pen":
    case "highlighter":
      for (const s of m.inks) for (let i = 1; i < s.length; i++) if (distToSegment(p, s[i - 1], s[i]) <= w) return true;
      return m.inks.some((s) => s.length === 1 && dist(s[0], p) <= w);
    case "rectangle":
    case "ellipse": {
      if (m.style.fill) return true;
      const r = m.rect;
      const inner = inflate(r, -w);
      const insideInner = p[0] > inner[0] && p[0] < inner[2] && p[1] > inner[1] && p[1] < inner[3];
      if (m.kind === "rectangle") return !insideInner;
      const cx = (r[0] + r[2]) / 2;
      const cy = (r[1] + r[3]) / 2;
      const rx = (r[2] - r[0]) / 2;
      const ry = (r[3] - r[1]) / 2;
      const d = Math.hypot((p[0] - cx) / (rx || 1), (p[1] - cy) / (ry || 1));
      return Math.abs(d - 1) * Math.min(rx, ry) <= w;
    }
    case "link":
      return true;
    case "callout": {
      const r = m.rect;
      if (p[0] >= r[0] - tol && p[0] <= r[2] + tol && p[1] >= r[1] - tol && p[1] <= r[3] + tol) return true;
      const leader = calloutLeader(m);
      for (let i = 1; i < leader.length; i++) if (distToSegment(p, leader[i - 1], leader[i]) <= w) return true;
      return false;
    }
    case "highlight":
    case "underline":
    case "strikeout":
      return m.quads.some((q) =>
        pointInPolygon(p, [
          [q[0], q[1]],
          [q[2], q[3]],
          [q[6], q[7]],
          [q[4], q[5]],
        ]),
      );
    default:
      return true;
  }
}

export function pointInRect(p: Pt, r: Rect | null): boolean {
  return !!r && p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
}

/** Bounds of a measurement's caption text. */
function captionBounds(m: Markup): Rect | null {
  const ap = buildAppearance(m);
  for (const op of ap.ops) {
    if (op.t !== "text") continue;
    const l = op.lines[0];
    if (!l) continue;
    return [l.x, l.y - op.size, l.x + textWidth(op.font, op.size, l.s), l.y + op.size * 0.3];
  }
  return null;
}

/** Copies of grouped markups form their own group: `copies[i]` is the copy of `originals[i]`. */
export function relinkGroups(originals: Markup[], copies: Markup[]): Markup[] {
  const idOf = new Map(originals.map((m, i) => [m.id, copies[i].id]));
  return copies.map((c, i) => {
    const g = originals[i].group;
    return { ...c, group: g ? idOf.get(g) : undefined };
  });
}

/** Clone a markup with a fresh id, offset, author and dates (paste/duplicate). */
export function cloneMarkup(m: Markup, id: string, pageId: string, dx: number, dy: number, author: string): Markup {
  const t = translate(m, dx, dy);
  const now = nowIso();
  const apFrom = m.keepAppearance ? (m.apFrom ?? m.objNum) : undefined;
  return { ...t, id, pageId, objNum: undefined, apFrom, author, created: now, modified: now, status: "None", replies: [], locked: false };
}
