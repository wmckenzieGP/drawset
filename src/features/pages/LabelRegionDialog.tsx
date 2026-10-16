import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { setTool } from "../../app/commands";
import { activeTab, flash, useApp } from "../../state/store";
import { useLabelRegionPick } from "../viewer/controller";
import { applyPageLabels, readRegionLabels } from "./labelRegion";
import { parsePageRange } from "./pageOps";

/** Starts the region tool: the user draws a box around the sheet number. */
export function startLabelRegion() {
  if (!activeTab()) return;
  setTool("labelregion");
  flash("Draw a box around the sheet number in the title block.");
}

export function LabelRegionDialog() {
  const pick = useLabelRegionPick((s) => s.pick);
  const tab = useApp(activeTab);
  const [which, setWhich] = useState<"all" | "range">("all");
  const [range, setRange] = useState("");
  const [bookmarks, setBookmarks] = useState(true);
  const [found, setFound] = useState<string[] | null>(null);
  const n = tab?.state.pages.length ?? 0;
  const indices = which === "all" ? [...Array(n).keys()] : (parsePageRange(range, n) ?? []);
  const key = indices.join(",");

  useEffect(() => {
    if (!pick || !tab) return;
    let live = true;
    setFound(null);
    readRegionLabels(tab, pick.rect, indices)
      .then((l) => live && setFound(l))
      .catch((e) => flash(`Could not read the region: ${(e as Error).message}`, "error"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, key, tab?.docId]);

  if (!tab || !pick) return null;
  const close = () => useLabelRegionPick.setState({ pick: null });
  const hits = found ? found.filter(Boolean).length : 0;
  const apply = () => {
    if (!found) return;
    const labels = new Map<string, string>();
    indices.forEach((i, k) => found[k] && labels.set(tab.state.pages[i].id, found[k]));
    applyPageLabels(tab.key, labels, bookmarks);
    flash(`Labelled ${labels.size} page${labels.size === 1 ? "" : "s"}${bookmarks ? " and made bookmarks" : ""}.`);
    close();
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide" aria-describedby={undefined} data-testid="label-dialog">
          <Dialog.Title>Label pages from the title block</Dialog.Title>
          <div className="field">
            <label className="check">
              <input type="radio" checked={which === "all"} onChange={() => setWhich("all")} /> All pages ({n})
            </label>
            <label className="check">
              <input type="radio" checked={which === "range"} onChange={() => setWhich("range")} /> Pages
              <input className="small" value={range} placeholder="e.g. 1-10" onChange={(e) => { setRange(e.target.value); setWhich("range"); }} />
            </label>
            <label className="check">
              <input type="checkbox" checked={bookmarks} onChange={(e) => setBookmarks(e.target.checked)} data-testid="label-bookmarks" /> Make bookmarks from the labels (replaces the current bookmarks)
            </label>
          </div>
          {!found ? (
            <p className="muted">Reading the region on {indices.length} pages…</p>
          ) : (
            <>
              <p className="muted" data-testid="label-summary">
                Found text on {hits} of {indices.length} pages. Pages with nothing in the box keep their label.
              </p>
              <ul className="label-preview" data-testid="label-preview">
                {indices.slice(0, 300).map((i, k) => (
                  <li key={tab.state.pages[i].id}>
                    <span className="muted">{tab.state.pages[i].label || i + 1}</span> → {found[k] || <span className="muted">(unchanged)</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="dialog-buttons">
            <button className="btn" onClick={() => { close(); startLabelRegion(); }}>
              Redraw the box
            </button>
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" disabled={!found || !hits} onClick={apply} data-testid="label-apply">
              Apply
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
