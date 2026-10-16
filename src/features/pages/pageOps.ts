/** Page operations. Each is one undoable command on the tab's page list. */
import { engine } from "../../engine/client";
import { buildPlan, saveCopyOf } from "../../state/documents";
import { commit, flash, newPageId, recordsToMarkups, scrollToPage, updateTab, useApp, type DocTab, type PageEntry, type Rotation } from "../../state/store";
import type { Markup } from "../../markup/model";
import { desktop, saveAs, type OpenedFile } from "../../platform/host";

/** Parses "1-3, 5, 8-" into 0-based page indices (in the order given, without duplicates). */
export function parsePageRange(input: string, count: number): number[] | null {
  const out: number[] = [];
  const seen = new Set<number>();
  const parts = input.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    const m = /^(\d*)\s*(?:-|–)\s*(\d*)$/.exec(part);
    let a: number;
    let b: number;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : count;
    } else if (/^\d+$/.test(part)) {
      a = b = parseInt(part, 10);
    } else return null;
    if (a < 1 || b < 1 || a > count || b > count) return null;
    const step = a <= b ? 1 : -1;
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
      if (!seen.has(i - 1)) {
        seen.add(i - 1);
        out.push(i - 1);
      }
    }
  }
  return out;
}

/** Splits "1-10, 11-20" into one group of indices per comma-separated range. */
export function parseRangeGroups(input: string, count: number): number[][] | null {
  const groups: number[][] = [];
  for (const part of input.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    const g = parsePageRange(part, count);
    if (!g) return null;
    groups.push(g);
  }
  return groups.length ? groups : null;
}

export function pagesFromSelection(t: DocTab): string[] {
  if (t.pageSelection.length) return t.state.pages.filter((p) => t.pageSelection.includes(p.id)).map((p) => p.id);
  const cur = t.state.pages[t.currentPage];
  return cur ? [cur.id] : [];
}

export function rotatePages(key: string, ids: string[], deg: 90 | 180 | 270) {
  if (!ids.length) return;
  commit(key, ids.length > 1 ? "Rotate pages" : "Rotate page", (s) => ({
    ...s,
    pages: s.pages.map((p) => (ids.includes(p.id) ? { ...p, rotation: ((p.rotation + deg) % 360) as Rotation } : p)),
  }));
}

export function deletePages(key: string, ids: string[]) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !ids.length) return;
  if (ids.length >= t.state.pages.length) {
    flash("A document must keep at least one page.", "error");
    return;
  }
  commit(key, ids.length > 1 ? `Delete ${ids.length} pages` : "Delete page", (s) => {
    const markups: Record<string, Markup> = {};
    for (const m of Object.values(s.markups)) if (!ids.includes(m.pageId)) markups[m.id] = m;
    return { pages: s.pages.filter((p) => !ids.includes(p.id)), markups };
  });
  updateTab(key, (x) => ({ ...x, pageSelection: [], currentPage: Math.min(x.currentPage, x.state.pages.length - 1) }));
}

/** Moves the given pages so they start at `toIndex` (index in the list before the move). */
export function movePages(key: string, ids: string[], toIndex: number) {
  commit(key, ids.length > 1 ? "Move pages" : "Move page", (s) => {
    const moving = s.pages.filter((p) => ids.includes(p.id));
    if (!moving.length) return s;
    const before = s.pages.slice(0, toIndex).filter((p) => !ids.includes(p.id));
    const after = s.pages.slice(toIndex).filter((p) => !ids.includes(p.id));
    const pages = [...before, ...moving, ...after];
    if (pages.every((p, i) => p === s.pages[i])) return s;
    return { ...s, pages };
  });
}

export async function insertBlankPage(key: string, at?: number) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return;
  const ref = t.state.pages[t.currentPage] ?? t.state.pages[0];
  const b = ref.info.bounds;
  // same size as the current page as displayed (its /Rotate applied)
  const info = await engine().addBlankPage(t.docId, b[2] - b[0], b[3] - b[1]);
  const entry: PageEntry = { id: newPageId(), src: info.index, info: { ...info, label: "" }, rotation: 0, scale: null };
  const index = at ?? t.currentPage + 1;
  commit(key, "Insert blank page", (s) => ({ ...s, pages: [...s.pages.slice(0, index), entry, ...s.pages.slice(index)] }));
  scrollToPage(key, index);
}

/** Inserts every page of each file at `at` (end when omitted), keeping their markups. */
export async function insertFromFiles(key: string, files: OpenedFile[], at?: number) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !files.length) return;
  const entries: PageEntry[] = [];
  let markups: Record<string, Markup> = {};
  try {
    useApp.setState({ busy: "Inserting pages…" });
    for (const f of files) {
      const res = await engine().importPages(t.docId, f.bytes);
      const pages: PageEntry[] = res.pages.map((info) => ({ id: newPageId(), src: info.index, info, rotation: 0 as Rotation, scale: info.scale }));
      entries.push(...pages);
      markups = { ...markups, ...recordsToMarkups(res.markups, pages) };
    }
  } catch (e) {
    flash(`Could not insert pages: ${(e as Error).message}`, "error");
    return;
  } finally {
    useApp.setState({ busy: null });
  }
  const index = at ?? t.state.pages.length;
  commit(key, files.length > 1 ? "Combine files" : "Insert pages", (s) => ({
    pages: [...s.pages.slice(0, index), ...entries, ...s.pages.slice(index)],
    markups: { ...s.markups, ...markups },
  }));
  flash(`Inserted ${entries.length} page${entries.length === 1 ? "" : "s"}.`);
}

function baseName(t: DocTab) {
  return t.name.replace(/\.pdf$/i, "");
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i + 1) : "";
}

function rangeLabel(indices: number[]): string {
  const sorted = [...indices].sort((a, b) => a - b);
  const contiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  return contiguous && sorted.length > 1 ? `${sorted[0] + 1}-${sorted[sorted.length - 1] + 1}` : sorted.map((v) => v + 1).join(",");
}

/** Extract pages to a new PDF (or one PDF per page). */
export async function extractPages(key: string, indices: number[], separate: boolean) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !indices.length) return;
  const groups = separate ? indices.map((i) => [i]) : [indices];
  await writeGroups(t, groups, "pages");
}

export async function splitDocument(key: string, groups: number[][]) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !groups.length) return;
  await writeGroups(t, groups, "part");
}

async function writeGroups(t: DocTab, groups: number[][], word: string) {
  const ids = (g: number[]) => g.map((i) => t.state.pages[i]?.id).filter((x): x is string => !!x);
  if (groups.length === 1) {
    const g = groups[0];
    await saveCopyOf(t.key, ids(g), `${baseName(t)} (${word} ${rangeLabel(g)}).pdf`);
    return;
  }
  // several files: next to the original in the desktop app, downloads in the browser
  let written = 0;
  try {
    for (const g of groups) {
      useApp.setState({ busy: `Writing ${written + 1} of ${groups.length}…` });
      const plan = buildPlan(t, t.state, { pageIds: ids(g) });
      const bytes = await engine().saveCopy(t.docId, plan);
      const name = `${baseName(t)} (${word} ${rangeLabel(g)}).pdf`;
      if (desktop && t.path) await desktop.saveFile(dirOf(t.path) + name, bytes);
      else await saveAs(name, bytes);
      written++;
    }
    flash(desktop && t.path ? `Wrote ${written} files next to ${t.name}.` : `Wrote ${written} files.`);
  } catch (e) {
    flash(`Could not write the files: ${(e as Error).message}`, "error");
  } finally {
    useApp.setState({ busy: null });
  }
}
