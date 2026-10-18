/** Commands shared by menus, toolbar and keyboard shortcuts. */
import { cloneMarkup, relinkGroups } from "../markup/edit";
import { copySelection, pasteFromMenu, pasteMarkups, pointerSpot } from "./clipboard";
import { aligned, canFlip, fitToText, flipped, type Alignment } from "../markup/arrange";
export { fitToText };
import { KIND_LABELS, newId, nowIso, type Markup, type ReviewStatus } from "../markup/model";
import { useInteraction } from "../features/viewer/controller";
import { textMarkup } from "../features/viewer/create";
import { closeTab, openWithDialog, saveActive, saveCopyOf, saveTab } from "../state/documents";
import { chooseImageTool } from "./images";
import { activeTab, commit, isContinuous, flash, redo, setView, undo, updateTab, useApp, usePainter, withGroups, withMarkups, showPanel, type PageMode, type PanelId, type Rotation, type ToolId } from "../state/store";
import { jumpTo } from "../features/links/navigate";
import { pageStep, shownFrom } from "../features/viewer/layout";
import { clampScale } from "../features/viewer/Viewer";

const MEASURE_TOOLS = new Set<ToolId>(["calibrate", "length", "polylength", "area", "cutout", "perimeter", "count", "angle", "dimension", "radius", "diameter", "volume"]);

