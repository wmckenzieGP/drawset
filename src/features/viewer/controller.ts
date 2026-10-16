/**
 * Pointer and keyboard interaction for the viewer: navigation, selection and editing, and every drawing tool.
 * Transient state lives here; document changes go through `commit` so they are undoable.
 */
import { markupFromTool } from "../toolchest/chest";
import { contentIndex, snapPoint, type SnapKind } from "./snap";
import { create } from "zustand";
import { engine } from "../../engine/client";
import { apply, normRect, rectPoints, snapAngle, snapSquare, type Pt, type Quad, type Rect, dist, rectContains, transformRect } from "../../markup/geometry";
import { markupBounds } from "../../markup/appearance";
import { canResize, hitTest, scaleBetween, setVertex, translate, vertexHandles, withDerivedRect } from "../../markup/edit";
import { KIND_LABELS, nowIso, type Markup, type MarkupKind } from "../../markup/model";
import { commit, flash, updateTab, useApp, withMarkups, type DocTab, type ToolId } from "../../state/store";
import { boxMarkup, calloutAt, imageAt, inkMarkup, measureAt, noteAt, stampAt, textBoxAt, textMarkup, vertexMarkup } from "./create";
import { isMeasure } from "../../markup/measure";
import { pageAt, type Layout, type PageLayout } from "./layout";
import { markupsInRect } from "./markupIndex";

export const useInteraction = create<{ editingId: string | null; cursor: string; spaceDown: boolean }>(() => ({ editingId: null, cursor: "default", spaceDown: false }));

