import { useEffect, useRef, useState } from "react";
import { engine } from "../../engine/client";
import { commit, flash, scrollToPage, updateTab, useApp, withMarkups, type DocTab } from "../../state/store";
import { baseMarkup } from "../viewer/create";
import type { SearchHit } from "../../engine/types";
import { bboxOf, type Pt } from "../../markup/geometry";

const CHUNK = 8;
let searchSeq = 0;

/** Searches the document in chunks so page rendering stays responsive; results stream in. */
export async function runSearch(key: string, query: string, navigate = true) {
  const seq = ++searchSeq;
  const t0 = useApp.getState().tabs.find((t) => t.key === key);
  if (!t0) return;
  updateTab(key, (t) => ({ ...t, search: { query, hits: [], current: -1, running: !!query.trim(), done: false } }));
  if (!query.trim()) return;
  // search pages in the current page order
  const pages = t0.state.pages.map((p) => p.src);
  const all: SearchHit[] = [];
  let navigated = !navigate;
  for (let i = 0; i < pages.length; i += CHUNK) {
    if (seq !== searchSeq) return;
    const chunk = pages.slice(i, i + CHUNK);
    const lo = Math.min(...chunk);
    const hi = Math.max(...chunk);
    const hits = (await engine().search(t0.docId, query, lo, hi)).filter((h) => chunk.includes(h.page));
    hits.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
    all.push(...hits);
    if (seq !== searchSeq) return;
    const snapshot = all.slice();
    updateTab(key, (t) => ({ ...t, search: { ...t.search, hits: snapshot, current: t.search.current < 0 && snapshot.length ? 0 : t.search.current } }));
    if (!navigated && all.length) {
      navigated = true;
      goToHit(key, 0);
    }
  }
  updateTab(key, (t) => ({ ...t, search: { ...t.search, running: false, done: true } }));
}

export function goToHit(key: string, index: number) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return;
  const hit = t.search.hits[index];
  if (!hit) return;
  const pageIndex = t.state.pages.findIndex((p) => p.src === hit.page);
  if (pageIndex < 0) return;
  const pts: Pt[] = hit.quads.flatMap((q) => [[q[0], q[1]], [q[6], q[7]]] as Pt[]);
  updateTab(key, (x) => ({ ...x, search: { ...x.search, current: index } }));
  scrollToPage(key, pageIndex, bboxOf(pts));
}

/** Turns every search result into a pending redaction (applied later from the review dialog). */
export function markHitsForRedaction(key: string) {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t || !t.search.hits.length) return;
  const bySrc = new Map(t.state.pages.map((p) => [p.src, p.id]));
  const made = t.search.hits.flatMap((h) => {
    const pageId = bySrc.get(h.page);
    if (!pageId) return [];
    const pts: Pt[] = h.quads.flatMap((q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]] as Pt[]);
    return [{ ...baseMarkup("redact", pageId), quads: h.quads, rect: bboxOf(pts), contents: t.search.query }];
  });
  commit(key, `Mark ${made.length} result${made.length === 1 ? "" : "s"} for redaction`, (s) => withMarkups(s, made));
  flash(`Marked ${made.length} result${made.length === 1 ? "" : "s"} for redaction. Review and apply them from the Tools menu.`);
}

export function SearchPanel({ tab }: { tab: DocTab }) {
  const [q, setQ] = useState(tab.search.query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const { hits, current, running, done } = tab.search;
  const byPage = new Map<number, number[]>();
  hits.forEach((h, i) => {
    const list = byPage.get(h.page) ?? [];
    list.push(i);
    byPage.set(h.page, list);
  });
  return (
    <div className="panel-body">
      <div className="panel-title">Search</div>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (q === tab.search.query && hits.length) goToHit(tab.key, (current + 1) % hits.length);
          else runSearch(tab.key, q);
        }}
      >
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find text" data-testid="search-input" />
        <button type="submit" className="btn">Find</button>
      </form>
      <div className="search-nav">
        <span className="muted" data-testid="search-count">
          {running ? `Searching… ${hits.length} found` : done ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : ""}
        </span>
        <span className="spacer" />
        <button className="btn small" disabled={!hits.length} onClick={() => goToHit(tab.key, (current - 1 + hits.length) % hits.length)} aria-label="Previous result">
          ▲
        </button>
        <button className="btn small" disabled={!hits.length} onClick={() => goToHit(tab.key, (current + 1) % hits.length)} aria-label="Next result">
          ▼
        </button>
      </div>
      {done && hits.length > 0 && (
        <button className="btn small search-redact" onClick={() => markHitsForRedaction(tab.key)} data-testid="search-redact">
          Mark all for redaction
        </button>
      )}
      <ul className="search-results" data-testid="search-results">
        {[...byPage.entries()].map(([page, idxs]) => {
          const pi = tab.state.pages.findIndex((p) => p.src === page);
          if (pi < 0) return null;
          return (
            <li key={page}>
              <button className={idxs.includes(current) ? "active" : ""} onClick={() => goToHit(tab.key, idxs[0])}>
                Page {tab.state.pages[pi].label} <span className="muted">({idxs.length})</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
