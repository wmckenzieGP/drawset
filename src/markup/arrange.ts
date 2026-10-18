/** Aligning, flipping and copying formats between markups. Pure: each returns changed copies. */
import { markupBounds } from "./appearance";
import { translate } from "./edit";
import type { Pt, Quad, Rect } from "./geometry";
import { nowIso, type Markup, type MarkupKind, type MarkupStyle } from "./model";

export type Alignment = "left" | "centre" | "right" | "top" | "middle" | "bottom";

const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];

/**
 * Lines markups up with the outermost one (left, right, top, bottom) or with the middle of them all (centre,
 * middle). Each group of markups (same `unit` key) moves as one. Only markups on the first one's page move.
 */
export function aligned(ms: Markup[], how: Alignment, unit: (m: Markup) => string = (m) => m.id): Markup[] {
  const page = ms[0]?.pageId;
  const units = new Map<string, Markup[]>();
  for (const m of ms) if (m.pageId === page) units.set(unit(m), [...(units.get(unit(m)) ?? []), m]);
  if (units.size < 2) return [];
  const boxes = new Map([...units].map(([k, list]) => [k, union(list.map(markupBounds))]));
  const all = union([...boxes.values()]);
  const out: Markup[] = [];
  for (const [k, list] of units) {
    const b = boxes.get(k)!;
    let dx = 0;
    let dy = 0;
    if (how === "left") dx = all[0] - b[0];
    else if (how === "right") dx = all[2] - b[2];
    else if (how === "centre") dx = (all[0] + all[2]) / 2 - (b[0] + b[2]) / 2;
    else if (how === "top") dy = all[1] - b[1];
    else if (how === "bottom") dy = all[3] - b[3];
    else dy = (all[1] + all[3]) / 2 - (b[1] + b[3]) / 2;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) out.push(...list.filter((m) => !m.locked).map((m) => translate(m, dx, dy)));
  }
  return out;
}

/** Kinds whose drawing can be mirrored (text, images and stamps would read backwards). */
const FLIPPABLE = new Set<MarkupKind>(["line", "arrow", "polyline", "polygon", "cloud", "pen", "highlighter", "callout", "length", "polylength", "area", "perimeter", "count", "angle", "arc", "dimension", "volume", "radius", "diameter", "rectangle", "ellipse"]);

export const canFlip = (m: Markup) => FLIPPABLE.has(m.kind) && !m.keepAppearance && !m.locked;

/** Mirrors markups across the vertical (horizontal flip) or horizontal (vertical flip) centre line of them all. */
export function flipped(ms: Markup[], axis: "horizontal" | "vertical"): Markup[] {
  const list = ms.filter(canFlip);
  if (!list.length) return [];
  const all = union(list.map(markupBounds));
  const c = axis === "horizontal" ? all[0] + all[2] : all[1] + all[3];
  const f = (p: Pt): Pt => (axis === "horizontal" ? [c - p[0], p[1]] : [p[0], c - p[1]]);
  const rect = (r: Rect): Rect => {
    const [a, b] = [f([r[0], r[1]]), f([r[2], r[3]])];
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  };
  return list.map((m) => ({
    ...m,
    rect: rect(m.rect),
    points: m.points.map(f),
    inks: m.inks.map((s) => s.map(f)),
    quads: m.quads.map((q) => [...f([q[0], q[1]]), ...f([q[2], q[3]]), ...f([q[4], q[5]]), ...f([q[6], q[7]])] as Quad),
    measure: m.measure ? { ...m.measure, cutouts: m.measure.cutouts.map((h) => h.map(f)) } : undefined,
    modified: nowIso(),
  }));
}

const TEXT_KINDS = new Set<MarkupKind>(["textbox", "callout"]);
const END_KINDS = new Set<MarkupKind>(["line", "arrow", "polyline", "length", "polylength", "arc", "dimension", "callout"]);

/**
 * `target`'s style with `source`'s format painted on: colour, fill, opacity, line width and style always;
 * line ends, cloud size and text settings only where both markups have them. A text box's missing border
 * does not take the outline off a shape.
 */
export function paintedStyle(source: Markup, target: Markup): MarkupStyle {
  const s = source.style;
  const out: MarkupStyle = { ...target.style, fill: s.fill, opacity: s.opacity, width: s.width, dash: s.dash };
  if (s.color || TEXT_KINDS.has(target.kind)) out.color = s.color;
  if (END_KINDS.has(source.kind) && END_KINDS.has(target.kind)) [out.lineStart, out.lineEnd] = [s.lineStart, s.lineEnd];
  if (source.kind === "cloud" && target.kind === "cloud") out.cloudIntensity = s.cloudIntensity;
  const texty = (k: MarkupKind) => TEXT_KINDS.has(k);
  if (texty(source.kind) && texty(target.kind)) Object.assign(out, { fontFamily: s.fontFamily, fontSize: s.fontSize, textColor: s.textColor, align: s.align });
  else if (source.kind === target.kind) out.fontSize = s.fontSize;
  return out;
}
