import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { useNodeEngine } from "./helpers/nodeEngine";
import type { EngineCore } from "../../src/engine/core/engineCore";
import { addTab, recordsToMarkups, setLoadedMarkups, undo, redo, useApp, type DocTab } from "../../src/state/store";
import { buildPlan } from "../../src/state/documents";
import { deletePages, insertBlankPage, insertFromFiles, movePages, parsePageRange, parseRangeGroups, rotatePages } from "../../src/features/pages/pageOps";
import { openMupdf } from "./helpers/mupdf";
import { openPdfjs } from "./helpers/pdfjs";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
let core: EngineCore;
beforeAll(() => {
  core = useNodeEngine();
});

async function openTab(name: string): Promise<string> {
  const info = core.open(read(name), name);
  const key = addTab(info, name, null);
  const tab = tabOf(key);
  setLoadedMarkups(key, recordsToMarkups(core.readMarkups(info.docId), tab.state.pages));
  return key;
}
const tabOf = (key: string): DocTab => useApp.getState().tabs.find((t) => t.key === key)!;

/** Writes the tab's current state to a copy and checks MuPDF and pdf.js both open it. */
async function writeCopy(key: string) {
  const t = tabOf(key);
  const bytes = core.saveCopy(t.docId, buildPlan(t));
  const mu = openMupdf(bytes);
  const pj = await openPdfjs(bytes);
  expect(pj.numPages).toBe(mu.countPages());
  await pj.destroy();
  return { bytes, mu };
}
const labelText = (mu: ReturnType<typeof openMupdf>, i: number) => mu.loadPage(i).toStructuredText("").asText().match(/M-(\d+)/)?.[1].replace(/^0+/, "");

describe("page ranges", () => {
  it("parses ranges in the order given", () => {
    expect(parsePageRange("1-3, 7", 10)).toEqual([0, 1, 2, 6]);
    expect(parsePageRange("8-", 10)).toEqual([7, 8, 9]);
    expect(parsePageRange("3-1", 10)).toEqual([2, 1, 0]);
    expect(parsePageRange("0", 10)).toBeNull();
    expect(parsePageRange("11", 10)).toBeNull();
    expect(parsePageRange("x", 10)).toBeNull();
    expect(parseRangeGroups("1-5, 6-10", 10)).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  });
});

describe("page operations", () => {
  it("reorders, rotates and deletes pages; each is undoable; the file matches", async () => {
    const key = await openTab("set-200.pdf");
    const ids = () => tabOf(key).state.pages.map((p) => p.id);
    const orig = ids();
    movePages(key, [orig[4]], 0);
    expect(ids().slice(0, 2)).toEqual([orig[4], orig[0]]);
    rotatePages(key, [orig[1]], 90);
    deletePages(key, [orig[199], orig[198]]);
    expect(ids().length).toBe(198);
    const { mu } = await writeCopy(key);
    expect(mu.countPages()).toBe(198);
    expect(labelText(mu, 0)).toBe("5");
    expect(labelText(mu, 1)).toBe("1");
    expect(mu.findPage(2).getInheritable("Rotate").asNumber()).toBe(90);
    // undo all three, redo one
    undo(key);
    undo(key);
    undo(key);
    expect(ids()).toEqual(orig);
    redo(key);
    expect(ids()[0]).toBe(orig[4]);
  });

  it("keeps markups with their pages when pages move or are deleted", async () => {
    const key = await openTab("annotated.pdf");
    const t = tabOf(key);
    const onP2 = Object.values(t.state.markups).filter((m) => m.pageId === t.state.pages[1].id);
    expect(onP2.length).toBeGreaterThan(0);
    movePages(key, [t.state.pages[1].id], 0);
    const { bytes } = await writeCopy(key);
    const back = core.open(bytes, "moved.pdf");
    const recs = core.readMarkups(back.docId);
    for (const m of onP2) expect(recs.find((r) => r.id === m.id)?.pageIndex).toBe(0);
    deletePages(key, [t.state.pages[0].id]);
    expect(Object.values(tabOf(key).state.markups).some((m) => m.pageId === t.state.pages[0].id)).toBe(false);
    const { bytes: b2 } = await writeCopy(key);
    const r2 = core.readMarkups(core.open(b2, "deleted.pdf").docId);
    expect(r2.find((r) => r.id === "fixture-square-1")).toBeUndefined();
    expect(r2.map((r) => r.id).sort()).toEqual(onP2.map((m) => m.id).sort());
  });

  it("inserts blank pages and pages from other files with their markups", async () => {
    const key = await openTab("calibration.pdf");
    await insertBlankPage(key, 0);
    expect(tabOf(key).state.pages.length).toBe(2);
    await insertFromFiles(key, [{ name: "annotated.pdf", path: null, bytes: read("annotated.pdf") } as never], 2);
    const t = tabOf(key);
    expect(t.state.pages.length).toBe(4);
    const imported = Object.values(t.state.markups).filter((m) => m.pageId === t.state.pages[2].id);
    expect(imported.some((m) => m.id === "fixture-square-1")).toBe(true);
    const { bytes, mu } = await writeCopy(key);
    expect(mu.countPages()).toBe(4);
    // the blank page is the calibration page's size and empty
    const b0 = mu.loadPage(0).getBounds();
    const b1 = mu.loadPage(1).getBounds();
    expect(b0[2] - b0[0]).toBeCloseTo(b1[2] - b1[0], 3);
    expect(mu.loadPage(0).toStructuredText("").asText().trim()).toBe("");
    const recs = core.readMarkups(core.open(bytes, "combined.pdf").docId);
    expect(recs.find((r) => r.id === "fixture-square-1")?.pageIndex).toBe(2);
    expect(recs.find((r) => r.id === "fixture-square-1")?.status).toBe("Accepted");
    undo(key);
    expect(tabOf(key).state.pages.length).toBe(2);
  });

  it("extracts a range into a valid file in the given order", async () => {
    const key = await openTab("set-200.pdf");
    const t = tabOf(key);
    const ids = [9, 3, 4].map((i) => t.state.pages[i].id);
    const bytes = core.saveCopy(t.docId, buildPlan(t, t.state, { pageIds: ids }));
    const mu = openMupdf(bytes);
    expect(mu.countPages()).toBe(3);
    expect([0, 1, 2].map((i) => labelText(mu, i))).toEqual(["10", "4", "5"]);
    const pj = await openPdfjs(bytes);
    expect(pj.numPages).toBe(3);
    await pj.destroy();
  });
});
