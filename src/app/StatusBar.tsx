import { useState } from "react";
import { activeTab, scrollToPage, setView, useApp } from "../state/store";
import { clampScale } from "../features/viewer/Viewer";

/** Finds a page by number ("12") or by label ("M-012"); returns the page index or -1. */
export function findPage(input: string, labels: string[]): number {
  const q = input.trim();
  if (!q) return -1;
  const exact = labels.findIndex((l) => l === q);
  if (exact >= 0) return exact;
  const ci = labels.findIndex((l) => l.toLowerCase() === q.toLowerCase());
  if (ci >= 0) return ci;
  if (/^\d+$/.test(q)) {
    const n = parseInt(q, 10);
    if (n >= 1 && n <= labels.length) return n - 1;
  }
  return -1;
}

export function StatusBar() {
  const tab = useApp(activeTab);
  const author = useApp((s) => s.author);
  const [goto, setGoto] = useState<string | null>(null);
  const [zoomText, setZoomText] = useState<string | null>(null);
  if (!tab) return <div className="statusbar"><span>Ready</span></div>;
  const labels = tab.state.pages.map((p) => p.info.label);
  const n = tab.state.pages.length;
  const cur = Math.min(tab.currentPage, n - 1);
  const label = labels[cur] ?? "";
  const zoom = Math.round(tab.view.scale * (72 / 96) * 100 * 10) / 10;
  const markupCount = Object.keys(tab.state.markups).length;
  return (
    <div className="statusbar">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const idx = findPage(goto ?? "", labels);
          if (idx >= 0) scrollToPage(tab.key, idx);
          else useApp.setState({ message: { text: `No page "${goto}"`, kind: "error" } });
          setGoto(null);
        }}
      >
        <label>
          Page{" "}
          <input
            className="goto"
            data-testid="goto-page"
            value={goto ?? (label === String(cur + 1) ? label : label)}
            onFocus={(e) => {
              setGoto(e.target.value);
              e.target.select();
            }}
            onBlur={() => setGoto(null)}
            onChange={(e) => setGoto(e.target.value)}
            aria-label="Go to page number or label"
          />
        </label>{" "}
        <span className="muted" data-testid="page-position">
          ({cur + 1} of {n})
        </span>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseFloat(zoomText ?? "");
          if (v > 0) setView(tab.key, { scale: clampScale((v / 100) * (96 / 72)) });
          setZoomText(null);
        }}
      >
        <label>
          Zoom{" "}
          <input className="zoom" data-testid="zoom" value={zoomText ?? `${zoom}%`} onFocus={(e) => { setZoomText(String(zoom)); e.target.select(); }} onBlur={() => setZoomText(null)} onChange={(e) => setZoomText(e.target.value)} aria-label="Zoom percentage" />
        </label>
      </form>
      <span className="muted">{tab.view.rotation ? `View rotated ${tab.view.rotation}°` : ""}</span>
      <span className="spacer" />
      <span className="muted" data-testid="markup-count">{tab.markupsLoaded ? `${markupCount} markup${markupCount === 1 ? "" : "s"}` : "Reading markups…"}</span>
      <span className="muted">Author: {author}</span>
    </div>
  );
}