export function setTool(tool: ToolId) {
  useApp.setState((s) => ({ tools: { ...s.tools, tool, chest: null } }));
  // measuring shows the page scale and results
  if (MEASURE_TOOLS.has(tool)) showPanel("measurements");
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
  /** Page layout: one page, continuous, side by side or continuous side by side. Keeps the current page in view. */
  setMode: (mode: PageMode) =>
    withActive((k) => {
      const t = activeTab()!;
      if (t.view.mode === mode) return;
      // one page or pair at a time is shown whole, as the layout is meant to be read
      setView(k, { mode, scrollTo: { page: t.currentPage, nonce: Date.now() }, ...(isContinuous(mode) ? {} : { fit: "page" as const }) });
    }),
  /** Next or previous page (or pair, side by side). */
  pageBy: (dir: 1 | -1) =>
    withActive((k) => {
      const t = activeTab()!;
      const step = pageStep(t.view.mode);
      const to = Math.max(0, Math.min(t.state.pages.length - 1, shownFrom(t.view.mode, t.currentPage) + dir * step));
      if (to !== t.currentPage) jumpTo(k, to);
    }),
  firstPage: () => withActive((k) => jumpTo(k, 0)),
  lastPage: () => withActive((k) => jumpTo(k, activeTab()!.state.pages.length - 1)),
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
  copy: () => void copySelection(),
  cut: () => {
    if (activeTab()?.selection.length && copySelection()) cmd.deleteSelection();
  },
  /** Pastes at the same spot on the current page. */
  pasteInPlace: () => pasteMarkups(null, true),
  /** Pastes centred on the pointer when it is over a page (Ctrl+V itself goes through the paste event). */
  paste: () => void pasteFromMenu(pointerSpot()),
  toggleLocked: () => {
    const t = activeTab();
    if (!t) return;
    const ms = t.selection.map((id) => t.state.markups[id]).filter(Boolean);
    cmd.setLocked(!ms.every((m) => m.locked));
  },
  /** Changes the drawing order of the selected markups on their page. */
  arrange: (how: "forward" | "front" | "backward" | "back") =>
    withActive((k) => {
      const t = activeTab()!;
      const sel = new Set(t.selection.filter((id) => t.state.markups[id]));
      if (!sel.size) return;
      commit(k, how === "front" ? "Bring to front" : how === "back" ? "Send to back" : how === "forward" ? "Bring forward" : "Send backward", (s) => ({ ...s, markups: arranged(s.markups, sel, how) }));
    }),
  /** Fits selected text boxes and callouts to their text, keeping the top-left corner. */
  autosize: () =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = t.selection.map((id) => t.state.markups[id]).filter((m) => m && !m.locked && (m.kind === "textbox" || m.kind === "callout") && m.contents);
      if (!ms.length) return;
      commit(k, "Autosize text", (s) => withMarkups(s, ms.map(fitToText)));
    }),
  openSearch: () => {
    showPanel("search");
    requestAnimationFrame(() => (document.querySelector('[data-testid="search-input"]') as HTMLInputElement | null)?.focus());
  },
  chooseImage: () => void chooseImageTool("image"),
  /** Hides both side panels, or brings back the ones that were open. */
  toggleSidePanels: () => {
    const s = useApp.getState();
    if (s.leftPanel || s.rightPanel) {
      hiddenPanels = { left: s.leftPanel, right: s.rightPanel };
      useApp.setState({ leftPanel: null, rightPanel: null });
    } else useApp.setState({ leftPanel: hiddenPanels.left ?? "thumbnails", rightPanel: hiddenPanels.right ?? "properties" });
  },
  fullScreen: () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  },
  cycleTab: (dir: 1 | -1) => {
    const s = useApp.getState();
    if (s.tabs.length < 2) return;
    const i = s.tabs.findIndex((t) => t.key === s.active);
    useApp.setState({ active: s.tabs[(i + dir + s.tabs.length) % s.tabs.length].key });
  },
  closeAll: async () => {
    for (const t of [...useApp.getState().tabs]) if (!(await closeTab(t.key))) return;
  },
  /** Picks up the selected markup's format; the next markup clicked gets it (Ctrl+Shift+C). */
  formatPainter: () =>
    withActive(() => {
      const t = activeTab()!;
      const src = t.selection.map((id) => t.state.markups[id]).find((m) => m && m.kind !== "foreign");
      if (!src) return flash("Select the markup whose format you want to copy, then use the format painter.");
      usePainter.setState({ source: src });
      useApp.setState((s) => ({ tools: { ...s.tools, tool: "painter", chest: null } }));
      flash("Click the markups to copy the format to. Esc when done.");
    }),
  /** Lines up the selected markups (each group as one) on their page. */
  align: (how: Alignment) =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = withGroups(t.state.markups, t.selection).map((id) => t.state.markups[id]).filter(Boolean);
      const moved = aligned(ms, how, (m) => m.group ?? m.id);
      if (moved.length) commit(k, "Align", (s) => withMarkups(s, moved));
      else if (new Set(ms.map((m) => m.group ?? m.id)).size < 2) flash("Select two or more markups to align.");
    }),
  /** Mirrors the selected shapes and lines across their middle. */
  flip: (axis: "horizontal" | "vertical") =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = withGroups(t.state.markups, t.selection).map((id) => t.state.markups[id]).filter(Boolean);
      const out = flipped(ms, axis);
      if (out.length) commit(k, axis === "horizontal" ? "Flip horizontal" : "Flip vertical", (s) => withMarkups(s, out));
      else if (ms.length && !ms.some(canFlip)) flash("Text, stamps and images can't be flipped.");
    }),
  /** Groups the selected markups (Ctrl+G): they are then selected, moved and copied together. */
  group: () =>
    withActive((k) => {
      const t = activeTab()!;
      const ms = withGroups(t.state.markups, t.selection).map((id) => t.state.markups[id]).filter(Boolean);
      if (ms.length < 2) return flash("Select two or more markups to group.");
      if (new Set(ms.map((m) => m.pageId)).size > 1) return flash("Only markups on the same page can be grouped.", "error");
      const lead = ms.find((m) => m.id === t.selection[0]) ?? ms[0];
      const now = nowIso();
      commit(k, "Group", (s) => withMarkups(s, ms.map((m) => ({ ...m, group: m.id === lead.id ? undefined : lead.id, modified: now }))));
      updateTab(k, (x) => ({ ...x, selection: ms.map((m) => m.id) }));
    }),
  /** Breaks up the groups in the selection (Ctrl+Shift+G). */
  ungroup: () =>
    withActive((k) => {
      const t = activeTab()!;
      const ids = withGroups(t.state.markups, t.selection);
      const ms = ids.map((id) => t.state.markups[id]).filter((m) => m?.group);
      if (!ms.length) return flash("The selection is not grouped.");
      const now = nowIso();
      commit(k, "Ungroup", (s) => withMarkups(s, ms.map((m) => ({ ...m, group: undefined, modified: now }))));
      updateTab(k, (x) => ({ ...x, selection: ids }));
    }),
  /** Opens the Properties panel, putting the cursor in one of its fields (the comment, or the reply box). */
  showProperties: (focus: "prop-comment" | "reply-input" = "prop-comment") => {
    showPanel("properties");
    // the panel renders on the next frame
    requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelector(`[data-testid="${focus}"]`) as HTMLElement | null)?.focus()));
  },
  /** Starts typing into a text box or callout. */
  editText: (id: string) =>
    withActive((k) => {
      const m = activeTab()!.state.markups[id];
      if (!m || m.locked || (m.kind !== "textbox" && m.kind !== "callout")) return;
      updateTab(k, (x) => ({ ...x, selection: [id] }));
      useInteraction.setState({ editingId: id });
    }),
  /** Makes the selected markups' format the default for new markups of their kinds. */
  setAsDefault: () => {
    const t = activeTab();
    if (!t) return;
    const ms = t.selection.map((id) => t.state.markups[id]).filter((m) => m && m.kind !== "foreign" && m.kind !== "image" && m.kind !== "signature");
    if (!ms.length) return;
    useApp.setState((s) => ({ tools: { ...s.tools, defaults: { ...s.tools.defaults, ...Object.fromEntries(ms.map((m) => [m.kind, { ...m.style }])) } } }));
    flash(ms.length === 1 ? `New ${KIND_LABELS[ms[0].kind].toLowerCase()} markups will look like this one.` : "New markups will look like these.");
  },
  /** Highlights, underlines or strikes through the selected PDF text. */
  markText: (kind: "highlight" | "underline" | "strikeout") =>
    withActive((k) => {
      const ts = activeTab()!.textSelection;
      if (!ts?.quads.length) return;
      const m = textMarkup(kind, ts.pageId, ts.quads, ts.text);
      commit(k, KIND_LABELS[kind], (s) => withMarkups(s, [m]));
      updateTab(k, (x) => ({ ...x, selection: [m.id], textSelection: null }));
    }),
  duplicate: () =>
    withActive((k) => {
      const t = activeTab()!;
      const author = useApp.getState().author;
      const originals = t.selection.map((id) => t.state.markups[id]).filter((m) => m && m.kind !== "foreign");
      const copies = relinkGroups(originals, originals.map((m) => cloneMarkup(m, newId(), m.pageId, 12, 12, author)));
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

let hiddenPanels: { left: PanelId | null; right: PanelId | null } = { left: null, right: null };

/** The markups object reordered (drawing order is insertion order, per page). */
export function arranged(markups: Record<string, Markup>, sel: Set<string>, how: "forward" | "front" | "backward" | "back"): Record<string, Markup> {
  const all = Object.values(markups);
  const pages = new Set(all.filter((m) => sel.has(m.id)).map((m) => m.pageId));
  let order = all.map((m) => m.id);
  for (const pageId of pages) {
    const onPage = order.filter((id) => markups[id].pageId === pageId);
    let next = [...onPage];
    if (how === "front") next = [...onPage.filter((id) => !sel.has(id)), ...onPage.filter((id) => sel.has(id))];
    else if (how === "back") next = [...onPage.filter((id) => sel.has(id)), ...onPage.filter((id) => !sel.has(id))];
    else if (how === "forward") {
      for (let i = next.length - 2; i >= 0; i--) if (sel.has(next[i]) && !sel.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    } else {
      for (let i = 1; i < next.length; i++) if (sel.has(next[i]) && !sel.has(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1], next[i]];
    }
    // put the page's markups back in the slots they used, in the new order
    let k = 0;
    order = order.map((id) => (markups[id].pageId === pageId ? next[k++] : id));
  }
  const out: Record<string, Markup> = {};
  for (const id of order) out[id] = sel.has(id) ? { ...markups[id], modified: nowIso() } : markups[id];
  return out;
}

