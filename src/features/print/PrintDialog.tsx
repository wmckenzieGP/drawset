import { useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { engine } from "../../engine/client";
import { buildPlan } from "../../state/documents";
import { activeTab, flash, useApp, type DocTab } from "../../state/store";
import { parsePageRange } from "../pages/pageOps";

const useDialog = create<{ open: boolean; jobs: PrintPage[] | null; mode: "fit" | "actual" }>(() => ({ open: false, jobs: null, mode: "fit" }));
export const openPrintDialog = () => activeTab() && useDialog.setState({ open: true });

export interface PrintPage {
  url: string;
  /** Page size in millimetres as printed at actual size. */
  wmm: number;
  hmm: number;
}

/** Longest side, in pixels, of a page image sent to the printer. */
const FIT_PX = 3300;
const ACTUAL_DPI = 200;
const MAX_PX = 9000;

async function bitmapUrl(img: ImageBitmap): Promise<string> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not prepare the page image.");
  return URL.createObjectURL(blob);
}

/** Renders the chosen pages to images; markups come from a saved copy so they print as other viewers show them. */
export async function preparePrint(tab: DocTab, indices: number[], withMarkups: boolean, mode: "fit" | "actual"): Promise<PrintPage[]> {
  let docId = tab.docId;
  let temp: string | null = null;
  let srcOf = (i: number) => tab.state.pages[i].src;
  if (withMarkups) {
    const ids = indices.map((i) => tab.state.pages[i].id);
    const bytes = await engine().saveCopy(tab.docId, buildPlan(tab, tab.state, { pageIds: ids }));
    const info = await engine().open(bytes, "print");
    temp = info.docId;
    docId = info.docId;
    srcOf = (i: number) => indices.indexOf(i);
  }
  const out: PrintPage[] = [];
  try {
    for (const i of indices) {
      const entry = tab.state.pages[i];
      const b = entry.info.bounds;
      const rot = withMarkups ? 0 : entry.rotation;
      const w = b[2] - b[0];
      const h = b[3] - b[1];
      const longest = Math.max(w, h);
      const scale = mode === "fit" ? FIT_PX / longest : Math.min(ACTUAL_DPI / 72, MAX_PX / longest);
      const bmp = await engine().render({ docId, page: srcOf(i), scale, rotate: rot, annots: withMarkups });
      if (!bmp.image) continue;
      const turned = (rot + (withMarkups ? 0 : 0)) % 180 !== 0;
      const pw = (turned ? h : w) * (25.4 / 72);
      const ph = (turned ? w : h) * (25.4 / 72);
      // after a save the copy carries the page rotation in /Rotate, so its bounds are already turned
      const wmm = withMarkups && entry.rotation % 180 !== 0 ? ph : pw;
      const hmm = withMarkups && entry.rotation % 180 !== 0 ? pw : ph;
      out.push({ url: await bitmapUrl(bmp.image), wmm, hmm });
      bmp.image.close();
      useApp.setState({ busy: `Preparing page ${out.length} of ${indices.length}…` });
    }
  } finally {
    if (temp) await engine().close(temp);
  }
  return out;
}

function PrintRoot() {
  const jobs = useDialog((s) => s.jobs);
  const mode = useDialog((s) => s.mode);
  if (!jobs) return null;
  return createPortal(
    <div id="print-root" className={`print-${mode}`} data-testid="print-root">
      <style>{`@page { margin: ${mode === "fit" ? "6mm" : "0"}; } @page landscape { size: landscape; } @page portrait { size: portrait; }`}</style>
      {jobs.map((j, i) => (
        <div key={i} className="print-page" style={{ page: j.wmm > j.hmm ? "landscape" : "portrait" } as React.CSSProperties}>
          <img src={j.url} alt={`Page ${i + 1}`} style={mode === "actual" ? { width: `${j.wmm}mm`, height: `${j.hmm}mm` } : undefined} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function PrintDialog() {
  const open = useDialog((s) => s.open);
  const tab = useApp(activeTab);
  const [which, setWhich] = useState<"all" | "current" | "range">("all");
  const [range, setRange] = useState("1");
  const [withMarkups, setWithMarkups] = useState(true);
  const [mode, setMode] = useState<"fit" | "actual">("fit");
  const n = tab?.state.pages.length ?? 0;
  const indices = !tab ? null : which === "all" ? [...Array(n).keys()] : which === "current" ? [tab.currentPage] : parsePageRange(range, n);

  const go = async () => {
    if (!tab || !indices) return;
    useDialog.setState({ open: false });
    try {
      useApp.setState({ busy: "Preparing pages for printing…" });
      const jobs = await preparePrint(tab, indices, withMarkups, mode);
      useDialog.setState({ jobs, mode });
      // wait for images to decode before opening the print dialog
      await new Promise((r) => setTimeout(r, 50));
      await Promise.all([...document.querySelectorAll<HTMLImageElement>("#print-root img")].map((img) => img.decode().catch(() => undefined)));
      useApp.setState({ busy: null });
      window.print();
    } catch (e) {
      flash(`Printing failed: ${(e as Error).message}`, "error");
    } finally {
      useApp.setState({ busy: null });
      const jobs = useDialog.getState().jobs;
      // keep the images until the print dialog has closed (print() blocks in Chromium)
      setTimeout(() => {
        if (!(window as unknown as { __drawsetKeepPrint?: boolean }).__drawsetKeepPrint) {
          jobs?.forEach((j) => URL.revokeObjectURL(j.url));
          useDialog.setState({ jobs: null });
        }
      }, 1000);
    }
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => useDialog.setState({ open: o })}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby={undefined}>
            <Dialog.Title>Print</Dialog.Title>
            <div className="field">
              <span>Pages</span>
              <label className="check">
                <input type="radio" checked={which === "all"} onChange={() => setWhich("all")} /> All ({n})
              </label>
              <label className="check">
                <input type="radio" checked={which === "current"} onChange={() => setWhich("current")} /> Current page
              </label>
              <label className="check">
                <input type="radio" checked={which === "range"} onChange={() => setWhich("range")} /> Pages
                <input className="small" value={range} onChange={(e) => setRange(e.target.value)} onFocus={() => setWhich("range")} data-testid="print-range" />
              </label>
              {which === "range" && !indices && <p className="error">Enter pages between 1 and {n}.</p>}
            </div>
            <label className="check">
              <input type="checkbox" checked={withMarkups} onChange={(e) => setWithMarkups(e.target.checked)} data-testid="print-markups" /> Print markups
            </label>
            <div className="field">
              <span>Page scaling</span>
              <label className="check">
                <input type="radio" checked={mode === "fit"} onChange={() => setMode("fit")} /> Fit to paper
              </label>
              <label className="check">
                <input type="radio" checked={mode === "actual"} onChange={() => setMode("actual")} data-testid="print-actual" /> Actual size
              </label>
            </div>
            <div className="dialog-buttons">
              <Dialog.Close className="btn">Cancel</Dialog.Close>
              <button className="btn primary" disabled={!indices || !indices.length} onClick={go} data-testid="print-go">
                Print…
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <PrintRoot />
    </>
  );
}
