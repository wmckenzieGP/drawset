/**
 * Crash recovery: every 60 s the unsaved changes of each document are written to a journal on this computer
 * (the app's own data folder, or the browser's IndexedDB). A journal is removed when its document is saved or
 * closed; one that is still there at the next start means Drawset did not close normally, and is offered back.
 * Passwords are never journaled.
 */
import type { OutlineNode } from "../../engine/types";
import type { Markup } from "../../markup/model";
import { desktop } from "../../platform/host";
import { isDirty, newPageId, useApp, type DocState, type DocTab, type PageEntry } from "../../state/store";
import type { HFSpec } from "../headerFooter/hf";

export const JOURNAL_INTERVAL_MS = 60_000;

type StoredMarkup = Omit<Markup, "pageId" | "image"> & { page: number; image?: Omit<NonNullable<Markup["image"]>, "data"> & { data: string } };

export interface JournalEntry {
  v: 1;
  id: string;
  savedAt: string;
  name: string;
  path: string | null;
  /** SHA-256 of the file the changes apply to (hex). */
  sha256: string;
  pageCount: number;
  pages: { src: number; rotation: PageEntry["rotation"]; scale: PageEntry["scale"]; label: string }[];
  markups: StoredMarkup[];
  outline?: OutlineNode[];
  fields?: Record<string, string>;
  headerFooter?: HFSpec | null;
  /** Pages inserted from other files cannot be journaled (their content is only in memory). */
  skippedPages: number;
  /** A pending security change was not journaled (it holds passwords). */
  securityDropped: boolean;
}

// ---------- serialising ----------

function b64(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function journalFor(t: DocTab, sha256: string, id: string): JournalEntry {
  const s = t.state;
  const kept = s.pages.filter((p) => p.src < t.info.pageCount);
  const srcOf = new Map(kept.map((p) => [p.id, p.src]));
  const markups: StoredMarkup[] = [];
  for (const m of Object.values(s.markups)) {
    const page = srcOf.get(m.pageId);
    if (page === undefined) continue;
    const { pageId: _p, image, ...rest } = m;
    void _p;
    markups.push({ ...rest, page, ...(image ? { image: { ...image, data: b64(image.data) } } : {}) });
  }
  return {
    v: 1,
    id,
    savedAt: new Date().toISOString(),
    name: t.name,
    path: t.path,
    sha256,
    pageCount: t.info.pageCount,
    pages: kept.map((p) => ({ src: p.src, rotation: p.rotation, scale: p.scale, label: p.label })),
    markups,
    ...(s.outline ? { outline: s.outline } : {}),
    ...(s.fields ? { fields: s.fields } : {}),
    ...(s.headerFooter !== undefined ? { headerFooter: s.headerFooter } : {}),
    skippedPages: s.pages.length - kept.length,
    securityDropped: s.security !== undefined,
  };
}

/** The document state a journal describes, for a freshly opened copy of its file. */
export function stateFromJournal(t: DocTab, j: JournalEntry): DocState {
  // reuse the open document's page ids so markups that did not change compare equal
  const current = new Map(t.state.pages.map((p) => [p.src, p.id]));
  const used = new Set<string>();
  const pages: PageEntry[] = j.pages
    .filter((p) => p.src < t.info.pageCount)
    .map((p) => {
      let id = current.get(p.src);
      if (!id || used.has(id)) id = newPageId();
      used.add(id);
      return { id, src: p.src, info: t.info.pages[p.src], rotation: p.rotation, scale: p.scale, label: p.label };
    });
  const idOf = new Map(pages.map((p) => [p.src, p.id]));
  const markups: Record<string, Markup> = {};
  // markups the file already has keep their identity, so unchanged ones are not rewritten on save
  const fileById = new Map(Object.values(t.saved.markups).map((m) => [m.id, m]));
  for (const sm of j.markups) {
    const pageId = idOf.get(sm.page);
    if (!pageId) continue;
    const { page: _p, image, ...rest } = sm;
    void _p;
    const m: Markup = { ...rest, pageId, ...(image ? { image: { ...image, data: unb64(image.data) } } : {}) };
    const orig = fileById.get(m.id);
    markups[m.id] = orig && stable(orig) === stable(m) ? orig : m;
  }
  return {
    pages,
    markups,
    ...(j.outline ? { outline: j.outline } : {}),
    ...(j.fields ? { fields: j.fields } : {}),
    ...(j.headerFooter !== undefined ? { headerFooter: j.headerFooter } : {}),
  };
}

/** JSON with sorted keys (and image bytes as base64), for comparing markups. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (x instanceof Uint8Array) return b64(x);
    if (x && typeof x === "object" && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, x[k]]));
    return x;
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- storage ----------

export interface JournalStore {
  write(id: string, json: string): Promise<void>;
  list(): Promise<string[]>;
  remove(id: string): Promise<void>;
}

const DB = "drawset-recovery";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("journal");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction("journal", mode).objectStore("journal"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

const browserStore: JournalStore = {
  write: async (id, json) => void (await tx("readwrite", (s) => s.put(json, id))),
  list: async () => (await tx("readonly", (s) => s.getAll())) as string[],
  remove: async (id) => void (await tx("readwrite", (s) => s.delete(id))),
};

let store: JournalStore | null = null;
export function journalStore(): JournalStore {
  if (store) return store;
  store = desktop?.journalWrite
    ? { write: (id, json) => desktop!.journalWrite(id, json), list: () => desktop!.journalList(), remove: (id) => desktop!.journalRemove(id) }
    : typeof indexedDB !== "undefined"
      ? browserStore
      : memoryStore();
  return store;
}
/** For tests. */
export function setJournalStore(s: JournalStore) {
  store = s;
}
export function memoryStore(): JournalStore {
  const m = new Map<string, string>();
  return { write: async (id, j) => void m.set(id, j), list: async () => [...m.values()], remove: async (id) => void m.delete(id) };
}

// ---------- the 60-second journal ----------

const journaled = new Map<string, DocState>();
/** Unique per run, so a new session never overwrites the journals of one that crashed. */
const SESSION = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
export const journalIdOf = (t: DocTab) => `j-${SESSION}-${t.docId}`;

/** Writes journals for documents with changes since their last journal; removes them for saved documents. */
export async function journalNow() {
  const tabs = useApp.getState().tabs;
  for (const t of tabs) {
    const id = journalIdOf(t);
    if (!isDirty(t) || !t.fingerprint) {
      if (journaled.has(id)) {
        journaled.delete(id);
        await journalStore().remove(id).catch(() => undefined);
      }
      continue;
    }
    if (journaled.get(id) === t.state) continue;
    journaled.set(id, t.state);
    try {
      await journalStore().write(id, JSON.stringify(journalFor(t, t.fingerprint, id)));
    } catch {
      journaled.delete(id);
    }
  }
}

/** Forgets a document's journal (saved, or closed on purpose). */
export async function dropJournal(t: DocTab) {
  const id = journalIdOf(t);
  journaled.delete(id);
  await journalStore().remove(id).catch(() => undefined);
}

export function startJournal(): () => void {
  const timer = setInterval(() => void journalNow(), JOURNAL_INTERVAL_MS);
  return () => clearInterval(timer);
}

export async function pendingJournals(): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  for (const json of await journalStore().list().catch(() => [] as string[])) {
    try {
      const j = JSON.parse(json) as JournalEntry;
      if (j && j.v === 1 && typeof j.id === "string") out.push(j);
    } catch {
      /* unreadable: ignore */
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
