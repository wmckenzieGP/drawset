/** Reply threads on markups: every change is an undoable command. */
import { newId, nowIso, type Markup, type Reply } from "../../markup/model";
import { withDescendants } from "./thread";
import { commit, useApp, withMarkups } from "../../state/store";

function change(key: string, m: Markup, label: string, replies: Reply[]) {
  commit(key, label, (s) => withMarkups(s, [{ ...m, replies }]));
}

export function addReply(key: string, m: Markup, text: string, inReplyTo?: string): Reply | null {
  const contents = text.trim();
  if (!contents) return null;
  const now = nowIso();
  const reply: Reply = { id: newId(), author: useApp.getState().author, contents, created: now, modified: now, ...(inReplyTo ? { inReplyTo } : {}) };
  change(key, m, "Add reply", [...m.replies, reply]);
  return reply;
}

export function editReply(key: string, m: Markup, id: string, text: string) {
  const contents = text.trim();
  const r = m.replies.find((x) => x.id === id);
  if (!r || !contents || r.contents === contents) return;
  change(key, m, "Edit reply", m.replies.map((x) => (x.id === id ? { ...x, contents, modified: nowIso() } : x)));
}

export function deleteReply(key: string, m: Markup, id: string) {
  const gone = withDescendants(m.replies, id);
  change(key, m, "Delete reply", m.replies.filter((x) => !gone.has(x.id)));
}
