/** Page labels read from a title-block region, and bookmarks made from page labels. */
import { engine } from "../../engine/client";
import type { OutlineNode } from "../../engine/types";
import type { Rect } from "../../markup/geometry";
import { commit, type DocState, type DocTab } from "../../state/store";

/** Longest label kept; title-block text beyond this is cut. */
export const MAX_LABEL = 60;

export function cleanLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

/** The text inside `rect` on each of the given pages (view indices), cleaned up as labels. */
export async function readRegionLabels(tab: DocTab, rect: Rect, indices: number[]): Promise<string[]> {
  const texts = await engine().textInRect(tab.docId, indices.map((i) => tab.state.pages[i].src), rect);
  return texts.map(cleanLabel);
}

/** Bookmarks, one per page in order, titled with the page's label. */
export function bookmarksFromLabels(s: DocState): OutlineNode[] {
  return s.pages.map((p, i) => ({ title: p.label || String(i + 1), page: p.src, children: [] }));
}

/** Sets new labels (empty ones are skipped) and optionally rebuilds the bookmarks, as one undo step. */
export function applyPageLabels(key: string, labels: Map<string, string>, bookmarks: boolean) {
  commit(key, bookmarks ? "Label pages and make bookmarks" : "Label pages", (s) => {
    const pages = s.pages.map((p) => {
      const l = labels.get(p.id);
      return l ? { ...p, label: l } : p;
    });
    const next = { ...s, pages };
    return bookmarks ? { ...next, outline: bookmarksFromLabels(next) } : next;
  });
}
