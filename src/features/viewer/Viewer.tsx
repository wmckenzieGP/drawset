import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { transformRect, type Rect } from "../../markup/geometry";
import { setView, updateTab, useApp, type DocTab } from "../../state/store";
import { Controller, useInteraction, type ViewerHost } from "./controller";
import { computeLayout, visibleRange, type Layout, type PageLayout } from "./layout";
import { drawOverlay, setBitmapListener } from "./overlay";
import { previewScale, renderCache, TILE } from "./renderCache";
import { TextEditor } from "./TextEditor";

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 64;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

function BitmapCanvas({ bitmap, style }: { bitmap: ImageBitmap; style: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} style={style} />;
}

function PageView({ tab, page, view, dpr }: { tab: DocTab; page: PageLayout; view: { left: number; top: number; w: number; h: number }; dpr: number }) {
  const { entry } = page;
  const pScale = previewScale(entry.info.bounds[2] - entry.info.bounds[0], entry.info.bounds[3] - entry.info.bounds[1]);
  const previewKey = `${tab.docId}:${entry.src}:p:${page.rot}`;
  const preview = renderCache.request(previewKey, { docId: tab.docId, page: entry.src, scale: pScale, rotate: page.rot }, 0);
  const scale = tab.view.scale * dpr;
  const tiles: { key: string; x: number; y: number; bmp: ImageBitmap | undefined }[] = [];
  // only tile when the preview is not already sharp enough
  if (scale > pScale * 1.05) {
    const lx0 = Math.max(0, view.left - page.x);
    const ly0 = Math.max(0, view.top - page.y);
    const lx1 = Math.min(page.w, view.left + view.w - page.x);
    const ly1 = Math.min(page.h, view.top + view.h - page.y);
    if (lx1 > lx0 && ly1 > ly0) {
      const tx0 = Math.floor((lx0 * dpr) / TILE);
      const ty0 = Math.floor((ly0 * dpr) / TILE);
      const tx1 = Math.floor((lx1 * dpr - 1) / TILE);
      const ty1 = Math.floor((ly1 * dpr - 1) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = `${tab.docId}:${entry.src}:t:${page.rot}:${scale.toFixed(5)}:${tx}:${ty}`;
          const bmp = renderCache.request(key, { docId: tab.docId, page: entry.src, scale, rotate: page.rot, tile: [tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE] }, 1);
          tiles.push({ key, x: tx, y: ty, bmp });
        }
      }
    }
  }
  return (
    <div className="page" data-page={page.index} style={{ left: page.x, top: page.y, width: page.w, height: page.h }}>
      {preview && <BitmapCanvas bitmap={preview} style={{ position: "absolute", left: 0, top: 0, width: page.w, height: page.h }} />}
      {tiles.map(
        (t) =>
          t.bmp && (
            <BitmapCanvas key={t.key} bitmap={t.bmp} style={{ position: "absolute", left: (t.x * TILE) / dpr, top: (t.y * TILE) / dpr, width: t.bmp.width / dpr, height: t.bmp.height / dpr }} />
          ),
      )}
    </div>
  );
}

