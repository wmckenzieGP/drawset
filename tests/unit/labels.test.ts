import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EngineCore } from "../../src/engine/core/engineCore";
import { transformRect, type Rect } from "../../src/markup/geometry";
import { openMupdf } from "./helpers/mupdf";
import { openPdfjs } from "./helpers/pdfjs";
import { identityPages } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

describe("page labels from a title-block region", () => {
  it("reads each sheet number from the box, writes /PageLabels and bookmarks that MuPDF and pdf.js read back", async () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    expect(info.pages[4].label).toBe("M-5");
    const w = info.pages[0].bounds[2];
    // the sheet-number cell of the title block, in user space, then page space
    const region = transformRect([w - 140, 20, w - 20, 80], info.pages[0].ctm) as Rect;
    const t0 = performance.now();
    const texts = e.textInRect(info.docId, [...Array(200).keys()], region);
    expect(performance.now() - t0).toBeLessThan(20000);
    expect(texts[0]).toBe("M-001");
    expect(texts[199]).toBe("M-200");
    expect(texts.every((t, i) => t === `M-${String(i + 1).padStart(3, "0")}`)).toBe(true);

    const outline = texts.map((title, i) => ({ title, page: i, children: [] }));
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [], deletes: [], defaultAuthor: "T", pageLabels: texts, outline }, "incremental");
    expect(res.info.pages.map((p) => p.label)).toEqual(texts);
    expect(res.info.outline).toHaveLength(200);
    expect(res.info.outline[57]).toMatchObject({ title: "M-058", page: 57 });

    const doc = openMupdf(res.bytes);
    expect(doc.getTrailer().get("Root").get("Outlines").get("Count").asNumber()).toBe(200);
    const pj = await openPdfjs(res.bytes);
    expect((await pj.getPageLabels())?.slice(0, 3)).toEqual(["M-001", "M-002", "M-003"]);
    const pjOutline = await pj.getOutline();
    expect(pjOutline).toHaveLength(200);
    if (!pjOutline) throw new Error("no outline");
    expect(pjOutline[9].title).toBe("M-010");
    expect(await pj.getPageIndex((pjOutline[9].dest as unknown as [{ num: number; gen: number }])[0])).toBe(9);
    await pj.destroy();
  });

  it("labels follow their pages when pages are reordered and deleted", () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const order = [2, 0, 1];
    const labels = ["C", "A", "B"];
    const res = e.save(info.docId, { pages: order.map((i) => ({ index: i, rotate: 0 })), upserts: [], deletes: [], defaultAuthor: "T", pageLabels: labels }, "full");
    expect(res.info.pageCount).toBe(3);
    expect(res.info.pages.map((p) => p.label)).toEqual(labels);
    // page content moved with the label: the first page is sheet 3
    expect(e.textInRect(res.info.docId, [0], transformRect([res.info.pages[0].bounds[2] - 140, 20, res.info.pages[0].bounds[2] - 20, 80], res.info.pages[0].ctm) as Rect)[0]).toBe("M-003");
  });
});

describe("labelling through the app state", () => {
  it("labels and bookmarks are one undo step, and a reorder keeps the new labels with their pages", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, undo, useApp } = await import("../../src/state/store");
    const { buildPlan } = await import("../../src/state/documents");
    const { applyPageLabels, readRegionLabels } = await import("../../src/features/pages/labelRegion");
    const { movePages } = await import("../../src/features/pages/pageOps");
    const core = useNodeEngine();
    const info = core.open(read("set-200.pdf"), "set-200.pdf");
    const key = addTab(info, "set-200.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    const w = info.pages[0].bounds[2];
    const region = transformRect([w - 140, 20, w - 20, 80], info.pages[0].ctm) as Rect;
    const found = await readRegionLabels(tab(), region, [0, 1, 2]);
    expect(found).toEqual(["M-001", "M-002", "M-003"]);
    applyPageLabels(key, new Map(found.map((l, i) => [tab().state.pages[i].id, l])), true);
    expect(tab().state.pages.slice(0, 4).map((p) => p.label)).toEqual(["M-001", "M-002", "M-003", "M-4"]);
    expect(tab().state.outline?.[3]).toMatchObject({ title: "M-4", page: 3 });
    const plan = buildPlan(tab());
    expect(plan.pageLabels?.slice(0, 4)).toEqual(["M-001", "M-002", "M-003", "M-4"]);
    expect(plan.outline).toHaveLength(200);

    movePages(key, [tab().state.pages[0].id], 3);
    const moved = buildPlan(tab());
    expect(moved.pageLabels?.slice(0, 4)).toEqual(["M-002", "M-003", "M-001", "M-4"]);
    undo(key);
    undo(key);
    expect(tab().state.pages[0].label).toBe("M-1");
    expect(tab().state.outline).toBeUndefined();
    expect(buildPlan(tab()).pageLabels).toBeUndefined();
  });
});
