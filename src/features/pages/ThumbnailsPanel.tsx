import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { scrollToPage, updateTab, type DocTab } from "../../state/store";
import { renderCache, thumbScale } from "../viewer/renderCache";
import { pageRotation } from "../viewer/layout";
import { deletePages, insertBlankPage, movePages, rotatePages } from "./pageOps";
import { openPageDialog } from "./PageDialogs";

const ITEM_H = 196;

function Thumb({ tab, index, selected, current, onClick, onContext, dragOverSide }: { tab: DocTab; index: number; selected: boolean; current: boolean; onClick: (e: React.MouseEvent) => void; onContext: (e: React.MouseEvent) => void; dragOverSide: "before" | "after" | null }) {
  const entry = tab.state.pages[index];
  const rot = pageRotation(entry, tab.view.rotation);
  const b = entry.info.bounds;
  const s = thumbScale(b[2] - b[0], b[3] - b[1]);
  const bmp = renderCache.request(`${tab.docId}:${entry.src}:th:${rot}`, { docId: tab.docId, page: entry.src, scale: s, rotate: rot }, 2);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !bmp) return;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")?.drawImage(bmp, 0, 0);
  }, [bmp]);
  const w = rot % 180 === 0 ? b[2] - b[0] : b[3] - b[1];
  const h = rot % 180 === 0 ? b[3] - b[1] : b[2] - b[0];
  const k = Math.min(150 / w, 150 / h);
  return (
    <div
      className={`thumb ${selected ? "selected" : ""} ${current ? "current" : ""} ${dragOverSide ? `drop-${dragOverSide}` : ""}`}
      style={{ top: index * ITEM_H, height: ITEM_H }}
      onClick={onClick}
      onContextMenu={onContext}
      draggable
      data-index={index}
      data-testid={`thumb-${index}`}
    >
      <div className="thumb-img" style={{ width: w * k, height: h * k }}>
        {bmp && <canvas ref={ref} style={{ width: "100%", height: "100%" }} />}
      </div>
      <div className="thumb-label">{entry.label}</div>
    </div>
  );
}

export function ThumbnailsPanel({ tab }: { tab: DocTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [drag, setDrag] = useState<{ ids: string[]; over: number | null; side: "before" | "after" } | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<number | null>(null);
  const n = tab.state.pages.length;

  useEffect(() => renderCache.subscribe(bump) as unknown as () => void, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // keep the current page visible
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = tab.currentPage * ITEM_H;
    if (top < el.scrollTop || top + ITEM_H > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 2 + ITEM_H / 2;
  }, [tab.currentPage]);

  const first = Math.max(0, Math.floor(scroll / ITEM_H) - 2);
  const last = Math.min(n - 1, Math.ceil((scroll + height) / ITEM_H) + 2);
  const selected = new Set(tab.pageSelection);

  const click = (i: number, e: React.MouseEvent) => {
    const id = tab.state.pages[i].id;
    let sel: string[];
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      sel = tab.state.pages.slice(a, b + 1).map((p) => p.id);
    } else if (e.ctrlKey || e.metaKey) {
      sel = selected.has(id) ? tab.pageSelection.filter((x) => x !== id) : [...tab.pageSelection, id];
      anchor.current = i;
    } else {
      sel = [id];
      anchor.current = i;
    }
    updateTab(tab.key, (t) => ({ ...t, pageSelection: sel }));
    scrollToPage(tab.key, i);
  };

  const indexFromEvent = (e: React.DragEvent) => {
    const el = ref.current!;
    const y = e.clientY - el.getBoundingClientRect().top + el.scrollTop;
    const i = Math.max(0, Math.min(n - 1, Math.floor(y / ITEM_H)));
    const side: "before" | "after" = y - i * ITEM_H < ITEM_H / 2 ? "before" : "after";
    return { i, side };
  };

  const ids = () => (tab.pageSelection.length ? tab.pageSelection : [tab.state.pages[tab.currentPage]?.id].filter(Boolean) as string[]);

  return (
    <div className="panel-body thumbs-wrap">
      <div className="panel-title">
        Pages <span className="muted">{n}</span>
      </div>
      <div
        className="thumbs"
        ref={ref}
        data-testid="thumbnails"
        onScroll={(e) => setScroll((e.target as HTMLElement).scrollTop)}
        onDragStart={(e) => {
          const idx = Number((e.target as HTMLElement).closest("[data-index]")?.getAttribute("data-index"));
          if (Number.isNaN(idx)) return;
          const id = tab.state.pages[idx].id;
          const dragIds = selected.has(id) ? tab.pageSelection : [id];
          if (!selected.has(id)) updateTab(tab.key, (t) => ({ ...t, pageSelection: [id] }));
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("application/x-drawset-pages", dragIds.join(","));
          setDrag({ ids: dragIds, over: null, side: "before" });
        }}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          const { i, side } = indexFromEvent(e);
          if (drag.over !== i || drag.side !== side) setDrag({ ...drag, over: i, side });
        }}
        onDragEnd={() => setDrag(null)}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          e.stopPropagation();
          const { i, side } = indexFromEvent(e);
          movePages(tab.key, drag.ids, side === "before" ? i : i + 1);
          setDrag(null);
        }}
      >
        <div style={{ height: n * ITEM_H, position: "relative" }}>
          {Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => first + k).map((i) => (
            <Thumb
              key={tab.state.pages[i].id}
              tab={tab}
              index={i}
              selected={selected.has(tab.state.pages[i].id)}
              current={i === tab.currentPage}
              onClick={(e) => click(i, e)}
              onContext={(e) => {
                e.preventDefault();
                if (!selected.has(tab.state.pages[i].id)) updateTab(tab.key, (t) => ({ ...t, pageSelection: [t.state.pages[i].id] }));
                setMenuAt({ x: e.clientX, y: e.clientY });
              }}
              dragOverSide={drag && drag.over === i ? drag.side : null}
            />
          ))}
        </div>
      </div>
      <Menu.Root open={!!menuAt} onOpenChange={(o) => !o && setMenuAt(null)} modal={false}>
        <Menu.Trigger asChild>
          <span style={{ position: "fixed", left: menuAt?.x ?? 0, top: menuAt?.y ?? 0, width: 1, height: 1 }} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="start">
            <Menu.Item className="menu-item" onSelect={() => rotatePages(tab.key, ids(), 90)}>Rotate clockwise</Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => rotatePages(tab.key, ids(), 270)}>Rotate anticlockwise</Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => rotatePages(tab.key, ids(), 180)}>Rotate 180°</Menu.Item>
            <Menu.Separator className="menu-sep" />
            <Menu.Item className="menu-item" onSelect={() => insertBlankPage(tab.key)}>Insert blank page after</Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => openPageDialog("insert")}>Insert pages from file…</Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => openPageDialog("extract")}>Extract pages…</Menu.Item>
            <Menu.Separator className="menu-sep" />
            <Menu.Item className="menu-item danger" onSelect={() => deletePages(tab.key, ids())}>Delete pages</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
