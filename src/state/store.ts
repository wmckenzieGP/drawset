/**
 * Application state. Each open document is a tab with an undoable DocState (pages + markups).
 * Every document change goes through `commit`, which records a snapshot for undo/redo.
 */
import type { ChestTool } from "../features/toolchest/chest";
import type { HFSpec } from "../features/headerFooter/hf";
import { create } from "zustand";
import type { DocInfo, FormField, MarkupRecord, OcrPage, SecuritySpec, OutlineNode, PageInfo, SearchHit } from "../engine/types";
import type { Quad, Rect } from "../markup/geometry";
import { DEFAULT_STYLE, type Markup, type MarkupKind, type MarkupStyle } from "../markup/model";
import { isMeasure, type PageScale } from "../markup/measure";

export type Rotation = 0 | 90 | 180 | 270;

export interface PageEntry {
  id: string;
  /** Physical page index in the engine document. */
  src: number;
  info: PageInfo;
  /** Extra rotation applied by the user (page operation), clockwise. */
  rotation: Rotation;
  /** Page scale for measurements (starts as the file's; null when uncalibrated). */
  scale: PageScale | null;
  /** Page label (starts as the file's). */
  label: string;
}

export interface DocState {
  pages: PageEntry[];
  markups: Record<string, Markup>;
  /** Replacement bookmarks; undefined keeps the file's. Pages are physical indices. */
  outline?: OutlineNode[];
  /** Header, footer and watermark settings; undefined keeps the file's, null removes them. */
  headerFooter?: HFSpec | null;
  /** New passwords and permissions to save; "none" removes them; undefined keeps the file's. */
  security?: SecuritySpec | "none";
  /** Text recognised since the file was opened or saved, by physical page (null removes it). */
  ocr?: Record<number, OcrPage | null>;
  /** Form field values changed since the file was opened or saved, by field name. */
  fields?: Record<string, string>;
}

export interface ViewState {
  /** CSS pixels per point. */
  scale: number;
  /** View rotation (does not change the file). */
  rotation: Rotation;
  /** Pending fit request, consumed by the viewer. */
  fit?: "page" | "width";
  /** Requested scroll target, consumed by the viewer. */
  scrollTo?: { page: number; rect?: Rect; nonce: number };
}

export interface SearchState {
  query: string;
  hits: SearchHit[];
  current: number;
  running: boolean;
  done: boolean;
}

export interface TextSelection {
  pageId: string;
  quads: Quad[];
  text: string;
}

export interface DocTab {
  key: string;
  docId: string;
  name: string;
  path: string | null;
  info: DocInfo;
  state: DocState;
  /** State as last saved; the document is dirty when state !== saved. */
  saved: DocState;
  undo: { label: string; state: DocState }[];
  redo: { label: string; state: DocState }[];
  selection: string[];
  /** Selected pages in the thumbnails panel (page ids). */
  pageSelection: string[];
  markupsLoaded: boolean;
  view: ViewState;
  currentPage: number;
  /** Pages visited by following links and bookmarks (positions in the page list), for Back and Forward. */
  nav: { back: number[]; fwd: number[] };
  search: SearchState;
  textSelection: TextSelection | null;
  /** The file's form fields (values as saved); null until read or when there is no form. */
  fields: FormField[] | null;
  /** SHA-256 of the file as opened or last saved (for crash recovery). */
  fingerprint?: string;
  /** Field the Forms panel should show and focus. */
  formFocus: { name: string; nonce: number } | null;
}

export type ToolId =
  | "select"
  | "pan"
  | "text"
  | "zoom"
  | "calibrate"
  | "cutout"
  /** Places a copy of the active Tool Chest tool. */
  | "chest"
  /** Draws the title-block box that pages are labelled from. */
  | "labelregion"
  | MarkupKind;

export interface ToolState {
  tool: ToolId;
  reuse: boolean;
  /** Default style per markup kind (what the next markup gets). */
  defaults: Partial<Record<MarkupKind, MarkupStyle>>;
  stampId: string;
  /** Pending image for stamp/image tools. */
  pendingImage: Markup["image"] | null;
  /** Active Tool Chest tool: its properties apply to the next markup (or it is placed as a copy). */
  chest: ChestTool | null;
}

