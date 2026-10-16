/**
 * Builds a markup's appearance as a small list of drawing operations in page space.
 * The same list is drawn on screen (draw.ts) and written to the PDF appearance stream (pdfAppearance.ts),
 * so what you see in Drawset is what other viewers see.
 */
import { bboxOf, dist, inflate, signedArea, type Pt, type Quad, type Rect } from "./geometry";
import { FONT_WIDTHS } from "./fontMetrics";
import type { FontFamily, LineEnd, Markup, RGB } from "./model";
import { measureValue } from "./measure";

export type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export interface PathOp {
  t: "path";
  segs: Seg[];
  stroke: RGB | null;
  fill: RGB | null;
  width: number;
  dash: number[] | null;
  evenOdd?: boolean;
  /** 0 butt, 1 round, 2 square. */
  cap?: 0 | 1 | 2;
  join?: 0 | 1 | 2;
}

export type TextFont = FontFamily | "Helvetica-Bold";

export interface TextOp {
  t: "text";
  /** Baseline origins in page space. */
  lines: { x: number; y: number; s: string }[];
  font: TextFont;
  size: number;
  color: RGB;
}

export interface ImageOp {
  t: "image";
  rect: Rect;
}

export type DrawOp = PathOp | TextOp | ImageOp;

export interface Appearance {
  ops: DrawOp[];
  /** Bounds of everything drawn, in page space (including stroke width). */
  bbox: Rect;
  opacity: number;
  blend: "Normal" | "Multiply";
}

const K = 0.5522847498;

export function rectSegs(r: Rect): Seg[] {
  return [["M", r[0], r[1]], ["L", r[2], r[1]], ["L", r[2], r[3]], ["L", r[0], r[3]], ["Z"]];
}