export function Viewer({ tab }: { tab: DocTab }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const normalRef = useRef<HTMLCanvasElement>(null);
  const multiplyRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const editingId = useInteraction((s) => s.editingId);
  const cursor = useInteraction((s) => s.cursor);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const layout: Layout = useMemo(() => computeLayout(tab.state.pages, tab.view.scale, tab.view.rotation, size.w), [tab.state.pages, tab.view.scale, tab.view.rotation, size.w]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const drawRef = useRef<() => void>(() => {});
  const frame = useRef(0);
  const redraw = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      drawRef.current();
    });
  }, []);

  const zoomTo = useCallback((scale: number, anchorX: number, anchorY: number) => {
    const el = scrollRef.current;
    const t = tabRef.current;
    if (!el) return;
    const s = clampScale(scale);
    const old = layoutRef.current;
    const cx = anchorX + el.scrollLeft;
    const cy = anchorY + el.scrollTop;
    // keep the page point under the anchor fixed
    const [a] = visibleRange(old, cy, cy);
    const p = old.pages[a];
    let target: { index: number; px: number; py: number } | null = null;
    if (p) target = { index: a, px: (cx - p.x) / p.w, py: (cy - p.y) / p.h };
    setView(t.key, { scale: s });
    requestAnimationFrame(() => {
      const nl = layoutRef.current;
      const np = target ? nl.pages[target.index] : null;
      if (np && target) {
        el.scrollLeft = np.x + target.px * np.w - anchorX;
        el.scrollTop = np.y + target.py * np.h - anchorY;
      }
    });
  }, []);

  const host = useMemo<ViewerHost>(
    () => ({
      tab: () => tabRef.current,
      layout: () => layoutRef.current,
      scrollEl: () => scrollRef.current,
      redraw,
      zoomToRect: (page, r) => {
        const el = scrollRef.current;
        if (!el) return;
        const d = transformRect(r, page.m);
        const w = Math.max(4, d[2] - d[0]);
        const h = Math.max(4, d[3] - d[1]);
        const cur = tabRef.current.view.scale;
        const s = clampScale(cur * Math.min(el.clientWidth / w, el.clientHeight / h) * 0.9);
        setView(tabRef.current.key, { scale: s });
        requestAnimationFrame(() => {
          const np = layoutRef.current.pages[page.index];
          const nd = transformRect(r, np.m);
          el.scrollLeft = np.x + (nd[0] + nd[2]) / 2 - el.clientWidth / 2;
          el.scrollTop = np.y + (nd[1] + nd[3]) / 2 - el.clientHeight / 2;
        });
      },
      zoomBy: (factor, clientX, clientY) => {
        const el = scrollRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        zoomTo(tabRef.current.view.scale * factor, clientX - r.left, clientY - r.top);
      },
    }),
    [redraw, zoomTo],
  );
  const controller = useMemo(() => new Controller(host), [host]);
  useEffect(() => {
    (window as unknown as { __drawsetController?: Controller }).__drawsetController = controller;
  }, [controller]);

  drawRef.current = () => {
    const n = normalRef.current?.getContext("2d");
    const m = multiplyRef.current?.getContext("2d");
    const el = scrollRef.current;
    if (!n || !m || !el) return;
    drawOverlay({
      normal: n,
      multiply: m,
      width: el.clientWidth,
      height: el.clientHeight,
      dpr,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      layout: layoutRef.current,
      tab: tabRef.current,
      controller,
      editingId: useInteraction.getState().editingId,
    });
  };

  // redraw on any state change
  useEffect(() => {
    redraw();
  });
  useEffect(() => {
    setBitmapListener(redraw);
    const unsub = renderCache.subscribe(bump);
    return () => {
      unsub();
    };
  }, [redraw]);

  // viewport size
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // fit requests (fit page on open, menu commands)
  useEffect(() => {
    const fit = tab.view.fit;
    const el = scrollRef.current;
    if (!fit || !el || el.clientWidth < 50) return;
    const p = layout.pages[tab.currentPage] ?? layout.pages[0];
    if (!p) return;
    const pw = p.w / tab.view.scale;
    const ph = p.h / tab.view.scale;
    const s = fit === "width" ? (el.clientWidth - 48) / pw : Math.min((el.clientWidth - 48) / pw, (el.clientHeight - 32) / ph);
    updateTab(tab.key, (t) => ({ ...t, view: { ...t.view, fit: undefined, scale: clampScale(s), scrollTo: { page: t.currentPage, nonce: Date.now() } } }));
  }, [tab.view.fit, tab.key, tab.currentPage, tab.view.scale, layout]);

  // scroll requests
  useEffect(() => {
    const req = tab.view.scrollTo;
    const el = scrollRef.current;
    if (!req || !el) return;
    const p = layout.pages[req.page];
    if (!p) return;
    if (req.rect) {
      const d = transformRect(req.rect, p.m);
      el.scrollLeft = p.x + (d[0] + d[2]) / 2 - el.clientWidth / 2;
      el.scrollTop = p.y + (d[1] + d[3]) / 2 - el.clientHeight / 2;
    } else {
      el.scrollTop = p.y - 12;
      el.scrollLeft = Math.max(0, p.x + p.w / 2 - el.clientWidth / 2);
    }
    updateTab(tab.key, (t) => ({ ...t, view: { ...t.view, scrollTo: undefined } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.view.scrollTo?.nonce, layout]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({ left: el.scrollLeft, top: el.scrollTop });
    redraw();
    const mid = el.scrollTop + el.clientHeight / 2;
    const [a] = visibleRange(layout, mid, mid);
    const cur = layout.pages[a] && layout.pages[a].y <= mid + 8 ? a : Math.max(0, a - 1);
    if (cur !== tabRef.current.currentPage) updateTab(tab.key, (t) => ({ ...t, currentPage: cur }));
  };

  // wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return; // shift+wheel scrolls horizontally
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.pow(1.0015, -delta);
      zoomTo(tabRef.current.view.scale * factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    controller.pointerDown(e.nativeEvent);
  };
  const onPointerMove = (e: React.PointerEvent) => controller.pointerMove(e.nativeEvent);
  const onPointerUp = (e: React.PointerEvent) => {
    controller.pointerUp(e.nativeEvent);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  // keyboard: space for pan, Enter/Escape/Backspace for drawing
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.code === "Space" && !useInteraction.getState().spaceDown) {
        useInteraction.setState({ spaceDown: true, cursor: "grab" });
        e.preventDefault();
        return;
      }
      if (controller.keyDown(e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") useInteraction.setState({ spaceDown: false, cursor: "default" });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [controller]);

  // tool change cancels drawing
  const tool = useApp((s) => s.tools.tool);
  useEffect(() => {
    controller.cancel();
  }, [tool, controller]);

  const el = scrollRef.current;
  const view = { left: el?.scrollLeft ?? scroll.left, top: el?.scrollTop ?? scroll.top, w: size.w, h: size.h };
  const [first, last] = visibleRange(layout, view.top - 200, view.top + view.h + 200);
  const visiblePages = layout.pages.slice(Math.max(0, first), last + 1);

  const editing = editingId ? tab.state.markups[editingId] : undefined;
  const editingPage = editing ? layout.pages.find((p) => p.entry.id === editing.pageId) : undefined;
  let editorRect: Rect | null = null;
  if (editing && editingPage) editorRect = controller.contentRect(editingPage, editing.rect);

  return (
    <div className="viewer-wrap">
      <div
        className="viewer"
        ref={scrollRef}
        data-testid="viewer"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => controller.doubleClick(e.nativeEvent)}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor }}
      >
        <div className="viewer-content" style={{ width: layout.width, height: layout.height }}>
          {visiblePages.map((p) => (
            <PageView key={p.entry.id} tab={tab} page={p} view={view} dpr={dpr} />
          ))}
          {editing && editingPage && editorRect && <TextEditor key={editing.id} tab={tab} markup={editing} rect={editorRect} scale={Math.hypot(editingPage.m[0], editingPage.m[1])} />}
        </div>
      </div>
      <canvas ref={multiplyRef} className="overlay overlay-multiply" width={size.w * dpr} height={size.h * dpr} style={{ width: size.w, height: size.h }} />
      <canvas ref={normalRef} className="overlay" width={size.w * dpr} height={size.h * dpr} style={{ width: size.w, height: size.h }} />
    </div>
  );
}