export interface ViewerHost {
  tab(): DocTab | null;
  layout(): Layout;
  scrollEl(): HTMLElement | null;
  redraw(): void;
  zoomToRect(page: PageLayout, r: Rect): void;
  zoomBy(factor: number, clientX: number, clientY: number): void;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const HANDLE_PX = 9;

type DragState =
  | { t: "idle" }
  | { t: "pan"; sx: number; sy: number; left: number; top: number; button: number }
  | { t: "marquee"; page: PageLayout; a: Pt; b: Pt; additive: boolean }
  | { t: "move"; page: PageLayout; start: Pt; last: Pt; originals: Markup[]; moved: boolean }
  | { t: "resize"; page: PageLayout; original: Markup; handle: Handle; frame: Rect; current: Markup }
  | { t: "vertex"; page: PageLayout; original: Markup; index: number; current: Markup }
  | { t: "box"; kind: MarkupKind | "zoom" | "labelregion"; page: PageLayout; a: Pt; b: Pt; moved: boolean }
  | { t: "line"; kind: "line" | "arrow" | "length" | "calibrate"; page: PageLayout; a: Pt; b: Pt }
  | { t: "callout"; page: PageLayout; tip: Pt; b: Pt }
  | { t: "ink"; kind: "pen" | "highlighter"; page: PageLayout; pts: Pt[] }
  | { t: "poly"; kind: PolyKind; page: PageLayout; pts: Pt[]; cursor: Pt; downAt: Pt | null }
  | { t: "textsel"; kind: "text" | "highlight" | "underline" | "strikeout"; page: PageLayout; a: Pt; b: Pt; quads: Quad[]; text: string; seq: number };

type PolyKind = "polyline" | "polygon" | "cloud" | "polylength" | "area" | "perimeter" | "count" | "angle" | "cutout";
const POLY_TOOLS = new Set<ToolId>(["polyline", "polygon", "cloud", "polylength", "area", "perimeter", "count", "angle", "cutout"]);

/** Where calibration picks go: the dialog listens. */
/** The title-block region drawn for labelling pages, waiting for the dialog. */
export const useLabelRegionPick = create<{ pick: { pageId: string; rect: Rect } | null }>(() => ({ pick: null }));

export const useCalibrationPick = create<{ pick: { pageId: string; a: Pt; b: Pt } | null }>(() => ({ pick: null }));

/** Tools whose points snap. Freehand, text and zoom tools do not. */
const SNAP_TOOLS = new Set<ToolId>(["rectangle", "ellipse", "line", "arrow", "polyline", "polygon", "cloud", "textbox", "callout", "note", "stamp", "image", "length", "polylength", "area", "perimeter", "count", "angle", "calibrate", "cutout", "redact", "erase", "chest"]);
const BOX_TOOLS = new Set<ToolId>(["rectangle", "ellipse", "textbox", "stamp", "image", "zoom", "redact", "erase", "labelregion"]);
const TEXT_TOOLS = new Set<ToolId>(["text", "highlight", "underline", "strikeout"]);

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
    if (d.t === "move" && d.moved) {
      const o = d.originals.find((x) => x.id === m.id);
      if (o) return translate(o, d.last[0] - d.start[0], d.last[1] - d.start[1]);
    }
    return m;
  }

  /** In-progress markup to draw as a preview. */
  preview(): { page: PageLayout; m: Markup } | null {
    const d = this.drag;
    switch (d.t) {
      case "box": {
        if (!d.moved || d.kind === "zoom" || d.kind === "labelregion") return null;
        if (d.kind === "stamp") return { page: d.page, m: stampAt(d.page.entry.id, d.a, d.b) };
        if (d.kind === "image") {
          const m = imageAt(d.page.entry.id, d.a, d.b);
          return m ? { page: d.page, m } : null;
        }
        if (d.kind === "textbox") return { page: d.page, m: textBoxAt(d.page.entry.id, d.a, d.b) };
        if (d.kind === "cloud") {
          const r = normRect([d.a[0], d.a[1], d.b[0], d.b[1]]);
          return { page: d.page, m: vertexMarkup("cloud", d.page.entry.id, rectPoints(r)) };
        }
        return { page: d.page, m: boxMarkup(d.kind, d.page.entry.id, d.a, d.b) };
      }
      case "line":
        if (d.kind === "length") return { page: d.page, m: measureAt("length", d.page.entry, [d.a, d.b]) };
        if (d.kind === "calibrate") return { page: d.page, m: { ...vertexMarkup("line", d.page.entry.id, [d.a, d.b]), style: { ...vertexMarkup("line", d.page.entry.id, [d.a, d.b]).style, color: [1, 0.3, 0], lineStart: "Butt", lineEnd: "Butt", dash: [4, 3] } } };
        return { page: d.page, m: vertexMarkup(d.kind, d.page.entry.id, [d.a, d.b]) };
      case "callout":
        return { page: d.page, m: calloutAt(d.page.entry.id, d.tip, d.b) };
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

  private finishCreate(m: Markup, label?: string, edit = true) {
    const tab = this.host.tab();
    if (!tab) return;
    commit(tab.key, `Add ${label ?? KIND_LABELS[m.kind]}`, (s) => withMarkups(s, [m]));
    this.setSelection([m.id]);
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
        if (this.drag.kind === "angle" && this.drag.pts.length >= 3) {
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
      if (!page) {
        this.setSelection([]);
        return;
      }
      const p = this.toPage(page, c);
      const hit = this.hitAt(tab, page, p);
      if (hit) {
        let sel = tab.selection;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          sel = sel.includes(hit.id) ? sel.filter((x) => x !== hit.id) : [...sel, hit.id];
          this.setSelection(sel);
          return;
        }
        if (!sel.includes(hit.id)) {
          sel = [hit.id];
          this.setSelection(sel);
        }
        const originals = sel.map((id) => tab.state.markups[id]).filter((m) => m && !m.locked && m.pageId === page.entry.id);
        this.drag = { t: "move", page, start: p, last: p, originals, moved: false };
        return;
      }
      this.drag = { t: "marquee", page, a: p, b: p, additive: e.shiftKey || e.ctrlKey };
      if (!this.drag.additive) this.setSelection([]);
      return;
    }

    if (!page) return;
    const raw = this.toPage(page, c);
    const p = SNAP_TOOLS.has(tool) ? this.snapAt(page, raw, e) : raw;
    if (BOX_TOOLS.has(tool)) {
      this.drag = { t: "box", kind: tool as MarkupKind | "zoom" | "labelregion", page, a: p, b: p, moved: false };
    } else if (tool === "line" || tool === "arrow" || tool === "length" || tool === "calibrate") {
      this.drag = { t: "line", kind: tool, page, a: p, b: p };
    } else if (tool === "callout") {
      this.drag = { t: "callout", page, tip: p, b: p };
    } else if (tool === "pen" || tool === "highlighter") {
      this.drag = { t: "ink", kind: tool, page, pts: [p] };
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

  pointerMove(e: PointerEvent) {
    const d = this.drag;
    const el = this.host.scrollEl();
    if (!el) return;
    if (d.t === "pan") {
      el.scrollLeft = d.left - (e.clientX - d.sx);
      el.scrollTop = d.top - (e.clientY - d.sy);
      return;
    }
    const c = this.contentPoint(e);
    if (d.t === "idle") {
      this.updateHover(c);
      // show what a click would snap to
      const had = this.snapMark;
      const page = SNAP_TOOLS.has(this.tool) ? pageAt(this.host.layout(), c[0], c[1]) : null;
      if (page) this.snapAt(page, this.toPage(page, c), e);
      else this.snapMark = null;
      if (had || this.snapMark) this.host.redraw();
      return;
    }
    const p = this.toPage(d.page, c);
    switch (d.t) {
      case "marquee":
        d.b = p;
        break;
      case "move":
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
        if (e.shiftKey && d.handle.length === 2) {
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
        break;
      case "ink": {
        const last = d.pts[d.pts.length - 1];
        if (dist(last, p) > this.tol(d.page, 1.5)) d.pts.push(p);
        break;
      }
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
    if (useInteraction.getState().spaceDown || tool === "pan") cursor = "grab";
    else if (tool === "zoom") cursor = "zoom-in";
    else if (TEXT_TOOLS.has(tool)) cursor = "text";
    else if (tool !== "select") cursor = "crosshair";
    else {
      const h = this.handles().find((x) => Math.abs(x.pos[0] - c[0]) <= HANDLE_PX && Math.abs(x.pos[1] - c[1]) <= HANDLE_PX);
      if (h) cursor = h.kind === "vertex" ? "move" : `${h.handle}-resize`;
      else {
        const tab = this.host.tab();
        const page = pageAt(this.host.layout(), c[0], c[1]);
        if (tab && page && this.hitAt(tab, page, this.toPage(page, c))) cursor = "move";
      }
    }
    if (useInteraction.getState().cursor !== cursor) useInteraction.setState({ cursor });
  }

  pointerUp(e: PointerEvent) {
    const d = this.drag;
    const tab = this.host.tab();
    if (d.t === "pan") {
      this.drag = { t: "idle" };
      useInteraction.setState({ cursor: this.tool === "pan" || useInteraction.getState().spaceDown ? "grab" : "default" });
      return;
    }
    if (!tab || d.t === "idle" || d.t === "poly") return;
    this.drag = { t: "idle" };
    switch (d.t) {
      case "marquee": {
        const r = normRect([d.a[0], d.a[1], d.b[0], d.b[1]]);
        const inside = markupsInRect(tab.state.markups, d.page.entry.id, r).filter((m) => !m.hidden && rectContains(r, markupBounds(m)));
        const ids = inside.map((m) => m.id);
        this.setSelection(d.additive ? [...new Set([...tab.selection, ...ids])] : ids);
        break;
      }
      case "move":
        if (d.moved && d.originals.length) {
          const dx = d.last[0] - d.start[0];
          const dy = d.last[1] - d.start[1];
          commit(tab.key, d.originals.length > 1 ? "Move markups" : "Move markup", (s) => withMarkups(s, d.originals.map((m) => translate(m, dx, dy))));
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
        if (!d.moved) break;
        if (d.kind === "cloud") this.finishCreate(vertexMarkup("cloud", pid, rectPoints(normRect([d.a[0], d.a[1], d.b[0], d.b[1]]))));
        else this.finishCreate(boxMarkup(d.kind, pid, d.a, d.b));
        break;
      }
      case "line":
        if (dist(d.a, d.b) <= this.tol(d.page, 3)) break;
        if (d.kind === "calibrate") useCalibrationPick.setState({ pick: { pageId: d.page.entry.id, a: d.a, b: d.b } });
        else if (d.kind === "length") this.finishCreate(measureAt("length", d.page.entry, [d.a, d.b]));
        else this.finishCreate(vertexMarkup(d.kind, d.page.entry.id, [d.a, d.b]));
        break;
      case "callout":
        this.finishCreate(calloutAt(d.page.entry.id, d.tip, dist(d.tip, d.b) > this.tol(d.page, 6) ? d.b : [d.tip[0] + 40, d.tip[1] - 40]));
        break;
      case "ink":
        if (d.pts.length > 1) this.finishCreate(inkMarkup(d.kind, d.page.entry.id, d.pts));
        break;
      case "textsel":
        if (d.kind === "text") {
          updateTab(tab.key, (t) => ({ ...t, textSelection: d.quads.length ? { pageId: d.page.entry.id, quads: d.quads, text: d.text } : null }));
        } else {
          // final selection may still be in flight: ask once more for the exact range
          engine()
            .selectText(tab.docId, d.page.entry.src, d.a, d.b)
            .then((res) => {
              if (res.quads.length) this.finishCreate(textMarkup(d.kind as "highlight", d.page.entry.id, res.quads, res.text));
            })
            .catch(() => undefined);
        }
        break;
    }
    this.host.redraw();
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
    if (hit && (hit.kind === "textbox" || hit.kind === "callout") && !hit.locked) {
      this.setSelection([hit.id]);
      useInteraction.setState({ editingId: hit.id });
    }
  }

  finishPoly() {
    const d = this.drag;
    if (d.t !== "poly") return;
    this.drag = { t: "idle" };
    // a double-click adds the last point twice
    const pts = d.pts.filter((p, i) => i === 0 || dist(p, d.pts[i - 1]) > this.tol(d.page, 2));
    const min = d.kind === "polyline" || d.kind === "polylength" ? 2 : d.kind === "count" ? 1 : 3;
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

  cancel() {
    // Esc finishes a count (each click is already a counted item)
    if (this.drag.t === "poly" && this.drag.kind === "count") {
      this.finishPoly();
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
    if (e.key === "Escape") return this.cancel();
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
