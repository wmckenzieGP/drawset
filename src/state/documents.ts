/** Opening, saving and closing documents: glue between the store, the engine and the host. */
import { engine } from "../engine/client";
import type { Decoration, DocInfo, OcrPage, SavePlan } from "../engine/types";
import { askText } from "../app/AskDialog";
import { dropJournal, sha256Hex } from "../features/recovery/journal";
import { currentSpec, decorationsFor, specJson } from "../features/headerFooter/hf";
import { sameScale } from "../markup/measure";
import { openPdfDialog, rememberRecentName, readPath, saveAs, savePathFor, setDirty, writeSaved, type OpenedFile } from "../platform/host";
import { renderCache } from "../features/viewer/renderCache";
import { invalidateApBitmaps } from "../features/viewer/overlay";
import { forgetContentIndexes } from "../features/viewer/snap";
import { runSearch } from "../features/search/SearchPanel";
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
      // fingerprint first: the bytes are handed to the engine
      const fingerprint = await sha256Hex(f.bytes).catch(() => undefined);
      const info = await openWithPassword(f);
      if (!info) {
        useApp.setState({ busy: null });
        continue;
      }
      const key = addTab(info, f.name, f.path);
      updateTab(key, (t) => ({ ...t, fingerprint }));
      rememberRecentName(f.name);
      if (info.hasForm) loadFields(key);
      useApp.setState({ busy: null });
      // markups load after the first page is on screen
      engine()
        .readMarkups(info.docId)
        .then((records) => {
          if (useApp.getState().tabs.some((t) => t.key === key)) setLoadedMarkups(key, records);
        })
        .catch((e) => {
          flash(`Could not read markups: ${e.message}`, "error");
          // the file's annotations are then simply left as they are; the document can still be edited and saved
          if (useApp.getState().tabs.some((t) => t.key === key)) setLoadedMarkups(key, []);
        });
    } catch (e) {
      useApp.setState({ busy: null });
      flash(`Could not open ${f.name}: ${(e as Error).message}`, "error");
    }
  }
}

const ENCRYPT = new TextEncoder().encode("/Encrypt");

/** Whether the file may be encrypted (then the bytes are copied to the engine so a retry with a password can reuse them). */
function mayBeEncrypted(bytes: Uint8Array): boolean {
  const first = ENCRYPT[0];
  for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - ENCRYPT.length; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < ENCRYPT.length && bytes[i + k] === ENCRYPT[k]) k++;
    if (k === ENCRYPT.length) return true;
  }
  return false;
}

/** Opens a file, asking for its password when it has one; null when the user gives up. */
async function openWithPassword(f: OpenedFile): Promise<DocInfo | null> {
  const keep = mayBeEncrypted(f.bytes);
  let password: string | undefined;
  let note = "";
  for (;;) {
    try {
      return await engine().open(keep ? f.bytes.slice() : f.bytes, f.name, password, keep);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "NEEDS_PASSWORD" && msg !== "WRONG_PASSWORD") throw e;
      if (msg === "WRONG_PASSWORD") note = "That password is not right. Try again.";
      useApp.setState({ busy: null });
      const pw = await askText({ title: `${f.name} is protected`, label: "Password", password: true, note: note || "Type the password to open this file.", ok: "Open" });
      if (pw === null) return null;
      password = pw;
      useApp.setState({ busy: `Opening ${f.name}…` });
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

async function loadFields(key: string) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return;
  try {
    const fields = await engine().formFields(t.docId);
    updateTab(key, (x) => ({ ...x, fields }));
  } catch (e) {
    flash(`Could not read the form: ${(e as Error).message}`, "error");
  }
}

/** Field values the engine document currently holds, per document (absent: as in the file). */
const appliedFields = new Map<string, Record<string, string>>();

export function fileFieldValues(t: DocTab): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of t.fields ?? []) out[f.name] = f.value;
  return out;
}

