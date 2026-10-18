/**
 * Page scales and measurement values. Pure functions shared by the viewer, the Markups List and the PDF writer.
 * Geometry is in page space (points). A scale says how much real distance one point on the page represents.
 */
import polygonClipping from "polygon-clipping";
import { dist, type Pt } from "./geometry";
import type { Markup, MarkupKind } from "./model";

export type Unit = "mm" | "cm" | "m" | "in" | "ft";
export const UNITS: Unit[] = ["mm", "cm", "m", "in", "ft"];
export const UNIT_LABELS: Record<Unit, string> = { mm: "Millimetres", cm: "Centimetres", m: "Metres", in: "Inches", ft: "Feet" };

/** Metres per unit. */
const METRES: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
/** Metres per PDF point (1/72 inch). */
export const METRES_PER_POINT = 0.0254 / 72;

export function convert(value: number, from: Unit, to: Unit): number {
  return (value * METRES[from]) / METRES[to];
}

export interface PageScale {
  /** "paper" side of the ratio, e.g. 1 mm. */
  paper: number;
  paperUnit: Unit;
  /** "real" side of the ratio, e.g. 100 mm. */
  real: number;
  realUnit: Unit;
  /** Units measurements are shown in. */
  displayUnit: Unit;
  /** Decimal places shown (0–4). Rounding is for display only. */
  precision: number;
}

/** What an uncalibrated page measures in: full size, millimetres. */
export const DEFAULT_SCALE: PageScale = { paper: 1, paperUnit: "mm", real: 1, realUnit: "mm", displayUnit: "mm", precision: 0 };

export interface ScalePreset {
  label: string;
  scale: Omit<PageScale, "displayUnit" | "precision">;
}

const metric = (n: number): ScalePreset => ({ label: `1:${n}`, scale: { paper: 1, paperUnit: "mm", real: n, realUnit: "mm" } });
const imperial = (label: string, paperIn: number, realFt: number): ScalePreset => ({ label, scale: { paper: paperIn, paperUnit: "in", real: realFt, realUnit: "ft" } });

export const METRIC_PRESETS: ScalePreset[] = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000].map(metric);
export const IMPERIAL_PRESETS: ScalePreset[] = [
  imperial('1/16" = 1\'-0"', 1 / 16, 1),
  imperial('3/32" = 1\'-0"', 3 / 32, 1),
  imperial('1/8" = 1\'-0"', 1 / 8, 1),
  imperial('3/16" = 1\'-0"', 3 / 16, 1),
  imperial('1/4" = 1\'-0"', 1 / 4, 1),
  imperial('3/8" = 1\'-0"', 3 / 8, 1),
  imperial('1/2" = 1\'-0"', 1 / 2, 1),
  imperial('3/4" = 1\'-0"', 3 / 4, 1),
  imperial('1" = 1\'-0"', 1, 1),
  imperial('1-1/2" = 1\'-0"', 1.5, 1),
  imperial('3" = 1\'-0"', 3, 1),
  imperial('1" = 10\'', 1, 10),
  imperial('1" = 20\'', 1, 20),
  imperial('1" = 30\'', 1, 30),
  imperial('1" = 40\'', 1, 40),
  imperial('1" = 50\'', 1, 50),
  imperial('1" = 100\'', 1, 100),
];

/** Display units per point on the page. */
export function unitsPerPoint(s: PageScale): number {
  const paperMetresPerPoint = METRES_PER_POINT;
  const realMetresPerPaperMetre = (s.real * METRES[s.realUnit]) / (s.paper * METRES[s.paperUnit]);
  return (paperMetresPerPoint * realMetresPerPaperMetre) / METRES[s.displayUnit];
}

/** Scale from two picked points `pts` apart on the page that are `known` `unit` apart in reality. */
export function scaleFromPoints(points: number, known: number, unit: Unit, precision: number): PageScale {
  // 1 mm on paper represents this many `unit`
  const paperMm = points * METRES_PER_POINT * 1000;
  return { paper: 1, paperUnit: "mm", real: known / paperMm, realUnit: unit, displayUnit: unit, precision };
}

const trim = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** Ratio text as written to /R, e.g. "1 mm = 100 mm". */
export function scaleRatioText(s: PageScale): string {
  return `${trim(s.paper)} ${s.paperUnit} = ${trim(s.real)} ${s.realUnit}`;
}

/** Short label: "1:100" for like-unit metric ratios, else the ratio text. */
export function scaleLabel(s: PageScale): string {
  if (s.paperUnit === s.realUnit) {
    const n = s.real / s.paper;
    if (Math.abs(n - Math.round(n)) < 1e-6) return `1:${Math.round(n)}`;
    return `1:${trim(n)}`;
  }
  const preset = IMPERIAL_PRESETS.find((p) => Math.abs(p.scale.paper - s.paper) < 1e-9 && Math.abs(p.scale.real - s.real) < 1e-9 && p.scale.paperUnit === s.paperUnit && p.scale.realUnit === s.realUnit);
  return preset ? preset.label : scaleRatioText(s);
}

