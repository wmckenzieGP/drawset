import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { OutlineNode } from "../../engine/types";
import { activeTab, commit, showPanel, type DocTab } from "../../state/store";
import { followLink, jumpTo } from "../links/navigate";

type Path = number[];

/** The bookmark being renamed, and the one last clicked (where new bookmarks go). */
const useBm = create<{ editing: string | null; selected: string | null }>(() => ({ editing: null, selected: null }));
const keyOf = (p: Path) => p.join(".");
const pathOf = (k: string): Path => (k ? k.split(".").map(Number) : []);

export const outlineOf = (t: DocTab) => t.state.outline ?? t.info.outline;

function nodeAt(list: OutlineNode[], p: Path): OutlineNode | undefined {
  let n: OutlineNode | undefined;
  let l = list;
  for (const i of p) {
    n = l[i];
    if (!n) return undefined;
    l = n.children;
  }
  return n;
}

/** A copy of the outline with the list at `parent` changed by `fn`. */
function editList(list: OutlineNode[], parent: Path, fn: (l: OutlineNode[]) => OutlineNode[]): OutlineNode[] {
  if (!parent.length) return fn(list);
  const [i, ...rest] = parent;
  return list.map((n, k) => (k === i ? { ...n, children: editList(n.children, rest, fn) } : n));
}

export function removeAt(list: OutlineNode[], p: Path): OutlineNode[] {
  return editList(list, p.slice(0, -1), (l) => l.filter((_, k) => k !== p[p.length - 1]));
}

export function insertAt(list: OutlineNode[], p: Path, node: OutlineNode): OutlineNode[] {
  return editList(list, p.slice(0, -1), (l) => [...l.slice(0, p[p.length - 1]), node, ...l.slice(p[p.length - 1])]);
}

/** Moves the bookmark at `from` to `to` (a position in the outline as it is before the move), or into it as its last child. */
export function moveBookmark(list: OutlineNode[], from: Path, to: Path, asChild: boolean): OutlineNode[] {
  const node = nodeAt(list, from);
  if (!node) return list;
  const fk = keyOf(from);
  // never into itself
  if (keyOf(to) === fk || keyOf(to).startsWith(`${fk}.`)) return list;
  const target = [...to];
  // removing `from` shifts later siblings (and their descendants) up by one
  const depth = from.length - 1;
  if (target.length > depth && keyOf(target.slice(0, depth)) === keyOf(from.slice(0, depth)) && target[depth] > from[depth]) target[depth]--;
  const without = removeAt(list, from);
  if (asChild) {
    const parent = nodeAt(without, target);
    return parent ? insertAt(without, [...target, parent.children.length], node) : list;
  }
  return insertAt(without, target, node);
}

/** Adds a bookmark to the current page after the selected one (or at the end) and starts renaming it. Ctrl+B. */
export function addBookmark() {
  const t = activeTab();
  if (!t) return;
  showPanel("bookmarks");
  const page = t.state.pages[t.currentPage];
  const outline = outlineOf(t);
  const sel = useBm.getState().selected;
  const at: Path = sel && nodeAt(outline, pathOf(sel)) ? pathOf(sel).map((v, i, a) => (i === a.length - 1 ? v + 1 : v)) : [outline.length];
  const node: OutlineNode = { title: page?.label ? `Page ${page.label}` : "New bookmark", page: page?.src ?? null, children: [] };
  commit(t.key, "Add bookmark", (s) => ({ ...s, outline: insertAt(s.outline ?? t.info.outline, at, node) }));
  useBm.setState({ editing: keyOf(at), selected: keyOf(at) });
}

function setOutline(tab: DocTab, label: string, fn: (o: OutlineNode[]) => OutlineNode[]) {
  commit(tab.key, label, (s) => ({ ...s, outline: fn(s.outline ?? tab.info.outline) }));
}

