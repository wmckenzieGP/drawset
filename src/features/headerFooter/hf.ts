/** Header, footer and watermark settings, and filling in their variables for each page. */
import type { Decoration, HFPosition } from "../../engine/types";
import type { DocState, DocTab } from "../../state/store";

export const POSITIONS: HFPosition[] = ["tl", "tc", "tr", "bl", "bc", "br"];
export const POSITION_LABELS: Record<HFPosition, string> = { tl: "Top left", tc: "Top centre", tr: "Top right", bl: "Bottom left", bc: "Bottom centre", br: "Bottom right" };

export const VARIABLES: { token: string; label: string }[] = [
  { token: "{page}", label: "Page number" },
  { token: "{pages}", label: "Page count" },
  { token: "{label}", label: "Page label" },
  { token: "{file}", label: "File name" },
  { token: "{date}", label: "Date" },
];

export interface HFSpec {
  version: 1;
  text: Partial<Record<HFPosition, string>>;
  fontSize: number;
  colour: [number, number, number];
  marginMm: number;
  watermark: { text: string; fontSize: number; colour: [number, number, number]; opacity: number; angle: number } | null;
  /** First and last page by position (1-based); null for all pages. */
  range: { from: number; to: number } | null;
  /** The date {date} shows: fixed when the settings are applied, so the file does not change by itself. */
  date: string;
}

export const MM = 72 / 25.4;

export function defaultSpec(): HFSpec {
  return { version: 1, text: {}, fontSize: 9, colour: [0, 0, 0], marginMm: 10, watermark: null, range: null, date: formatDate(new Date()) };
}

/** Australian short date: 16/10/2026. */
export function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function parseSpec(json: string | null | undefined): HFSpec | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!v || v.version !== 1 || typeof v.text !== "object") return null;
    const d = defaultSpec();
    return { ...d, ...v, text: { ...v.text } };
  } catch {
    return null;
  }
}

/** The settings in force: the unsaved ones, else the file's. */
export function currentSpec(tab: DocTab, state: DocState = tab.state): HFSpec | null {
  return state.headerFooter === undefined ? parseSpec(tab.info.headerFooter) : state.headerFooter;
}

export function fillVariables(text: string, v: { page: number; pages: number; label: string; file: string; date: string }): string {
  return text.replace(/\{(page|pages|label|file|date)\}/g, (_m, k: keyof typeof v) => String(v[k]));
}

/**
 * Each physical page's decoration for `state` (null where none). Pages outside the range, deleted pages and
 * pages without settings get null so earlier decorations are removed.
 */
export function decorationsFor(tab: DocTab, state: DocState = tab.state): Map<number, Decoration | null> {
  const spec = currentSpec(tab, state);
  const out = new Map<number, Decoration | null>();
  for (let i = 0; i < tab.info.pageCount; i++) out.set(i, null);
  if (!spec) return out;
  const n = state.pages.length;
  const from = spec.range ? Math.max(1, spec.range.from) : 1;
  const to = spec.range ? Math.min(n, spec.range.to) : n;
  state.pages.forEach((p, i) => {
    if (i + 1 < from || i + 1 > to) return;
    const vars = { page: i + 1, pages: n, label: p.label, file: tab.name, date: spec.date };
    const items = POSITIONS.filter((pos) => spec.text[pos]?.trim()).map((pos) => ({ pos, text: fillVariables(spec.text[pos]!, vars) }));
    const wm = spec.watermark?.text.trim() ? { ...spec.watermark, text: fillVariables(spec.watermark.text, vars) } : null;
    if (!items.length && !wm) return;
    out.set(p.src, { rotate: (p.info.rotate + p.rotation) % 360, items, fontSize: spec.fontSize, colour: spec.colour, margin: spec.marginMm * MM, watermark: wm });
  });
  return out;
}

export function specJson(spec: HFSpec | null): string | null {
  return spec ? JSON.stringify(spec) : null;
}