/** Parses "1 mm = 100 mm", "1 in = 10 ft" (as other editors write /R). */
export function parseRatio(r: string): Pick<PageScale, "paper" | "paperUnit" | "real" | "realUnit"> | null {
  const m = /^\s*([\d.]+)\s*(mm|cm|m|in|ft|")\s*=\s*([\d.]+)\s*(mm|cm|m|in|ft|'|")\s*$/i.exec(r.replace(/’|”/g, (c) => (c === "’" ? "'" : '"')));
  if (!m) return null;
  const unit = (u: string): Unit => (u === '"' ? "in" : u === "'" ? "ft" : (u.toLowerCase() as Unit));
  const paper = parseFloat(m[1]);
  const real = parseFloat(m[3]);
  if (!(paper > 0) || !(real > 0)) return null;
  return { paper, paperUnit: unit(m[2]), real, realUnit: unit(m[4]) };
}

/** Maps a unit label from a /NumberFormat /U to a unit Drawset knows. */
export function unitFromLabel(u: string): Unit | null {
  const s = u.trim().toLowerCase().replace(/\.$/, "");
  if (["mm", "millimetre", "millimetres", "millimeter", "millimeters"].includes(s)) return "mm";
  if (["cm", "centimetre", "centimetres", "centimeter", "centimeters"].includes(s)) return "cm";
  if (["m", "metre", "metres", "meter", "meters"].includes(s)) return "m";
  if (["in", "inch", "inches", '"'].includes(s)) return "in";
  if (["ft", "foot", "feet", "'", "ft'"].includes(s)) return "ft";
  return null;
}

/** Scale from a /Measure /RL dictionary's /R text and first /X number format (C = display units per point). */
export function scaleFromMeasure(r: string | null, unitLabel: string | null, c: number | null, denominator: number | null): PageScale | null {
  const display = unitLabel ? unitFromLabel(unitLabel) : null;
  const precision = denominator && denominator >= 1 ? Math.min(4, Math.max(0, Math.round(Math.log10(denominator)))) : 2;
  const ratio = r ? parseRatio(r) : null;
  if (ratio) {
    const s: PageScale = { ...ratio, displayUnit: display ?? ratio.realUnit, precision };
    // trust C when it disagrees (it is what readers actually use)
    if (c && c > 0 && display && Math.abs(unitsPerPoint(s) - c) / c > 1e-4) return fromFactor(c, display, precision);
    return s;
  }
  if (c && c > 0 && display) return fromFactor(c, display, precision);
  return null;
}

function fromFactor(c: number, unit: Unit, precision: number): PageScale {
  // c display units per point → 1 mm of paper is c * (points per mm) units
  const perMm = c / (METRES_PER_POINT * 1000);
  return { paper: 1, paperUnit: "mm", real: perMm, realUnit: unit, displayUnit: unit, precision };
}

export function sameScale(a: PageScale | null | undefined, b: PageScale | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.paper === b.paper && a.real === b.real && a.paperUnit === b.paperUnit && a.realUnit === b.realUnit && a.displayUnit === b.displayUnit && a.precision === b.precision;
}

// ---------- measurement values ----------

export const MEASURE_KINDS: ReadonlySet<MarkupKind> = new Set(["length", "polylength", "area", "perimeter", "count", "angle", "dimension", "volume", "radius", "diameter"]);

export function isMeasure(kind: MarkupKind): boolean {
  return MEASURE_KINDS.has(kind);
}

function pathLength(pts: readonly Pt[], closed: boolean): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

function ringArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area in square points of `outer` less the union of `cutouts` (cutouts outside the outline do not count). */
export function netArea(outer: readonly Pt[], cutouts: readonly (readonly Pt[])[]): number {
  if (outer.length < 3) return 0;
  const ring = (pts: readonly Pt[]) => [pts.map((p) => [p[0], p[1]] as [number, number])];
  let shape = [ring(outer)] as polygonClipping.MultiPolygon;
  const holes = cutouts.filter((c) => c.length >= 3);
  if (holes.length) shape = polygonClipping.difference(shape, ...holes.map((h) => ring(h) as polygonClipping.Polygon));
  let total = 0;
  for (const poly of shape) {
    poly.forEach((r, i) => {
      const closed = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
      const a = Math.abs(ringArea((closed ? r.slice(0, -1) : r) as Pt[]));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

/** Interior angle at the middle point, in degrees (0–180). */
export function angleAt(a: Pt, vertex: Pt, b: Pt): number {
  const v1 = [a[0] - vertex[0], a[1] - vertex[1]];
  const v2 = [b[0] - vertex[0], b[1] - vertex[1]];
  const l = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (l === 0) return 0;
  const c = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / l));
  return (Math.acos(c) * 180) / Math.PI;
}

export interface MeasureResult {
  /** Full-precision value in the display unit (squared for areas, degrees for angles, items for counts). */
  value: number;
  /** Unit text: "m", "m²", "°", "" for counts. */
  unit: string;
  /** Rounded for display, e.g. "12.35 m". */
  text: string;
}

const SQUARE: Record<Unit, string> = { mm: "mm²", cm: "cm²", m: "m²", in: "sq in", ft: "sq ft" };
const CUBIC: Record<Unit, string> = { mm: "mm³", cm: "cm³", m: "m³", in: "cu in", ft: "cu ft" };

/** Points sampled along the circular arc from `a` through `m` to `b` (a straight line when they are in line). */
export function arcThrough(a: Pt, m: Pt, b: Pt, steps = 32): Pt[] {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return [a, b];
  const sq = (p: Pt) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
  const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const ang = (p: Pt) => Math.atan2(p[1] - cy, p[0] - cx);
  const a0 = ang(a);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // go the way that passes through m
  let sweep = norm(ang(b) - a0);
  if (norm(ang(m) - a0) > sweep) sweep -= 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (sweep * i) / steps;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** A dimension's measured points `a`, `b` and the dimension line through the offset point `o`. */
export function dimensionLine(pts: readonly Pt[]): { a: Pt; b: Pt; a2: Pt; b2: Pt; offset: number; normal: Pt } {
  const [a, b] = pts;
  const l = dist(a, b) || 1;
  const normal: Pt = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  const o = pts[2];
  const offset = o ? (o[0] - a[0]) * normal[0] + (o[1] - a[1]) * normal[1] : 0;
  return { a, b, a2: [a[0] + normal[0] * offset, a[1] + normal[1] * offset], b2: [b[0] + normal[0] * offset, b[1] + normal[1] * offset], offset, normal };
}

export function areaUnitLabel(u: Unit): string {
  return SQUARE[u];
}

export function formatNumber(v: number, precision: number): string {
  return v.toLocaleString("en-AU", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

/** Value of a measurement markup at `scale` (the markup's own scale when omitted). */
export function measureValue(m: Markup, scale: PageScale = m.measure?.scale ?? DEFAULT_SCALE): MeasureResult {
  const k = unitsPerPoint(scale);
  const p = scale.precision;
  const u = scale.displayUnit;
  switch (m.kind) {
    case "length":
    case "polylength": {
      const v = pathLength(m.points, false) * k;
      return { value: v, unit: u, text: `${formatNumber(v, p)} ${u}` };
    }
    case "perimeter": {
      const v = pathLength(m.points, true) * k;
      return { value: v, unit: u, text: `${formatNumber(v, p)} ${u}` };
    }
    case "area": {
      const v = netArea(m.points, m.measure?.cutouts ?? []) * k * k;
      return { value: v, unit: SQUARE[u], text: `${formatNumber(v, p)} ${SQUARE[u]}` };
    }
    case "count": {
      const v = m.points.length;
      return { value: v, unit: "", text: `${v}` };
    }
    case "angle": {
      const v = m.points.length >= 3 ? angleAt(m.points[0], m.points[1], m.points[2]) : 0;
      return { value: v, unit: "°", text: `${formatNumber(v, Math.min(p, 2) || 1)}°` };
    }
    case "dimension": {
      const v = m.points.length >= 2 ? dist(m.points[0], m.points[1]) * k : 0;
      return { value: v, unit: u, text: `${formatNumber(v, p)} ${u}` };
    }
    case "radius":
    case "diameter": {
      const v = m.points.length >= 2 ? dist(m.points[0], m.points[1]) * k * (m.kind === "diameter" ? 2 : 1) : 0;
      return { value: v, unit: u, text: `${m.kind === "diameter" ? "Ø" : "R"} ${formatNumber(v, p)} ${u}` };
    }
    case "volume": {
      const depth = convert(m.measure?.depth ?? 1, "m", u);
      const v = netArea(m.points, m.measure?.cutouts ?? []) * k * k * depth;
      return { value: v, unit: CUBIC[u], text: `${formatNumber(v, p)} ${CUBIC[u]}` };
    }
    default:
      return { value: 0, unit: "", text: "" };
  }
}

/** Number of vertices each measurement tool needs before it can finish. */
export const MIN_POINTS: Partial<Record<MarkupKind, number>> = { length: 2, polylength: 2, area: 3, perimeter: 3, count: 1, angle: 3, dimension: 3, volume: 3, radius: 2, diameter: 2 };