export interface AppState {
  tabs: DocTab[];
  active: string | null;
  tools: ToolState;
  author: string;
  leftPanel: "thumbnails" | "bookmarks" | "search" | "toolchest" | "forms" | null;
  rightPanel: boolean;
  bottomPanel: boolean;
  message: { text: string; kind: "info" | "error" } | null;
  busy: string | null;
  snap: SnapSettings;
  /** Two documents side by side; the focused pane follows the active tab. */
  split: SplitState | null;
}

export type Pane = "left" | "right";

export interface SplitState {
  left: string;
  right: string;
  focus: Pane;
  /** Pan, zoom and page follow the pane being used. */
  sync: boolean;
}

export interface SnapSettings {
  /** Snap to markup vertices. */
  markups: boolean;
  /** Snap to the drawing: line end points and intersections. */
  content: boolean;
  grid: boolean;
  /** Grid spacing on paper, millimetres. */
  gridMm: number;
}

const DEFAULT_SNAP: SnapSettings = { markups: true, content: true, grid: false, gridMm: 5 };

function loadSnap(): SnapSettings {
  try {
    const v = JSON.parse(localStorage.getItem("drawset.snap") ?? "null");
    return v && typeof v === "object" ? { ...DEFAULT_SNAP, ...v, gridMm: Number(v.gridMm) > 0 ? Number(v.gridMm) : DEFAULT_SNAP.gridMm } : DEFAULT_SNAP;
  } catch {
    return DEFAULT_SNAP;
  }
}

export function setSnap(patch: Partial<SnapSettings>) {
  useApp.setState((s) => ({ snap: { ...s.snap, ...patch } }));
  try {
    localStorage.setItem("drawset.snap", JSON.stringify(useApp.getState().snap));
  } catch {
    /* storage unavailable */
  }
}

export const KIND_DEFAULTS: Partial<Record<MarkupKind, Partial<MarkupStyle>>> = {
  highlighter: { color: [1, 0.9, 0], width: 12, opacity: 1 },
  highlight: { color: [1, 0.9, 0], opacity: 1 },
  underline: { color: [0, 0.4, 0.9] },
  strikeout: { color: [0.9, 0.1, 0.1] },
  arrow: { lineEnd: "ClosedArrow" },
  callout: { lineStart: "OpenArrow", color: [0.9, 0.1, 0.1], width: 1, fill: [1, 1, 1] },
  textbox: { color: null, width: 1, fill: null },
  note: { color: [1, 0.82, 0.2] },
  stamp: { color: null },
  image: { color: null },
  length: { color: [0.1, 0.35, 0.85], width: 1, lineStart: "Butt", lineEnd: "Butt", fontSize: 10 },
  polylength: { color: [0.1, 0.35, 0.85], width: 1, lineStart: "None", lineEnd: "None", fontSize: 10 },
  area: { color: [0.1, 0.5, 0.2], fill: [0.78, 0.93, 0.8], opacity: 1, width: 1, fontSize: 10 },
  perimeter: { color: [0.55, 0.2, 0.75], width: 1.5, fontSize: 10 },
  count: { color: [0.9, 0.1, 0.1], width: 1, fontSize: 10 },
  angle: { color: [0.85, 0.45, 0.05], width: 1, fontSize: 10 },
  link: { color: null, width: 1 },
};

export function defaultStyleFor(kind: MarkupKind): MarkupStyle {
  return { ...DEFAULT_STYLE, ...(KIND_DEFAULTS[kind] ?? {}) };
}

function loadAuthor(): string {
  try {
    return localStorage.getItem("drawset.author") || "Drawset user";
  } catch {
    return "Drawset user";
  }
}

export const useApp = create<AppState>(() => ({
  tabs: [],
  active: null,
  tools: { tool: "select", reuse: false, defaults: {}, stampId: "approved", pendingImage: null, chest: null },
  author: loadAuthor(),
  leftPanel: "thumbnails",
  rightPanel: true,
  bottomPanel: false,
  message: null,
  busy: null,
  snap: loadSnap(),
  split: null,
}));

