import { activeTab, setSnap, useApp } from "../state/store";
import { openSecurity, securitySummary } from "../features/security/SecurityDialog";
import { useCursor } from "../features/viewer/controller";
import { scaleLabel } from "../markup/measure";
import { keysOf } from "./keymap";


const ISO = [["A0", 841, 1189], ["A1", 594, 841], ["A2", 420, 594], ["A3", 297, 420], ["A4", 210, 297], ["B1", 707, 1000], ["B2", 500, 707]] as const;
const mm = (pt: number) => (pt * 25.4) / 72;

/** "A1 841 × 594 mm", or just the size when it is not a standard sheet. */
export function sheetSize(wPt: number, hPt: number): string {
  const w = mm(wPt);
  const h = mm(hPt);
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const iso = ISO.find(([, x, y]) => Math.abs(a - x) < 2 && Math.abs(b - y) < 2);
  return `${iso ? `${iso[0]} ` : ""}${Math.round(w)} × ${Math.round(h)} mm`;
}

function Toggle({ on, onClick, label, title, id }: { on: boolean; onClick: () => void; label: string; title: string; id: string }) {
  return (
    <button className={on ? "on" : ""} aria-pressed={on} onClick={onClick} title={title} data-testid={id}>
      {label}
    </button>
  );
}

/** Along the bottom: snapping, reuse and split sync on the left; the page's size, scale and the pointer on the right. */
export function StatusBar() {
  const tab = useApp(activeTab);
  const author = useApp((s) => s.author);
  const snap = useApp((s) => s.snap);
  const reuse = useApp((s) => s.tools.reuse);
  const split = useApp((s) => s.split);
  const cursor = useCursor();
  const page = tab ? tab.state.pages[Math.min(tab.currentPage, tab.state.pages.length - 1)] : undefined;
  const pointerPage = tab && cursor.pageId ? tab.state.pages.find((p) => p.id === cursor.pageId) : undefined;
  const sizeOf = (p: NonNullable<typeof page>) => {
    const b = p.info.bounds;
    const turned = (p.info.rotate + p.rotation) % 180 !== 0;
    return turned ? sheetSize(b[3] - b[1], b[2] - b[0]) : sheetSize(b[2] - b[0], b[3] - b[1]);
  };
  const markupCount = tab ? Object.keys(tab.state.markups).length : 0;
  return (
    <div className="statusbar">
      <span className="snap-toggles" title="Hold Alt while drawing to turn snapping off">
        <Toggle on={snap.showGrid} onClick={() => setSnap({ showGrid: !snap.showGrid })} label="Grid" title={`Show grid (${keysOf("view.showGrid")})`} id="show-grid" />
        <Toggle on={snap.grid} onClick={() => setSnap({ grid: !snap.grid })} label="Snap" title={`Snap to grid (${keysOf("view.snapGrid")})`} id="snap-grid" />
        <Toggle on={snap.content} onClick={() => setSnap({ content: !snap.content })} label="Content" title={`Snap to content: line ends and intersections in the drawing (${keysOf("view.snapContent")})`} id="snap-content" />
        <Toggle on={snap.markups} onClick={() => setSnap({ markups: !snap.markups })} label="Markup" title={`Snap to markup points (${keysOf("view.snapMarkup")})`} id="snap-markups" />
        <Toggle on={reuse} onClick={() => useApp.setState((s) => ({ tools: { ...s.tools, reuse: !s.tools.reuse } }))} label="Reuse" title="Keep the drawing tool after each markup" id="status-reuse" />
        <Toggle on={!!split?.sync} onClick={() => split && useApp.setState({ split: { ...split, sync: !split.sync } })} label="Sync" title="Split view panes follow each other" id="status-sync" />
        {(snap.grid || snap.showGrid) && (
          <select value={snap.gridMm} onChange={(e) => setSnap({ gridMm: Number(e.target.value) })} aria-label="Grid spacing" data-testid="snap-grid-size">
            {[1, 2, 2.5, 5, 10, 20, 25, 50].map((v) => (
              <option key={v} value={v}>
                {v} mm
              </option>
            ))}
          </select>
        )}
      </span>
      <span className="spacer" />
      {tab && (tab.info.security.encrypted || tab.state.security) && (
        <button className="secured" onClick={openSecurity} title={securitySummary(tab)} data-testid="security-status">
          {tab.state.security === "none" ? "Unsecured on save" : tab.state.security ? "Secured on save" : tab.info.security.owner ? "Secured" : "Restricted"}
        </button>
      )}
      {tab && (
        <span className="muted" data-testid="markup-count">
          {tab.markupsLoaded ? `${markupCount} markup${markupCount === 1 ? "" : "s"}` : "Reading markups…"}
        </span>
      )}
      <span className="muted">Author: {author}</span>
      {tab?.view.rotation ? <span className="muted">View rotated {tab.view.rotation}°</span> : null}
      {page && (
        <span className="muted" data-testid="page-size">
          {sizeOf(page)}
        </span>
      )}
      {page && (
        <span className="muted" data-testid="page-scale-status">
          {page.scale ? scaleLabel(page.scale) : "No scale"}
        </span>
      )}
      <span className="muted coords" data-testid="cursor">
        {pointerPage && cursor.pt ? `${mm(cursor.pt[0] - pointerPage.info.bounds[0]).toFixed(1)}, ${mm(cursor.pt[1] - pointerPage.info.bounds[1]).toFixed(1)} mm` : ""}
      </span>
    </div>
  );
}
