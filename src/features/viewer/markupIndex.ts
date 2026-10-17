/** Spatial index (rbush) of markups per page, rebuilt when the markup set changes. */
import RBush from "rbush";
import { markupBounds } from "../../markup/appearance";
import type { Rect } from "../../markup/geometry";
import type { Markup } from "../../markup/model";

interface Item {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  m: Markup;
  /** Drawing order (insertion order of the markup record). */
  idx: number;
}

const cache = new WeakMap<Record<string, Markup>, Map<string, RBush<Item>>>();

export function pageIndex(markups: Record<string, Markup>, pageId: string): RBush<Item> {
  let byPage = cache.get(markups);
  if (!byPage) {
    byPage = new Map();
    const groups = new Map<string, Item[]>();
    let idx = 0;
    for (const m of Object.values(markups)) {
      const b = markupBounds(m);
      const list = groups.get(m.pageId) ?? [];
      list.push({ minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], m, idx: idx++ });
      groups.set(m.pageId, list);
    }
    for (const [pid, items] of groups) {
      const tree = new RBush<Item>();
      tree.load(items);
      byPage.set(pid, tree);
    }
    cache.set(markups, byPage);
  }
  let tree = byPage.get(pageId);
  if (!tree) {
    tree = new RBush<Item>();
    byPage.set(pageId, tree);
  }
  return tree;
}

export function markupsInRect(markups: Record<string, Markup>, pageId: string, r: Rect): Markup[] {
  return pageIndex(markups, pageId)
    .search({ minX: r[0], minY: r[1], maxX: r[2], maxY: r[3] })
    .sort((a, b) => a.idx - b.idx)
    .map((i) => i.m);
}
