/** Commands shared by menus, toolbar and keyboard shortcuts. */
import { cloneMarkup } from "../markup/edit";
import { newId, nowIso, type Markup, type ReviewStatus } from "../markup/model";
import { closeTab, openWithDialog, saveActive, saveCopyOf, saveTab } from "../state/documents";
import { activeTab, commit, flash, redo, setView, undo, updateTab, useApp, withMarkups, type Rotation, type ToolId } from "../state/store";
import { clampScale } from "../features/viewer/Viewer";

let clipboard: { docId: string; markups: Markup[] } | null = null;

export function setTool(tool: ToolId) {
  useApp.setState((s) => ({ tools: { ...s.tools, tool, chest: null } }));
}

export function withActive(fn: (key: string) => void) {
  const t = activeTab();
  if (t) fn(t.key);
}

export const cmd = {
  open: () => openWithDialog(),
  save: () => saveActive(),
  saveCopy: () => withActive((k) => saveCopyOf(k)),
  close: () => withActive((k) => closeTab(k)),
  undo: () => withActive(undo),
  redo: () => withActive(redo),
  zoomIn: () => withActive((k) => setView(k, { scale: clampScale((activeTab()!.view.scale || 1) * 1.25) })),
  zoomOut: () => withActive((k) => setView(k, { scale: clampScale((activeTab()!.view.scale || 1) / 1.25) })),
  actualSize: () => withActive((k) => setView(k, { scale: 96 / 72 })),
  fitPage: () => withActive((k) => setView(k, { fit: "page" })),
  fitWidth: () => withActive((k) => setView(k, { fit: "width" })),
  rotateView: (deg: 90 | -90) =>
    withActive((k) => {
      const t = activeTab()!;
      setView(k, { rotation: (((t.view.rotation + deg) % 360) + 360) % 360 as Rotation, scrollTo: { page: t.currentPage, nonce: Date.now() } });
    }),
  deleteSelection: () =>
    withActive((k) => {
      const t = activeTab()!;
      const ids = t.selection.filter((id) => t.state.markups[id] && !t.state.markups[id].locked);
      if (!ids.length) return;
      commit(k, ids.length > 1 ? "Delete markups" : "Delete markup", (s) => withMarkups(s, [], ids));
    }),
  copy: () => {
    const t = activeTab();
    if (!t) return;
    const ms = t.selection.map((id) => t.state.markups[id]).filter(Boolean);
    if (ms.length) clipboard = { docId: t.docId, markups: ms };
    else if (t.textSelection?.text) navigator.clipboard?.writeText(t.textSelection.text).catch(() => undefined);
  },
  paste: () =>
    withActive((k) => {
      if (!clipboard) return;
      const t = activeTab()!;
      const page = t.state.pages[t.currentPage];
      if (!page) return;
      const sameDoc = clipboard.docId === t.docId;
      const author = useApp.getState().author;
      const source = clipboard.markups.filter((m) => sameDoc || !(m.keepAppearance || m.kind === "foreign"));
      const copies = source.filter((m) => m.kind !== "foreign").map((m) => {
        const samePage = m.pageId === page.id;
        return cloneMarkup(m, newId(), page.id, samePage ? 12 : 0, samePage ? 12 : 0, author);
      });
      if (!copies.length) return;
      commit(k, "Paste", (s) => withMarkups(s, copies));
      updateTab(k, (x) => ({ ...x, selection: copies.map((c) => c.id) }));
      clipboard = { ...clipboard, markups: copies };
    }),
  duplicate: () =>
    withActive((k) => {
      const t = activeTab()!;
      const author = useApp.getState().author;
      const copies = t.selection
        .map((id) => t.state.markups[id])
        .filter((m) => m && m.kind !== "foreign")
        .map((m) => cloneMarkup(m, newId(), m.pageId, 12, 12, author));
      if (!copies.length) return;
      commit(k, "Duplicate", (s) => withMarkups(s, copies));
      updateTab(k, (x) => ({ ...x, selection: copies.map((c) => c.id) }));
    }),
  selectAllOnPage: () =>
    withActive((k) => {
      const t = activeTab()!;
      const page = t.state.pages[t.currentPage];
      if (!page) return;
      const ids = Object.values(t.state.markups).filter((m) => m.pageId === page.id && !m.hidden).map((m) => m.id);
      updateTab(k, (x) => ({ ...x, selection: ids }));
    }),
  setLocked: (locked: boolean) =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = t.selection.map((id) => t.state.markups[id]).filter((m) => m && m.locked !== locked);
      if (!ms.length) return;
      commit(k, locked ? "Lock" : "Unlock", (s) => withMarkups(s, ms.map((m) => ({ ...m, locked, modified: nowIso() }))));
    }),
  setStatus: (ids: string[], status: ReviewStatus) =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = ids.map((id) => t.state.markups[id]).filter((m) => m && m.status !== status);
      if (!ms.length) return;
      commit(k, `Set status ${status}`, (s) => withMarkups(s, ms.map((m) => ({ ...m, status, modified: nowIso() }))));
    }),
  flatten: async () => {
    const t = activeTab();
    if (!t) return;
    const count = Object.values(t.state.markups).filter((m) => m.kind !== "link").length;
    if (!count) {
      flash("There are no markups to flatten.");
      return;
    }
    const ok = window.confirm(
      `Flatten ${count} markup${count === 1 ? "" : "s"} into the page content and save?\n\nThis is permanent: flattened markups can no longer be edited, moved or listed.`,
    );
    if (!ok) return;
    await saveTab(t.key, { flatten: true });
  },
};
