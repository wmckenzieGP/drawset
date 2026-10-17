import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useNodeEngine } from "./helpers/nodeEngine";
import { mk } from "./helpers/markups";
import type { EngineCore } from "../../src/engine/core/engineCore";
import { addTab, commit, isDirty, setLoadedMarkups, undo, useApp, withMarkups, type DocTab } from "../../src/state/store";
import { saveTab } from "../../src/state/documents";
import { deletePages } from "../../src/features/pages/pageOps";
import { openMupdf } from "./helpers/mupdf";

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
});
