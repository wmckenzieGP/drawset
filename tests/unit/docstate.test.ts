import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useNodeEngine } from "./helpers/nodeEngine";
import { mk } from "./helpers/markups";
import type { EngineCore } from "../../src/engine/core/engineCore";
import { addTab, commit, isDirty, setLoadedMarkups, undo, useApp, withGroups, withMarkups, type DocTab } from "../../src/state/store";
import { saveTab } from "../../src/state/documents";
import { deletePages } from "../../src/features/pages/pageOps";
import { openMupdf } from "./helpers/mupdf";
import { keepOnPage } from "../../src/features/viewer/controller";
import { computeLayout } from "../../src/features/viewer/layout";
import { markupBounds } from "../../src/markup/appearance";
import { cloneMarkup, relinkGroups, translate } from "../../src/markup/edit";
import { arranged } from "../../src/app/commands";

const host = vi.hoisted(() => ({ dest: undefined as string | null | undefined, write: null as null | ((b: Uint8Array) => void) }));
vi.mock("../../src/platform/host", async (orig) => ({
  ...(await orig<typeof import("../../src/platform/host")>()),
  savePathFor: async () => host.dest,
  writeSaved: async (_p: string | null, _n: string, bytes: Uint8Array) => host.write?.(bytes),
}));

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
let core: EngineCore;
beforeAll(() => {
  core = useNodeEngine();
});
const tabOf = (key: string): DocTab => useApp.getState().tabs.find((t) => t.key === key)!;

