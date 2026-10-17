import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { useNodeEngine } from "./helpers/nodeEngine";
import type { EngineCore } from "../../src/engine/core/engineCore";
import { activeTab, addTab, commit, undo, redo, updateTab, useApp, withMarkups } from "../../src/state/store";
import { cmd } from "../../src/app/commands";
import { hitTest, scaleBetween, setVertex, translate, cloneMarkup } from "../../src/markup/edit";
import { mk } from "./helpers/markups";

let core: EngineCore;
let key: string;
let pageId: string;
beforeAll(() => {
  core = useNodeEngine();
  const info = core.open(new Uint8Array(readFileSync("fixtures/calibration.pdf")), "calibration.pdf");
  key = addTab(info, "calibration.pdf", null);
  pageId = activeTab()!.state.pages[0].id;
});
const tab = () => activeTab()!;

describe("pure editing operations", () => {
  it("moves every coordinate", () => {
    const m = mk("polyline", { points: [[0, 0], [10, 5]], rect: [0, 0, 10, 5], inks: [], quads: [] });
    const t = translate(m, 3, 4);
    expect(t.points).toEqual([[3, 4], [13, 9]]);
    expect(t.rect).toEqual([3, 4, 13, 9]);
    expect(m.points).toEqual([[0, 0], [10, 5]]);
  });
  it("resizes from one box to another", () => {
    const m = mk("pen", { rect: [0, 0, 10, 10], inks: [[[0, 0], [10, 10]]] });
    const s = scaleBetween(m, [0, 0, 10, 10], [10, 10, 30, 50]);
    expect(s.rect).toEqual([10, 10, 30, 50]);
    expect(s.inks[0]).toEqual([[10, 10], [30, 50]]);
  });
  it("moves a vertex and updates the bounds", () => {
    const m = mk("polygon", { points: [[0, 0], [10, 0], [5, 8]], rect: [0, 0, 10, 8] });
    const v = setVertex(m, 2, [5, 20]);
    expect(v.rect).toEqual([0, 0, 10, 20]);
  });
  it("hit-tests outlines, fills and lines", () => {
    const r = mk("rectangle", { rect: [0, 0, 100, 100] });
    expect(hitTest(r, [0.5, 50], 2)).toBe(true);
    expect(hitTest(r, [50, 50], 2)).toBe(false);
    expect(hitTest({ ...r, style: { ...r.style, fill: [1, 0, 0] } }, [50, 50], 2)).toBe(true);
    const l = mk("line", { points: [[0, 0], [100, 0]], rect: [0, 0, 100, 0] });
    expect(hitTest(l, [50, 1], 2)).toBe(true);
    expect(hitTest(l, [50, 10], 2)).toBe(false);
  });
  it("copies get a new id, author and no status", () => {
    const m = mk("rectangle", { status: "Accepted", objNum: 12, locked: true });
    const c = cloneMarkup(m, "new", "p9", 12, 12, "Me");
    expect([c.id, c.pageId, c.author, c.status, c.objNum, c.locked]).toEqual(["new", "p9", "Me", "None", undefined, false]);
  });
});

describe("editing commands", () => {
  it("adds, moves, deletes, duplicates and locks, each undoable", () => {
    const m = mk("rectangle", { pageId, rect: [100, 100, 200, 150] });
    commit(key, "Add rectangle", (s) => withMarkups(s, [m]));
    commit(key, "Move", (s) => withMarkups(s, [translate(s.markups[m.id], 50, 0)]));
    expect(tab().state.markups[m.id].rect[0]).toBe(150);
    undo(key);
    expect(tab().state.markups[m.id].rect[0]).toBe(100);
    redo(key);
    expect(tab().state.markups[m.id].rect[0]).toBe(150);

    updateTab(key, (t) => ({ ...t, selection: [m.id] }));
    cmd.duplicate();
    expect(Object.keys(tab().state.markups).length).toBe(2);
    const copyId = tab().selection[0];
    expect(copyId).not.toBe(m.id);
    expect(tab().state.markups[copyId].rect[0]).toBe(162);
    undo(key);
    expect(Object.keys(tab().state.markups).length).toBe(1);

    updateTab(key, (t) => ({ ...t, selection: [m.id] }));
    cmd.setLocked(true);
    cmd.deleteSelection();
    expect(tab().state.markups[m.id]).toBeDefined();
    cmd.setLocked(false);
    cmd.deleteSelection();
    expect(tab().state.markups[m.id]).toBeUndefined();
    undo(key);
    expect(tab().state.markups[m.id]).toBeDefined();

    updateTab(key, (t) => ({ ...t, selection: [m.id] }));
    cmd.copy();
    cmd.paste();
    expect(Object.keys(tab().state.markups).length).toBe(2);
    cmd.setStatus([m.id], "Rejected");
    expect(tab().state.markups[m.id].status).toBe("Rejected");
    const labels = tab().undo.map((u) => u.label);
    expect(labels.slice(-2)).toEqual(["Paste", "Set status Rejected"]);
    expect(useApp.getState().tabs.length).toBe(1);
  });

  it("merges rapid changes of one property into one undo step", () => {
    const m = Object.values(tab().state.markups)[0];
    const before = tab().undo.length;
    for (const o of [0.9, 0.8, 0.7, 0.6]) commit(key, "Opacity", (s) => withMarkups(s, [{ ...s.markups[m.id], style: { ...s.markups[m.id].style, opacity: o } }]), `opacity:${m.id}`);
    expect(tab().undo.length).toBe(before + 1);
    undo(key);
    expect(tab().state.markups[m.id].style.opacity).toBe(m.style.opacity);
  });

  it("a change straight after undo is its own step, not merged into the one before", () => {
    const m = Object.values(tab().state.markups)[0];
    const set = (o: number) => commit(key, "Opacity", (s) => withMarkups(s, [{ ...s.markups[m.id], style: { ...s.markups[m.id].style, opacity: o } }]), `opacity:${m.id}`);
    const before = tab().state;
    set(0.5);
    undo(key);
    set(0.3);
    expect(tab().undo[tab().undo.length - 1].state).toBe(before);
    undo(key);
    expect(tab().state).toBe(before);
  });
});
