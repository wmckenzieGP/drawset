/** Draws markups, selection, handles, previews and search hits on the overlay canvases. */
import { buildAppearance } from "../../markup/appearance";
import { drawAppearance } from "../../markup/draw";
import { type Quad } from "../../markup/geometry";
import type { Markup } from "../../markup/model";
import { engine } from "../../engine/client";
import type { DocTab } from "../../state/store";
import { HANDLE_PX, type Controller } from "./controller";
import { visibleRange, type Layout, type PageLayout } from "./layout";
import { markupsInRect } from "./markupIndex";

// ---- bitmaps for annotations drawn from their own appearance, and for image markups ----
const apBitmaps = new Map<string, ImageBitmap | "pending" | "failed">();
const imageBitmaps = new WeakMap<Uint8Array, ImageBitmap | "pending">();
let onBitmap: (() => void) | null = null;
export function setBitmapListener(fn: () => void) {
  onBitmap = fn;
}
export function invalidateApBitmaps(docId: string) {
  for (const k of [...apBitmaps.keys()]) if (k.startsWith(docId + ":")) apBitmaps.delete(k);
}

function apBitmap(tab: DocTab, page: PageLayout, m: Markup, devScale: number): ImageBitmap | null {
  if (m.objNum === undefined && m.apFrom === undefined) return null;
  const objNum = m.objNum ?? m.apFrom!;
  const bucket = Math.min(8, Math.max(0.25, 2 ** Math.round(Math.log2(devScale))));
  const key = `${tab.docId}:${page.entry.src}:${objNum}:${bucket}`;
  const v = apBitmaps.get(key);
  if (v === "pending" || v === "failed") return null;
  if (v) return v;
  apBitmaps.set(key, "pending");
  engine()
    .renderAnnotation(tab.docId, page.entry.src, objNum, bucket)
    .then((b) => {
      if (b.image) apBitmaps.set(key, b.image);
      onBitmap?.();
    })
    .catch(() => apBitmaps.set(key, "failed"));
  return null;
}

export function markupImage(m: Markup): ImageBitmap | null {
  if (!m.image) return null;
  const v = imageBitmaps.get(m.image.data);
  if (v === "pending") return null;
  if (v) return v;
  imageBitmaps.set(m.image.data, "pending");
  createImageBitmap(new Blob([m.image.data as Uint8Array<ArrayBuffer>], { type: m.image.mime }))
    .then((b) => {
      imageBitmaps.set(m.image!.data, b);
      onBitmap?.();
    })
    .catch(() => undefined);
  return null;
}

function drawMarkup(ctx: CanvasRenderingContext2D, tab: DocTab, page: PageLayout, m: Markup, devScale: number) {
  if (m.hidden) return;
  if (m.kind === "foreign" || m.keepAppearance) {
    const bmp = apBitmap(tab, page, m, devScale);
    if (bmp) {
      ctx.save();
      ctx.globalAlpha = m.kind === "foreign" ? 1 : m.style.opacity;
      ctx.drawImage(bmp, m.rect[0], m.rect[1], m.rect[2] - m.rect[0], m.rect[3] - m.rect[1]);
      ctx.restore();
    }
    return;
  }
  drawAppearance(ctx, buildAppearance(m), markupImage(m));
}

function quadPath(ctx: CanvasRenderingContext2D, q: Quad) {
  ctx.moveTo(q[0], q[1]);
  ctx.lineTo(q[2], q[3]);
  ctx.lineTo(q[6], q[7]);
  ctx.lineTo(q[4], q[5]);
  ctx.closePath();
}

export interface OverlayParams {
  normal: CanvasRenderingContext2D;
  multiply: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  scrollLeft: number;
  scrollTop: number;
  layout: Layout;
  tab: DocTab;
  controller: Controller;
  editingId: string | null;
}

