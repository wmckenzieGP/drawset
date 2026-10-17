/** Pure helpers for reply threads. */
import type { Reply } from "../../markup/model";

/** Replies in reading order: each reply followed by the replies that answer it, with its depth. */
export function threadOrder(replies: Reply[]): { reply: Reply; depth: number }[] {
  const ids = new Set(replies.map((r) => r.id));
  const children = new Map<string, Reply[]>();
  const roots: Reply[] = [];
  for (const r of [...replies].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))) {
    if (r.inReplyTo && ids.has(r.inReplyTo) && r.inReplyTo !== r.id) {
      const list = children.get(r.inReplyTo) ?? [];
      list.push(r);
      children.set(r.inReplyTo, list);
    } else roots.push(r);
  }
  const out: { reply: Reply; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (r: Reply, depth: number) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ reply: r, depth });
    for (const c of children.get(r.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // replies stuck in a cycle still show, at the top level
  for (const r of replies) if (!seen.has(r.id)) walk(r, 0);
  return out;
}

/** A reply and everything that answers it, directly or further down. */
export function withDescendants(replies: Reply[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of replies) {
      if (r.inReplyTo && out.has(r.inReplyTo) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return out;
}