// the focused split pane shows whatever tab becomes active; closed tabs leave the split
useApp.subscribe((s, prev) => {
  const sp = s.split;
  if (!sp) return;
  const keys = new Set(s.tabs.map((t) => t.key));
  if (!keys.has(sp.left) || !keys.has(sp.right)) {
    const left = keys.has(sp.left) ? sp.left : sp.right;
    const right = keys.has(sp.right) ? sp.right : sp.left;
    useApp.setState({ split: keys.has(left) && keys.has(right) && s.tabs.length > 1 && left !== right ? { ...sp, left, right } : null });
    return;
  }
  if (s.active && s.active !== prev.active && s.active !== sp[sp.focus]) useApp.setState({ split: { ...sp, [sp.focus]: s.active } });
});

export function toggleSplit() {
  const s = useApp.getState();
  if (s.split) {
    useApp.setState({ split: null });
    return;
  }
  const a = activeTab(s);
  if (!a) return;
  const other = s.tabs.find((t) => t.key !== a.key) ?? a;
  useApp.setState({ split: { left: a.key, right: other.key, focus: "left", sync: true } });
}

export function focusPane(pane: Pane) {
  const sp = useApp.getState().split;
  if (!sp) return;
  if (sp.focus !== pane) useApp.setState({ split: { ...sp, focus: pane } });
  if (useApp.getState().active !== sp[pane]) useApp.setState({ active: sp[pane] });
}

let tabSeq = 1;
let pageSeq = 1;
export const newPageId = () => `pg${pageSeq++}`;

export function activeTab(s: AppState = useApp.getState()): DocTab | null {
  return s.tabs.find((t) => t.key === s.active) ?? null;
}

export function updateTab(key: string, fn: (t: DocTab) => DocTab) {
  useApp.setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? fn(t) : t)) }));
}

export function pagesFromInfo(info: DocInfo): PageEntry[] {
  return info.pages.map((p) => ({ id: newPageId(), src: p.index, info: p, rotation: 0, scale: p.scale, label: p.label }));
}

/** Converts records read from the engine into markups attached to page entries (by physical index). */
export function recordsToMarkups(records: MarkupRecord[], pages: PageEntry[]): Record<string, Markup> {
  const bySrc = new Map(pages.map((p) => [p.src, p.id]));
  const out: Record<string, Markup> = {};
  for (const r of records) {
    const pageId = bySrc.get(r.pageIndex);
    if (!pageId) continue;
    const { pageIndex: _pageIndex, ...rest } = r;
    let id = rest.id;
    while (out[id]) id = `${rest.id}-${Math.random().toString(36).slice(2, 7)}`;
    out[id] = { ...rest, id, pageId };
  }
  return out;
}

export function addTab(info: DocInfo, name: string, path: string | null): string {
  const key = `tab${tabSeq++}`;
  const pages = pagesFromInfo(info);
  const state: DocState = { pages, markups: {} };
  const tab: DocTab = {
    key,
    docId: info.docId,
    name,
    path,
    info,
    state,
    saved: state,
    undo: [],
    redo: [],
    selection: [],
    pageSelection: [],
    markupsLoaded: false,
    view: { scale: 0.25, rotation: 0, fit: "page" },
    currentPage: 0,
    nav: { back: [], fwd: [] },
    search: { query: "", hits: [], current: -1, running: false, done: false },
    textSelection: null,
    fields: null,
    formFocus: null,
  };
  useApp.setState((s) => ({ tabs: [...s.tabs, tab], active: key }));
  return key;
}

/** Sets the markups read from the file as both current and saved state (no undo entry). */
/**
 * Adds the file's own markups once they have been read. Changes made before that (a page rotated or deleted,
 * a markup drawn) are kept, and every undo and redo step gets the file's markups for the pages it has, so
 * undoing past the load never looks like the file's annotations were deleted. Each markup is one object
 * everywhere, so unchanged annotations are never rewritten on save.
 */
export function setLoadedMarkups(key: string, records: MarkupRecord[]) {
  updateTab(key, (t) => {
    const fileMarkups = recordsToMarkups(records, t.saved.pages);
    const withFile = (s: DocState): DocState => {
      const ids = new Set(s.pages.map((p) => p.id));
      const markups: Record<string, Markup> = {};
      for (const m of Object.values(fileMarkups)) if (ids.has(m.pageId)) markups[m.id] = m;
      return { ...s, markups: { ...markups, ...s.markups } };
    };
    const saved = withFile(t.saved);
    const state = t.state === t.saved ? saved : withFile(t.state);
    const step = (u: { label: string; state: DocState }) => ({ ...u, state: u.state === t.saved ? saved : withFile(u.state) });
    return { ...t, state, saved, undo: t.undo.map(step), redo: t.redo.map(step), markupsLoaded: true };
  });
}