export function drawOverlay(p: OverlayParams) {
  const { normal, multiply, dpr, layout, tab, controller } = p;
  for (const ctx of [normal, multiply]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.width * dpr, p.height * dpr);
  }
  const [first, last] = visibleRange(layout, p.scrollTop, p.scrollTop + p.height);
  const selected = new Set(tab.selection);
  const preview = controller.preview();
  const hits = tab.search.hits;
  for (let i = first; i <= last; i++) {
    const page = layout.pages[i];
    const setT = (ctx: CanvasRenderingContext2D) => {
      const m = page.m;
      const ox = page.x - p.scrollLeft;
      const oy = page.y - p.scrollTop;
      ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, (m[4] + ox) * dpr, (m[5] + oy) * dpr);
    };
    setT(normal);
    setT(multiply);
    const scale = Math.hypot(page.m[0], page.m[1]);
    // visible part of the page in page space, for culling
    const vis = [p.scrollLeft - page.x, p.scrollTop - page.y, p.scrollLeft - page.x + p.width, p.scrollTop - page.y + p.height];
    const inv = page.inv;
    const c1 = [vis[0] * inv[0] + vis[1] * inv[2] + inv[4], vis[0] * inv[1] + vis[1] * inv[3] + inv[5]];
    const c2 = [vis[2] * inv[0] + vis[3] * inv[2] + inv[4], vis[2] * inv[1] + vis[3] * inv[3] + inv[5]];
    const cull: [number, number, number, number] = [Math.min(c1[0], c2[0]) - 50, Math.min(c1[1], c2[1]) - 50, Math.max(c1[0], c2[0]) + 50, Math.max(c1[1], c2[1]) + 50];
    for (const stored of markupsInRect(tab.state.markups, page.entry.id, cull)) {
      const m = controller.liveMarkup(stored);
      if (m.id === p.editingId && (m.kind === "textbox" || m.kind === "callout")) {
        // the editor shows the text; draw the frame only
        drawMarkup(normal, tab, page, { ...m, contents: "" }, scale * dpr);
        continue;
      }
      const ctx = m.kind === "highlight" || m.kind === "highlighter" || m.kind === "area" ? multiply : normal;
      drawMarkup(ctx, tab, page, m, scale * dpr);
    }
    if (preview && preview.page.entry.id === page.entry.id) {
      const ctx = preview.m.kind === "highlight" || preview.m.kind === "highlighter" || preview.m.kind === "area" ? multiply : normal;
      drawMarkup(ctx, tab, page, preview.m, scale * dpr);
    }
    // search hits
    const pageHits = hits.filter((h) => h.page === page.entry.src);
    if (pageHits.length) {
      multiply.save();
      for (const h of pageHits) {
        const isCurrent = tab.search.hits[tab.search.current] === h;
        multiply.fillStyle = isCurrent ? "rgba(255,120,0,0.9)" : "rgba(255,190,60,0.6)";
        multiply.beginPath();
        for (const q of h.quads) quadPath(multiply, q);
        multiply.fill();
      }
      multiply.restore();
    }
    // text selection
    const ts = controller.textSelectionPreview();
    const quads = ts && ts.page.entry.id === page.entry.id ? ts.quads : tab.textSelection && tab.textSelection.pageId === page.entry.id ? tab.textSelection.quads : null;
    if (quads && quads.length) {
      multiply.save();
      multiply.fillStyle = "rgba(80,150,255,0.45)";
      multiply.beginPath();
      for (const q of quads) quadPath(multiply, q);
      multiply.fill();
      multiply.restore();
    }
    // selection outlines (device space for crisp lines)
    for (const id of selected) {
      const stored = tab.state.markups[id];
      if (!stored || stored.pageId !== page.entry.id) continue;
      const m = controller.liveMarkup(stored);
      const b = m.kind === "foreign" || m.keepAppearance ? m.rect : buildAppearance(m).bbox;
      normal.save();
      normal.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pts = [
        [b[0], b[1]],
        [b[2], b[3]],
      ].map(([x, y]) => [x * page.m[0] + y * page.m[2] + page.m[4] + page.x - p.scrollLeft, x * page.m[1] + y * page.m[3] + page.m[5] + page.y - p.scrollTop]);
      const x0 = Math.min(pts[0][0], pts[1][0]) - 3;
      const y0 = Math.min(pts[0][1], pts[1][1]) - 3;
      const x1 = Math.max(pts[0][0], pts[1][0]) + 3;
      const y1 = Math.max(pts[0][1], pts[1][1]) + 3;
      normal.strokeStyle = m.locked ? "rgba(200,120,40,0.95)" : "rgba(40,140,255,0.95)";
      normal.lineWidth = 1;
      normal.setLineDash([4, 3]);
      normal.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
      normal.restore();
    }
    // marquee
    const mq = controller.marquee();
    if (mq && mq.page.entry.id === page.entry.id) {
      normal.save();
      normal.fillStyle = "rgba(40,140,255,0.12)";
      normal.strokeStyle = "rgba(40,140,255,0.9)";
      normal.lineWidth = 1 / scale;
      normal.fillRect(mq.r[0], mq.r[1], mq.r[2] - mq.r[0], mq.r[3] - mq.r[1]);
      normal.strokeRect(mq.r[0], mq.r[1], mq.r[2] - mq.r[0], mq.r[3] - mq.r[1]);
      normal.restore();
    }
  }
  // handles (content → viewport)
  normal.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const h of controller.handles()) {
    const x = h.pos[0] - p.scrollLeft;
    const y = h.pos[1] - p.scrollTop;
    const s = HANDLE_PX - 2;
    normal.fillStyle = h.kind === "vertex" ? "#ffb020" : "#ffffff";
    normal.strokeStyle = "#1e78ff";
    normal.lineWidth = 1.5;
    if (h.kind === "vertex") {
      normal.beginPath();
      normal.arc(x, y, s / 2 + 1, 0, Math.PI * 2);
      normal.fill();
      normal.stroke();
    } else {
      normal.fillRect(x - s / 2, y - s / 2, s, s);
      normal.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }
}