// keeps the engine's form in step with the undoable state, then redraws the pages that changed
useApp.subscribe((s, prev) => {
  for (const t of s.tabs) {
    if (!t.fields) continue;
    const before = prev.tabs.find((x) => x.key === t.key);
    if (before && before.state.fields === t.state.fields && before.fields === t.fields) continue;
    const file = fileFieldValues(t);
    const applied = appliedFields.get(t.docId) ?? file;
    const target = { ...file, ...(t.state.fields ?? {}) };
    const diff: Record<string, string> = {};
    for (const [k, v] of Object.entries(target)) if (applied[k] !== v) diff[k] = v;
    if (!Object.keys(diff).length) continue;
    appliedFields.set(t.docId, target);
    engine()
      .setFieldValues(t.docId, diff)
      .then((pages) => {
        if (pages.length) renderCache.refreshDoc(t.docId, new Set(pages));
      })
      .catch((e) => flash(`Could not fill the form: ${(e as Error).message}`, "error"));
  }
});

/** Page content changed in the engine: redraw it, and forget anything worked out from the old text. */
function contentChanged(key: string, docId: string, pages: number[]) {
  renderCache.refreshDoc(docId, new Set(pages));
  forgetContentIndexes(docId);
  // results found in the old text are stale: search again quietly (a search already running reads the new text from here on)
  const q = useApp.getState().tabs.find((x) => x.key === key)?.search;
  if (q?.query && !q.running) void runSearch(key, q.query, false);
}

/** Each physical page's decoration (as JSON) that the engine document currently holds, per document. */
const appliedDecor = new Map<string, Map<number, string>>();

const appliedSpec = new Map<string, string | null>();

const decorKey = (d: Decoration | null) => (d ? JSON.stringify(d) : "");

/** What the file itself holds: its saved settings applied to its own pages. */
function fileDecorations(t: DocTab): Map<number, string> {
  const saved = decorationsFor(t, { ...t.saved, headerFooter: undefined });
  return new Map([...saved].map(([k, v]) => [k, decorKey(v)]));
}

// headers, footers and watermarks follow the undoable state (and page order, labels and rotation)
useApp.subscribe((s, prev) => {
  for (const t of s.tabs) {
    const before = prev.tabs.find((x) => x.key === t.key);
    if (before && before.state === t.state) continue;
    const spec = currentSpec(t);
    if (!spec && !appliedDecor.has(t.docId) && !t.info.headerFooter) continue;
    const applied = appliedDecor.get(t.docId) ?? fileDecorations(t);
    const want = decorationsFor(t);
    const pages: Record<number, Decoration | null> = {};
    const next = new Map(applied);
    for (const [src, d] of want) {
      const k = decorKey(d);
      if ((applied.get(src) ?? "") === k) continue;
      pages[src] = d;
      next.set(src, k);
    }
    const json = specJson(spec);
    const specChanged = json !== (appliedSpec.get(t.docId) ?? t.info.headerFooter);
    if (!Object.keys(pages).length && !specChanged) continue;
    appliedDecor.set(t.docId, next);
    appliedSpec.set(t.docId, json);
    engine()
      .setDecorations(t.docId, pages, json)
      .then((changed) => {
        if (changed.length) contentChanged(t.key, t.docId, changed);
      })
      .catch((e) => flash(`Could not update headers and footers: ${(e as Error).message}`, "error"));
  }
});
/** Each physical page's recognised-text layer that the engine document currently holds, per document. */
const appliedOcr = new Map<string, Record<number, OcrPage | null>>();

// the recognised-text layer follows the undoable state
useApp.subscribe((s, prev) => {
  for (const t of s.tabs) {
    const before = prev.tabs.find((x) => x.key === t.key);
    if (before && before.state === t.state) continue;
    const applied = appliedOcr.get(t.docId) ?? {};
    const want = t.state.ocr ?? {};
    if (want === applied) continue;
    const pages: Record<number, OcrPage | null> = {};
    for (const src of new Set([...Object.keys(applied), ...Object.keys(want)].map(Number))) {
      if ((want[src] ?? null) !== (applied[src] ?? null)) pages[src] = want[src] ?? null;
    }
    appliedOcr.set(t.docId, want);
    if (!Object.keys(pages).length) continue;
    engine()
      .setOcrLayer(t.docId, pages)
      .then((changed) => {
        if (changed.length) contentChanged(t.key, t.docId, changed);
      })
      .catch((e) => flash(`Could not update the recognised text: ${(e as Error).message}`, "error"));
  }
});

