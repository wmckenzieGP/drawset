/** Opening, saving and closing documents: glue between the store, the engine and the host. */
import { engine } from "../engine/client";
import type { SavePlan } from "../engine/types";
import { sameScale } from "../markup/measure";
import { openPdfDialog, rememberRecentName, readPath, saveAs, saveInPlace, setDirty, type OpenedFile } from "../platform/host";
import { renderCache } from "../features/viewer/renderCache";
import { invalidateApBitmaps } from "../features/viewer/overlay";
import { forgetContentIndexes } from "../features/viewer/snap";
import { addTab, activeTab, flash, isDirty, pagesFromInfo, recordsToMarkups, setLoadedMarkups, updateTab, useApp, type DocState, type DocTab } from "./store";

export async function openFiles(files: OpenedFile[]) {
  for (const f of files) {
    const existing = f.path ? useApp.getState().tabs.find((t) => t.path === f.path) : undefined;
    if (existing) {
      useApp.setState({ active: existing.key });
      continue;
    }
    try {
      useApp.setState({ busy: `Opening ${f.name}…` });
      const info = await engine().open(f.bytes, f.name);
      const key = addTab(info, f.name, f.path);
      rememberRecentName(f.name);
      useApp.setState({ busy: null });
      // markups load after the first page is on screen
      engine()
        .readMarkups(info.docId)
        .then((records) => {
          const tab = useApp.getState().tabs.find((t) => t.key === key);
          if (tab) setLoadedMarkups(key, recordsToMarkups(records, tab.state.pages));
        })
        .catch((e) => flash(`Could not read markups: ${e.message}`, "error"));
    } catch (e) {
      useApp.setState({ busy: null });
      flash(`Could not open ${f.name}: ${(e as Error).message}`, "error");
    }
  }
}

export async function openWithDialog() {
  const files = await openPdfDialog();
  if (files.length) await openFiles(files);
}

export async function openPath(p: string) {
  try {
    await openFiles([await readPath(p)]);
  } catch (e) {
    flash(`Could not open ${p}: ${(e as Error).message}`, "error");
  }
}

/** Builds the save plan: what changed since the last save. */
export function buildPlan(t: DocTab, state: DocState = t.state, opts: { flatten?: boolean; applyRedactions?: boolean; pageIds?: string[] } = {}): SavePlan {
  const pages = opts.pageIds ? opts.pageIds.map((id) => state.pages.find((p) => p.id === id)).filter((p): p is DocState["pages"][number] => !!p) : state.pages;
  const physOf = new Map(state.pages.map((p) => [p.id, p.src]));
  const upserts: SavePlan["upserts"] = [];
  for (const m of Object.values(state.markups)) {
    if (t.saved.markups[m.id] === m && m.objNum !== undefined) continue;
    const page = physOf.get(m.pageId);
    if (page === undefined) continue;
    upserts.push({ markup: m, page });
  }
  const deletes: number[] = [];
  for (const m of Object.values(t.saved.markups)) {
    if (!state.markups[m.id] && m.objNum !== undefined) deletes.push(m.objNum);
  }
  return {
    pages: pages.map((p) => ({ index: p.src, rotate: (p.info.rotate + p.rotation) % 360, ...(sameScale(p.scale, p.info.scale) ? {} : { scale: p.scale }) })),
    upserts,
    deletes,
    flatten: opts.flatten,
    applyRedactions: opts.applyRedactions,
    defaultAuthor: useApp.getState().author,
  };
}

function syncDirtyFlag() {
  setDirty(useApp.getState().tabs.some(isDirty));
}
useApp.subscribe(syncDirtyFlag);

/** Saves in place (incremental) and reloads the document from the saved bytes. */
export async function saveTab(key: string, opts: { flatten?: boolean; applyRedactions?: boolean } = {}): Promise<boolean> {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return false;
  try {
    useApp.setState({ busy: "Saving…" });
    const plan = buildPlan(t, t.state, opts);
    const res = await engine().save(t.docId, plan, "incremental");
    renderCache.invalidateDoc(t.docId);
    invalidateApBitmaps(t.docId);
    forgetContentIndexes(t.docId);
    const path = await saveInPlace(t.path, t.name, res.bytes);
    const pages = pagesFromInfo(res.info);
    const state: DocState = { pages, markups: recordsToMarkups(res.markups, pages) };
    updateTab(key, (x) => ({
      ...x,
      info: res.info,
      path: path ?? x.path,
      state,
      saved: state,
      undo: [],
      redo: [],
      selection: x.selection.filter((id) => state.markups[id]),
      pageSelection: [],
      markupsLoaded: true,
      search: { ...x.search, hits: [], current: -1, done: false },
      textSelection: null,
    }));
    flash(opts.flatten ? "Markups flattened and saved." : opts.applyRedactions ? "Redactions applied and saved." : `Saved ${t.name}.`);
    return true;
  } catch (e) {
    flash(`Save failed: ${(e as Error).message}`, "error");
    return false;
  } finally {
    useApp.setState({ busy: null });
  }
}

export async function saveActive() {
  const t = activeTab();
  if (t) await saveTab(t.key);
}

/** Writes a full copy with all markups; the open document is unchanged. */
export async function saveCopyOf(key: string, pageIds?: string[], suggestedName?: string): Promise<boolean> {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return false;
  try {
    useApp.setState({ busy: "Writing copy…" });
    const bytes = await engine().saveCopy(t.docId, buildPlan(t, t.state, { pageIds }));
    useApp.setState({ busy: null });
    const name = suggestedName ?? t.name.replace(/\.pdf$/i, "") + " copy.pdf";
    await saveAs(name, bytes);
    return true;
  } catch (e) {
    flash(`Could not write the copy: ${(e as Error).message}`, "error");
    return false;
  } finally {
    useApp.setState({ busy: null });
  }
}

export async function closeTab(key: string, force = false): Promise<boolean> {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return true;
  if (!force && isDirty(t) && !window.confirm(`${t.name} has unsaved changes. Close it without saving?`)) return false;
  useApp.setState((s) => {
    const tabs = s.tabs.filter((x) => x.key !== key);
    const idx = s.tabs.findIndex((x) => x.key === key);
    const active = s.active === key ? (tabs[Math.min(idx, tabs.length - 1)]?.key ?? null) : s.active;
    return { tabs, active };
  });
  await engine().close(t.docId);
  return true;
}