describe("document state", () => {
  it("keeps edits made before the file's markups are read, and undoing past the load deletes nothing", () => {
    const info = core.open(read("annotated.pdf"), "annotated.pdf");
    const key = addTab(info, "annotated.pdf", null);
    const original = tabOf(key).saved;
    const records = core.readMarkups(info.docId);
    const onPage1 = records.filter((r) => r.pageIndex === 1).length;
    expect(onPage1).toBeGreaterThan(0);

    // a markup drawn and a page deleted while the file's markups are still being read
    const drawn = mk("rectangle", { pageId: original.pages[0].id, points: [[10, 10], [60, 40]] });
    commit(key, "Add rectangle", (s) => withMarkups(s, [drawn]));
    deletePages(key, [original.pages[1].id]);
    setLoadedMarkups(key, records);

    const t = tabOf(key);
    expect(t.markupsLoaded).toBe(true);
    expect(t.state.markups[drawn.id]).toBeDefined();
    expect(Object.keys(t.state.markups).length).toBe(records.length - onPage1 + 1);
    expect(Object.keys(t.saved.markups).length).toBe(records.length);
    // the step before the page was deleted has the page's markups back
    expect(Object.keys(t.undo[t.undo.length - 1].state.markups).length).toBe(records.length + 1);

    undo(key);
    undo(key);
    expect(tabOf(key).state).toBe(tabOf(key).saved);
    expect(isDirty(tabOf(key))).toBe(false);
  });

  it("deleting pages keeps form values, recognised text and the header and footer", () => {
    const info = core.open(read("annotated.pdf"), "annotated.pdf");
    const key = addTab(info, "annotated.pdf", null);
    setLoadedMarkups(key, core.readMarkups(info.docId));
    commit(key, "Edits", (s) => ({ ...s, fields: { name: "Level 2" }, ocr: { 0: null } }));
    deletePages(key, [tabOf(key).state.pages[1].id]);
    expect(tabOf(key).state.fields).toEqual({ name: "Level 2" });
    expect(tabOf(key).state.ocr).toEqual({ 0: null });
  });

  it("cancelling Save leaves the document as it was; a failed write keeps the changes for another try", async () => {
    const info = core.open(read("annotated.pdf"), "annotated.pdf");
    const key = addTab(info, "annotated.pdf", null);
    setLoadedMarkups(key, core.readMarkups(info.docId));
    const drawn = mk("rectangle", { pageId: tabOf(key).state.pages[0].id, points: [[10, 10], [60, 40]], contents: "Keep me" });
    commit(key, "Add rectangle", (s) => withMarkups(s, [drawn]));
    const before = tabOf(key);

    host.dest = undefined;
    expect(await saveTab(key)).toBe(false);
    expect(tabOf(key)).toBe(before);

    host.dest = null;
    host.write = () => {
      throw new Error("The disk is full.");
    };
    expect(await saveTab(key)).toBe(false);
    expect(isDirty(tabOf(key))).toBe(true);
    expect(Object.values(tabOf(key).state.markups).some((m) => m.contents === "Keep me")).toBe(true);
    expect(useApp.getState().message?.text ?? "").toMatch(/Save failed.*changes are kept/);

    let written: Uint8Array | null = null;
    host.write = (b) => void (written = b);
    expect(await saveTab(key)).toBe(true);
    expect(isDirty(tabOf(key))).toBe(false);
    const page = openMupdf(written!).loadPage(0);
    expect(page.getAnnotations().some((a) => a.getContents() === "Keep me")).toBe(true);
  });

  it("a markup moved onto another page is saved there once, with nothing left behind", async () => {
    const info = core.open(read("annotated.pdf"), "annotated.pdf");
    const key = addTab(info, "annotated.pdf", null);
    setLoadedMarkups(key, core.readMarkups(info.docId));
    const [p0, p1] = tabOf(key).state.pages;
    const m = Object.values(tabOf(key).state.markups).find((x) => x.pageId === p0.id && x.objNum !== undefined && !x.quads.length && x.kind !== "link")!;
    const onFirst = core.readMarkups(info.docId).filter((r) => r.pageIndex === 0).length;
    commit(key, "Move", (s) => withMarkups(s, [{ ...m, pageId: p1.id, contents: "Moved over" }]));
    host.dest = null;
    let written: Uint8Array | null = null;
    host.write = (b) => void (written = b);
    expect(await saveTab(key)).toBe(true);
    const doc = openMupdf(written!);
    expect(doc.loadPage(0).getAnnotations().length).toBeLessThan(onFirst);
    expect(doc.loadPage(0).getAnnotations().some((a) => a.getContents() === m.contents && m.contents !== "")).toBe(false);
    expect(doc.loadPage(1).getAnnotations().filter((a) => a.getContents() === "Moved over").length).toBe(1);
  });

  it("markups dragged past the page edge are kept on the page", () => {
    const info = core.open(read("annotated.pdf"), "annotated.pdf");
    const key = addTab(info, "annotated.pdf", null);
    const layout = computeLayout(tabOf(key).state.pages, 1, 0, 1000);
    const page = layout.pages[0];
    const b = page.entry.info.bounds;
    const box = mk("textbox", { pageId: page.entry.id, rect: [100, 100, 200, 140], points: [] });
    const [out] = keepOnPage(page, [translate(box, 0, b[3] + 500)]);
    const r = markupBounds(out);
    expect(r[3]).toBeLessThanOrEqual(b[3] + 1e-6);
    expect(r[1]).toBeGreaterThanOrEqual(b[1]);
    expect(r[0]).toBe(markupBounds(box)[0]);
  });

  it("bring to front and send to back change the drawing order, and the saved file keeps it", async () => {
    const info = core.open(read("calibration.pdf"), "calibration.pdf");
    const key = addTab(info, "calibration.pdf", null);
    setLoadedMarkups(key, []);
    const pid = tabOf(key).state.pages[0].id;
    const [a, b, c] = ["A", "B", "C"].map((n) => mk("rectangle", { pageId: pid, points: [[10, 10], [60, 40]], contents: n }));
    commit(key, "Add", (s) => withMarkups(s, [a, b, c]));
    host.dest = null;
    let written: Uint8Array | null = null;
    host.write = (bytes) => void (written = bytes);
    expect(await saveTab(key)).toBe(true);
    const ids = () => Object.values(tabOf(key).state.markups).map((m) => m.contents);
    expect(ids()).toEqual(["A", "B", "C"]);
    const idOf = (n: string) => Object.values(tabOf(key).state.markups).find((m) => m.contents === n)!.id;
    commit(key, "Front", (s) => ({ ...s, markups: arranged(s.markups, new Set([idOf("A")]), "front") }));
    expect(ids()).toEqual(["B", "C", "A"]);
    commit(key, "Back", (s) => ({ ...s, markups: arranged(s.markups, new Set([idOf("C")]), "back") }));
    expect(ids()).toEqual(["C", "B", "A"]);
    commit(key, "Forward", (s) => ({ ...s, markups: arranged(s.markups, new Set([idOf("C")]), "forward") }));
    expect(ids()).toEqual(["B", "C", "A"]);
    expect(await saveTab(key)).toBe(true);
    const order = openMupdf(written!).loadPage(0).getAnnotations().map((x) => x.getContents());
    expect(order).toEqual(["B", "C", "A"]);
    // and reading the file back gives the same order
    expect(ids()).toEqual(["B", "C", "A"]);
  });

  it("grouped markups are saved as /RT /Group, read back as a group, and regroup when the first is deleted", async () => {
    const info = core.open(read("calibration.pdf"), "calibration.pdf");
    const key = addTab(info, "calibration.pdf", null);
    setLoadedMarkups(key, []);
    const pid = tabOf(key).state.pages[0].id;
    const [a, b, c] = ["A", "B", "C"].map((n) => mk("rectangle", { pageId: pid, points: [[10, 10], [60, 40]], contents: n }));
    commit(key, "Add", (s) => withMarkups(s, [a, { ...b, group: a.id }, { ...c, group: a.id }]));
    expect(withGroups(tabOf(key).state.markups, [c.id]).sort()).toEqual([a.id, b.id, c.id].sort());
    // copies form a group of their own
    const ms = [a, b, c].map((m) => tabOf(key).state.markups[m.id]);
    const copies = relinkGroups(ms, ms.map((m, i) => cloneMarkup(m, `copy-${i}`, pid, 5, 5, "x")));
    expect(copies.map((m) => m.group)).toEqual([undefined, "copy-0", "copy-0"]);
    host.dest = null;
    let written: Uint8Array | null = null;
    host.write = (bytes) => void (written = bytes);
    expect(await saveTab(key)).toBe(true);
    const annots = openMupdf(written!).loadPage(0).getAnnotations();
    const objOf = (n: string) => annots.find((x) => x.getContents() === n)!.getObject();
    expect(objOf("B").get("RT").asName()).toBe("Group");
    expect(objOf("C").get("IRT").asIndirect()).toBe(objOf("A").asIndirect());
    expect(objOf("A").get("IRT").isNull()).toBe(true);
    // reading the file back
    const back = core.open(written!, "g.pdf");
    const recs = core.readMarkups(back.docId);
    expect(recs).toHaveLength(3);
    const rec = (n: string) => recs.find((r) => r.contents === n)!;
    expect(rec("A").group).toBeUndefined();
    expect(rec("B").group).toBe(rec("A").id);
    expect(rec("C").group).toBe(rec("A").id);
    expect(rec("A").replies).toEqual([]);
    // deleting the first: B leads, C follows it, and the saved file keeps both
    commit(key, "Delete", (s) => withMarkups(s, [], [a.id]));
    const st = tabOf(key).state.markups;
    expect(st[b.id].group).toBeUndefined();
    expect(st[c.id].group).toBe(b.id);
    expect(await saveTab(key)).toBe(true);
    const after = openMupdf(written!).loadPage(0).getAnnotations();
    expect(after.map((x) => x.getContents()).sort()).toEqual(["B", "C"]);
    const objB = after.find((x) => x.getContents() === "B")!.getObject();
    expect(objB.get("RT").isNull()).toBe(true);
    expect(after.find((x) => x.getContents() === "C")!.getObject().get("IRT").asIndirect()).toBe(objB.asIndirect());
  });
});