function Rename({ tab, path, node }: { tab: DocTab; path: Path; node: OutlineNode }) {
  const [v, setV] = useState(node.title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const done = (save: boolean) => {
    useBm.setState({ editing: null });
    if (save && v.trim() && v !== node.title) setOutline(tab, "Rename bookmark", (o) => editList(o, path.slice(0, -1), (l) => l.map((n, k) => (k === path[path.length - 1] ? { ...n, title: v.trim() } : n))));
  };
  return (
    <input
      ref={ref}
      className="bm-rename"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
        e.stopPropagation();
      }}
      aria-label="Bookmark name"
      data-testid="bm-rename"
    />
  );
}

function Node({ tab, node, path, drag }: { tab: DocTab; node: OutlineNode; path: Path; drag: React.MutableRefObject<Path | null> }) {
  const [open, setOpen] = useState(path.length < 2);
  const [over, setOver] = useState<"before" | "into" | null>(null);
  const { editing, selected } = useBm();
  const k = keyOf(path);
  // bookmarks point at physical pages; find where that page is now
  const index = node.page === null ? -1 : tab.state.pages.findIndex((p) => p.src === node.page);
  return (
    <li>
      <div
        className={`bm-row ${selected === k ? "selected" : ""} ${over ? `drop-${over}` : ""}`}
        style={{ paddingLeft: 6 + (path.length - 1) * 14 }}
        draggable={editing !== k}
        onDragStart={(e) => {
          drag.current = path;
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!drag.current) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setOver(e.clientX > r.left + r.width * 0.6 ? "into" : "before");
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          const from = drag.current;
          drag.current = null;
          const how = over;
          setOver(null);
          if (from) setOutline(tab, "Move bookmark", (o) => moveBookmark(o, from, path, how === "into"));
        }}
        data-testid="bm-row"
      >
        {node.children.length > 0 ? (
          <button className="bm-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="bm-toggle" />
        )}
        {editing === k ? (
          <Rename tab={tab} path={path} node={node} />
        ) : (
          <button
            className="bm-title"
            disabled={index < 0 && !node.uri}
            onClick={() => {
              useBm.setState({ selected: k });
              if (index >= 0) jumpTo(tab.key, index);
              else if (node.uri) void followLink(tab, { type: "url", url: node.uri });
            }}
            onDoubleClick={() => useBm.setState({ editing: k, selected: k })}
            onKeyDown={(e) => {
              if (e.key === "F2") useBm.setState({ editing: k });
              if (e.key === "Delete") {
                e.stopPropagation();
                setOutline(tab, "Delete bookmark", (o) => removeAt(o, path));
              }
            }}
            title={node.title}
          >
            {node.title || "(untitled)"}
          </button>
        )}
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <Node key={i} tab={tab} node={c} path={[...path, i]} drag={drag} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BookmarksPanel({ tab }: { tab: DocTab }) {
  const outline = outlineOf(tab);
  const selected = useBm((s) => s.selected);
  const drag = useRef<Path | null>(null);
  const sel = selected && nodeAt(outline, pathOf(selected)) ? pathOf(selected) : null;
  return (
    <div className="panel-body">
      <div className="panel-title">
        Bookmarks
        <span className="bm-actions">
          <button className="btn small" onClick={addBookmark} title="Add a bookmark to the current page (Ctrl+B)" data-testid="bm-add">
            Add
          </button>
          <button className="btn small" disabled={!sel} onClick={() => sel && useBm.setState({ editing: keyOf(sel) })} title="Rename (F2, or double-click)" data-testid="bm-edit">
            Rename
          </button>
          <button
            className="btn small"
            disabled={!sel}
            onClick={() => {
              if (!sel) return;
              setOutline(tab, "Delete bookmark", (o) => removeAt(o, sel));
              useBm.setState({ selected: null });
            }}
            title="Delete (Del)"
            data-testid="bm-delete"
          >
            Delete
          </button>
        </span>
      </div>
      {outline.length === 0 ? (
        <p className="muted pad">This document has no bookmarks. Add one for the current page with Ctrl+B.</p>
      ) : (
        <ul className="bookmarks" data-testid="bookmarks">
          {outline.map((n, i) => (
            <Node key={i} tab={tab} node={n} path={[i]} drag={drag} />
          ))}
        </ul>
      )}
      <p className="muted pad small">Drag a bookmark onto another to move it before that one, or onto its right-hand side to put it inside.</p>
    </div>
  );
}
