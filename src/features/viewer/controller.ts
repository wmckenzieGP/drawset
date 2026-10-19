/**
 * Pointer and keyboard interaction for the viewer: navigation, selection and editing, and every drawing tool.
 * Transient state lives here; document changes go through `commit` so they are undoable.
 */
import { markupFromTool } from "../toolchest/chest";
import { contentIndex, snapPoint, type SnapKind } from "./snap";
import { create } from "zustand";
import { engine } from "../../engine/client";
import { apply, bboxOf, inflate, normRect, quadPoints, rectPoints, snapAngle, snapSquare, type Pt, type Quad, type Rect, dist, rectContains, transformRect } from "../../markup/geometry";
import { markupBounds } from "../../markup/appearance";
import { clickField } from "../forms/forms";
import { openLinkDialog } from "../links/LinkDialog";
import { describeTarget, followLink } from "../links/navigate";
import { canResize, cloneMarkup, hitTest, relinkGroups, scaleBetween, setVertex, translate, vertexHandles, withDerivedRect } from "../../markup/edit";
import { formatDate, KIND_LABELS, newId, nowIso, type Markup, type MarkupKind } from "../../markup/model";
import { changeLive, commit, flash, settleLive, showPanel, updateTab, useApp, usePainter, withGroups, withMarkups, type DocState, type DocTab, type ToolId } from "../../state/store";
import { eraseStrokes, simplifyStroke } from "../../markup/ink";
import { boxMarkup, calloutAt, imageAt, inkMarkup, measureAt, noteAt, signatureAt, stampAt, textBoxAt, textMarkup, vertexMarkup } from "./create";
import { dimensionLine, isMeasure } from "../../markup/measure";
import { paintedStyle } from "../../markup/arrange";
import { useCursor } from "./cursor";
export { useCursor };
import { pageAt, type Layout, type PageLayout } from "./layout";
import { markupsInRect } from "./markupIndex";

/** What a right-click landed on, for the menu it opens. `at` is the page and the point clicked (page space). */
export type ContextTarget =
  | { t: "drawing"; kind: string; points: number }
  | { t: "markup"; at: { pageId: string; pt: Pt }; ids: string[] }
  | { t: "text"; at: { pageId: string; pt: Pt } }
  | { t: "page"; at: { pageId: string; pt: Pt }; index: number };

export const useInteraction = create<{ editingId: string | null; cursor: string; spaceDown: boolean; title: string }>(() => ({ editingId: null, cursor: "default", spaceDown: false, title: "" }));