/** Builds the save plan: what changed since the last save. */
export interface SaveOptions {
  flatten?: boolean;
  flattenForms?: boolean;
  applyRedactions?: boolean;
}

export function buildPlan(t: DocTab, state: DocState = t.state, opts: SaveOptions & { pageIds?: string[] } = {}): SavePlan {
  const pages = opts.pageIds ? opts.pageIds.map((id) => state.pages.find((p) => p.id === id)).filter((p): p is DocState["pages"][number] => !!p) : state.pages;
  const physOf = new Map(state.pages.map((p) => [p.id, p.src]));
  const savedPhysOf = new Map(t.saved.pages.map((p) => [p.id, p.src]));
  const upserts: SavePlan["upserts"] = [];
  const deletes: number[] = [];
  for (const m of Object.values(state.markups)) {
    const was = t.saved.markups[m.id];
    if (was === m && m.objNum !== undefined) continue;
    const page = physOf.get(m.pageId);
    if (page === undefined) continue;
    if (was?.objNum !== undefined && m.objNum !== undefined && savedPhysOf.get(was.pageId) !== page) {
      // moved to another page: the annotation (and its replies) is removed there and written afresh here
      deletes.push(was.objNum);
      const { objNum: _o, ...fresh } = m;
      void _o;
      upserts.push({ markup: { ...fresh, replies: fresh.replies.map(({ objNum: _r, ...r }) => (void _r, r)) }, page });
      continue;
    }
    upserts.push({ markup: m, page });
  }
  for (const m of Object.values(t.saved.markups)) {
    if (!state.markups[m.id] && m.objNum !== undefined) deletes.push(m.objNum);
  }
  // labels go by position: write them when one changed, or when pages moved in a file that has its own labels
  const labelsChanged = pages.some((p) => p.label !== p.info.label);
  const moved = pages.length !== t.info.pageCount || pages.some((p, i) => p.src !== i);
  const ownLabels = t.info.pages.some((p, i) => p.label !== String(i + 1));
  const pageLabels = labelsChanged || (moved && ownLabels) ? pages.map((p, i) => p.label || String(i + 1)) : undefined;
  const outline = !opts.pageIds && state.outline && state.outline !== t.saved.outline ? state.outline : undefined;
  return {
    ...(pageLabels ? { pageLabels } : {}),
    ...(outline ? { outline } : {}),
    ...(state.fields && Object.keys(state.fields).length ? { fieldValues: state.fields } : {}),
    ...(opts.flattenForms ? { flattenForms: true } : {}),
    ...(state.security !== undefined ? { security: state.security } : {}),
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

/** Why the file's permissions forbid this save (null when they allow it). */
export function rightsBlock(t: DocTab, plan: SavePlan): string | null {
  const sec = t.info.security;
  if (sec.owner) return null;
  const p = sec.permissions;
  const pagesChanged = plan.pages.length !== t.info.pageCount || plan.pages.some((x, i) => x.index !== i || x.rotate !== t.info.pages[i].rotate || x.scale !== undefined);
  if (plan.security !== undefined) return "Changing passwords and permissions needs the permissions password.";
  if (plan.flatten || plan.flattenForms || plan.applyRedactions || plan.pageLabels || plan.outline || pagesChanged || t.state.headerFooter !== undefined || t.state.ocr !== undefined) {
    if (!p.edit || (pagesChanged && !p.assemble)) return "This file's permissions do not allow changing its pages or content.";
  }
  if ((plan.upserts.length || plan.deletes.length) && !p.annotate) return "This file's permissions do not allow adding or changing markups.";
  if (plan.fieldValues && !p.form && !p.annotate) return "This file's permissions do not allow filling in its form.";
  return null;
}

/**
 * A file whose permissions forbid changes needs its permissions password before Drawset changes it.
 * Returns false when the user cancels.
 */
export async function ensureRights(key: string, why = "This file's permissions do not allow changes."): Promise<boolean> {
  let note = why;
  for (;;) {
    const t = useApp.getState().tabs.find((x) => x.key === key);
    if (!t) return false;
    if (t.info.security.owner) return true;
    const pw = await askText({ title: "Permissions password", label: "Permissions password", password: true, note: `${note} Type the permissions password to continue.`, ok: "Unlock" });
    if (pw === null) return false;
    try {
      const info = await engine().unlock(t.docId, pw);
      updateTab(key, (x) => ({ ...x, info }));
      return true;
    } catch {
      note = "That password is not right.";
    }
  }
}

/** Saves in place (incremental) and reloads the document from the saved bytes. */
export async function saveTab(key: string, opts: SaveOptions = {}): Promise<boolean> {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return false;
  if (!t.markupsLoaded) {
    flash("Still reading this document's markups; save again in a moment.");
    return false;
  }
  const blocked = rightsBlock(t, buildPlan(t, t.state, opts));
  if (blocked && !(await ensureRights(key, blocked))) return false;
  // where it goes is settled first: cancelling the dialog must leave the document exactly as it was
  const dest = await savePathFor(t.path, t.name);
  if (dest === undefined) return false;
  try {
    useApp.setState({ busy: "Saving…" });
    const plan = buildPlan(t, t.state, opts);
    const res = await engine().save(t.docId, plan, "incremental");
    // from here the engine holds the saved revision, so the tab must follow it even if writing the file fails
    renderCache.invalidateDoc(t.docId);
    invalidateApBitmaps(t.docId);
    forgetContentIndexes(t.docId);
    const fields = res.info.hasForm ? await engine().formFields(t.docId) : null;
    appliedFields.delete(t.docId);
    appliedDecor.delete(t.docId);
    appliedSpec.delete(t.docId);
    appliedOcr.delete(t.docId);
    const fingerprint = await sha256Hex(res.bytes).catch(() => undefined);
    const pages = pagesFromInfo(res.info);
    const state: DocState = { pages, markups: recordsToMarkups(res.markups, pages) };
    let error: Error | null = null;
    try {
      await writeSaved(dest, t.name, res.bytes);
    } catch (e) {
      error = e as Error;
    }
    updateTab(key, (x) => ({
      ...x,
      info: res.info,
      path: error ? x.path : (dest ?? x.path),
      name: !error && dest ? (dest.split(/[\\/]/).pop() ?? x.name) : x.name,
      state,
      // not written: the changes stay unsaved (a copy of the state is never identical to it), and saving again
      // writes the engine's revision, which already holds them
      saved: error ? { ...state } : state,
      undo: [],
      redo: [],
      selection: x.selection.filter((id) => state.markups[id]),
      pageSelection: [],
      markupsLoaded: true,
      search: { ...x.search, hits: [], current: -1, done: false },
      textSelection: null,
      fields,
      fingerprint: error ? x.fingerprint : fingerprint,
    }));
    if (error) {
      flash(`Save failed: ${error.message} Your changes are kept; save again or use Save a copy.`, "error");
      return false;
    }
    void dropJournal(t);
    flash(opts.flattenForms ? "Form fields flattened and saved." : opts.flatten ? "Markups flattened and saved." : opts.applyRedactions ? "Redactions applied and saved." : `Saved ${t.name}.`);
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
  if (!t.info.security.owner && !(await ensureRights(key, "Saving a copy of a restricted file needs the permissions password."))) return false;
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
  appliedFields.delete(t.docId);
  appliedDecor.delete(t.docId);
  appliedSpec.delete(t.docId);
  appliedOcr.delete(t.docId);
  void dropJournal(t);
  await engine().close(t.docId);
  return true;
}
