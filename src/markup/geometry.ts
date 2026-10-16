/** Plain double-precision geometry shared by the engine, the overlay and the appearance writer. */
export type Pt = [number, number];
export type Rect = [number, number, number, number];
export type Matrix = [number, number, number, number, number, number];
export type Quad = [number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a then b (row-vector convention, as in PDF and MuPDF). */
export function concat(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -m[4] * a - m[5] * c, -m[4] * b - m[5] * d];
}

export const scaleM = (sx: number, sy = sx): Matrix => [sx, 0, 0, sy, 0, 0];
export const translateM = (tx: number, ty: number): Matrix => [1, 0, 0, 1, tx, ty];
export function rotateM(deg: number): Matrix {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return [1, 0, 0, 1, 0, 0];
  if (r === 90) return [0, 1, -1, 0, 0, 0];
  if (r === 180) return [-1, 0, 0, -1, 0, 0];
  if (r === 270) return [0, -1, 1, 0, 0, 0];
  const s = Math.sin((r * Math.PI) / 180);
  const c = Math.cos((r * Math.PI) / 180);
  return [c, s, -s, c, 0, 0];
}

export function apply(m: Matrix, p: Pt): Pt {
  return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]];
}

export function transformRect(r: Rect, m: Matrix): Rect {
  const pts = [apply(m, [r[0], r[1]]), apply(m, [r[2], r[1]]), apply(m, [r[0], r[3]]), apply(m, [r[2], r[3]])];
  return bboxOf(pts);
}

export function bboxOf(pts: readonly Pt[]): Rect {
  if (pts.length === 0) return [0, 0, 0, 0];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function normRect(r: Rect): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

export function unionRect(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function inflate(r: Rect, d: number): Rect {
  return [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function quadPoints(q: Quad): Pt[] {
  return [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[4], q[5]],
    [q[6], q[7]],
  ];
}

/** Distance from p to segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed area (positive when counter-clockwise in a y-up frame, clockwise in y-down). */
export function signedArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return -a / 2;
}

/**
 * Constrain `p` relative to `anchor` to horizontal, vertical or 45° (Shift while drawing).
 * Keeps the projected length so the point follows the pointer.
 */
export function snapAngle(anchor: Pt, p: Pt, stepDeg = 45): Pt {
  const dx = p[0] - anchor[0];
  const dy = p[1] - anchor[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const proj = dx * Math.cos(ang) + dy * Math.sin(ang);
  return [anchor[0] + proj * Math.cos(ang), anchor[1] + proj * Math.sin(ang)];
}

/** Constrain a drag rectangle to a square (Shift while drawing boxes). */
export function snapSquare(anchor: Pt, p: Pt): Pt {
  const dx = p[0] - anchor[0];
  const dy = p[1] - anchor[1];
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [anchor[0] + Math.sign(dx || 1) * s, anchor[1] + Math.sign(dy || 1) * s];
}

export function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Display transform: page space → device, scaled then rotated clockwise, translated to start at the origin. */
export function displayMatrix(bounds: Rect, scale: number, rotate: number): Matrix {
  const m0 = concat(scaleM(scale), rotateM(rotate));
  const r = transformRect(bounds, m0);
  return concat(m0, translateM(-r[0], -r[1]));
}
