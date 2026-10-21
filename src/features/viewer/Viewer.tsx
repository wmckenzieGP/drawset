import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { transformRect, type Rect } from "../../markup/geometry";
import { focusPane, isContinuous, isPaired, scrollToPage, setView, updateTab, useApp, wheelAction, type DocTab, type Pane } from "../../state/store";
import { followPane, leadPane, publishPosition } from "./splitSync";
import { Controller, useInteraction, type ViewerHost } from "./controller";
import { computeLayout, NO_SLACK, pageByIndex, PAGE_GAP, pageStep, placeView, sameSlack, shownFrom, visibleRange, type Layout, type PageLayout, type Slack } from "./layout";
import { drawOverlay, addBitmapListener } from "./overlay";
import { previewScale, renderCache, TILE } from "./renderCache";
import { TextEditor } from "./TextEditor";
import { useCursor } from "./cursor";
import { ViewerMenu, type MenuAt } from "./ViewerMenu";
import { dropImages } from "../../app/clipboard";

/** The button last pressed with the mouse or a pen (it keeps the focus after the click). */
let lastClicked: Element | null = null;
if (typeof window !== "undefined") window.addEventListener("pointerdown", (e) => (lastClicked = (e.target as Element | null)?.closest?.("button") ?? null), true);

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

