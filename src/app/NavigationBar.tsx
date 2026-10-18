import { useState } from "react";
import { goBack, goForward, jumpTo } from "../features/links/navigate";
import { clampScale } from "../features/viewer/Viewer";
import { isContinuous, setNavPrefs, setView, useApp, wheelAction, type DocTab, type PageMode } from "../state/store";
import { cmd } from "./commands";
import { Icon } from "./icons";
import { keysOf } from "./keymap";
import { findPage } from "./findPage";

const MODES: [PageMode, string, string][] = [
  ["single", "Single page", "view.single"],
  ["continuous", "Continuous", "view.continuous"],
  ["sideBySide", "Side by side", "view.sideBySide"],
  ["continuousSideBySide", "Continuous side by side", "view.continuousSideBySide"],
];

const tip = (label: string, id: string) => `${label} (${keysOf(id)})`;

/** Under the document: page navigation, views, page layout, what the wheel does, and zoom. */
export function NavigationBar({ tab }: { tab: DocTab }) {
  const nav = useApp((s) => s.nav);
  const [goto, setGoto] = useState<string | null>(null);
  const [zoomText, setZoomText] = useState<string | null>(null);
  const labels = tab.state.pages.map((p) => p.label);
  const n = tab.state.pages.length;
  const cur = Math.min(tab.currentPage, n - 1);
  const zoom = Math.round(tab.view.scale * (72 / 96) * 100 * 10) / 10;
  const mode = tab.view.mode;
  const wheel = wheelAction(mode, nav);
  return (
    <div className="navbar" role="toolbar" aria-label="Navigation" data-testid="navbar">
      <button className="icon-btn" onClick={cmd.firstPage} disabled={cur <= 0} title={tip("First page", "view.firstPage")} data-testid="nav-first">
        <Icon name="first" size={14} />
      </button>
      <button className="icon-btn" onClick={() => cmd.pageBy(-1)} disabled={cur <= 0} title={tip("Previous page", "view.prevPage")} data-testid="nav-prev">
        <Icon name="prevPage" size={14} />
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const idx = findPage(goto ?? "", labels);
          if (idx >= 0) jumpTo(tab.key, idx);
          else useApp.setState({ message: { text: `No page "${goto}"`, kind: "error" } });
          setGoto(null);
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <input
          className="goto"
          data-testid="goto-page"
          value={goto ?? labels[cur] ?? ""}
          onFocus={(e) => {
            setGoto(e.target.value);
            e.target.select();
          }}
          onBlur={() => setGoto(null)}
          onChange={(e) => setGoto(e.target.value)}
          aria-label="Go to page number or label"
        />{" "}
        <span className="muted" data-testid="page-position">
          ({cur + 1} of {n})
        </span>
      </form>
      <button className="icon-btn" onClick={() => cmd.pageBy(1)} disabled={cur >= n - 1} title={tip("Next page", "view.nextPage")} data-testid="nav-next">
        <Icon name="nextPage" size={14} />
      </button>
      <button className="icon-btn" onClick={cmd.lastPage} disabled={cur >= n - 1} title={tip("Last page", "view.lastPage")} data-testid="nav-last">
        <Icon name="last" size={14} />
      </button>
      <span className="nav-sep" />
      <button className="icon-btn" onClick={() => goBack(tab.key)} disabled={!tab.nav.back.length} title={tip("Previous view", "view.prevView")} data-testid="nav-back">
        <Icon name="viewBack" size={14} />
      </button>
      <button className="icon-btn" onClick={() => goForward(tab.key)} disabled={!tab.nav.fwd.length} title={tip("Next view", "view.nextView")} data-testid="nav-forward">
        <Icon name="viewForward" size={14} />
      </button>
      <span className="nav-sep" />
      {MODES.map(([m, label, id]) => (
        <button key={m} className={`icon-btn ${mode === m ? "on" : ""}`} aria-pressed={mode === m} onClick={() => cmd.setMode(m)} title={tip(label, id)} data-testid={`mode-${m}`}>
          <Icon name={m} size={15} />
        </button>
      ))}
      <span className="nav-sep" />
      <button
        className="icon-btn wheel"
        onClick={() => setNavPrefs(isContinuous(mode) ? { wheelContinuous: wheel === "zoom" ? "scroll" : "zoom" } : { wheelSingle: wheel === "zoom" ? "scroll" : "zoom" })}
        title={`Mouse wheel ${wheel === "zoom" ? "zooms" : "scrolls"} in this layout; click to make it ${wheel === "zoom" ? "scroll" : "zoom"}. Hold Ctrl to ${wheel === "zoom" ? "scroll" : "zoom"} instead.`}
        data-testid="wheel-mode"
        data-wheel={wheel}
      >
        <Icon name={wheel === "zoom" ? "wheelZoom" : "wheelScroll"} size={15} />
        <span>{wheel === "zoom" ? "Wheel zooms" : "Wheel scrolls"}</span>
      </button>
      <span className="spacer" />
      <button className="icon-btn" onClick={cmd.zoomOut} title={tip("Zoom out", "view.zoomOut")}>
        −
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseFloat(zoomText ?? "");
          if (v > 0) setView(tab.key, { scale: clampScale((v / 100) * (96 / 72)) });
          setZoomText(null);
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <input
          className="zoom"
          data-testid="zoom"
          value={zoomText ?? `${zoom}%`}
          onFocus={(e) => {
            setZoomText(String(zoom));
            e.target.select();
          }}
          onBlur={() => setZoomText(null)}
          onChange={(e) => setZoomText(e.target.value)}
          aria-label="Zoom percentage"
        />
      </form>
      <button className="icon-btn" onClick={cmd.zoomIn} title={tip("Zoom in", "view.zoomIn")}>
        +
      </button>
      <button className="icon-btn" onClick={cmd.fitPage} title={tip("Fit page", "view.fitPage")}>
        <Icon name="fitPage" size={14} />
      </button>
      <button className="icon-btn" onClick={cmd.fitWidth} title={tip("Fit width", "view.fitWidth")}>
        <Icon name="fitWidth" size={14} />
      </button>
    </div>
  );
}
