import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { resolveLinkedPath } from "../../src/features/links/navigate";
import type { LinkTarget } from "../../src/markup/model";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { diffFraction, openPdfjs } from "./helpers/pdfjs";
import { identityPages, mk } from "./helpers/markups";

const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));

const TARGETS: { rect: [number, number, number, number]; link: LinkTarget; contents: string }[] = [
  { rect: [100, 100, 220, 140], link: { type: "page", page: 41 }, contents: "Go to M-42" },
  { rect: [100, 200, 220, 240], link: { type: "url", url: "https://example.com/specs?id=7" }, contents: "Specification" },
  { rect: [100, 300, 220, 340], link: { type: "file", path: "../Structural/S-101.pdf", page: 2 }, contents: "Structural" },
  { rect: [100, 400, 220, 440], link: { type: "file", path: "schedule.xlsx" }, contents: "Schedule" },
];

describe("hyperlinks", () => {
  it("writes page, web and file links as standard /Link annotations that MuPDF and pdf.js follow, and reads them back", async () => {
    const e = new EngineCore();
    const src = read("set-200.pdf");
    const info = e.open(src, "set-200.pdf");
    const before = renderMupdf(src, 0, 0.25);
    const ms = TARGETS.map((t) => mk("link", { ...t, subject: "Hyperlink", style: { ...mk("link").style, color: null, width: 1 } }));
    const res = e.save(info.docId, { pages: identityPages(info), upserts: ms.map((m) => ({ markup: m, page: 0 })), deletes: [], defaultAuthor: "T" }, "incremental");
    expect(Buffer.from(res.bytes.subarray(0, src.length)).equals(Buffer.from(src))).toBe(true);

    // read back exactly
    const back = res.markups.filter((m) => m.kind === "link").sort((a, b) => a.rect[1] - b.rect[1]);
    expect(back.map((m) => m.link)).toEqual(TARGETS.map((t) => t.link));
    expect(back.map((m) => m.contents)).toEqual(TARGETS.map((t) => t.contents));
    expect(back.every((m) => m.style.color === null && m.subtype === "Link")).toBe(true);
    for (const [i, m] of back.entries()) for (let k = 0; k < 4; k++) expect(m.rect[k]).toBeCloseTo(TARGETS[i].rect[k], 3);

    // MuPDF resolves the internal link; the standard keys are there
    const doc = openMupdf(res.bytes);
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const links = page.getLinks();
    const internal = links.find((l) => !l.isExternal())!;
    expect(doc.resolveLink(internal)).toBe(41);
    expect(links.some((l) => l.getURI() === "https://example.com/specs?id=7")).toBe(true);
    const arr = page.getObject().get("Annots");
    const objs = [...Array(arr.length).keys()].map((i) => arr.get(i).resolve()).filter((o) => o.get("Subtype").asName() === "Link");
    for (const o of objs) {
      for (const k of ["NM", "T", "Subj", "Contents", "M", "CreationDate"]) expect(o.get(k).isNull()).toBe(false);
      expect(o.get("Border").toString()).toBe("[0 0 0]");
    }
    const remote = objs.find((o) => o.get("A").get("S").asName() === "GoToR")!;
    expect(remote.get("A").get("F").get("F").asString()).toBe("../Structural/S-101.pdf");
    expect(remote.get("A").get("D").get(0).asNumber()).toBe(2);
    expect(objs.find((o) => o.get("A").get("S").asName() === "Launch")).toBeTruthy();

    // pdf.js sees the same targets
    const pj = await openPdfjs(res.bytes);
    const annots = (await (await pj.getPage(1)).getAnnotations()).filter((a) => a.subtype === "Link");
    expect(annots).toHaveLength(4);
    const dest = annots.find((a) => a.dest)!.dest;
    expect(await pj.getPageIndex(dest[0])).toBe(41);
    expect(annots.some((a) => a.url === "https://example.com/specs?id=7")).toBe(true);
    expect(annots.some((a) => a.newWindow && a.unsafeUrl?.includes("S-101.pdf"))).toBe(true);
    await pj.destroy();

    // invisible: the page looks the same
    expect(diffFraction(before, renderMupdf(res.bytes, 0, 0.25))).toBeLessThan(0.0005);
  });

  it("internal links follow their page when pages are reordered, and a border is drawn when asked for", () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const m = mk("link", { link: { type: "page", page: 9 }, style: { ...mk("link").style, color: [0, 0, 1], width: 2 } });
    const order = [9, 0, 1, 2];
    const res = e.save(info.docId, { pages: order.map((i) => ({ index: i, rotate: 0 })), upserts: [{ markup: m, page: 0 }], deletes: [], defaultAuthor: "T" }, "full");
    const link = res.markups.find((x) => x.kind === "link")!;
    // the link was on old page 0 (now 1) and points at old page 9 (now 0)
    expect(link.pageIndex).toBe(1);
    expect(link.link).toEqual({ type: "page", page: 0 });
    expect(link.style.color).toEqual([0, 0, 1]);
    const annots = openMupdf(res.bytes).loadPage(1).getObject().get("Annots");
    const linkObj = [...Array(annots.length).keys()].map((i) => annots.get(i).resolve()).find((o) => o.get("Subtype").asName() === "Link")!;
    const ap = linkObj.get("AP").get("N").readStream().asString();
    expect(ap).toMatch(/ re\b|\bl\b/);
  });

  it("links from other editors are read, and ones Drawset cannot edit are left alone", () => {
    const doc = new mupdf.PDFDocument();
    for (let i = 0; i < 3; i++) doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
    const page = doc.loadPage(0) as mupdf.PDFPage;
    page.createLink([10, 10, 100, 40], "#page=3");
    page.createLink([10, 50, 100, 80], "https://example.org");
    const js = doc.addObject({ Type: doc.newName("Annot"), Subtype: doc.newName("Link"), Rect: [10, 90, 100, 120], A: { S: doc.newName("JavaScript"), JS: doc.newString("app.alert(1)") } });
    page.getObject().get("Annots").push(js);
    // a named destination
    const names = doc.addObject({ Names: [doc.newString("sheet2"), [doc.findPage(1), doc.newName("Fit")]] });
    doc.getTrailer().get("Root").put("Names", { Dests: names });
    const named = doc.addObject({ Type: doc.newName("Annot"), Subtype: doc.newName("Link"), Rect: [10, 130, 100, 160], Dest: doc.newString("sheet2") });
    page.getObject().get("Annots").push(named);
    const bytes = doc.saveToBuffer("").asUint8Array().slice();
    const e = new EngineCore();
    const info = e.open(bytes, "x.pdf");
    const links = e.readMarkups(info.docId).filter((m) => m.kind === "link");
    expect(links.map((l) => l.link)).toEqual([{ type: "page", page: 2 }, { type: "url", url: "https://example.org" }, { type: "page", page: 1 }]);
    // saving with an edit elsewhere keeps the script link byte for byte
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [{ markup: mk("rectangle"), page: 0 }], deletes: [], defaultAuthor: "T" }, "incremental");
    const after = openMupdf(res.bytes).loadPage(0).getObject().get("Annots");
    let kept = false;
    for (let i = 0; i < after.length; i++) {
      const a = after.get(i).resolve().get("A");
      if (a.isDictionary() && a.get("S").toString() === "/JavaScript") kept = true;
    }
    expect(kept).toBe(true);
  });

  it("editing a link updates it in place and keeps other editors' keys", () => {
    const doc = new mupdf.PDFDocument();
    for (let i = 0; i < 2; i++) doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
    const page = doc.loadPage(0) as mupdf.PDFPage;
    page.createLink([10, 10, 100, 40], "https://example.org");
    page.getObject().get("Annots").get(0).put("XYZ_Vendor", doc.newString("keep me"));
    const e = new EngineCore();
    const info = e.open(doc.saveToBuffer("").asUint8Array().slice(), "x.pdf");
    const rec = e.readMarkups(info.docId).find((m) => m.kind === "link")!;
    const { pageIndex, ...m } = rec;
    const res = e.save(info.docId, { pages: identityPages(info), upserts: [{ markup: { ...m, pageId: "p0", link: { type: "page", page: 1 }, contents: "Sheet 2" }, page: pageIndex }], deletes: [], defaultAuthor: "T" }, "incremental");
    const annots = openMupdf(res.bytes).loadPage(0).getObject().get("Annots");
    expect(annots.length).toBe(1);
    expect(annots.get(0).get("XYZ_Vendor").asString()).toBe("keep me");
    expect(res.markups.find((x) => x.kind === "link")).toMatchObject({ link: { type: "page", page: 1 }, contents: "Sheet 2", objNum: rec.objNum });
    // deleting removes it
    const del = e.save(res.info.docId, { pages: identityPages(res.info), upserts: [], deletes: [rec.objNum!], defaultAuthor: "T" }, "incremental");
    expect(del.markups.filter((x) => x.kind === "link")).toHaveLength(0);
  });

  it("flattening markups keeps links working", () => {
    const e = new EngineCore();
    const info = e.open(read("set-200.pdf"), "set-200.pdf");
    const ms = [mk("rectangle"), mk("link", { rect: [300, 300, 400, 340], link: { type: "page", page: 5 } })];
    const res = e.save(info.docId, { pages: identityPages(info), upserts: ms.map((m) => ({ markup: m, page: 0 })), deletes: [], defaultAuthor: "T", flatten: true }, "full");
    expect(res.markups.map((m) => m.kind)).toEqual(["link"]);
    expect(res.markups[0].link).toEqual({ type: "page", page: 5 });
  });

  it("resolves linked file paths next to the open file", () => {
    expect(resolveLinkedPath("C:\\Jobs\\Hospital\\Arch\\A-101.pdf", "../Structural/S-101.pdf")).toBe("C:\\Jobs\\Hospital\\Structural\\S-101.pdf");
    expect(resolveLinkedPath("C:\\Jobs\\A-101.pdf", "/D/Other/X.pdf")).toBe("D:\\Other\\X.pdf");
    expect(resolveLinkedPath("C:\\Jobs\\A-101.pdf", "file:///C:/Specs/s.pdf")).toBe("C:\\Specs\\s.pdf");
    expect(resolveLinkedPath("/home/w/jobs/a.pdf", "b/c.pdf")).toBe("/home/w/jobs/b/c.pdf");
    expect(resolveLinkedPath(null, "b.pdf")).toBeNull();
  });
});

describe("following links in the app", () => {
  it("a page link jumps there and Back and Forward return", async () => {
    const { useNodeEngine } = await import("./helpers/nodeEngine");
    const { addTab, useApp } = await import("../../src/state/store");
    const { followLink, goBack, goForward, jumpTo } = await import("../../src/features/links/navigate");
    const core = useNodeEngine();
    const info = core.open(read("set-200.pdf"), "set-200.pdf");
    const key = addTab(info, "set-200.pdf", null);
    const tab = () => useApp.getState().tabs.find((t) => t.key === key)!;
    await followLink(tab(), { type: "page", page: 41 });
    expect(tab().currentPage).toBe(41);
    jumpTo(key, 99);
    expect(tab().currentPage).toBe(99);
    goBack(key);
    expect(tab().currentPage).toBe(41);
    goBack(key);
    expect(tab().currentPage).toBe(0);
    expect(tab().nav.back).toEqual([]);
    goForward(key);
    goForward(key);
    expect(tab().currentPage).toBe(99);
  });
});
