/**
 * Tool Chest: markups saved as reusable tools, grouped into sets, with recents and JSON import/export.
 * Kept on this computer only (browser storage of the app).
 */
import { create } from "zustand";
import { bboxOf, type Pt } from "../../markup/geometry";
import { isMeasure } from "../../markup/measure";
import { KIND_LABELS, newId, nowIso, type Markup, type MarkupKind, type MarkupStyle } from "../../markup/model";
import { translate } from "../../markup/edit";
import type { PageEntry } from "../../state/store";

/** What a tool keeps of a markup: everything except identity, page, author, dates, review state and file links. */
export type ToolTemplate = Pick<Markup, "kind" | "subtype" | "rect" | "points" | "inks" | "quads" | "style" | "contents" | "subject" | "icon" | "stampId" | "stampText" | "image" | "measure">;

export type ToolMode = "draw" | "copy";

export interface ChestTool {
  id: string;
  name: string;
  /** draw: the kind's tool with these properties; copy: click places this exact markup. */
  mode: ToolMode;
  template: ToolTemplate;
}

export interface ChestSet {
  id: string;
  name: string;
  tools: ChestTool[];
}

const COPY_KINDS = new Set<MarkupKind>(["stamp", "image", "textbox", "callout", "note", "count"]);

/** Kinds that can be drawn again (text markups need text under them, redactions are not tools). */
export const CHEST_KINDS = new Set<MarkupKind>(["rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "pen", "highlighter", "textbox", "callout", "note", "stamp", "image", "length", "polylength", "area", "perimeter", "count", "angle", "arc", "dimension", "volume", "radius", "diameter"]);

const clonePts = (ps: Pt[]) => ps.map((p) => [p[0], p[1]] as Pt);

export function toolFromMarkup(m: Markup, name?: string): ChestTool {
  const template: ToolTemplate = {
    kind: m.kind,
    subtype: m.subtype,
    rect: [...m.rect],
    points: clonePts(m.points),
    inks: m.inks.map(clonePts),
    quads: m.quads.map((q) => [...q] as typeof q),
    style: structuredClone(m.style),
    contents: m.contents,
    subject: m.subject,
    icon: m.icon,
    stampId: m.stampId,
    stampText: m.stampText ? [...m.stampText] : undefined,
    image: m.image ? { ...m.image, data: m.image.data.slice() } : undefined,
    measure: m.measure ? { ...m.measure, scale: m.measure.scale ? { ...m.measure.scale } : null, cutouts: m.measure.cutouts.map(clonePts) } : undefined,
  };
  return { id: newId(), name: name ?? (m.subject || KIND_LABELS[m.kind]), mode: COPY_KINDS.has(m.kind) ? "copy" : "draw", template };
}

function centre(t: ToolTemplate): Pt {
  const pts = t.points.length ? t.points : t.inks.length ? t.inks.flat() : [];
  const r = pts.length ? bboxOf(pts) : t.rect;
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

/** The tool's markup placed with its centre at `at` on `page`. Measurements take the page's scale. */
export function markupFromTool(tool: ChestTool, page: PageEntry, at: Pt, author: string): Markup {
  const t = tool.template;
  const now = nowIso();
  const base: Markup = {
    id: newId(),
    pageId: page.id,
    kind: t.kind,
    subtype: t.subtype,
    rect: [...t.rect],
    points: clonePts(t.points),
    inks: t.inks.map(clonePts),
    quads: t.quads.map((q) => [...q] as typeof q),
    style: structuredClone(t.style),
    contents: t.contents,
    author,
    subject: t.subject,
    created: now,
    modified: now,
    status: "None",
    locked: false,
    icon: t.icon,
    stampId: t.stampId,
    stampText: t.stampText ? [...t.stampText] : undefined,
    image: t.image ? { ...t.image, data: t.image.data.slice() } : undefined,
    replies: [],
    measure: t.measure ? { ...t.measure, scale: isMeasure(t.kind) ? page.scale : t.measure.scale, cutouts: t.measure.cutouts.map(clonePts) } : undefined,
  };
  const c = centre(t);
  return translate(base, at[0] - c[0], at[1] - c[1]);
}

/** Properties a draw-mode tool gives a newly drawn markup of its kind. */
export function applyTemplate(m: Markup, t: ToolTemplate): Markup {
  if (m.kind !== t.kind) return m;
  const out: Markup = { ...m, style: structuredClone(t.style), subject: t.subject, icon: t.icon };
  // measurements keep their value text in /Contents; only text-bearing markups take the saved text
  if (!isMeasure(t.kind)) out.contents = t.contents;
  if (t.stampId) out.stampId = t.stampId;
  if (t.stampText) out.stampText = [...t.stampText];
  if (t.image) out.image = { ...t.image, data: t.image.data.slice() };
  return out;
}

// ---------- JSON ----------

export const TOOLSET_FORMAT = "drawset-toolset";

interface ToolJson extends Omit<ChestTool, "template"> {
  template: Omit<ToolTemplate, "image"> & { image?: { data: string; mime: string; width: number; height: number } };
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toolToJson(t: ChestTool): ToolJson {
  const { image, ...rest } = t.template;
  return { ...t, template: { ...rest, ...(image ? { image: { ...image, data: toBase64(image.data) } } : {}) } };
}

export function setToJson(set: ChestSet): string {
  return JSON.stringify({ format: TOOLSET_FORMAT, version: 1, name: set.name, tools: set.tools.map(toolToJson) }, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isRgbOrNull = (v: unknown) => v === null || (Array.isArray(v) && v.length === 3 && v.every((x) => isNum(x) && x >= 0 && x <= 1));

function validStyle(s: unknown): s is MarkupStyle {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return isRgbOrNull(o.color) && isRgbOrNull(o.fill) && isNum(o.opacity) && isNum(o.width) && isNum(o.fontSize) && Array.isArray(o.textColor) && typeof o.fontFamily === "string";
}

/** Reads a tool set file; tools get new ids so a set can be imported twice. Throws with a readable message. */
export function setFromJson(text: string): ChestSet {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const d = data as { format?: unknown; version?: unknown; name?: unknown; tools?: unknown };
  if (d?.format !== TOOLSET_FORMAT) throw new Error("This is not a Drawset tool set file.");
  if (d.version !== 1) throw new Error("This tool set was made by a newer version of Drawset.");
  if (!Array.isArray(d.tools)) throw new Error("The tool set has no tools.");
  const tools: ChestTool[] = [];
  for (const raw of d.tools as ToolJson[]) {
    const t = raw?.template;
    if (!t || !CHEST_KINDS.has(t.kind) || !validStyle(t.style)) throw new Error(`The tool "${raw?.name ?? "?"}" is not valid.`);
    if (!Array.isArray(t.rect) || t.rect.length !== 4 || !t.rect.every(isNum)) throw new Error(`The tool "${raw.name}" has no valid frame.`);
    if (!Array.isArray(t.points) || !t.points.every(isPt) || !Array.isArray(t.inks) || !t.inks.every((s) => Array.isArray(s) && s.every(isPt))) throw new Error(`The tool "${raw.name}" has invalid points.`);
    const image = t.image ? { data: fromBase64(t.image.data), mime: t.image.mime === "image/jpeg" ? ("image/jpeg" as const) : ("image/png" as const), width: Number(t.image.width), height: Number(t.image.height) } : undefined;
    tools.push({
      id: newId(),
      name: String(raw.name ?? KIND_LABELS[t.kind]),
      mode: raw.mode === "copy" ? "copy" : "draw",
      template: {
        kind: t.kind,
        subtype: String(t.subtype ?? ""),
        rect: [...t.rect],
        points: t.points,
        inks: t.inks,
        quads: Array.isArray(t.quads) ? t.quads : [],
        style: t.style,
        contents: String(t.contents ?? ""),
        subject: String(t.subject ?? KIND_LABELS[t.kind]),
        icon: String(t.icon ?? "Comment"),
        stampId: t.stampId,
        stampText: Array.isArray(t.stampText) ? t.stampText.map(String) : undefined,
        image,
        measure: t.measure ? { scale: t.measure.scale ?? null, cutouts: Array.isArray(t.measure.cutouts) ? t.measure.cutouts : [], ...(typeof t.measure.depth === "number" && t.measure.depth > 0 ? { depth: t.measure.depth } : {}) } : undefined,
      },
    });
  }
  return { id: newId(), name: String(d.name ?? "Imported tools"), tools };
}

// ---------- store ----------

const STORE_KEY = "drawset.toolchest.v1";
const MAX_RECENTS = 8;

interface ChestState {
  sets: ChestSet[];
  /** Recently used tools, newest first (copies, so they survive the tool being deleted from its set). */
  recents: ChestTool[];
  /** The set new tools are added to. */
  currentSet: string;
}

function load(): ChestState {
  const fresh = (): ChestState => {
    const id = newId();
    return { sets: [{ id, name: "My tools", tools: [] }], recents: [], currentSet: id };
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh();
    const saved = JSON.parse(raw) as { sets: string[]; recents: string; currentSet: string };
    const sets = saved.sets.map((s) => setFromJsonKeepIds(s));
    const recents = saved.recents ? setFromJsonKeepIds(saved.recents).tools : [];
    if (!sets.length) return fresh();
    return { sets, recents, currentSet: sets.some((s) => s.id === saved.currentSet) ? saved.currentSet : sets[0].id };
  } catch {
    return fresh();
  }
}

/** Storage keeps ids (recents and the current set refer to them). */
function setFromJsonKeepIds(text: string): ChestSet {
  const parsed = JSON.parse(text) as { id?: string; tools: { id: string }[] };
  const set = setFromJson(text);
  return { ...set, id: parsed.id ?? set.id, tools: set.tools.map((t, i) => ({ ...t, id: parsed.tools[i]?.id ?? t.id })) };
}

function storeJson(set: ChestSet): string {
  const j = JSON.parse(setToJson(set));
  j.id = set.id;
  return JSON.stringify(j);
}

export const useChest = create<ChestState>(() => load());

useChest.subscribe((s) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ sets: s.sets.map(storeJson), recents: storeJson({ id: "recents", name: "Recent", tools: s.recents }), currentSet: s.currentSet }));
  } catch {
    // storage full or unavailable: the chest still works for this session
  }
});

export function findTool(id: string): ChestTool | null {
  const s = useChest.getState();
  for (const set of s.sets) for (const t of set.tools) if (t.id === id) return t;
  return s.recents.find((t) => t.id === id) ?? null;
}

export function addTools(ms: Markup[], setId = useChest.getState().currentSet) {
  const tools = ms.filter((m) => CHEST_KINDS.has(m.kind)).map((m) => toolFromMarkup(m));
  if (!tools.length) return 0;
  useChest.setState((s) => ({ sets: s.sets.map((x) => (x.id === setId ? { ...x, tools: [...x.tools, ...tools] } : x)) }));
  return tools.length;
}

export function updateTool(id: string, patch: Partial<Pick<ChestTool, "name" | "mode">>) {
  useChest.setState((s) => ({
    sets: s.sets.map((x) => ({ ...x, tools: x.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    recents: s.recents.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

export function removeTool(id: string) {
  useChest.setState((s) => ({ sets: s.sets.map((x) => ({ ...x, tools: x.tools.filter((t) => t.id !== id) })), recents: s.recents.filter((t) => t.id !== id) }));
}

export function addSet(name: string): string {
  const id = newId();
  useChest.setState((s) => ({ sets: [...s.sets, { id, name, tools: [] }], currentSet: id }));
  return id;
}

export function importSet(text: string): ChestSet {
  const set = setFromJson(text);
  useChest.setState((s) => ({ sets: [...s.sets, set] }));
  return set;
}

export function renameSet(id: string, name: string) {
  useChest.setState((s) => ({ sets: s.sets.map((x) => (x.id === id ? { ...x, name } : x)) }));
}

export function removeSet(id: string) {
  useChest.setState((s) => {
    const sets = s.sets.filter((x) => x.id !== id);
    if (!sets.length) sets.push({ id: newId(), name: "My tools", tools: [] });
    return { sets, currentSet: sets.some((x) => x.id === s.currentSet) ? s.currentSet : sets[0].id };
  });
}

export function noteRecent(tool: ChestTool) {
  useChest.setState((s) => ({ recents: [tool, ...s.recents.filter((t) => t.id !== tool.id)].slice(0, MAX_RECENTS) }));
}
