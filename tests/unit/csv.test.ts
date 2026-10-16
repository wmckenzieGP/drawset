import { describe, expect, it } from "vitest";
import { guardFormula, markupRows, parseCsv, rowsToCsv, sortRows, CSV_COLUMNS } from "../../src/features/markupsList/csv";
import { formatDate, type Markup } from "../../src/markup/model";
import type { PageEntry } from "../../src/state/store";
import { mk } from "./helpers/markups";

const pages: PageEntry[] = ["A-101", "A-102", "M-1"].map((label, i) => ({
  id: `p${i}`,
  src: i,
  rotation: 0,
  info: { index: i, label, bounds: [0, 0, 1190, 842], rotate: 0 } as PageEntry["info"],
}));

function model(): Record<string, Markup> {
  const list = [
    mk("rectangle", { pageId: "p1", subject: "Clash", contents: 'Duct hits beam, see "B2"', author: "Jo Smith", status: "Accepted", modified: "2026-10-01T03:00:00.000Z" }),
    mk("cloud", { pageId: "p0", subject: "RFI", contents: "Line one\nLine two, with comma", author: "Āria Ngata", modified: "2026-10-02T03:00:00.000Z", locked: true }),
    mk("textbox", { pageId: "p2", subject: "Note", contents: "=HYPERLINK(\"x\")", author: "A", modified: "2026-09-30T03:00:00.000Z" }),
    mk("foreign", { pageId: "p0", subtype: "Polygon", subject: "", contents: "-12", author: "B" }),
  ];
  return Object.fromEntries(list.map((m) => [m.id, m]));
}

describe("markups CSV", () => {
  it("has one row per markup that matches the model field for field", () => {
    const ms = model();
    const rows = sortRows(markupRows(ms, pages), "page", 1);
    const csv = rowsToCsv(rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const table = parseCsv(csv);
    expect(table[0]).toEqual(CSV_COLUMNS);
    expect(table.length - 1).toBe(Object.keys(ms).length);
    for (const line of table.slice(1)) {
      const rec = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, line[i]]));
      const m = ms[rec.ID];
      const pi = pages.findIndex((p) => p.id === m.pageId);
      expect(rec.Page).toBe(pages[pi].info.label);
      expect(Number(rec["Page number"])).toBe(pi + 1);
      expect(rec.Subject).toBe(m.subject);
      expect(rec.Author).toBe(m.author);
      expect(rec.Date).toBe(formatDate(m.modified));
      expect(rec.Status).toBe(m.status);
      expect(rec.Comment).toBe(guardFormula(m.contents));
      expect(rec.Locked).toBe(m.locked ? "Yes" : "No");
      expect(rec.Type).toBe(m.kind === "foreign" ? "Polygon" : rec.Type);
    }
    // rows come out in page order
    expect(table.slice(1).map((l) => l[1])).toEqual(["1", "1", "2", "3"]);
  });

  it("keeps formulas from running in spreadsheets but leaves numbers alone", () => {
    expect(guardFormula("=1+1")).toBe("'=1+1");
    expect(guardFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(guardFormula("-12")).toBe("-12");
    expect(guardFormula("+3.5")).toBe("+3.5");
    expect(guardFormula("- check")).toBe("'- check");
    expect(guardFormula("Plain")).toBe("Plain");
  });

  it("sorts by any column both ways", () => {
    const rows = markupRows(model(), pages);
    const byAuthor = sortRows(rows, "author", 1).map((r) => r.author);
    expect(byAuthor).toEqual(["A", "Āria Ngata", "B", "Jo Smith"]);
    const byDate = sortRows(rows, "date", -1).map((r) => r.modified);
    expect(byDate).toEqual([...byDate].sort().reverse());
  });
});