export function ellipseSegs(r: Rect): Seg[] {
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  const rx = (r[2] - r[0]) / 2;
  const ry = (r[3] - r[1]) / 2;
  const kx = rx * K;
  const ky = ry * K;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

export function polySegs(pts: readonly Pt[], close: boolean): Seg[] {
  const segs: Seg[] = [];
  pts.forEach((p, i) => segs.push([i === 0 ? "M" : "L", p[0], p[1]]));
  if (close && pts.length > 2) segs.push(["Z"]);
  return segs;
}

function roundRectSegs(r: Rect, rad: number): Seg[] {
  const [x0, y0, x1, y1] = r;
  const k = rad * (1 - K);
  return [
    ["M", x0 + rad, y0],
    ["L", x1 - rad, y0],
    ["C", x1 - k, y0, x1, y0 + k, x1, y0 + rad],
    ["L", x1, y1 - rad],
    ["C", x1, y1 - k, x1 - k, y1, x1 - rad, y1],
    ["L", x0 + rad, y1],
    ["C", x0 + k, y1, x0, y1 - k, x0, y1 - rad],
    ["L", x0, y0 + rad],
    ["C", x0, y0 + k, x0 + k, y0, x0 + rad, y0],
    ["Z"],
  ];
}

/** Cloud border: overlapping semicircular bumps along each edge, bulging outwards. */
export function cloudSegs(pts: readonly Pt[], intensity: number, lineWidth: number): Seg[] {
  if (pts.length < 2) return [];
  const poly = pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-9 ? pts.slice(0, -1) : pts.slice();
  // in page space (y down) a positive signed area means clockwise on screen
  const cw = signedArea(poly) > 0;
  const target = Math.max(4, (6 + 6 * Math.max(0.2, intensity)) + lineWidth);
  const segs: Seg[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    const n = Math.max(1, Math.round(len / target));
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    // outward normal
    const nx = cw ? uy : -uy;
    const ny = cw ? -ux : ux;
    for (let j = 0; j < n; j++) {
      const p0: Pt = [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n];
      const p1: Pt = [a[0] + ((b[0] - a[0]) * (j + 1)) / n, a[1] + ((b[1] - a[1]) * (j + 1)) / n];
      const r = len / n / 2;
      const m: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const top: Pt = [m[0] + nx * r, m[1] + ny * r];
      if (segs.length === 0) segs.push(["M", p0[0], p0[1]]);
      segs.push(["C", p0[0] + nx * r * K, p0[1] + ny * r * K, top[0] - ux * r * K, top[1] - uy * r * K, top[0], top[1]]);
      segs.push(["C", top[0] + ux * r * K, top[1] + uy * r * K, p1[0] + nx * r * K, p1[1] + ny * r * K, p1[0], p1[1]]);
    }
  }
  segs.push(["Z"]);
  return segs;
}

/** Line-ending shape at `tip`, pointing away from `from`. */
export function lineEndOps(style: LineEnd, tip: Pt, from: Pt, width: number, color: RGB, fill: RGB | null): PathOp[] {
  if (style === "None") return [];
  const len = dist(tip, from) || 1;
  const ux = (tip[0] - from[0]) / len;
  const uy = (tip[1] - from[1]) / len;
  const size = Math.max(6, width * 4.5);
  const base = { stroke: color, width, dash: null, cap: 0 as const, join: 0 as const };
  const at = (along: number, across: number): Pt => [tip[0] + ux * along - uy * across, tip[1] + uy * along + ux * across];
  switch (style) {
    case "OpenArrow":
    case "ROpenArrow": {
      const d = style === "OpenArrow" ? -size : size;
      const a = at(d, size * 0.45);
      const b = at(d, -size * 0.45);
      return [{ t: "path", segs: [["M", a[0], a[1]], ["L", tip[0], tip[1]], ["L", b[0], b[1]]], fill: null, ...base }];
    }
    case "ClosedArrow":
    case "RClosedArrow": {
      const d = style === "ClosedArrow" ? -size : size;
      const a = at(d, size * 0.45);
      const b = at(d, -size * 0.45);
      return [{ t: "path", segs: [["M", a[0], a[1]], ["L", tip[0], tip[1]], ["L", b[0], b[1]], ["Z"]], fill: fill ?? color, ...base }];
    }
    case "Circle": {
      const r = size / 2.5;
      return [{ t: "path", segs: ellipseSegs([tip[0] - r, tip[1] - r, tip[0] + r, tip[1] + r]), fill, ...base }];
    }
    case "Square": {
      const r = size / 2.5;
      const p = [at(r, r), at(r, -r), at(-r, -r), at(-r, r)];
      return [{ t: "path", segs: polySegs(p, true), fill, ...base }];
    }
    case "Diamond": {
      const r = size / 2;
      const p = [at(r, 0), at(0, r), at(-r, 0), at(0, -r)];
      return [{ t: "path", segs: polySegs(p, true), fill, ...base }];
    }
    case "Butt": {
      const a = at(0, size / 2);
      const b = at(0, -size / 2);
      return [{ t: "path", segs: [["M", a[0], a[1]], ["L", b[0], b[1]]], fill: null, ...base }];
    }
    case "Slash": {
      const a = at(size / 3, size / 2);
      const b = at(-size / 3, -size / 2);
      return [{ t: "path", segs: [["M", a[0], a[1]], ["L", b[0], b[1]]], fill: null, ...base }];
    }
  }
  return [];
}

// ---------- text layout (Helvetica / Times / Courier metrics, shared by screen and PDF) ----------

export function charWidth(font: TextFont, ch: string): number {
  const table = FONT_WIDTHS[font] ?? FONT_WIDTHS.Helvetica;
  return table[ch.codePointAt(0) ?? 63] ?? table[63] ?? 556;
}

export function textWidth(font: TextFont, size: number, s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(font, ch);
  return (w * size) / 1000;
}

/** Word-wraps text to `maxWidth`; explicit newlines are kept. Very long words are broken. */
export function wrapText(font: TextFont, size: number, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      if (w === "") continue;
      const trial = line + w;
      if (textWidth(font, size, trial) <= maxWidth || line === "") {
        if (line === "" && textWidth(font, size, w) > maxWidth && !/^\s+$/.test(w)) {
          // break a long word
          let chunk = "";
          for (const ch of w) {
            if (textWidth(font, size, chunk + ch) > maxWidth && chunk) {
              out.push(chunk);
              chunk = "";
            }
            chunk += ch;
          }
          line = chunk;
        } else line = trial;
      } else {
        out.push(line.trimEnd());
        line = /^\s+$/.test(w) ? "" : w;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export const LINE_HEIGHT = 1.2;
const ASCENT = 0.8;

export function layoutText(font: TextFont, size: number, text: string, box: Rect, pad: number, align: 0 | 1 | 2) {
  const innerW = Math.max(1, box[2] - box[0] - 2 * pad);
  const lines = wrapText(font, size, text, innerW);
  return lines.map((s, i) => {
    const w = textWidth(font, size, s);
    const x = align === 0 ? box[0] + pad : align === 1 ? (box[0] + box[2]) / 2 - w / 2 : box[2] - pad - w;
    return { x, y: box[1] + pad + size * ASCENT + i * size * LINE_HEIGHT, s };
  });
}

/** Height a text box needs for its text at the given width. */
export function textBoxHeight(font: TextFont, size: number, text: string, width: number, pad: number): number {
  const lines = wrapText(font, size, text, Math.max(1, width - 2 * pad));
  return Math.max(1, lines.length) * size * LINE_HEIGHT + 2 * pad - size * (LINE_HEIGHT - 1);
}

export function textPadding(m: Markup): number {
  return 2 + (m.style.color ? m.style.width : 0);
}

// ---------- built-in stamps (original Drawset designs) ----------

export interface StampDef {
  id: string;
  label: string;
  color: RGB;
}

export const BUILTIN_STAMPS: StampDef[] = [
  { id: "approved", label: "APPROVED", color: [0.1, 0.55, 0.2] },
  { id: "reviewed", label: "REVIEWED", color: [0.12, 0.35, 0.75] },
  { id: "for-construction", label: "FOR CONSTRUCTION", color: [0.1, 0.55, 0.2] },
  { id: "not-for-construction", label: "NOT FOR CONSTRUCTION", color: [0.8, 0.1, 0.1] },
  { id: "preliminary", label: "PRELIMINARY", color: [0.85, 0.45, 0.05] },
  { id: "revise-resubmit", label: "REVISE AND RESUBMIT", color: [0.85, 0.45, 0.05] },
  { id: "superseded", label: "SUPERSEDED", color: [0.8, 0.1, 0.1] },
  { id: "as-constructed", label: "AS CONSTRUCTED", color: [0.12, 0.35, 0.75] },
  { id: "information-only", label: "INFORMATION ONLY", color: [0.35, 0.35, 0.4] },
  { id: "void", label: "VOID", color: [0.8, 0.1, 0.1] },
];

export function stampDef(id: string | undefined): StampDef {
  return BUILTIN_STAMPS.find((s) => s.id === id) ?? BUILTIN_STAMPS[0];
}

/** Natural size of a built-in stamp in points for the given text lines. */
export function stampSize(lines: string[]): [number, number] {
  const titleSize = 18;
  const subSize = 9;
  const w = Math.max(textWidth("Helvetica-Bold", titleSize, lines[0] ?? ""), ...lines.slice(1).map((l) => textWidth("Helvetica", subSize, l)));
  return [w + 24, 14 + titleSize + lines.slice(1).length * subSize * 1.3 + 8];
}

function stampOps(m: Markup): DrawOp[] {
  const def = stampDef(m.stampId);
  const color = m.style.color ?? def.color;
  const lines = m.stampText && m.stampText.length ? m.stampText : [def.label];
  const [nw, nh] = stampSize(lines);
  const r = m.rect;
  const sx = (r[2] - r[0]) / nw;
  const sy = (r[3] - r[1]) / nh;
  const s = Math.min(sx, sy);
  const bw = 2.5 * s;
  const ops: DrawOp[] = [
    { t: "path", segs: roundRectSegs(inflate(r, -bw / 2), 6 * s), stroke: color, fill: null, width: bw, dash: null },
  ];
  const titleSize = 18 * s;
  const subSize = 9 * s;
  const cx = (r[0] + r[2]) / 2;
  const top = r[1] + (r[3] - r[1] - nh * s) / 2;
  ops.push({ t: "text", font: "Helvetica-Bold", size: titleSize, color, lines: [{ x: cx - textWidth("Helvetica-Bold", titleSize, lines[0]) / 2, y: top + 7 * s + titleSize * ASCENT, s: lines[0] }] });
  if (lines.length > 1) {
    ops.push({
      t: "text",
      font: "Helvetica",
      size: subSize,
      color,
      lines: lines.slice(1).map((l, i) => ({ x: cx - textWidth("Helvetica", subSize, l) / 2, y: top + 7 * s + titleSize + 4 * s + subSize * ASCENT + i * subSize * 1.3, s: l })),
    });
  }
  return ops;
}

function noteOps(m: Markup): DrawOp[] {
  const r = m.rect;
  const w = r[2] - r[0];
  const h = r[3] - r[1];
  const fill = m.style.color ?? [1, 0.82, 0.2];
  const body: Rect = [r[0] + w * 0.05, r[1] + h * 0.08, r[2] - w * 0.05, r[1] + h * 0.72];
  const rad = w * 0.15;
  const segs = roundRectSegs(body, rad);
  // speech tail
  const tail: Seg[] = [["M", r[0] + w * 0.3, body[3] - 0.5], ["L", r[0] + w * 0.22, r[3] - h * 0.06], ["L", r[0] + w * 0.52, body[3] - 0.5], ["Z"]];
  const lineY = [0.3, 0.45, 0.6].map((f) => r[1] + h * f);
  return [
    { t: "path", segs: [...segs, ...tail], fill, stroke: [0.15, 0.15, 0.15], width: Math.max(0.6, w * 0.04), dash: null, join: 1 },
    { t: "path", segs: lineY.flatMap((y): Seg[] => [["M", r[0] + w * 0.22, y], ["L", r[2] - w * 0.22, y]]), fill: null, stroke: [0.15, 0.15, 0.15], width: Math.max(0.5, w * 0.035), dash: null, cap: 1 },
  ];
}

function quadPolygon(q: Quad): Pt[] {
  return [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]],
  ];
}

function textMarkupOps(m: Markup): DrawOp[] {
  const color = m.style.color ?? [1, 1, 0];
  if (m.kind === "highlight") {
    return [{ t: "path", segs: m.quads.flatMap((q) => polySegs(quadPolygon(q), true)), fill: color, stroke: null, width: 0, dash: null }];
  }
  const segs: Seg[] = [];
  let width = 1;
  for (const q of m.quads) {
    const h = dist([q[0], q[1]], [q[4], q[5]]);
    width = Math.max(0.5, h / 14);
    const f = m.kind === "underline" ? 0.93 : 0.55;
    const a: Pt = [q[0] + (q[4] - q[0]) * f, q[1] + (q[5] - q[1]) * f];
    const b: Pt = [q[2] + (q[6] - q[2]) * f, q[3] + (q[7] - q[3]) * f];
    segs.push(["M", a[0], a[1]], ["L", b[0], b[1]]);
  }
  return [{ t: "path", segs, fill: null, stroke: color, width, dash: null }];
}

export function calloutBoxAnchor(box: Rect, toward: Pt): Pt {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  const w = (box[2] - box[0]) / 2;
  const h = (box[3] - box[1]) / 2;
  if (Math.abs(dx) * h > Math.abs(dy) * w) return [dx > 0 ? box[2] : box[0], cy];
  return [cx, dy > 0 ? box[3] : box[1]];
}

function textBoxOps(m: Markup): DrawOp[] {
  const ops: DrawOp[] = [];
  const s = m.style;
  const stroke = s.color && s.width > 0 ? s.color : null;
  if (s.fill || stroke) {
    const inset = stroke ? s.width / 2 : 0;
    ops.push({ t: "path", segs: rectSegs(inflate(m.rect, -inset)), fill: s.fill, stroke, width: s.width, dash: s.dash });
  }
  if (m.contents) {
    ops.push({ t: "text", font: s.fontFamily, size: s.fontSize, color: s.textColor, lines: layoutText(s.fontFamily, s.fontSize, m.contents, m.rect, textPadding(m), s.align) });
  }
  return ops;
}

/** Callout leader in page space: tip, optional knee, then the anchor on the text box edge. */
export function calloutLeader(m: Markup): Pt[] {
  if (m.points.length === 0) return [];
  return [...m.points, calloutBoxAnchor(m.rect, m.points[m.points.length - 1])];
}

function calloutOps(m: Markup): DrawOp[] {
  const s = m.style;
  const ops: DrawOp[] = [];
  const leaderColour = s.color ?? s.textColor;
  if (m.points.length >= 1) {
    const pts = calloutLeader(m);
    ops.push({ t: "path", segs: polySegs(pts, false), fill: null, stroke: leaderColour, width: Math.max(0.5, s.width), dash: null, join: 1 });
    ops.push(...lineEndOps(s.lineStart === "None" ? "None" : s.lineStart, pts[0], pts[1], Math.max(0.5, s.width), leaderColour, leaderColour));
  }
  return [...ops, ...textBoxOps(m)];
}

/** Caption text centred on `at`, sitting just above it. */
function captionOp(m: Markup, at: Pt, text: string, above = true): TextOp {
  const size = m.style.fontSize;
  const w = textWidth(m.style.fontFamily, size, text);
  const y = above ? at[1] - size * 0.35 : at[1] + size * ASCENT * 0.5;
  return { t: "text", font: m.style.fontFamily, size, color: m.style.color ?? m.style.textColor, lines: [{ x: at[0] - w / 2, y, s: text }] };
}

/** Point halfway along a polyline. */
function pathMidpoint(pts: readonly Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (left <= d && d > 0) return [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * left) / d, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * left) / d];
    left -= d;
  }
  return pts[0] ?? [0, 0];
}

