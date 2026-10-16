/** Markups List rows and CSV export (pure, unit-tested). */
import { colourHex, formatDate, KIND_LABELS, type Markup } from "../../markup/model";
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
      m,
    });
  }
  return rows;
}

export type SortKey = "page" | "type" | "subject" | "author" | "date" | "status" | "comment" | "colour";

/** Sorts names the way people expect (accents and case don't push entries to the end). */
const collator = new Intl.Collator("en-AU", { sensitivity: "base", numeric: true });

export function sortRows(rows: Row[], key: SortKey, dir: 1 | -1): Row[] {
  const val = (r: Row): string | number => (key === "page" ? r.pageIndex : key === "date" ? r.modified : (r[key] as string));
  return rows.slice().sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === "number" || key === "date" ? (va < vb ? -1 : va > vb ? 1 : 0) : collator.compare(va, vb as string);
    return c !== 0 ? c * dir : a.pageIndex - b.pageIndex || a.modified.localeCompare(b.modified);
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

export const CSV_COLUMNS = ["Page", "Page number", "Type", "Subject", "Author", "Date", "Status", "Comment", "Colour", "Locked", "ID"];

export function rowsToCsv(rows: Row[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push([r.page, r.pageIndex + 1, r.type, r.subject, r.author, r.date, r.status, r.comment, r.colour, r.locked ? "Yes" : "No", r.id].map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
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
