/** Following links and bookmarks, with Back and Forward through the pages visited. */
import type { LinkTarget } from "../../markup/model";
import { openPath } from "../../state/documents";
import { activeTab, flash, scrollToPage, updateTab, useApp, type DocTab } from "../../state/store";
import type { Rect } from "../../markup/geometry";

const MAX_HISTORY = 100;

/** Goes to a page (position in the page list), remembering where we were. */
export function jumpTo(key: string, index: number, rect?: Rect) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return;
  if (index !== t.currentPage) updateTab(key, (x) => ({ ...x, nav: { back: [...x.nav.back, x.currentPage].slice(-MAX_HISTORY), fwd: [] } }));
  scrollToPage(key, index, rect);
}

export function goBack(key = activeTab()?.key) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !t.nav.back.length) return;
  const to = t.nav.back[t.nav.back.length - 1];
  updateTab(t.key, (x) => ({ ...x, nav: { back: x.nav.back.slice(0, -1), fwd: [...x.nav.fwd, x.currentPage] } }));
  scrollToPage(t.key, Math.min(to, t.state.pages.length - 1));
}

export function goForward(key = activeTab()?.key) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !t.nav.fwd.length) return;
  const to = t.nav.fwd[t.nav.fwd.length - 1];
  updateTab(t.key, (x) => ({ ...x, nav: { back: [...x.nav.back, x.currentPage], fwd: x.nav.fwd.slice(0, -1) } }));
  scrollToPage(t.key, Math.min(to, t.state.pages.length - 1));
}

const isAbsolute = (p: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p);

/** A link's file path resolved against the folder of the file it is in. PDF paths use "/" and "/C/…" for drives. */
export function resolveLinkedPath(base: string | null, path: string): string | null {
  let p = path.replace(/^file:\/\//i, "");
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  const windows = !!base && (/^[a-zA-Z]:/.test(base) || base.includes("\\"));
  if (windows) {
    const drive = /^\/([a-zA-Z])\/(.*)$/.exec(p);
    if (drive) p = `${drive[1].toUpperCase()}:\\${drive[2]}`;
    p = p.replace(/\//g, "\\");
  }
  if (isAbsolute(p)) return p;
  if (!base) return null;
  const sep = windows ? "\\" : "/";
  const parts = base.slice(0, Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"))).split(/[\\/]/);
  for (const seg of p.split(/[\\/]/)) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join(sep);
}

export function describeTarget(tab: DocTab, t: LinkTarget | undefined): string {
  if (!t) return "No target";
  if (t.type === "url") return t.url;
  if (t.type === "file") return t.page !== undefined ? `${t.path}, page ${t.page + 1}` : t.path;
  const i = tab.state.pages.findIndex((p) => p.src === t.page);
  return i < 0 ? "A deleted page" : `Page ${tab.state.pages[i].label}${tab.state.pages[i].label !== String(i + 1) ? ` (${i + 1})` : ""}`;
}

export const SAFE_URL = /^(https?:|mailto:)/i;

export async function followLink(tab: DocTab, t: LinkTarget) {
  if (t.type === "page") {
    const i = tab.state.pages.findIndex((p) => p.src === t.page);
    if (i < 0) flash("That page has been deleted.", "error");
    else jumpTo(tab.key, i);
    return;
  }
  if (t.type === "url") {
    if (!SAFE_URL.test(t.url)) {
      flash(`Drawset only opens web and email links, not "${t.url}".`, "error");
      return;
    }
    if (window.confirm(`Open this address in your web browser?\n\n${t.url}`)) window.open(t.url, "_blank", "noopener");
    return;
  }
  const path = resolveLinkedPath(tab.path, t.path);
  if (!path) {
    flash(`Save this file first so the linked file "${t.path}" can be found next to it.`, "error");
    return;
  }
  if (!/\.pdf$/i.test(path)) {
    flash(`Drawset opens linked PDF files only. The link points to ${path}.`, "error");
    return;
  }
  await openPath(path);
  const opened = useApp.getState().tabs.find((x) => x.path === path);
  if (opened && t.page !== undefined) jumpTo(opened.key, Math.min(t.page, opened.state.pages.length - 1));
}
