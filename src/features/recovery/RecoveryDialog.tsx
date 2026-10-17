import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { isDesktop, pickLocalFiles } from "../../platform/host";
import { openFiles, openPath } from "../../state/documents";
import { commit, flash, useApp, type DocTab } from "../../state/store";
import { journalStore, pendingJournals, stateFromJournal, type JournalEntry } from "./journal";

function waitForTab(pred: (t: DocTab) => boolean, ms = 30000): Promise<DocTab | null> {
  return new Promise((resolve) => {
    const find = () => useApp.getState().tabs.find(pred) ?? null;
    const now = find();
    if (now) return resolve(now);
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, ms);
    const unsub = useApp.subscribe(() => {
      const t = find();
      if (!t) return;
      clearTimeout(timer);
      unsub();
      resolve(t);
    });
  });
}

/** Opens the journal's file (asking for it in the browser) and applies its changes as one undo step. */
export async function restoreJournal(j: JournalEntry): Promise<boolean> {
  const before = new Set(useApp.getState().tabs.map((t) => t.key));
  if (j.path && isDesktop) await openPath(j.path);
  else {
    const files = await pickLocalFiles("application/pdf,.pdf");
    if (!files.length) return false;
    await openFiles(files);
  }
  const t = await waitForTab((x) => (j.path && isDesktop ? x.path === j.path : !before.has(x.key) || x.key === useApp.getState().active) && x.markupsLoaded);
  if (!t) {
    flash(`Could not open ${j.name} to restore its changes.`, "error");
    return false;
  }
  if (t.fingerprint !== j.sha256 && !window.confirm(`${t.name} is not the same file the changes were made to (it has changed or is a different file).\n\nRestore the changes anyway? Markups may land in the wrong place.`)) return false;
  commit(t.key, "Restore unsaved changes", () => stateFromJournal(t, j));
  await journalStore().remove(j.id).catch(() => undefined);
  const notes = [j.skippedPages ? `${j.skippedPages} page${j.skippedPages === 1 ? "" : "s"} inserted from other files could not be restored` : "", j.securityDropped ? "the security change was not kept (passwords are never stored)" : ""].filter(Boolean);
  flash(`Restored the unsaved changes to ${t.name}${notes.length ? `; ${notes.join("; ")}` : ""}. Save to keep them.`);
  return true;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

export function RecoveryDialog() {
  const [list, setList] = useState<JournalEntry[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pendingJournals().then(setList);
  }, []);
  if (!list.length) return null;
  const drop = async (j: JournalEntry) => {
    await journalStore().remove(j.id).catch(() => undefined);
    setList((l) => l.filter((x) => x.id !== j.id));
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && setList([])}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide" aria-describedby={undefined} data-testid="recovery-dialog">
          <Dialog.Title>Recover unsaved changes</Dialog.Title>
          <p>Drawset did not close normally last time. These documents had changes that were not saved:</p>
          <ul className="recovery-list">
            {list.map((j) => (
              <li key={j.id} data-testid="recovery-item">
                <div>
                  <strong>{j.name}</strong>
                  <div className="muted">
                    {j.path ?? "Opened in the browser"} · {j.markups.length} markup{j.markups.length === 1 ? "" : "s"} · {when(j.savedAt)}
                  </div>
                </div>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (await restoreJournal(j)) setList((l) => l.filter((x) => x.id !== j.id));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  data-testid="recovery-restore"
                >
                  {j.path && isDesktop ? "Restore" : "Choose the file…"}
                </button>
                <button className="btn" disabled={busy} onClick={() => drop(j)} data-testid="recovery-discard">
                  Discard
                </button>
              </li>
            ))}
          </ul>
          <div className="dialog-buttons">
            <button className="btn" onClick={() => setList([])}>
              Decide later
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