/** Area centroid of a polygon (vertex average when degenerate). */
export function polygonCentroid(pts: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function measureOps(m: Markup): DrawOp[] {
  const s = m.style;
  const stroke = s.color && s.width > 0 ? s.color : null;
  const pts = m.points;
  const ops: DrawOp[] = [];
  const text = measureValue(m).text;
  switch (m.kind) {
    case "length":
    case "polylength":
      if (pts.length < 2) return ops;
      if (stroke) {
        ops.push({ t: "path", segs: polySegs(pts, false), fill: null, stroke, width: s.width, dash: s.dash, join: 1 });
        ops.push(...lineEndOps(s.lineStart, pts[0], pts[1], s.width, stroke, s.fill));
        ops.push(...lineEndOps(s.lineEnd, pts[pts.length - 1], pts[pts.length - 2], s.width, stroke, s.fill));
      }
      ops.push(captionOp(m, pathMidpoint(pts), text));
      return ops;
    case "area":
    case "perimeter": {
      if (pts.length < 2) return ops;
      const segs = polySegs(pts, true);
      const holes = m.kind === "area" ? (m.measure?.cutouts ?? []).filter((c) => c.length > 2) : [];
      for (const h of holes) segs.push(...polySegs(h, true));
      ops.push({ t: "path", segs, fill: m.kind === "area" ? s.fill : null, stroke, width: s.width, dash: s.dash, join: 1, evenOdd: true });
      if (pts.length > 2) ops.push(captionOp(m, polygonCentroid(pts), text, false));
      return ops;
    }
    case "count": {
      const r = Math.max(4, s.fontSize * 0.45);
      const fill = s.fill ?? s.color ?? [0.9, 0.1, 0.1];
      for (const p of pts) ops.push({ t: "path", segs: ellipseSegs([p[0] - r, p[1] - r, p[0] + r, p[1] + r]), fill, stroke: stroke ?? fill, width: Math.min(s.width, 1), dash: null });
      if (pts.length) ops.push(captionOp(m, [pts[pts.length - 1][0] + r + textWidth(s.fontFamily, s.fontSize, text) / 2 + 2, pts[pts.length - 1][1]], text, false));
      return ops;
    }
    case "angle": {
      if (pts.length < 2) return ops;
      if (stroke) ops.push({ t: "path", segs: polySegs(pts, false), fill: null, stroke, width: s.width, dash: s.dash, join: 1 });
      if (pts.length >= 3 && stroke) {
        const [a, v, b] = pts;
        const rad = Math.max(8, Math.min(dist(a, v), dist(b, v)) * 0.3);
        const a0 = Math.atan2(a[1] - v[1], a[0] - v[0]);
        let sweep = Math.atan2(b[1] - v[1], b[0] - v[0]) - a0;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;
        const n = 16;
        const arc: Seg[] = [];
        for (let i = 0; i <= n; i++) {
          const t = a0 + (sweep * i) / n;
          arc.push([i === 0 ? "M" : "L", v[0] + rad * Math.cos(t), v[1] + rad * Math.sin(t)]);
        }
        ops.push({ t: "path", segs: arc, fill: null, stroke, width: Math.max(0.5, s.width * 0.75), dash: null });
        const mid = a0 + sweep / 2;
        const lab = rad + s.fontSize * 1.2;
        ops.push(captionOp(m, [v[0] + lab * Math.cos(mid), v[1] + lab * Math.sin(mid)], text, false));
      }
      return ops;
    }
  }
  return ops;
}

/** Pending redaction or erase: an outlined, hatched area (nothing is removed until applied). */
function redactOps(m: Markup): DrawOp[] {
  const colour: RGB = m.kind === "redact" ? [0.85, 0.05, 0.05] : [0.1, 0.45, 0.85];
  const areas: Seg[][] = m.quads.length ? m.quads.map((q) => polySegs(quadPolygon(q), true)) : [rectSegs(m.rect)];
  const ops: DrawOp[] = [];
  for (const segs of areas) {
    const pts = segPoints(segs);
    const b = bboxOf(pts);
    // diagonal hatching clipped by eye to the box (drawn as short segments inside it)
    const hatch: Seg[] = [];
    const step = 6;
    for (let d = -(b[3] - b[1]); d < b[2] - b[0]; d += step) {
      const x0 = b[0] + Math.max(0, d);
      const y0 = b[3] - Math.max(0, -d);
      const len = Math.min(b[2] - x0, y0 - b[1]);
      if (len <= 0) continue;
      hatch.push(["M", x0, y0], ["L", x0 + len, y0 - len]);
    }
    ops.push({ t: "path", segs: hatch, fill: null, stroke: colour, width: 0.4, dash: null });
    ops.push({ t: "path", segs, fill: null, stroke: colour, width: 1.2, dash: [4, 2] });
  }
  return ops;
}

/** Markup appearance in page space. Foreign annotations and kept appearances return no ops. */
export function buildAppearance(m: Markup): Appearance {
  const s = m.style;
  const ops: DrawOp[] = [];
  let blend: Appearance["blend"] = "Normal";
  const stroke = s.color && s.width > 0 ? s.color : null;
  switch (m.kind) {
    case "rectangle":
      ops.push({ t: "path", segs: rectSegs(m.rect), fill: s.fill, stroke, width: s.width, dash: s.dash });
      break;
    case "ellipse":
      ops.push({ t: "path", segs: ellipseSegs(m.rect), fill: s.fill, stroke, width: s.width, dash: s.dash });
      break;
    case "line":
    case "arrow":
    case "polyline": {
      const pts = m.points;
      if (pts.length >= 2 && stroke) {
        ops.push({ t: "path", segs: polySegs(pts, false), fill: null, stroke, width: s.width, dash: s.dash, join: 1 });
        ops.push(...lineEndOps(s.lineStart, pts[0], pts[1], s.width, stroke, s.fill));
        ops.push(...lineEndOps(s.lineEnd, pts[pts.length - 1], pts[pts.length - 2], s.width, stroke, s.fill));
      }
      break;
    }
    case "polygon":
      ops.push({ t: "path", segs: polySegs(m.points, true), fill: s.fill, stroke, width: s.width, dash: s.dash, join: 1 });
      break;
    case "cloud":
      ops.push({ t: "path", segs: cloudSegs(m.points, s.cloudIntensity, s.width), fill: s.fill, stroke, width: s.width, dash: s.dash, join: 1 });
      break;
    case "pen":
    case "highlighter":
      if (m.kind === "highlighter") blend = "Multiply";
      if (stroke) ops.push({ t: "path", segs: m.inks.flatMap((ink) => polySegs(ink, false)), fill: null, stroke, width: s.width, dash: null, cap: 1, join: 1 });
      break;
    case "textbox":
      ops.push(...textBoxOps(m));
      break;
    case "callout":
      ops.push(...calloutOps(m));
      break;
    case "note":
      ops.push(...noteOps(m));
      break;
    case "highlight":
      blend = "Multiply";
      ops.push(...textMarkupOps(m));
      break;
    case "underline":
    case "strikeout":
      ops.push(...textMarkupOps(m));
      break;
    case "stamp":
      if (!m.keepAppearance) {
        if (m.image) ops.push({ t: "image", rect: m.rect });
        else ops.push(...stampOps(m));
      }
      break;
    case "image":
      if (!m.keepAppearance) ops.push({ t: "image", rect: m.rect });
      break;
    case "area":
      // multiply lets the drawing show through a solid, pale fill while lines and caption stay crisp
      blend = "Multiply";
      ops.push(...measureOps(m));
      break;
    case "length":
    case "polylength":
    case "perimeter":
    case "count":
    case "angle":
      ops.push(...measureOps(m));
      break;
    case "redact":
    case "erase":
      ops.push(...redactOps(m));
      break;
    case "link": {
      // the border sits inside the link area, which stays exactly the frame
      const h = s.width / 2;
      const r: Rect = [m.rect[0] + h, m.rect[1] + h, m.rect[2] - h, m.rect[3] - h];
      if (stroke && r[2] > r[0] && r[3] > r[1]) ops.push({ t: "path", segs: rectSegs(r), fill: null, stroke, width: s.width, dash: s.dash });
      break;
    }
    case "foreign":
      break;
  }
  // box kinds keep /Rect equal to their frame so the frame survives save and reopen exactly
  // (for redactions /Rect is the area to remove, so it must be exactly the frame)
  const frameIsBox = m.kind === "textbox" || m.kind === "stamp" || m.kind === "image" || m.kind === "note" || m.kind === "redact" || m.kind === "erase" || m.kind === "link";
  return { ops, bbox: frameIsBox ? m.rect : opsBounds(ops, m), opacity: s.opacity, blend };
}

export function segPoints(segs: readonly Seg[]): Pt[] {
  const pts: Pt[] = [];
  for (const s of segs) {
    if (s[0] === "M" || s[0] === "L") pts.push([s[1], s[2]]);
    else if (s[0] === "C") pts.push([s[1], s[2]], [s[3], s[4]], [s[5], s[6]]);
  }
  return pts;
}

function opsBounds(ops: DrawOp[], m: Markup): Rect {
  let r: Rect | null = null;
  const add = (b: Rect) => (r = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] : b);
  for (const op of ops) {
    if (op.t === "path") {
      const pts = segPoints(op.segs);
      if (pts.length) add(inflate(bboxOf(pts), op.stroke ? op.width / 2 + 0.5 : 0.5));
    } else if (op.t === "text") {
      for (const l of op.lines) add([l.x, l.y - op.size, l.x + textWidth(op.font, op.size, l.s), l.y + op.size * 0.3]);
    } else add(op.rect);
  }
  if (m.kind === "textbox" || m.kind === "callout" || m.kind === "stamp" || m.kind === "image" || m.kind === "note") add(m.rect);
  return r ?? m.rect;
}

/** Bounding box used for hit-testing and selection. */
export function markupBounds(m: Markup): Rect {
  if (m.kind === "foreign" || m.keepAppearance) return m.rect;
  return buildAppearance(m).bbox;
}