export function Viewer({ tab, pane }: { tab: DocTab; pane?: Pane }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const normalRef = useRef<HTMLCanvasElement>(null);
  const multiplyRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const editingId = useInteraction((s) => s.editingId);
  const cursor = useInteraction((s) => s.cursor);
  const hoverTitle = useInteraction((s) => s.title);
  // the grid is drawn on the overlay, so redraw when it is switched
  useApp((s) => s.snap.showGrid && s.snap.gridMm);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const mode = tab.view.mode;
  // a single-page layout is rebuilt when the page (or pair) shown changes, not on every current-page change
  const shown = isContinuous(mode) ? 0 : shownFrom(mode, tab.currentPage);
  // room around the pages for dragging them past where scrolling stops
  const [slack, setSlack] = useState<Slack>(NO_SLACK);
  const slackRef = useRef(slack);
  slackRef.current = slack;
  const layout: Layout = useMemo(
    () => computeLayout(tab.state.pages, tab.view.scale, tab.view.rotation, size.w, mode, shown, slack),
    [tab.state.pages, tab.view.scale, tab.view.rotation, size.w, mode, shown, slack],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  /** Scrolls the window's top left to (`left`, `top`), adding room around the pages where scrolling would stop; returns how far the content moved for that room. */
  const place = useCallback((left: number, top: number, grow = false): [number, number] => {
    const el = scrollRef.current;
    if (!el) return [0, 0];
    const was = slackRef.current;
    const to = placeView(layoutRef.current, was, el.clientWidth, el.clientHeight, left, top, grow);
    if (!sameSlack(to.slack, was)) flushSync(() => setSlack(to.slack));
    el.scrollLeft = to.left;
    el.scrollTop = to.top;
    return [to.slack.l - was.l, to.slack.t - was.t];
  }, []);

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
    if (p) target = { index: p.index, px: (cx - p.x) / p.w, py: (cy - p.y) / p.h };
    setView(t.key, { scale: s });
    requestAnimationFrame(() => {
      const nl = layoutRef.current;
      const np = target ? pageByIndex(nl, target.index) : null;
      if (np && target) place(np.x + target.px * np.w - anchorX, np.y + target.py * np.h - anchorY);
    });
  }, [place]);

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
          const np = pageByIndex(layoutRef.current, page.index);
          if (!np) return;
          const nd = transformRect(r, np.m);
          place(np.x + (nd[0] + nd[2]) / 2 - el.clientWidth / 2, np.y + (nd[1] + nd[3]) / 2 - el.clientHeight / 2);
        });
      },
      panTo: (left, top) => place(left, top, true),
      panEnd: () => {
        const el = scrollRef.current;
        if (el) place(el.scrollLeft, el.scrollTop);
      },
      zoomBy: (factor, clientX, clientY) => {
        const el = scrollRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        zoomTo(tabRef.current.view.scale * factor, clientX - r.left, clientY - r.top);
      },
    }),
    [redraw, zoomTo, place],
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
    // the markups are drawn for the window as it is now, on canvases that scroll with the pages: while the window
    // scrolls before the next drawing, they move with the pages instead of lagging behind them
    const [left, top] = [el.scrollLeft, el.scrollTop];
    for (const c of [n.canvas, m.canvas]) c.style.transform = `translate(${left}px, ${top}px)`;
    drawOverlay({
      normal: n,
      multiply: m,
      width: el.clientWidth,
      height: el.clientHeight,
      dpr,
      scrollLeft: left,
      scrollTop: top,
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
    const unBitmap = addBitmapListener(redraw);
    const unsub = renderCache.subscribe(bump);
    return () => {
      unBitmap();
      unsub();
    };
  }, [redraw]);

  // split view: follow the other pane (same page, same spot, same zoom)
  useEffect(() => {
    if (!pane) return;
    return followPane(pane, (pos) => {
      const el = scrollRef.current;
      if (!el) return;
      const show = () => {
        const index = Math.min(pos.page, tabRef.current.state.pages.length - 1);
        const p = pageByIndex(layoutRef.current, index);
        if (!p) {
          // a single-page layout shows the other pane's page first
          updateTab(tabRef.current.key, (t) => ({ ...t, currentPage: index }));
          requestAnimationFrame(show);
          return;
        }
        place(p.x + pos.px * p.w - el.clientWidth / 2, p.y + pos.py * p.h - el.clientHeight / 2);
      };
      if (Math.abs(tabRef.current.view.scale - pos.scale) > 1e-9) {
        setView(tabRef.current.key, { scale: pos.scale });
        requestAnimationFrame(show);
      } else show();
    });
  }, [pane, place]);
  // zoom changes lead too (scrolling alone does not fire when the position stays put)
  useEffect(() => {
    requestAnimationFrame(() => publish());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.view.scale]);
  const publish = () => {
    const el = scrollRef.current;
    if (!pane || !el) return;
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    const [a] = visibleRange(layoutRef.current, cy, cy);
    const p = layoutRef.current.pages[a];
    if (p) publishPosition(pane, { page: p.index, px: (cx - p.x) / p.w, py: (cy - p.y) / p.h, scale: tabRef.current.view.scale });
  };

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
    const p = pageByIndex(layout, tab.currentPage) ?? layout.pages[0];
    if (!p) return;
    // side by side, the pair fits together
    const mate = isPaired(mode) ? pageByIndex(layout, p.index % 2 === 0 ? p.index + 1 : p.index - 1) : undefined;
    const pw = (p.w + (mate ? mate.w + PAGE_GAP : 0)) / tab.view.scale;
    const ph = Math.max(p.h, mate?.h ?? 0) / tab.view.scale;
    const s = fit === "width" ? (el.clientWidth - 48) / pw : Math.min((el.clientWidth - 48) / pw, (el.clientHeight - 32) / ph);
    updateTab(tab.key, (t) => ({ ...t, view: { ...t.view, fit: undefined, scale: clampScale(s), scrollTo: { page: t.currentPage, nonce: Date.now() } } }));
  }, [tab.view.fit, tab.key, tab.currentPage, tab.view.scale, layout, mode]);

  // scroll requests
  useEffect(() => {
    const req = tab.view.scrollTo;
    const el = scrollRef.current;
    if (!req || !el) return;
    // going to a page puts it back in its usual place
    if (!sameSlack(slackRef.current, NO_SLACK)) return setSlack(NO_SLACK);
    const p = pageByIndex(layout, req.page);
    // a single-page layout first has to show the page
    if (!p) return;
    if (req.end) {
      el.scrollTop = p.y + p.h - el.clientHeight + 12;
      el.scrollLeft = Math.max(0, p.x + p.w / 2 - el.clientWidth / 2);
    } else if (req.rect) {
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
    // in a continuous layout the page in the middle of the window is the current one; otherwise it is the one shown
    if (isContinuous(layout.mode)) {
      // the page taking up most of the window (the top one when several fit)
      const top = el.scrollTop;
      const bottom = top + el.clientHeight;
      const [a, b] = visibleRange(layout, top, bottom);
      let cur = layout.pages[a]?.index ?? 0;
      let best = -1;
      for (let i = a; i <= b; i++) {
        const p = layout.pages[i];
        const seen = Math.max(0, Math.min(bottom, p.y + p.h) - Math.max(top, p.y)) / Math.max(1, Math.min(p.h, el.clientHeight));
        if (seen > best + 0.02) {
          best = seen;
          cur = p.index;
        }
      }
      if (cur !== tabRef.current.currentPage) updateTab(tab.key, (t) => ({ ...t, currentPage: cur }));
    }
    publish();
  };

  // the wheel zooms or scrolls, as set for the layout; Ctrl held does the other (non-passive so zooming does not scroll)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let flipAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return; // shift+wheel scrolls horizontally
      const t = tabRef.current;
      const action = wheelAction(t.view.mode);
      const zoom = action === "zoom" ? !e.ctrlKey : e.ctrlKey;
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (zoom) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomTo(t.view.scale * Math.pow(1.0015, -delta), e.clientX - r.left, e.clientY - r.top);
        return;
      }
      if (e.ctrlKey) e.preventDefault();
      if (isContinuous(t.view.mode)) {
        if (e.ctrlKey) el.scrollTop += delta;
        return;
      }
      // one page at a time: scrolling past the end of the page turns to the next one (and back)
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const atStart = el.scrollTop <= 0;
      const now = performance.now();
      if ((delta > 0 && atEnd) || (delta < 0 && atStart)) {
        e.preventDefault();
        if (now - flipAt < 350) return;
        flipAt = now;
        const step = pageStep(t.view.mode);
        const from = shownFrom(t.view.mode, t.currentPage);
        const to = delta > 0 ? from + step : from - step;
        if (to < 0 || to >= t.state.pages.length) return;
        scrollToPage(t.key, to);
        if (delta < 0) updateTab(t.key, (x) => ({ ...x, view: { ...x.view, scrollTo: { ...x.view.scrollTo!, end: true } } }));
        return;
      }
      if (e.ctrlKey) el.scrollTop += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // right-click menus
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const menuOpen = useRef(false);
  menuOpen.current = !!menu;
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (e.target instanceof HTMLTextAreaElement) return;
    const target = controller.contextMenu(e.nativeEvent);
    setMenu(target ? { x: e.clientX, y: e.clientY, target } : null);
  };

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
      // with two panes open, keys go to the pane in use
      if (pane && useApp.getState().split?.focus !== pane) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      // keys in an open right-click menu are the menu's, and Enter or Space on a button reached by keyboard presses it
      // (a button clicked with the mouse keeps the focus, but the keys still go to the page: Space pans)
      if (menuOpen.current || (target?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ") && target !== lastClicked)) return;
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
  }, [controller, pane]);

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
    <div
      className="viewer-wrap"
      onPointerEnter={() => pane && leadPane(pane)}
      onWheelCapture={() => pane && leadPane(pane)}
      onPointerDownCapture={() => {
        if (!pane) return;
        leadPane(pane);
        focusPane(pane);
      }}
    >
      <div
        className="viewer"
        ref={scrollRef}
        data-testid="viewer"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        // pressing the wheel drags the page; the browser's own wheel-button scrolling would fight it
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => controller.doubleClick(e.nativeEvent)}
        onContextMenu={onContextMenu}
        onDrop={(e) => {
          // pictures dropped on a page become image markups there (PDFs go on to the window, which opens them)
          const images = [...e.dataTransfer.files].filter((f) => /^image\/(png|jpeg|gif|bmp|webp)$/.test(f.type));
          const at = images.length ? controller.pointAt(e) : null;
          if (!at) return;
          e.preventDefault();
          if (pane) focusPane(pane);
          void dropImages(images, at);
        }}
        onPointerLeave={() => useCursor.getState().tabKey === tab.key && useCursor.setState({ tabKey: null, pageId: null, pt: null })}
        style={{ cursor }}
        title={hoverTitle || undefined}
      >
        <div className="viewer-content" style={{ width: layout.width, height: layout.height }}>
          {visiblePages.map((p) => (
            <PageView key={p.entry.id} tab={tab} page={p} view={view} dpr={dpr} />
          ))}
          {editing && editingPage && editorRect && <TextEditor key={editing.id} tab={tab} markup={editing} rect={editorRect} scale={Math.hypot(editingPage.m[0], editingPage.m[1])} />}
          {/* markups, selection and drawing in progress (clipped, so they never add to the scrolling area) */}
          <div className="overlay-layer">
            <canvas ref={multiplyRef} className="overlay overlay-multiply" width={size.w * dpr} height={size.h * dpr} style={{ width: size.w, height: size.h }} />
            <canvas ref={normalRef} className="overlay" width={size.w * dpr} height={size.h * dpr} style={{ width: size.w, height: size.h }} />
          </div>
        </div>
      </div>
      <ViewerMenu tab={tab} menu={menu} controller={controller} onClose={() => setMenu(null)} />
    </div>
  );
}
