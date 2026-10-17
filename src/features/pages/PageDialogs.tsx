import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { activeTab, flash, useApp } from "../../state/store";
import { pickLocalFiles, type OpenedFile } from "../../platform/host";
import { extractPages, insertFromFiles, parsePageRange, parseRangeGroups, splitDocument } from "./pageOps";

type Kind = "insert" | "combine" | "extract" | "split";
const useDialog = create<{ kind: Kind | null }>(() => ({ kind: null }));
export const openPageDialog = (kind: Kind) => useDialog.setState({ kind });
const close = () => useDialog.setState({ kind: null });

function FilesField({ files, setFiles }: { files: OpenedFile[]; setFiles: (f: OpenedFile[]) => void }) {
  return (
    <div className="field">
      <span>Files</span>
      <div className="file-list">
        {files.length === 0 && <span className="muted">No files chosen</span>}
        {files.map((f, i) => (
          <div key={i} className="file-row">
            {f.name}
            <button type="button" className="link" onClick={() => setFiles(files.filter((_, k) => k !== i))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn" data-testid="choose-files" onClick={async () => setFiles([...files, ...(await pickLocalFiles("application/pdf,.pdf", true))])}>
        Add files…
      </button>
    </div>
  );
}

function InsertDialog({ combine }: { combine: boolean }) {
  const tab = useApp(activeTab);
  const [files, setFiles] = useState<OpenedFile[]>([]);
  const [where, setWhere] = useState<"after" | "before" | "start" | "end">(combine ? "end" : "after");
  if (!tab) return null;
  const at = where === "start" ? 0 : where === "end" ? tab.state.pages.length : where === "before" ? tab.currentPage : tab.currentPage + 1;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!files.length) return;
        close();
        await insertFromFiles(tab.key, files, at);
      }}
    >
      <FilesField files={files} setFiles={setFiles} />
      {!combine && (
        <label className="field">
          <span>Position</span>
          <select value={where} onChange={(e) => setWhere(e.target.value as typeof where)}>
            <option value="after">After the current page ({tab.currentPage + 1})</option>
            <option value="before">Before the current page ({tab.currentPage + 1})</option>
            <option value="start">At the start</option>
            <option value="end">At the end</option>
          </select>
        </label>
      )}
      <p className="muted">Markups in the inserted files come across with their pages.</p>
      <div className="dialog-buttons">
        <Dialog.Close className="btn" type="button">Cancel</Dialog.Close>
        <button type="submit" className="btn primary" disabled={!files.length} data-testid="dialog-ok">
          {combine ? "Combine" : "Insert"}
        </button>
      </div>
    </form>
  );
}

function ExtractDialog() {
  const tab = useApp(activeTab);
  const n = tab?.state.pages.length ?? 0;
  const sel = tab ? tab.state.pages.map((p, i) => (tab.pageSelection.includes(p.id) ? i + 1 : 0)).filter(Boolean) : [];
  const [range, setRange] = useState(sel.length ? sel.join(", ") : tab ? String(tab.currentPage + 1) : "1");
  const [separate, setSeparate] = useState(false);
  if (!tab) return null;
  const parsed = parsePageRange(range, n);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!parsed) return;
        close();
        await extractPages(tab.key, parsed, separate);
      }}
    >
      <label className="field">
        <span>Pages (for example 1-3, 7)</span>
        <input value={range} onChange={(e) => setRange(e.target.value)} data-testid="range" autoFocus />
      </label>
      {!parsed && <p className="error">Enter page numbers between 1 and {n}.</p>}
      <label className="check">
        <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /> One file per page
      </label>
      <div className="dialog-buttons">
        <Dialog.Close className="btn" type="button">Cancel</Dialog.Close>
        <button type="submit" className="btn primary" disabled={!parsed} data-testid="dialog-ok">Extract</button>
      </div>
    </form>
  );
}

function SplitDialog() {
  const tab = useApp(activeTab);
  const n = tab?.state.pages.length ?? 0;
  const [mode, setMode] = useState<"every" | "ranges">("every");
  const [every, setEvery] = useState("10");
  const [ranges, setRanges] = useState(`1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}`);
  if (!tab) return null;
  let groups: number[][] | null = null;
  if (mode === "every") {
    const k = parseInt(every, 10);
    if (k >= 1) {
      groups = [];
      for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
    }
  } else groups = parseRangeGroups(ranges, n);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!groups) return;
        if (groups.length > 100) {
          flash("That would create more than 100 files.", "error");
          return;
        }
        close();
        await splitDocument(tab.key, groups);
      }}
    >
      <label className="check">
        <input type="radio" checked={mode === "every"} onChange={() => setMode("every")} /> Every
        <input className="small" value={every} onChange={(e) => setEvery(e.target.value)} disabled={mode !== "every"} /> pages
      </label>
      <label className="check">
        <input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} /> By page ranges, one file each
      </label>
      <input value={ranges} onChange={(e) => setRanges(e.target.value)} disabled={mode !== "ranges"} data-testid="split-ranges" />
      {groups ? <p className="muted">Creates {groups.length} file{groups.length === 1 ? "" : "s"}.</p> : <p className="error">Check the page numbers (1 to {n}).</p>}
      <div className="dialog-buttons">
        <Dialog.Close className="btn" type="button">Cancel</Dialog.Close>
        <button type="submit" className="btn primary" disabled={!groups} data-testid="dialog-ok">Split</button>
      </div>
    </form>
  );
}

const TITLES: Record<Kind, string> = { insert: "Insert pages from file", combine: "Combine files", extract: "Extract pages", split: "Split document" };

export function PageDialogs() {
  const kind = useDialog((s) => s.kind);
  return (
    <Dialog.Root open={!!kind} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title>{kind ? TITLES[kind] : ""}</Dialog.Title>
          {kind === "insert" && <InsertDialog combine={false} />}
          {kind === "combine" && <InsertDialog combine />}
          {kind === "extract" && <ExtractDialog />}
          {kind === "split" && <SplitDialog />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
