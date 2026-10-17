import { useState } from "react";
import { formatDate, type Markup } from "../../markup/model";
import { addReply, deleteReply, editReply } from "./replies";
import { threadOrder } from "./thread";

/** The reply thread of one markup, with answer, edit and delete. */
export function ReplyThread({ tabKey, markup }: { tabKey: string; markup: Markup }) {
  const [draft, setDraft] = useState("");
  const [answering, setAnswering] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const rows = threadOrder(markup.replies);
  const target = answering ? markup.replies.find((r) => r.id === answering) : undefined;
  const send = () => {
    if (addReply(tabKey, markup, draft, target?.id)) {
      setDraft("");
      setAnswering(null);
    }
  };
  return (
    <div className="replies" data-testid="replies">
      <div className="panel-subtitle">Replies{rows.length ? ` (${rows.length})` : ""}</div>
      {rows.map(({ reply: r, depth }) => (
        <div key={r.id} className="reply" style={{ marginLeft: Math.min(depth, 4) * 14 }} data-testid="reply">
          <div className="muted reply-head">
            <span>
              {r.author} · {formatDate(r.created)}
            </span>
            <span className="reply-actions">
              <button className="link" onClick={() => setAnswering(r.id)} data-testid="reply-answer">
                Reply
              </button>
              <button className="link" onClick={() => setEditing({ id: r.id, text: r.contents })}>
                Edit
              </button>
              <button className="link" onClick={() => deleteReply(tabKey, markup, r.id)} data-testid="reply-delete">
                Delete
              </button>
            </span>
          </div>
          {editing?.id === r.id ? (
            <textarea
              autoFocus
              rows={2}
              value={editing.text}
              onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
              onBlur={() => {
                editReply(tabKey, markup, r.id, editing.text);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <div className="reply-text">{r.contents}</div>
          )}
        </div>
      ))}
      {target && (
        <div className="muted">
          Answering {target.author}{" "}
          <button className="link" onClick={() => setAnswering(null)}>
            (cancel)
          </button>
        </div>
      )}
      <textarea
        rows={2}
        placeholder="Write a reply"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
        data-testid="reply-input"
      />
      <button className="btn" disabled={!draft.trim()} onClick={send} data-testid="reply-add">
        Add reply
      </button>
    </div>
  );
}
