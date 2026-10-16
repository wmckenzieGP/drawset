import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { markupBounds } from "../../markup/appearance";
import { activeTab, commit, scrollToPage, useApp, withMarkups } from "../../state/store";
import { saveTab } from "../../state/documents";

const useDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openRedactDialog = () => activeTab() && useDialog.setState({ open: true });

/** Review every pending redaction and erase, then apply them all (permanent) and save. */
export function RedactDialog() {
  const open = useDialog((s) => s.open);
  const tab = useApp(activeTab);
  if (!tab) return null;
  const pageIndex = new Map(tab.state.pages.map((p, i) => [p.id, i]));
  const pending = Object.values(tab.state.markups)
    .filter((m) => (m.kind === "redact" || m.kind === "erase") && pageIndex.has(m.pageId))
    .sort((a, b) => pageIndex.get(a.pageId)! - pageIndex.get(b.pageId)!);
  const close = () => useDialog.setState({ open: false });
  const apply = async () => {
    close();
    await saveTab(tab.key, { applyRedactions: true });
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog wide" aria-describedby={undefined} data-testid="redact-dialog">
          <Dialog.Title>Review redactions</Dialog.Title>
          {pending.length === 0 ? (
            <p className="muted">There is nothing to apply. Use the Erase or Redact tools, or mark search results for redaction.</p>
          ) : (
            <>
              <p>
                Applying permanently removes the content under {pending.length} area{pending.length === 1 ? "" : "s"}: text, image pixels and drawing lines that lie wholly inside. Redactions become black boxes; erased
                areas are left blank. The file is then saved in full, so the removed content is not kept in an earlier version inside it.
              </p>
              <ul className="redact-list" data-testid="redact-list">
                {pending.map((m) => {
                  const i = pageIndex.get(m.pageId)!;
                  return (
                    <li key={m.id}>
                      <button className="link" onClick={() => scrollToPage(tab.key, i, markupBounds(m))}>
                        Page {tab.state.pages[i].info.label}
                      </button>{" "}
                      {m.kind === "redact" ? "Redaction" : "Erase"}
                      {m.contents ? <span className="muted"> “{m.contents.slice(0, 60)}”</span> : null}
                      <button className="link" onClick={() => commit(tab.key, "Remove redaction", (s) => withMarkups(s, [], [m.id]))}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="dialog-buttons">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary danger" disabled={!pending.length} onClick={apply} data-testid="redact-apply">
              Apply and save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
