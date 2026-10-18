import { describe, expect, it } from "vitest";
import type { OutlineNode } from "../../src/engine/types";
import { insertAt, moveBookmark, removeAt } from "../../src/features/viewer/BookmarksPanel";
import { fitToText } from "../../src/app/commands";
import { commandFor, COMMANDS } from "../../src/app/keymap";
import { computeLayout } from "../../src/features/viewer/layout";
import { textBoxHeight, textPadding } from "../../src/markup/appearance";
import { mk } from "./helpers/markups";

const n = (title: string, children: OutlineNode[] = []): OutlineNode => ({ title, page: 0, children });
const titles = (l: OutlineNode[]): unknown => l.map((x) => (x.children.length ? [x.title, titles(x.children)] : x.title));
const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({ code, key: code.replace(/^Key/, "").toLowerCase(), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("bookmark editing", () => {
  const o = [n("A"), n("B", [n("B1"), n("B2")]), n("C")];
  it("inserts and removes at a path", () => {
    expect(titles(insertAt(o, [1, 1], n("X")))).toEqual(["A", ["B", ["B1", "X", "B2"]], "C"]);
    expect(titles(removeAt(o, [1, 0]))).toEqual(["A", ["B", ["B2"]], "C"]);
  });
  it("moves before another bookmark, into one, and never into itself", () => {
    expect(titles(moveBookmark(o, [2], [0], false))).toEqual(["C", "A", ["B", ["B1", "B2"]]]);
    expect(titles(moveBookmark(o, [0], [2], false))).toEqual([["B", ["B1", "B2"]], "A", "C"]);
    expect(titles(moveBookmark(o, [0], [1], true))).toEqual([["B", ["B1", "B2", "A"]], "C"]);
    expect(titles(moveBookmark(o, [1, 1], [0], false))).toEqual(["B2", "A", ["B", ["B1"]], "C"]);
    expect(moveBookmark(o, [1], [1, 0], false)).toBe(o);
  });
});

describe("familiar keys", () => {
  it("no two commands share a key", () => {
    const seen = new Map<string, string>();
    for (const c of COMMANDS) for (const k of c.keys) {
      expect(seen.get(k), `${k} is used by ${seen.get(k)} and ${c.id}`).toBeUndefined();
      seen.set(k, c.id);
    }
  });
  it("matches keys by position, with modifiers exact", () => {
    expect(commandFor(key("KeyR"))?.id).toBe("tool.rectangle");
    expect(commandFor(key("KeyL", { shiftKey: true, altKey: true }))?.id).toBe("tool.length");
    expect(commandFor(key("Digit4", { ctrlKey: true }))?.id).toBe("view.single");
    expect(commandFor(key("Equal", { ctrlKey: true, shiftKey: true }))?.id).toBe("view.rotateCw");
    expect(commandFor(key("BracketLeft", { ctrlKey: true }))?.id).toBe("edit.sendBackward");
    expect(commandFor({ ...key("F3"), key: "F3" } as KeyboardEvent)?.id).toBe("view.nextResult");
    expect(commandFor(key("KeyR", { ctrlKey: true, altKey: true }))).toBeUndefined();
  });
});

describe("autosize", () => {
  it("fits a text box to its longest line and its lines", () => {
    const m = mk("textbox", { rect: [100, 100, 400, 400], contents: "Check RL\nSee detail 4 on A-201" });
    const f = fitToText(m);
    expect(f.rect[0]).toBe(100);
    expect(f.rect[1]).toBe(100);
    expect(f.rect[2]).toBeLessThan(400);
    expect(f.rect[3] - f.rect[1]).toBeCloseTo(textBoxHeight(m.style.fontFamily, m.style.fontSize, m.contents, f.rect[2] - f.rect[0], textPadding(m)));
    // nothing wraps at the new width: two lines
    expect(f.rect[3] - f.rect[1]).toBeCloseTo(2 * m.style.fontSize * 1.2 + 2 * textPadding(m) - m.style.fontSize * 0.2);
  });
});

describe("page layouts", () => {
  const page = (i: number) => ({ id: `p${i}`, src: i, rotation: 0 as const, scale: null, label: String(i + 1), info: { bounds: [0, 0, 100, 50] as [number, number, number, number], rotate: 0 } }) as never;
  const pages = Array.from({ length: 5 }, (_, i) => page(i));
  it("single page shows the current page; side by side its pair; continuous all", () => {
    expect(computeLayout(pages, 1, 0, 800, "single", 3).pages.map((p) => p.index)).toEqual([3]);
    expect(computeLayout(pages, 1, 0, 800, "sideBySide", 3).pages.map((p) => p.index)).toEqual([2, 3]);
    expect(computeLayout(pages, 1, 0, 800, "sideBySide", 4).pages.map((p) => p.index)).toEqual([4]);
    const c = computeLayout(pages, 1, 0, 800, "continuousSideBySide", 0).pages;
    expect(c.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(c[0].y).toBe(c[1].y);
    expect(c[2].y).toBeGreaterThan(c[0].y);
    // a lone last page sits in the left column
    expect(c[4].x).toBe(c[0].x);
  });
});