export interface ViewerHost {
  tab(): DocTab | null;
  layout(): Layout;
  scrollEl(): HTMLElement | null;
  redraw(): void;
  zoomToRect(page: PageLayout, r: Rect): void;
  zoomBy(factor: number, clientX: number, clientY: number): void;
  /** Scrolls to (`left`, `top`) while dragging the view, past the pages' edges if need be; returns how far the content moved to make room. */
  panTo(left: number, top: number): [number, number];
  /** The drag is over: drops room around the pages that is no longer in view. */
  panEnd(): void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const HANDLE_PX = 9;

type DragState =
  | { t: "idle" }
  | { t: "pan"; sx: number; sy: number; left: number; top: number; button: number }
  | { t: "marquee"; page: PageLayout; a: Pt; b: Pt; additive: boolean }
  | { t: "move"; page: PageLayout; start: Pt; last: Pt; originals: Markup[]; moved: boolean; at?: Pt; copy?: { toggle: string } }
  | { t: "resize"; page: PageLayout; original: Markup; handle: Handle; frame: Rect; current: Markup }
  | { t: "vertex"; page: PageLayout; original: Markup; index: number; current: Markup }
  | { t: "box"; kind: MarkupKind | "zoom" | "labelregion" | "cloudplus"; page: PageLayout; a: Pt; b: Pt; moved: boolean }
  | { t: "line"; kind: "line" | "arrow" | "length" | "calibrate" | "radius" | "diameter"; page: PageLayout; a: Pt; b: Pt }
  /** `plus`: the cloud a Cloud+ callout belongs to; the text is placed with a click after the cloud is drawn. */
  | { t: "callout"; page: PageLayout; tip: Pt; b: Pt; plus?: Markup }
  | { t: "ink"; kind: "pen" | "highlighter"; page: PageLayout; pts: Pt[]; startedAt: number }
  | { t: "inkErase"; page: PageLayout; last: Pt; before: DocState }
  | { t: "poly"; kind: PolyKind; page: PageLayout; pts: Pt[]; cursor: Pt; downAt: Pt | null }
  | { t: "textsel"; kind: "text" | "highlight" | "underline" | "strikeout"; page: PageLayout; a: Pt; b: Pt; quads: Quad[]; text: string; seq: number };

type PolyKind = "polyline" | "polygon" | "cloud" | "polylength" | "area" | "perimeter" | "count" | "angle" | "cutout" | "arc" | "dimension" | "volume";
const POLY_TOOLS = new Set<ToolId>(["arc", "dimension", "volume", "polyline", "polygon", "cloud", "polylength", "area", "perimeter", "count", "angle", "cutout"]);

/** Where calibration picks go: the dialog listens. */
/** The title-block region drawn for labelling pages, waiting for the dialog. */
export const useLabelRegionPick = create<{ pick: { pageId: string; rect: Rect } | null }>(() => ({ pick: null }));

export const useCalibrationPick = create<{ pick: { pageId: string; a: Pt; b: Pt } | null }>(() => ({ pick: null }));

/** Tools whose points snap. Freehand, text and zoom tools do not. */
const SNAP_TOOLS = new Set<ToolId>(["rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "textbox", "callout", "note", "stamp", "image", "length", "polylength", "area", "perimeter", "count", "angle", "calibrate", "cutout", "redact", "erase", "chest", "link", "cloudplus", "arc", "dimension", "volume", "radius", "diameter"]);
const BOX_TOOLS = new Set<ToolId>(["rectangle", "ellipse", "textbox", "stamp", "image", "signature", "zoom", "redact", "erase", "labelregion", "link", "cloudplus"]);
/** Tools that place a ready-made markup: it follows the pointer until the click that places it. */
const GHOST_TOOLS = new Set<ToolId>(["stamp", "signature"]);
const TEXT_TOOLS = new Set<ToolId>(["text", "highlight", "underline", "strikeout"]);
/** A pen stroke started within this long of the last one joins the same markup. */
export const INK_JOIN_MS = 1500;
/** The ink eraser's radius in screen pixels. */
const ERASER_PX = 8;

export class Controller {
  drag: DragState = { t: "idle" };
  private selSeq = 0;
  hoverHandle: string | null = null;

  constructor(private host: ViewerHost) {}

  private get tool(): ToolId {
    return useApp.getState().tools.tool;
  }

  contentPoint(e: { clientX: number; clientY: number }): Pt {
    const el = this.host.scrollEl()!;
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left + el.scrollLeft, e.clientY - r.top + el.scrollTop];
  }

  toPage(page: PageLayout, c: Pt): Pt {
    return apply(page.inv, [c[0] - page.x, c[1] - page.y]);
  }

  /** Page-space tolerance for a number of screen pixels. */
  tol(page: PageLayout, px: number): number {
    return px / Math.hypot(page.m[0], page.m[1]);
  }

  /** What the pointer last snapped to, drawn as a marker. */
  snapMark: { pageId: string; pt: Pt; kind: SnapKind } | null = null;

  /** `p` snapped to markups, the drawing or the grid (as switched on); Alt held turns snapping off. */
  snapAt(page: PageLayout, p: Pt, e: { altKey?: boolean }, exclude?: string): Pt {
    this.snapMark = null;
    const s = useApp.getState().snap;
    const tab = this.host.tab();
    if (!tab || e.altKey || (!s.markups && !s.content && !s.grid)) return p;
    const tol = this.tol(page, 8);
    const markups = s.markups ? markupsInRect(tab.state.markups, page.entry.id, [p[0] - tol, p[1] - tol, p[0] + tol, p[1] + tol]).filter((m) => m.id !== exclude) : null;
    const content = s.content ? contentIndex(tab.docId, page.entry.src, () => this.host.redraw()) : null;
    const b = page.entry.info.bounds;
    const hit = snapPoint(p, tol, { markups, content, grid: s.grid ? (s.gridMm * 72) / 25.4 : null, origin: [b[0], b[1]] });
    if (!hit) return p;
    this.snapMark = { pageId: page.entry.id, pt: hit.pt, kind: hit.kind };
    return hit.pt;
  }

  // ---------- selection helpers ----------

  private setSelection(ids: string[]) {
    const tab = this.host.tab();
    if (!tab) return;
    updateTab(tab.key, (t) => ({ ...t, selection: ids }));
  }

  selected(): Markup[] {
    const tab = this.host.tab();
    if (!tab) return [];
    return tab.selection.map((id) => tab.state.markups[id]).filter(Boolean);
  }

  /** Handles of the single selected, unlocked markup, in content coordinates. */
  handles(): { id: string; pos: Pt; kind: "resize" | "vertex"; index?: number; handle?: Handle; page: PageLayout; m: Markup }[] {
    const sel = this.selected();
    if (sel.length !== 1 || sel[0].locked) return [];
    const m = this.liveMarkup(sel[0]);
    const page = this.host.layout().pages.find((p) => p.entry.id === m.pageId);
    if (!page) return [];
    const toContent = (p: Pt): Pt => {
      const d = apply(page.m, p);
      return [d[0] + page.x, d[1] + page.y];
    };
    const out: ReturnType<Controller["handles"]> = [];
    if (canResize(m)) {
      const r = m.rect;
      const pts: Record<Handle, Pt> = {
        nw: [r[0], r[1]],
        n: [(r[0] + r[2]) / 2, r[1]],
        ne: [r[2], r[1]],
        e: [r[2], (r[1] + r[3]) / 2],
        se: [r[2], r[3]],
        s: [(r[0] + r[2]) / 2, r[3]],
        sw: [r[0], r[3]],
        w: [r[0], (r[1] + r[3]) / 2],
      };
      for (const h of HANDLES) out.push({ id: `r-${h}`, pos: toContent(pts[h]), kind: "resize", handle: h, page, m });
    }
    vertexHandles(m).forEach((p, i) => out.push({ id: `v-${i}`, pos: toContent(p), kind: "vertex", index: i, page, m }));
    return out;
  }

  /** The markup as currently being dragged (for drawing), or as stored. */
  liveMarkup(m: Markup): Markup {
    const d = this.drag;
    if ((d.t === "resize" || d.t === "vertex") && d.original.id === m.id) return d.current;
    if (d.t === "move" && d.moved && !d.copy) {
      const o = d.originals.find((x) => x.id === m.id);
      if (o) return translate(o, d.last[0] - d.start[0], d.last[1] - d.start[1]);
    }
    return m;
  }

  /** In-progress markup to draw as a preview. */
  preview(): { page: PageLayout; m: Markup; with?: Markup[] } | null {
    const d = this.drag;
    switch (d.t) {
      case "idle": {
        // a stamp or signature waiting to be placed follows the pointer, faintly
        if (!GHOST_TOOLS.has(this.tool)) return null;
        const c = useCursor.getState();
        const page = c.pt && c.tabKey === this.host.tab()?.key ? this.host.layout().pages.find((pl) => pl.entry.id === c.pageId) : undefined;
        if (!page || !c.pt) return null;
        const m = this.tool === "stamp" ? stampAt(page.entry.id, c.pt, null) : signatureAt(page.entry.id, c.pt, null);
        return m ? { page, m: { ...m, style: { ...m.style, opacity: m.style.opacity * 0.55 } } } : null;
      }
      case "move":
        // a copy being dragged shows where it will go; the original stays put
        return d.copy && d.moved && d.originals[0] ? { page: d.page, m: translate(d.originals[0], d.last[0] - d.start[0], d.last[1] - d.start[1]) } : null;
      case "box": {
        if (!d.moved || d.kind === "zoom" || d.kind === "labelregion") return null;
        if (d.kind === "stamp") return { page: d.page, m: stampAt(d.page.entry.id, d.a, d.b) };
        if (d.kind === "image" || d.kind === "signature") {
          const m = d.kind === "image" ? imageAt(d.page.entry.id, d.a, d.b) : signatureAt(d.page.entry.id, d.a, d.b);
          return m ? { page: d.page, m } : null;
        }
        if (d.kind === "textbox") return { page: d.page, m: textBoxAt(d.page.entry.id, d.a, d.b) };
        if (d.kind === "cloud" || d.kind === "cloudplus") {
          const r = normRect([d.a[0], d.a[1], d.b[0], d.b[1]]);
          return { page: d.page, m: vertexMarkup("cloud", d.page.entry.id, rectPoints(r)) };
        }
        return { page: d.page, m: boxMarkup(d.kind, d.page.entry.id, d.a, d.b) };
      }
      case "line":
        if (d.kind === "length" || d.kind === "radius" || d.kind === "diameter") return { page: d.page, m: measureAt(d.kind, d.page.entry, [d.a, d.b]) };
        if (d.kind === "calibrate") return { page: d.page, m: { ...vertexMarkup("line", d.page.entry.id, [d.a, d.b]), style: { ...vertexMarkup("line", d.page.entry.id, [d.a, d.b]).style, color: [1, 0.3, 0], lineStart: "Butt", lineEnd: "Butt", dash: [4, 3] } } };
        return { page: d.page, m: vertexMarkup(d.kind, d.page.entry.id, [d.a, d.b]) };
      case "callout":
        return { page: d.page, m: calloutAt(d.page.entry.id, d.tip, d.b), with: d.plus ? [d.plus] : undefined };
      case "ink":
        return { page: d.page, m: inkMarkup(d.kind, d.page.entry.id, d.pts) };
      case "poly": {
        const pts = d.kind === "count" ? d.pts : [...d.pts, d.cursor];
        if (d.kind === "cutout") return { page: d.page, m: { ...vertexMarkup("polygon", d.page.entry.id, pts), style: { ...vertexMarkup("polygon", d.page.entry.id, pts).style, color: [0.1, 0.55, 0.25], dash: [4, 3], fill: null } } };
        if (isMeasure(d.kind)) return { page: d.page, m: measureAt(d.kind, d.page.entry, pts) };
        return { page: d.page, m: vertexMarkup(d.kind, d.page.entry.id, pts) };
      }
      case "textsel":
        if (d.kind === "text" || !d.quads.length) return null;
        return { page: d.page, m: textMarkup(d.kind, d.page.entry.id, d.quads, d.text) };
    }
    return null;
  }

  marquee(): { page: PageLayout; r: Rect } | null {
    const d = this.drag;
    if (d.t === "marquee") return { page: d.page, r: normRect([d.a[0], d.a[1], d.b[0], d.b[1]]) };
    if (d.t === "box" && (d.kind === "zoom" || d.kind === "labelregion") && d.moved) return { page: d.page, r: normRect([d.a[0], d.a[1], d.b[0], d.b[1]]) };
    return null;
  }

  textSelectionPreview(): { page: PageLayout; quads: Quad[] } | null {
    const d = this.drag;
    return d.t === "textsel" && d.kind === "text" ? { page: d.page, quads: d.quads } : null;
  }

  // ---------- creating ----------

  /** The freehand markup the last stroke went into, and when that stroke ended. */
  private lastInk: { m: Markup; at: number } | null = null;

  /**
   * Adds a pen or highlighter stroke. A stroke started soon after the last one (on the same page, with the same
   * tool) joins that markup, so handwriting and sketches stay one markup; each stroke still undoes on its own.
   * Freehand tools stay in hand until Esc or another tool.
   */
  private addStroke(tab: DocTab, d: Extract<DragState, { t: "ink" }>) {
    const pageId = d.page.entry.id;
    // a click makes a dot
    const pts = d.pts.length > 1 ? simplifyStroke(d.pts, this.tol(d.page, 0.35)) : [d.pts[0], [d.pts[0][0] + 0.01, d.pts[0][1]] as Pt];
    const prev = this.lastInk;
    const current = prev ? tab.state.markups[prev.m.id] : undefined;
    if (prev && current === prev.m && current.kind === d.kind && current.pageId === pageId && d.startedAt - prev.at < INK_JOIN_MS) {
      const m = { ...current, inks: [...current.inks, pts], rect: bboxOf([...current.inks.flat(), ...pts]), modified: nowIso() };
      commit(tab.key, `Add ${KIND_LABELS[d.kind].toLowerCase()} stroke`, (s) => withMarkups(s, [m]));
      this.lastInk = { m, at: performance.now() };
      return;
    }
    const m = inkMarkup(d.kind, pageId, pts);
    commit(tab.key, `Add ${KIND_LABELS[d.kind]}`, (s) => withMarkups(s, [m]));
    this.lastInk = { m, at: performance.now() };
  }

  /** Rubs out freehand strokes along the eraser's path to `p`. */
  private eraseTo(page: PageLayout, p: Pt) {
    const tab = this.host.tab();
    const d = this.drag;
    if (!tab || d.t !== "inkErase") return;
    const from = d.last;
    d.last = p;
    const r = this.tol(page, ERASER_PX);
    const near = markupsInRect(tab.state.markups, page.entry.id, inflate(bboxOf([from, p]), r + 50));
    const { changed, removed } = eraseStrokes(near, from, p, r);
    if (changed.length || removed.length) changeLive(tab.key, (s) => withMarkups(s, changed, removed));
  }

  /** The eraser's outline under the pointer (page space), drawn by the overlay. */
  eraserRing(): { pageId: string; pt: Pt; r: number } | null {
    if (this.tool !== "inkEraser") return null;
    const c = useCursor.getState();
    const page = c.pageId ? this.host.layout().pages.find((pl) => pl.entry.id === c.pageId) : undefined;
    return page && c.pt && c.tabKey === this.host.tab()?.key ? { pageId: page.entry.id, pt: c.pt, r: this.tol(page, ERASER_PX) } : null;
  }

  private finishCreate(m: Markup, label?: string, edit = true, others: Markup[] = []) {
    const tab = this.host.tab();
    if (!tab) return;
    commit(tab.key, `Add ${label ?? KIND_LABELS[m.kind]}`, (s) => withMarkups(s, [...others, m]));
    this.setSelection([...others.map((x) => x.id), m.id]);
    if (edit && (m.kind === "textbox" || m.kind === "callout")) useInteraction.setState({ editingId: m.id });
    if (!useApp.getState().tools.reuse) useApp.setState((s) => ({ tools: { ...s.tools, tool: "select", chest: null } }));
  }

  // ---------- pointer events ----------

  pointerDown(e: PointerEvent) {
    const tab = this.host.tab();
    if (!tab) return;
    const c = this.contentPoint(e);
    const el = this.host.scrollEl()!;
    const tool = this.tool;
    if (e.button === 1 || (e.button === 0 && (useInteraction.getState().spaceDown || tool === "pan"))) {
      this.drag = { t: "pan", sx: e.clientX, sy: e.clientY, left: el.scrollLeft, top: el.scrollTop, button: e.button };
      useInteraction.setState({ cursor: "grabbing" });
      return;
    }
    if (e.button !== 0) return;
    if (useInteraction.getState().editingId) return;
    // placing a Cloud+ text: the click's release places it
    if (this.drag.t === "callout" && this.drag.plus) return;
    const page = pageAt(this.host.layout(), c[0], c[1]);

    if (this.drag.t === "poly") {
      // click adds a vertex (double-click finishes)
      if (page && page.entry.id === this.drag.page.entry.id) {
        let p = this.toPage(page, c);
        if (e.shiftKey && this.drag.pts.length) p = snapAngle(this.drag.pts[this.drag.pts.length - 1], p);
        else p = this.snapAt(page, p, e);
        this.drag.pts.push(p);
        this.drag.cursor = p;
        this.drag.downAt = p;
        // three-click tools finish on the third click
        if ((this.drag.kind === "angle" || this.drag.kind === "arc" || this.drag.kind === "dimension") && this.drag.pts.length >= 3) {
          this.finishPoly();
          return;
        }
      }
      this.host.redraw();
      return;
    }

    if (tool === "select") {
      // handles first
      for (const h of this.handles()) {
        if (Math.abs(h.pos[0] - c[0]) <= HANDLE_PX && Math.abs(h.pos[1] - c[1]) <= HANDLE_PX) {
          if (h.kind === "resize") this.drag = { t: "resize", page: h.page, original: h.m, handle: h.handle!, frame: h.m.rect, current: h.m };
          else this.drag = { t: "vertex", page: h.page, original: h.m, index: h.index!, current: h.m };
          return;
        }
      }
      let target = page;
      let hit = page ? this.hitAt(tab, page, this.toPage(page, c)) : null;
      if (!hit) {
        // a markup hanging off its own page, or lying beside it, is picked where it is drawn
        const stray = this.strayHit(tab, c);
        if (stray) [target, hit] = [stray.page, stray.hit];
      }
      if (!target) {
        this.setSelection([]);
        return;
      }
      const p = this.toPage(target, c);
      // a plain click follows a link; Shift or Ctrl selects it (or use the Link tool to move and resize links)
      if (hit?.kind === "link" && hit.link && !e.shiftKey && !e.ctrlKey && !e.metaKey && !tab.selection.includes(hit.id)) {
        void followLink(tab, hit.link);
        return;
      }
      if (hit) {
        let sel = tab.selection;
        // grouped markups are picked together
        const group = withGroups(tab.state.markups, [hit.id]);
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+drag copies (Ctrl+Shift+drag in a straight line); a Ctrl+click without moving adds or removes it
          const ids = sel.includes(hit.id) ? sel : [...sel, ...group.filter((id) => !sel.includes(id))];
          const originals = ids.map((id) => tab.state.markups[id]).filter((m) => m && m.kind !== "foreign" && m.pageId === target.entry.id);
          this.drag = { t: "move", page: target, start: p, last: p, originals, moved: false, copy: { toggle: hit.id } };
          return;
        }
        if (e.shiftKey) {
          sel = sel.includes(hit.id) ? sel.filter((x) => !group.includes(x)) : [...sel, ...group.filter((id) => !sel.includes(id))];
          this.setSelection(sel);
          return;
        }
        if (!sel.includes(hit.id)) {
          sel = group;
          this.setSelection(sel);
        }
        const originals = sel.map((id) => tab.state.markups[id]).filter((m) => m && !m.locked && m.pageId === target.entry.id);
        this.drag = { t: "move", page: target, start: p, last: p, originals, moved: false };
        return;
      }
      if (!e.shiftKey && !e.ctrlKey && tab.fields?.length && clickField(tab, target.entry.src, p)) return;
      this.drag = { t: "marquee", page: target, a: p, b: p, additive: e.shiftKey || e.ctrlKey };
      if (!this.drag.additive) this.setSelection([]);
      return;
    }

    if (!page) return;
    const raw = this.toPage(page, c);
    if (tool === "painter") {
      // the format painter: each click copies the source's format onto the markup clicked
      const src = usePainter.getState().source;
      const hit = this.hitAt(tab, page, raw);
      if (src && hit && hit.id !== src.id && !hit.locked && hit.kind !== "foreign") {
        commit(tab.key, "Format painter", (s) => withMarkups(s, [{ ...hit, style: paintedStyle(src, hit), modified: nowIso() }]));
        if (!useApp.getState().tools.reuse) useApp.setState((s) => ({ tools: { ...s.tools, tool: "select" } }));
      }
      return;
    }
    if (tool === "link") {
      // with the Link tool, existing links are selected and moved instead of followed
      const hit = this.hitAt(tab, page, raw);
      if (hit?.kind === "link") {
        if (!tab.selection.includes(hit.id)) this.setSelection([hit.id]);
        this.drag = { t: "move", page, start: raw, last: raw, originals: hit.locked ? [] : [hit], moved: false };
        return;
      }
    }
    const p = SNAP_TOOLS.has(tool) ? this.snapAt(page, raw, e) : raw;
    if (BOX_TOOLS.has(tool)) {
      this.drag = { t: "box", kind: tool as MarkupKind | "zoom" | "labelregion" | "cloudplus", page, a: p, b: p, moved: false };
    } else if (tool === "line" || tool === "arrow" || tool === "length" || tool === "calibrate" || tool === "radius" || tool === "diameter") {
      this.drag = { t: "line", kind: tool, page, a: p, b: p };
    } else if (tool === "callout") {
      this.drag = { t: "callout", page, tip: p, b: p };
    } else if (tool === "pen" || tool === "highlighter") {
      this.drag = { t: "ink", kind: tool, page, pts: [p], startedAt: performance.now() };
      if (tab.selection.length) this.setSelection([]);
    } else if (tool === "inkEraser") {
      this.drag = { t: "inkErase", page, last: p, before: tab.state };
      this.eraseTo(page, p);
    } else if (POLY_TOOLS.has(tool)) {
      if (tool === "cutout" && !this.cutoutTarget(tab, page.entry.id)) {
        flash("Select an area measurement on this page first, then draw the cutout inside it.", "error");
        return;
      }
      this.drag = { t: "poly", kind: tool as PolyKind, page, pts: [p], cursor: p, downAt: p };
    } else if (tool === "note") {
      this.finishCreate(noteAt(page.entry.id, p));
    } else if (tool === "chest") {
      const chest = useApp.getState().tools.chest;
      if (chest) this.finishCreate(markupFromTool(chest, page.entry, p, useApp.getState().author), chest.name, false);
    } else if (TEXT_TOOLS.has(tool)) {
      this.drag = { t: "textsel", kind: tool as "text", page, a: p, b: p, quads: [], text: "", seq: ++this.selSeq };
      if (tool === "text") updateTab(tab.key, (t) => ({ ...t, textSelection: null }));
    }
    this.host.redraw();
  }

  private hitAt(tab: DocTab, page: PageLayout, p: Pt): Markup | null {
    const tol = this.tol(page, 4);
    const cands = markupsInRect(tab.state.markups, page.entry.id, [p[0] - tol, p[1] - tol, p[0] + tol, p[1] + tol]);
    for (let i = cands.length - 1; i >= 0; i--) if (hitTest(cands[i], p, tol)) return cands[i];
    return null;
  }

  /** A markup outside its own page's box under the pointer (hanging off the page or over the next one), on a page near the pointer. */
  private strayHit(tab: DocTab, c: Pt): { page: PageLayout; hit: Markup } | null {
    const pages = this.host.layout().pages;
    const near = pages.filter((pl) => c[1] >= pl.y - pl.h && c[1] <= pl.y + 2 * pl.h);
    for (const pl of near) {
      const hit = this.hitAt(tab, pl, this.toPage(pl, c));
      if (hit) return { page: pl, hit };
    }
    return null;
  }

  /**
   * Where moved markups land. Dropped on another page, they go onto that page at the same spot on screen;
   * otherwise they stay on their own page. Either way they may hang off the page's edge or over the next page.
   */
  private placeMoved(from: PageLayout, at: Pt | null, ms: Markup[]): Markup[] {
    const target = at ? pageAt(this.host.layout(), at[0], at[1]) : null;
    if (target && target.entry.id !== from.entry.id && ms.every((m) => !m.quads.length)) {
      // the group's centre goes where it was dropped; page units are the same on every page
      const b = ms.map(markupBounds).reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])]);
      const centre: Pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const onScreen = apply(from.m, centre);
      const there = this.toPage(target, [onScreen[0] + from.x, onScreen[1] + from.y]);
      return ms.map((m) => ({ ...translate(m, there[0] - centre[0], there[1] - centre[1]), pageId: target.entry.id }));
    }
    return ms;
  }

  pointerMove(e: PointerEvent) {
    const d = this.drag;
    const el = this.host.scrollEl();
    if (!el) return;
    if (d.t === "pan") {
      // the page follows the pointer every way, past the window's edges too
      const [mx, my] = this.host.panTo(d.left - (e.clientX - d.sx), d.top - (e.clientY - d.sy));
      d.left += mx;
      d.top += my;
      return;
    }
    const c = this.contentPoint(e);
    const under = pageAt(this.host.layout(), c[0], c[1]);
    useCursor.setState(under ? { tabKey: this.host.tab()?.key ?? null, pageId: under.entry.id, pt: this.toPage(under, c) } : { tabKey: null, pageId: null, pt: null });
    if (d.t === "idle") {
      this.updateHover(c);
      // show what a click would snap to
      const had = this.snapMark;
      const page = SNAP_TOOLS.has(this.tool) ? pageAt(this.host.layout(), c[0], c[1]) : null;
      if (page) this.snapAt(page, this.toPage(page, c), e);
      else this.snapMark = null;
      if (had || this.snapMark || this.tool === "inkEraser" || GHOST_TOOLS.has(this.tool)) this.host.redraw();
      return;
    }
    const p = this.toPage(d.page, c);
    switch (d.t) {
      case "marquee":
        d.b = p;
        break;
      case "move":
        d.at = c;
        d.last = e.shiftKey ? snapAngle(d.start, p) : p;
        if (!d.moved && dist(d.start, d.last) > this.tol(d.page, 3)) d.moved = true;
        break;
      case "resize": {
        const f = d.frame;
        let [x0, y0, x1, y1] = f;
        if (d.handle.includes("w")) x0 = p[0];
        if (d.handle.includes("e")) x1 = p[0];
        if (d.handle.includes("n")) y0 = p[1];
        if (d.handle.includes("s")) y1 = p[1];
        if ((e.shiftKey || d.original.kind === "signature") && d.handle.length === 2) {
          const ratio = (f[2] - f[0]) / (f[3] - f[1] || 1);
          const w = Math.abs(x1 - x0);
          const h = w / ratio;
          if (d.handle.includes("n")) y0 = y1 - h;
          else y1 = y0 + h;
        }
        const to = normRect([x0, y0, x1, y1]);
        if (to[2] - to[0] < 2 || to[3] - to[1] < 2) break;
        d.current = d.original.kind === "callout" || d.original.keepAppearance || d.original.kind === "foreign"
          ? { ...d.original, rect: to, modified: nowIso() }
          : scaleBetween(d.original, f, to);
        if (d.original.kind === "callout") d.current = { ...d.original, rect: to, modified: nowIso() };
        break;
      }
      case "vertex": {
        let q: Pt;
        if (e.shiftKey) {
          const pts = d.original.points;
          const anchor = pts[d.index === 0 ? 1 : d.index - 1] ?? pts[0];
          q = snapAngle(anchor, p);
        } else q = this.snapAt(d.page, p, e, d.original.id);
        d.current = setVertex(d.original, d.index, q);
        break;
      }
      case "box":
        d.b = e.shiftKey ? snapSquare(d.a, p) : d.kind === "zoom" || d.kind === "labelregion" ? p : this.snapAt(d.page, p, e);
        if (!d.moved && dist(d.a, d.b) > this.tol(d.page, 3)) d.moved = true;
        break;
      case "line":
        d.b = e.shiftKey ? snapAngle(d.a, p) : this.snapAt(d.page, p, e);
        break;
      case "callout":
        d.b = e.shiftKey ? snapAngle(d.tip, p) : this.snapAt(d.page, p, e);
        // a Cloud+ leader starts on the cloud's edge nearest the text
        if (d.plus) d.tip = nearestOnOutline(d.plus.points, d.b);
        break;
      case "ink": {
        // every position the pointer passed through, not just one per frame, so quick strokes stay smooth
        const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        const min = this.tol(d.page, 0.75);
        for (const ev of evs.length ? evs : [e]) {
          const q = evs.length ? this.toPage(d.page, this.contentPoint(ev)) : p;
          if (dist(d.pts[d.pts.length - 1], q) > min) d.pts.push(q);
        }
        break;
      }
      case "inkErase":
        this.eraseTo(d.page, p);
        break;
      case "poly": {
        const last = d.pts[d.pts.length - 1];
        d.cursor = e.shiftKey ? snapAngle(last, p) : this.snapAt(d.page, p, e);
        // dragging the very first press draws a rectangular cloud instead
        if (d.kind === "cloud" && d.pts.length === 1 && d.downAt && e.buttons === 1 && dist(d.downAt, p) > this.tol(d.page, 6)) {
          this.drag = { t: "box", kind: "cloud", page: d.page, a: d.pts[0], b: p, moved: true };
        }
        break;
      }
      case "textsel":
        d.b = p;
        this.updateTextSelection(d);
        break;
    }
    this.host.redraw();
  }

  private updateTextSelection(d: Extract<DragState, { t: "textsel" }>) {
    const tab = this.host.tab();
    if (!tab) return;
    const seq = ++this.selSeq;
    d.seq = seq;
    engine()
      .selectText(tab.docId, d.page.entry.src, d.a, d.b)
      .then((res) => {
        if (this.drag !== d || d.seq !== seq) return;
        d.quads = res.quads;
        d.text = res.text;
        this.host.redraw();
      })
      .catch(() => undefined);
  }

  private updateHover(c: Pt) {
    const tool = this.tool;
    let cursor = "default";
    let title = "";
    if (useInteraction.getState().spaceDown || tool === "pan") cursor = "grab";
    else if (tool === "zoom") cursor = "zoom-in";
    else if (tool === "painter") cursor = "copy";
    else if (TEXT_TOOLS.has(tool)) cursor = "text";
    else if (tool !== "select") cursor = "crosshair";
    else {
      const h = this.handles().find((x) => Math.abs(x.pos[0] - c[0]) <= HANDLE_PX && Math.abs(x.pos[1] - c[1]) <= HANDLE_PX);
      if (h) cursor = h.kind === "vertex" ? "move" : `${h.handle}-resize`;
      else {
        const tab = this.host.tab();
        const page = pageAt(this.host.layout(), c[0], c[1]);
        // a markup hanging off its page counts too
        const hit = tab ? ((page ? this.hitAt(tab, page, this.toPage(page, c)) : null) ?? this.strayHit(tab, c)?.hit ?? null) : null;
        if (hit?.kind === "link" && hit.link && !tab!.selection.includes(hit.id)) {
          cursor = "pointer";
          title = [hit.contents, describeTarget(tab!, hit.link)].filter(Boolean).join("\n");
        } else if (hit) {
          cursor = hit.locked ? "default" : "move";
          title = hoverText(hit);
        }
      }
    }
    if (useInteraction.getState().cursor !== cursor || useInteraction.getState().title !== title) useInteraction.setState({ cursor, title });
  }

  pointerUp(e: PointerEvent) {
    const d = this.drag;
    const tab = this.host.tab();
    if (d.t === "pan") {
      this.drag = { t: "idle" };
      this.host.panEnd();
      useInteraction.setState({ cursor: this.tool === "pan" || useInteraction.getState().spaceDown ? "grab" : "default" });
      return;
    }
    if (!tab || d.t === "idle" || d.t === "poly") return;
    this.drag = { t: "idle" };
    switch (d.t) {
      case "marquee": {
        const r = normRect([d.a[0], d.a[1], d.b[0], d.b[1]]);
        const inside = markupsInRect(tab.state.markups, d.page.entry.id, r).filter((m) => !m.hidden && rectContains(r, markupBounds(m)));
        const ids = withGroups(tab.state.markups, inside.map((m) => m.id));
        this.setSelection(d.additive ? [...new Set([...tab.selection, ...ids])] : ids);
        break;
      }
      case "move":
        if (d.copy && !d.moved) {
          const id = d.copy.toggle;
          const group = withGroups(tab.state.markups, [id]);
          this.setSelection(tab.selection.includes(id) ? tab.selection.filter((x) => !group.includes(x)) : [...tab.selection, ...group.filter((x) => !tab.selection.includes(x))]);
          break;
        }
        if (d.copy && d.originals.length) {
          const author = useApp.getState().author;
          const copies = relinkGroups(d.originals, d.originals.map((m) => cloneMarkup(m, newId(), m.pageId, 0, 0, author)));
          const placed = this.placeMoved(d.page, d.at ?? null, copies.map((m) => translate(m, d.last[0] - d.start[0], d.last[1] - d.start[1])));
          commit(tab.key, placed.length > 1 ? "Copy markups" : "Copy markup", (s) => withMarkups(s, placed));
          this.setSelection(placed.map((m) => m.id));
          break;
        }
        if (d.moved && d.originals.length) {
          const moved = this.placeMoved(d.page, d.at ?? null, d.originals.map((m) => translate(m, d.last[0] - d.start[0], d.last[1] - d.start[1])));
          commit(tab.key, d.originals.length > 1 ? "Move markups" : "Move markup", (s) => withMarkups(s, moved));
        }
        break;
      case "resize":
        if (d.current !== d.original) commit(tab.key, "Resize markup", (s) => withMarkups(s, [d.current]));
        break;
      case "vertex":
        if (d.current !== d.original) commit(tab.key, "Edit vertex", (s) => withMarkups(s, [d.current]));
        break;
      case "box": {
        const pid = d.page.entry.id;
        if (d.kind === "labelregion") {
          if (d.moved) useLabelRegionPick.setState({ pick: { pageId: pid, rect: normRect([d.a[0], d.a[1], d.b[0], d.b[1]]) } });
          useApp.setState((s) => ({ tools: { ...s.tools, tool: "select", chest: null } }));
          break;
        }
        if (d.kind === "link") {
          if (d.moved) openLinkDialog({ pageId: pid, rect: normRect([d.a[0], d.a[1], d.b[0], d.b[1]]) });
          break;
        }
        if (d.kind === "zoom") {
          if (d.moved) this.host.zoomToRect(d.page, normRect([d.a[0], d.a[1], d.b[0], d.b[1]]));
          else this.host.zoomBy(e.altKey ? 0.5 : 2, e.clientX, e.clientY);
          break;
        }
        if (d.kind === "textbox") {
          this.finishCreate(textBoxAt(pid, d.a, d.moved ? d.b : null));
          break;
        }
        if (d.kind === "stamp") {
          this.finishCreate(stampAt(pid, d.a, d.moved ? d.b : null));
          break;
        }
        if (d.kind === "image") {
          const m = imageAt(pid, d.a, d.moved ? d.b : null);
          if (m) this.finishCreate(m);
          break;
        }
        if (d.kind === "signature") {
          const m = signatureAt(pid, d.a, d.moved ? d.b : null);
          if (m) this.finishCreate(m);
          break;
        }
        if (!d.moved) break;
        if (d.kind === "cloudplus") {
          // now place the text: the leader follows the pointer until the next click
          const cloud = vertexMarkup("cloud", pid, rectPoints(normRect([d.a[0], d.a[1], d.b[0], d.b[1]])));
          const at: Pt = [Math.max(d.a[0], d.b[0]) + 30, Math.min(d.a[1], d.b[1]) - 30];
          this.drag = { t: "callout", page: d.page, tip: nearestOnOutline(cloud.points, at), b: at, plus: cloud };
          break;
        }
        if (d.kind === "cloud") this.finishCreate(vertexMarkup("cloud", pid, rectPoints(normRect([d.a[0], d.a[1], d.b[0], d.b[1]]))));
        else this.finishCreate(boxMarkup(d.kind, pid, d.a, d.b));
        break;
      }
      case "line":
        if (dist(d.a, d.b) <= this.tol(d.page, 3)) break;
        if (d.kind === "calibrate") useCalibrationPick.setState({ pick: { pageId: d.page.entry.id, a: d.a, b: d.b } });
        else if (d.kind === "length" || d.kind === "radius" || d.kind === "diameter") this.finishCreate(measureAt(d.kind, d.page.entry, [d.a, d.b]));
        else this.finishCreate(vertexMarkup(d.kind, d.page.entry.id, [d.a, d.b]));
        break;
      case "callout": {
        const callout = calloutAt(d.page.entry.id, d.tip, dist(d.tip, d.b) > this.tol(d.page, 6) ? d.b : [d.tip[0] + 40, d.tip[1] - 40]);
        if (d.plus) this.finishCreate({ ...callout, group: d.plus.id }, "Cloud+", true, [d.plus]);
        else this.finishCreate(callout);
        break;
      }
      case "ink":
        this.addStroke(tab, d);
        break;
      case "inkErase":
        settleLive(tab.key, "Erase strokes", d.before);
        break;
      case "textsel":
        if (d.kind === "text") {
          updateTab(tab.key, (t) => ({ ...t, textSelection: d.quads.length ? { pageId: d.page.entry.id, quads: d.quads, text: d.text } : null }));
        } else {
          // final selection may still be in flight: ask once more for the exact range
          engine()
            .selectText(tab.docId, d.page.entry.src, d.a, d.b)
            .then((res) => {
              // text selection runs in reading order, so a drag over empty space can still pick up text elsewhere on the page
              const box = normRect([d.a[0], d.a[1], d.b[0], d.b[1]]);
              const near = (q: Quad) => Math.min(q[0], q[2], q[4], q[6]) <= box[2] + 2 && Math.max(q[0], q[2], q[4], q[6]) >= box[0] - 2 && Math.min(q[1], q[3], q[5], q[7]) <= box[3] + 2 && Math.max(q[1], q[3], q[5], q[7]) >= box[1] - 2;
              const onText = res.quads.some(near);
              if (res.quads.length && (onText || d.kind !== "highlight")) this.finishCreate(textMarkup(d.kind as "highlight", d.page.entry.id, res.quads, res.text));
              else if (d.kind === "highlight" && dist(d.a, d.b) > this.tol(d.page, 6)) {
                // away from text the highlight tool paints the dragged band, like a highlighter pen
                const y = (d.a[1] + d.b[1]) / 2;
                const ink = inkMarkup("highlighter", d.page.entry.id, [[Math.min(d.a[0], d.b[0]), y], [Math.max(d.a[0], d.b[0]), y]]);
                this.finishCreate({ ...ink, style: { ...ink.style, width: Math.max(4, Math.abs(d.b[1] - d.a[1])) } }, "Highlight");
              }
            })
            .catch(() => undefined);
        }
        break;
    }
    this.host.redraw();
  }

  /**
   * A right-click: a markup is selected (with its group, or the selection it is part of) and gets the markup menu;
   * selected PDF text gets the text menu; the bare page gets the page menu. Mid-way through a polyline or polygon
   * the menu finishes or steps back.
   */
  contextMenu(e: MouseEvent): ContextTarget | null {
    const tab = this.host.tab();
    if (!tab || useInteraction.getState().editingId) return null;
    const d = this.drag;
    if (d.t === "poly") return { t: "drawing", kind: d.kind, points: d.pts.length };
    if (d.t !== "idle") return null;
    const c = this.contentPoint(e);
    let page = pageAt(this.host.layout(), c[0], c[1]);
    let hit = page ? this.hitAt(tab, page, this.toPage(page, c)) : null;
    if (!hit) {
      const stray = this.strayHit(tab, c);
      if (stray) [page, hit] = [stray.page, stray.hit];
    }
    if (!page) return null;
    const pt = this.toPage(page, c);
    const at = { pageId: page.entry.id, pt };
    if (hit) {
      const ids = tab.selection.includes(hit.id) ? tab.selection : withGroups(tab.state.markups, [hit.id]);
      this.setSelection(ids);
      return { t: "markup", at, ids };
    }
    const ts = tab.textSelection;
    const tol = this.tol(page, 3);
    if (ts?.text && ts.pageId === page.entry.id && ts.quads.some((q) => inRect(inflate(bboxOf(quadPoints(q)), tol), pt))) return { t: "text", at };
    this.setSelection([]);
    const index = tab.state.pages.findIndex((p) => p.id === page.entry.id);
    if (index >= 0 && index !== tab.currentPage) updateTab(tab.key, (t) => ({ ...t, currentPage: index }));
    return { t: "page", at, index };
  }

  /** The page and point under a dragged-in file. */
  pointAt(e: { clientX: number; clientY: number }): { pageId: string; pt: Pt } | null {
    const c = this.contentPoint(e);
    const page = pageAt(this.host.layout(), c[0], c[1]);
    return page ? { pageId: page.entry.id, pt: this.toPage(page, c) } : null;
  }

  doubleClick(e: MouseEvent) {
    const d = this.drag;
    if (d.t === "poly") {
      this.finishPoly();
      return;
    }
    const tab = this.host.tab();
    if (!tab || this.tool !== "select") return;
    const c = this.contentPoint(e);
    const page = pageAt(this.host.layout(), c[0], c[1]);
    if (!page) return;
    const hit = this.hitAt(tab, page, this.toPage(page, c));
    if (!hit) return;
    if ((hit.kind === "textbox" || hit.kind === "callout") && !hit.locked) {
      this.setSelection([hit.id]);
      useInteraction.setState({ editingId: hit.id });
      return;
    }
    // any other markup: write its comment
    if (hit.kind === "link") return;
    this.setSelection([hit.id]);
    showComment();
  }

  finishPoly() {
    const d = this.drag;
    if (d.t !== "poly") return;
    this.drag = { t: "idle" };
    // a double-click adds the last point twice
    const pts = d.pts.filter((p, i) => i === 0 || dist(p, d.pts[i - 1]) > this.tol(d.page, 2));
    const min = d.kind === "polyline" || d.kind === "polylength" ? 2 : d.kind === "count" ? 1 : 3;
    // a dimension finished early (Enter) sits just off the line
    if (d.kind === "dimension" && pts.length === 2 && dist(pts[0], pts[1]) > 0) {
      const { normal } = dimensionLine(pts);
      pts.push([(pts[0][0] + pts[1][0]) / 2 - normal[0] * 12, (pts[0][1] + pts[1][1]) / 2 - normal[1] * 12]);
    }
    if (pts.length >= min) {
      if (d.kind === "cutout") this.addCutout(d.page.entry.id, pts);
      else if (isMeasure(d.kind)) this.finishCreate(measureAt(d.kind, d.page.entry, pts));
      else this.finishCreate(vertexMarkup(d.kind, d.page.entry.id, pts));
    }
    this.host.redraw();
  }

  /** The selected area measurement on `pageId`, which a cutout is added to. */
  private cutoutTarget(tab: DocTab, pageId: string): Markup | null {
    const sel = tab.selection.map((id) => tab.state.markups[id]).filter((m) => m && m.kind === "area" && m.pageId === pageId && !m.locked);
    return sel.length === 1 ? sel[0] : null;
  }

  private addCutout(pageId: string, pts: Pt[]) {
    const tab = this.host.tab();
    if (!tab) return;
    const target = this.cutoutTarget(tab, pageId);
    if (!target) return;
    const measure = { scale: target.measure?.scale ?? null, cutouts: [...(target.measure?.cutouts ?? []), pts] };
    commit(tab.key, "Add cutout", (s) => withMarkups(s, [{ ...target, measure, modified: nowIso() }]));
    if (!useApp.getState().tools.reuse) useApp.setState((s) => ({ tools: { ...s.tools, tool: "select", chest: null } }));
  }

  /** Drops the shape being drawn (the right-click menu's Cancel). */
  discard() {
    if (this.drag.t === "idle") return;
    this.drag = { t: "idle" };
    this.host.redraw();
  }

  /** Takes back the last point of the polyline or polygon being drawn. */
  removeLastPoint() {
    const d = this.drag;
    if (d.t === "poly" && d.pts.length > 1) {
      d.pts.pop();
      this.host.redraw();
    }
  }

  /**
   * Arrow keys move the selected markups one screen pixel (ten with Shift) in the direction shown on screen,
   * whatever the page's rotation. A run of presses undoes as one step.
   */
  nudge(dx: number, dy: number): boolean {
    const tab = this.host.tab();
    if (!tab) return false;
    const ms = tab.selection.map((id) => tab.state.markups[id]).filter((m) => m && !m.locked);
    const pl = ms.length ? this.host.layout().pages.find((p) => p.entry.id === ms[0].pageId) : undefined;
    if (!pl) return false;
    const o = apply(pl.inv, [0, 0]);
    const v = apply(pl.inv, [dx, dy]);
    const [px, py] = [v[0] - o[0], v[1] - o[1]];
    const moved = ms.filter((m) => m.pageId === pl.entry.id).map((m) => translate(m, px, py));
    commit(tab.key, "Move", (s) => withMarkups(s, moved), "nudge");
    return true;
  }

  cancel() {
    this.lastInk = null;
    // Esc finishes a count (each click is already a counted item)
    if (this.drag.t === "poly" && this.drag.kind === "count") {
      this.finishPoly();
      return true;
    }
    // Esc while placing a Cloud+ text keeps the cloud without it
    if (this.drag.t === "callout" && this.drag.plus) {
      const cloud = this.drag.plus;
      this.drag = { t: "idle" };
      this.finishCreate(cloud, "Cloud");
      this.host.redraw();
      return true;
    }
    if (this.drag.t !== "idle") {
      this.drag = { t: "idle" };
      this.host.redraw();
      return true;
    }
    return false;
  }

  keyDown(e: KeyboardEvent): boolean {
    const d = this.drag;
    if (d.t === "poly") {
      if (e.key === "Enter") {
        this.finishPoly();
        return true;
      }
      if (e.key === "Backspace" && d.pts.length > 1) {
        d.pts.pop();
        this.host.redraw();
        return true;
      }
    }
    if (e.key === "Escape") {
      if (this.cancel()) return true;
      // with nothing being drawn, Esc lets go of the selection
      const tab = this.host.tab();
      if (tab?.selection.length && this.tool === "select") {
        this.setSelection([]);
        return true;
      }
      return false;
    }
    // Enter (or F2) starts typing into a selected text box or callout
    if ((e.key === "Enter" || e.key === "F2") && d.t === "idle" && this.tool === "select") {
      const tab = this.host.tab();
      const m = tab && tab.selection.length === 1 ? tab.state.markups[tab.selection[0]] : undefined;
      if (m && !m.locked && (m.kind === "textbox" || m.kind === "callout")) {
        useInteraction.setState({ editingId: m.id });
        return true;
      }
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir && !e.ctrlKey && !e.metaKey && !e.altKey && d.t === "idle" && this.tool === "select") {
      const step = e.shiftKey ? 10 : 1;
      return this.nudge(dir[0] * step, dir[1] * step);
    }
    return false;
  }

  /** Content-space rectangle of a page-space rect (for the text editor overlay). */
  contentRect(page: PageLayout, r: Rect): Rect {
    const d = transformRect(r, page.m);
    return [d[0] + page.x, d[1] + page.y, d[2] + page.x, d[3] + page.y];
  }

  /** Called when markups change externally (undo) so stale drags are dropped. */
  reset() {
    this.drag = { t: "idle" };
  }
}


export { withDerivedRect };

/** The tooltip over a markup: what it is, who made it, and its comment. */
export function hoverText(m: Markup): string {
  const head = [m.subject || KIND_LABELS[m.kind], m.author, formatDate(m.modified)].filter(Boolean).join(" · ");
  const comment = m.kind === "textbox" || m.kind === "callout" ? "" : m.contents.trim();
  const replies = m.replies.length ? `${m.replies.length} repl${m.replies.length === 1 ? "y" : "ies"}` : "";
  return [head, comment.length > 300 ? comment.slice(0, 300) + "…" : comment, replies].filter(Boolean).join("\n");
}

/** Shows the Properties panel with the cursor in the comment box. */
function showComment() {
  showPanel("properties");
  requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector('[data-testid="prop-comment"]') as HTMLElement | null)?.focus()));
}

const inRect = (r: Rect, p: Pt) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];

/** The point on a closed outline nearest to `p`. */
export function nearestOnOutline(pts: readonly Pt[], p: Pt): Pt {
  let best: Pt = pts[0] ?? p;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const dq = dist(q, p);
    if (dq < bestD) [best, bestD] = [q, dq];
  }
  return best;
}
