/** Markups List rows and CSV export (pure, unit-tested). */
import { threadOrder } from "../replies/thread";
import { colourHex, formatDate, KIND_LABELS, type Markup } from "../../markup/model";
import { isMeasure, measureValue, scaleLabel } from "../../markup/measure";
import type { PageEntry } from "../../state/store";

export interface Row {
  id: string;
  pageIndex: number;
  page: string;
  type: string;
  subject: string;
  author: string;
  date: string;
  /** ISO for sorting */
  modified: string;
  status: string;
  comment: string;
  colour: string;
  locked: boolean;
  /** Measured value as shown, "" for other markups. */
  measurement: string;
  /** Full-precision value and its unit (measurements only). */
  value: number | null;
  unit: string;
  /** Number of replies, and their text for filtering and export ("Author (date): text" per line). */
  replyCount: number;
  replies: string;
  m: Markup;
}

export function markupRows(markups: Record<string, Markup>, pages: PageEntry[]): Row[] {
  const pageIdx = new Map(pages.map((p, i) => [p.id, i]));
  const rows: Row[] = [];
  for (const m of Object.values(markups)) {
    const pi = pageIdx.get(m.pageId);
    if (pi === undefined) continue;
    rows.push({
      id: m.id,
      pageIndex: pi,
      page: pages[pi].info.label,
      type: m.kind === "foreign" ? m.subtype : KIND_LABELS[m.kind],
      subject: m.subject,
      author: m.author,
      date: formatDate(m.modified),
      modified: m.modified,
      status: m.status,
      comment: m.contents,
      colour: colourHex(m.kind === "textbox" ? m.style.textColor : m.style.color),
      locked: m.locked,
      ...(isMeasure(m.kind) ? (({ text, value, unit }) => ({ measurement: text, value, unit }))(measureValue(m)) : { measurement: "", value: null, unit: "" }),
      replyCount: m.replies.length,
      replies: threadOrder(m.replies)
        .map(({ reply: r, depth }) => `${"> ".repeat(depth)}${r.author} (${formatDate(r.created)}): ${r.contents}`)
        .join("\n"),
      m,
    });
  }
  return rows;
}

export type SortKey = "page" | "type" | "subject" | "author" | "date" | "status" | "comment" | "colour" | "measurement" | "replies";

/** Sorts names the way people expect (accents and case don't push entries to the end). */
const collator = new Intl.Collator("en-AU", { sensitivity: "base", numeric: true });

export function sortRows(rows: Row[], key: SortKey, dir: 1 | -1): Row[] {
  const val = (r: Row): string | number => (key === "page" ? r.pageIndex : key === "measurement" ? (r.value ?? -Infinity) : key === "replies" ? r.replyCount : key === "date" ? r.modified : (r[key] as string));
  return rows.slice().sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === "number" || key === "date" ? (va < vb ? -1 : va > vb ? 1 : 0) : collator.compare(va, vb as string);
    // ties keep a stable order (creation, then id) so rows do not jump when they are edited
    return c !== 0 ? c * dir : a.pageIndex - b.pageIndex || a.m.created.localeCompare(b.m.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** Text that spreadsheets would run as a formula gets a leading apostrophe (shown as plain text). */
export function guardFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

function cell(v: string | number | boolean): string {
  const s = typeof v === "string" ? guardFormula(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = ["Page", "Page number", "Type", "Subject", "Author", "Date", "Status", "Comment", "Colour", "Locked", "Measurement", "ID", "Replies"];

export function rowsToCsv(rows: Row[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push([r.page, r.pageIndex + 1, r.type, r.subject, r.author, r.date, r.status, r.comment, r.colour, r.locked ? "Yes" : "No", r.measurement, r.id, r.replies].map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export const QUANTITY_COLUMNS = ["Page", "Page number", "Type", "Subject", "Quantity", "Unit", "Scale", "Comment", "ID"];

/**
 * Quantities for takeoff: one row per measurement with the unrounded value, then a total per type and unit.
 * Values are plain numbers (no thousands separators) so spreadsheets read them as numbers.
 */
export function quantitiesCsv(rows: Row[]): string {
  const ms = rows.filter((r) => r.value !== null);
  const lines = [QUANTITY_COLUMNS.join(",")];
  const totals = new Map<string, { type: string; unit: string; total: number; count: number }>();
  for (const r of ms) {
    const scale = r.m.measure?.scale;
    lines.push([r.page, r.pageIndex + 1, r.type, r.subject, plain(r.value!), r.unit, scale ? scaleLabel(scale) : "", r.comment, r.id].map(cell).join(","));
    const key = `${r.type}|${r.unit}`;
    const t = totals.get(key) ?? { type: r.type, unit: r.unit, total: 0, count: 0 };
    t.total += r.value!;
    t.count++;
    totals.set(key, t);
  }
  if (totals.size) lines.push("");
  for (const t of totals.values()) lines.push(["Total", "", t.type, `${t.count} item${t.count === 1 ? "" : "s"}`, plain(t.total), t.unit, "", "", ""].map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Up to 10 significant decimals, no exponent, no separators. */
function plain(v: number): string {
  return String(Math.round(v * 1e10) / 1e10);
}

/** Minimal CSV parser (for tests and round trips). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && s[i + 1] === "\n")) {
      if (c === "\r") i++;
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}