const MAX_UNDO = 200;

let lastCoalesce: { key: string; tag: string; at: number } | null = null;

/**
 * Applies a document change as one undoable step. Changes with the same `coalesce` tag in quick
 * succession (dragging a colour or opacity slider) merge into a single undo step.
 */
export function commit(key: string, label: string, fn: (s: DocState) => DocState, coalesce?: string) {
  updateTab(key, (t) => {
    const next = fn(t.state);
    if (next === t.state) return t;
    const now = Date.now();
    const merge = !!coalesce && !!lastCoalesce && lastCoalesce.key === key && lastCoalesce.tag === coalesce && now - lastCoalesce.at < 1500 && t.undo.length > 0;
    lastCoalesce = coalesce ? { key, tag: coalesce, at: now } : null;
    const undo = merge ? t.undo : [...t.undo, { label, state: t.state }].slice(-MAX_UNDO);
    const markups = next.markups;
    return { ...t, state: next, undo, redo: [], selection: t.selection.filter((id) => markups[id]) };
  });
}

export function undo(key: string) {
  // the next edit starts a new step, even one of the same kind within the coalescing window
  lastCoalesce = null;
  updateTab(key, (t) => {
    const last = t.undo[t.undo.length - 1];
    if (!last) return t;
    return { ...t, state: last.state, undo: t.undo.slice(0, -1), redo: [...t.redo, { label: last.label, state: t.state }], selection: t.selection.filter((id) => last.state.markups[id]) };
  });
}

export function redo(key: string) {
  lastCoalesce = null;
  updateTab(key, (t) => {
    const next = t.redo[t.redo.length - 1];
    if (!next) return t;
    return { ...t, state: next.state, redo: t.redo.slice(0, -1), undo: [...t.undo, { label: next.label, state: t.state }], selection: t.selection.filter((id) => next.state.markups[id]) };
  });
}

export function isDirty(t: DocTab): boolean {
  return t.state !== t.saved;
}

/** Helpers for markup edits inside commit. */
export function withMarkups(s: DocState, changed: Markup[], removed: string[] = []): DocState {
  const markups = { ...s.markups };
  for (const id of removed) delete markups[id];
  for (const m of changed) markups[m.id] = m;
  return { ...s, markups };
}

export function markupsOnPage(s: DocState, pageId: string): Markup[] {
  return Object.values(s.markups).filter((m) => m.pageId === pageId);
}

export function flash(text: string, kind: "info" | "error" = "info") {
  useApp.setState({ message: { text, kind } });
}

export function setAuthor(name: string) {
  const author = name.trim() || "Drawset user";
  try {
    localStorage.setItem("drawset.author", author);
  } catch {
    /* storage unavailable */
  }
  useApp.setState({ author });
}

export function setView(key: string, view: Partial<ViewState>) {
  updateTab(key, (t) => ({ ...t, view: { ...t.view, ...view } }));
}

let scrollNonce = 1;
export function scrollToPage(key: string, page: number, rect?: Rect) {
  updateTab(key, (t) => ({ ...t, currentPage: page, view: { ...t.view, scrollTo: { page, rect, nonce: scrollNonce++ } } }));
}

/** Sets the scale of the given pages; their measurements are recalculated in the same undo step. */
export function setPageScale(key: string, pageIds: string[], scale: PageScale | null) {
  const ids = new Set(pageIds);
  commit(key, pageIds.length > 1 ? `Set scale on ${pageIds.length} pages` : "Set scale", (s) => {
    const pages = s.pages.map((p) => (ids.has(p.id) ? { ...p, scale } : p));
    const changed = Object.values(s.markups)
      .filter((m) => ids.has(m.pageId) && isMeasure(m.kind))
      .map((m) => ({ ...m, measure: { cutouts: m.measure?.cutouts ?? [], scale }, modified: new Date().toISOString() }));
    return withMarkups({ ...s, pages }, changed);
  });
}
