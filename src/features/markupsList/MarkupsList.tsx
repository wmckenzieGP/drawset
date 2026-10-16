import { useEffect, useMemo, useRef, useState } from "react";
import { markupBounds } from "../../markup/appearance";
import { KIND_LABELS, STATUSES, type ReviewStatus } from "../../markup/model";
import { scrollToPage, updateTab, useApp, type DocTab } from "../../state/store";
import { saveAs } from "../../platform/host";
import { cmd } from "../../app/commands";
import { markupRows, quantitiesCsv, rowsToCsv, sortRows, type SortKey } from "./csv";
import { formatTotal, totalsByType } from "../measure/MeasurePanel";

const ROW_H = 26;
const COLS: { key: SortKey; label: string; w: number }[] = [
  { key: "page", label: "Page", w: 70 },
  { key: "type", label: "Type", w: 110 },
  { key: "subject", label: "Subject", w: 130 },
  { key: "author", label: "Author", w: 120 },
  { key: "date", label: "Date", w: 120 },
  { key: "status", label: "Status", w: 90 },
  { key: "colour", label: "Colour", w: 80 },
  { key: "measurement", label: "Measurement", w: 120 },
  { key: "comment", label: "Comment", w: 320 },
];

export function MarkupsList({ tab }: { tab: DocTab }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "page", dir: 1 });
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [height, setHeight] = useState(240);
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(200);
  const bodyRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);

  const allRows = useMemo(() => markupRows(tab.state.markups, tab.state.pages), [tab.state.markups, tab.state.pages]);
  const types = useMemo(() => [...new Set(allRows.map((r) => r.type))].sort(), [allRows]);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = allRows.filter(
      (r) =>
        (!typeFilter || r.type === typeFilter) &&
        (!statusFilter || r.status === statusFilter) &&
        (!f || [r.page, r.type, r.subject, r.author, r.comment, r.status, r.date].some((v) => v.toLowerCase().includes(f))),
    );
    return sortRows(filtered, sort.key, sort.dir);
  }, [allRows, filter, typeFilter, statusFilter, sort]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = new Set(tab.selection);
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 5);
  const last = Math.min(rows.length - 1, Math.ceil((scroll + viewH) / ROW_H) + 5);

  const clickRow = (i: number, e: React.MouseEvent) => {
    const r = rows[i];
    let sel: string[];
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      sel = rows.slice(a, b + 1).map((x) => x.id);
    } else if (e.ctrlKey || e.metaKey) {
      sel = selected.has(r.id) ? tab.selection.filter((x) => x !== r.id) : [...tab.selection, r.id];
      anchor.current = i;
    } else {
      sel = [r.id];
      anchor.current = i;
      // zoom to the markup
      const b = markupBounds(r.m);
      scrollToPage(tab.key, r.pageIndex, b);
    }
    updateTab(tab.key, (t) => ({ ...t, selection: sel }));
  };

  const exportQuantities = async () => {
    const csv = quantitiesCsv(rows);
    await saveAs(tab.name.replace(/\.pdf$/i, "") + " quantities.csv", new TextEncoder().encode(csv), "CSV files", "csv", "text/csv");
  };

  const exportCsv = async () => {
    const csv = rowsToCsv(rows);
    await saveAs(tab.name.replace(/\.pdf$/i, "") + " markups.csv", new TextEncoder().encode(csv), "CSV files", "csv", "text/csv");
  };

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 200, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const selCount = tab.selection.length;
  const totals = useMemo(() => totalsByType(rows.map((r) => r.m)), [rows]);
  return (
    <div className="markups-list" style={{ height }} data-testid="markups-list">
      <div className="resize-handle" onPointerDown={startResize} />
      <div className="ml-toolbar">
        <strong>Markups</strong>
        <span className="muted" data-testid="ml-count">
          {rows.length.toLocaleString("en-AU")} of {allRows.length.toLocaleString("en-AU")}
        </span>
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="ml-filter" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="spacer" />
        <select value="" disabled={!selCount} onChange={(e) => e.target.value && cmd.setStatus(tab.selection, e.target.value as ReviewStatus)} aria-label="Set status of selected markups" data-testid="ml-bulk-status">
          <option value="">Set status ({selCount})</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn" onClick={exportCsv} data-testid="ml-export">
          Export CSV
        </button>
        <button className="btn" onClick={exportQuantities} disabled={!totals.length} data-testid="ml-export-quantities">
          Export quantities
        </button>
        <button className="btn" onClick={() => useApp.setState({ bottomPanel: false })} aria-label="Close Markups List">
          ✕
        </button>
      </div>
      <div className="ml-head" style={{ gridTemplateColumns: COLS.map((c) => `${c.w}px`).join(" ") }}>
        {COLS.map((c) => (
          <button key={c.key} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : 1 }))}>
            {c.label}
            {sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
          </button>
        ))}
      </div>
      <div className="ml-body" ref={bodyRef} onScroll={(e) => setScroll((e.target as HTMLElement).scrollTop)} data-testid="ml-body">
        <div style={{ height: rows.length * ROW_H, position: "relative" }}>
          {rows.slice(first, last + 1).map((r, k) => {
            const i = first + k;
            return (
              <div key={r.id} className={`ml-row ${selected.has(r.id) ? "selected" : ""}`} style={{ top: i * ROW_H, height: ROW_H, gridTemplateColumns: COLS.map((c) => `${c.w}px`).join(" ") }} onClick={(e) => clickRow(i, e)} data-testid="ml-row">
                <span>{r.page}</span>
                <span>{r.type}</span>
                <span>{r.subject}</span>
                <span>{r.author}</span>
                <span>{r.date}</span>
                <span>{r.status === "None" ? "" : r.status}</span>
                <span>
                  {r.colour && <i className="swatch" style={{ background: r.colour }} />} {r.colour}
                </span>
                <span className="num">{r.measurement}</span>
                <span title={r.comment}>{r.comment}</span>
              </div>
            );
          })}
        </div>
      </div>
      {totals.length > 0 && (
        <div className="ml-totals" data-testid="ml-totals">
          <strong>Totals</strong>
          {totals.map((t) => (
            <span key={t.kind + t.unit}>
              {KIND_LABELS[t.kind]} ({t.count}): {formatTotal(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
