import { useState } from "react";
import type { OutlineNode } from "../../engine/types";
import { scrollToPage, type DocTab } from "../../state/store";

function Node({ tab, node, depth }: { tab: DocTab; node: OutlineNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  // bookmarks point at physical pages; find where that page is now
  const index = node.page === null ? -1 : tab.state.pages.findIndex((p) => p.src === node.page);
  return (
    <li>
      <div className="bm-row" style={{ paddingLeft: 6 + depth * 14 }}>
        {node.children.length > 0 ? (
          <button className="bm-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="bm-toggle" />
        )}
        <button className="bm-title" disabled={index < 0 && !node.uri} onClick={() => (index >= 0 ? scrollToPage(tab.key, index) : node.uri && window.open(node.uri, "_blank"))} title={node.title}>
          {node.title || "(untitled)"}
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <Node key={i} tab={tab} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BookmarksPanel({ tab }: { tab: DocTab }) {
  const outline = tab.info.outline;
  return (
    <div className="panel-body">
      <div className="panel-title">Bookmarks</div>
      {outline.length === 0 ? (
        <p className="muted pad">This document has no bookmarks.</p>
      ) : (
        <ul className="bookmarks" data-testid="bookmarks">
          {outline.map((n, i) => (
            <Node key={i} tab={tab} node={n} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}
