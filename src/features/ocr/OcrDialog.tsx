import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { ensureRights } from "../../state/documents";
import { activeTab, flash, useApp } from "../../state/store";
import { runOcr, type OcrProgress } from "./ocr";

export const useOcrDialog = create<{ open: boolean }>(() => ({ open: false }));

export async function openOcr() {
  const t = activeTab();
  if (!t) return;
  if (!t.info.security.owner && !t.info.security.permissions.edit && !(await ensureRights(t.key, "Adding recognised text changes the page content."))) return;
  useOcrDialog.setState({ open: true });
}

type Scope = "all" | "current" | "range";

export function OcrDialog() {
  const open = useOcrDialog((s) => s.open);
  const tab = useApp(activeTab);
  const [scope, setScope] = useState<Scope>("all");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [skipText, setSkipText] = useState(true);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const cancelled = useRef(false);
  const n = tab?.state.pages.length ?? 0;

  useEffect(() => {
    if (!open) return;
    setProgress(null);
    setFrom(1);
    setTo(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !tab) return null;
  const running = progress !== null;
  const close = () => {
    cancelled.current = true;
    useOcrDialog.setState({ open: false });
  };

  const start = async () => {
    const positions =
      scope === "all"
        ? [...Array(n).keys()]
        : scope === "current"
          ? [tab.currentPage]
          : [...Array(n).keys()].filter((i) => i >= Math.max(1, from) - 1 && i <= Math.min(n, to) - 1);
    if (!positions.length) {
      flash("Choose at least one page.", "error");
      return;
    }
    cancelled.current = false;
    setProgress({ done: 0, total: positions.length, page: null });
    try {
      const res = await runOcr(tab.key, positions, { skipText, onProgress: setProgress, cancelled: () => cancelled.current });
      if (!res) {
        flash("Text recognition cancelled.");
      } else if (!res.pages) {
        flash("Every chosen page already has text. Untick “Skip pages that already have text” to read them anyway.");
      } else {
        const skipped = res.skipped ? ` ${res.skipped} page${res.skipped === 1 ? "" : "s"} already had text.` : "";
        flash(`Recognised ${res.words} word${res.words === 1 ? "" : "s"} on ${res.pages} page${res.pages === 1 ? "" : "s"}.${skipped} The text can now be searched and selected.`);
      }
    } catch (e) {
      flash(`Could not recognise text: ${(e as Error).message}`, "error");
    } finally {
      setProgress(null);
      if (!cancelled.current) useOcrDialog.setState({ open: false });
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog ocr-dialog" aria-describedby={undefined} data-testid="ocr-dialog">
          <Dialog.Title>Recognise text</Dialog.Title>
          <p className="muted">Reads the words on scanned pages and adds them as invisible text, so the pages can be searched and text can be selected and copied. The scan itself is not changed. English text is recognised, on this computer.</p>
          <div className="ocr-scope">
            <label className="check">
              <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} disabled={running} data-testid="ocr-all" /> All pages
            </label>
            <label className="check">
              <input type="radio" checked={scope === "current"} onChange={() => setScope("current")} disabled={running} data-testid="ocr-current" /> Current page ({tab.state.pages[tab.currentPage]?.label || tab.currentPage + 1})
            </label>
            <label className="check">
              <input type="radio" checked={scope === "range"} onChange={() => setScope("range")} disabled={running} data-testid="ocr-range" /> Pages
              <input className="small" type="number" min={1} max={n} value={from} onChange={(e) => { setFrom(Number(e.target.value) || 1); setScope("range"); }} disabled={running} aria-label="First page" data-testid="ocr-from" />
              to
              <input className="small" type="number" min={1} max={n} value={to} onChange={(e) => { setTo(Number(e.target.value) || n); setScope("range"); }} disabled={running} aria-label="Last page" data-testid="ocr-to" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={skipText} onChange={(e) => setSkipText(e.target.checked)} disabled={running} data-testid="ocr-skip" /> Skip pages that already have text
          </label>
          {running && (
            <div className="ocr-progress" data-testid="ocr-progress">
              <progress max={progress.total} value={progress.done} />
              <span className="muted">
                {progress.page === null ? "Starting…" : `Reading page ${tab.state.pages[progress.page]?.label || progress.page + 1} (${progress.done + 1} of ${progress.total})…`}
              </span>
            </div>
          )}
          <div className="dialog-buttons">
            <button className="btn" onClick={close} data-testid="ocr-cancel">
              Cancel
            </button>
            <button className="btn primary" onClick={() => void start()} disabled={running} data-testid="ocr-start">
              Recognise
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
