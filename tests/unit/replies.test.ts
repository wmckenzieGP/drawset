import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import type { Reply } from "../../src/markup/model";
import { threadOrder, withDescendants } from "../../src/features/replies/thread";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, diffFraction, renderPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

function blankPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

const reply = (id: string, contents: string, created: string, inReplyTo?: string): Reply => ({ id, author: id === "r2" ? "Engineer" : "Architect", contents, created, modified: created, ...(inReplyTo ? { inReplyTo } : {}) });

function annotsByNm(bytes: Uint8Array) {
  const page = openMupdf(bytes).loadPage(0) as mupdf.PDFPage;
  const annots = page.getObject().get("Annots");
  const out = new Map<string, mupdf.PDFObject>();
  for (let i = 0; i < annots.length; i++) {
    const a = annots.get(i);
    if (a.get("NM").isString()) out.set(a.get("NM").asString(), a);
  }
  return out;
}

describe("replies", () => {
  it("a thread is written with /IRT and /RT /R, read back with its shape, and draws nothing", async () => {
    const e = new EngineCore();
    const info = e.open(blankPdf(), "blank.pdf");
    const bare = mk("rectangle", { id: "box", status: "Accepted" });
    const before = e.save(info.docId, plan(info, [bare]), "incremental");
    const m = { ...before.markups[0], pageId: "p0", replies: [reply("r1", "Is this the 90 mm stud?", "2026-10-16T01:00:00.000Z"), reply("r2", "Yes, 90 mm at 450 centres.", "2026-10-16T02:00:00.000Z", "r1"), reply("r3", "Fire rating to follow.", "2026-10-16T03:00:00.000Z")] };
    const res = e.save(before.info.docId, plan(before.info, [m]), "incremental");

    const byNm = annotsByNm(res.bytes);
    const parent = byNm.get("box")!;
    for (const id of ["r1", "r2", "r3"]) {
      const a = byNm.get(id)!;
      expect(a.get("Subtype").asName()).toBe("Text");
      expect(a.get("RT").asName()).toBe("R");
      expect(a.get("T").isString() && a.get("Contents").isString() && a.get("CreationDate").isString() && a.get("M").isString()).toBe(true);
      expect(a.get("AP").get("N").isStream()).toBe(true);
      expect(a.get("StateModel").isNull()).toBe(true);
    }
    expect(byNm.get("r1")!.get("IRT").asIndirect()).toBe(parent.asIndirect());
    expect(byNm.get("r2")!.get("IRT").asIndirect()).toBe(byNm.get("r1")!.asIndirect());
    expect(byNm.get("r3")!.get("IRT").asIndirect()).toBe(parent.asIndirect());

    // read back: one markup, three replies, the status still a status
    expect(res.markups).toHaveLength(1);
    const back = res.markups[0];
    expect(back.status).toBe("Accepted");
    expect(back.replies.map((r) => [r.id, r.author, r.contents, r.inReplyTo ?? null, r.created])).toEqual(m.replies.map((r) => [r.id, r.author, r.contents, r.inReplyTo ?? null, r.created]));

    // pdf.js sees the same thread
    const pj = await annotationsPdfjs(res.bytes, 0);
    const pjBy = new Map(pj.map((a) => [a.id, a]));
    const r2 = pj.find((a) => a.contentsObj?.str === "Yes, 90 mm at 450 centres.")!;
    expect(r2.replyType).toBe("R");
    expect(pjBy.get(r2.inReplyTo)?.contentsObj?.str).toBe("Is this the 90 mm stud?");

    // replies add nothing to the page image
    expect(diffFraction(renderMupdf(before.bytes, 0, 1), renderMupdf(res.bytes, 0, 1), 8)).toBe(0);
    expect(diffFraction(await renderPdfjs(before.bytes, 0, 1), await renderPdfjs(res.bytes, 0, 1), 8)).toBe(0);
  });

  it("editing and deleting replies updates the file in place and keeps the rest of the thread", () => {
    const e = new EngineCore();
    const info = e.open(blankPdf(), "blank.pdf");
    const m0 = mk("note", { id: "n", rect: [100, 100, 120, 120], replies: [reply("r1", "First", "2026-10-16T01:00:00.000Z"), reply("r2", "Answer", "2026-10-16T02:00:00.000Z", "r1"), reply("r3", "Other", "2026-10-16T03:00:00.000Z")] });
    const a = e.save(info.docId, plan(info, [m0]), "incremental");
    const m1 = a.markups[0];
    const r2num = m1.replies.find((r) => r.id === "r2")!.objNum;
    const edited = { ...m1, pageId: "p0", replies: m1.replies.filter((r) => r.id !== "r3").map((r) => (r.id === "r1" ? { ...r, contents: "First, revised", modified: "2026-10-16T04:00:00.000Z" } : r)) };
    const b = e.save(a.info.docId, plan(a.info, [edited]), "incremental");
    // incremental: the earlier file is a prefix
    expect(Buffer.from(b.bytes.subarray(0, a.bytes.length)).equals(Buffer.from(a.bytes))).toBe(true);
    const back = b.markups[0].replies;
    expect(back.map((r) => [r.id, r.contents, r.inReplyTo ?? null])).toEqual([
      ["r1", "First, revised", null],
      ["r2", "Answer", "r1"],
    ]);
    expect(back.find((r) => r.id === "r2")!.objNum).toBe(r2num);
    expect(annotsByNm(b.bytes).has("r3")).toBe(false);
  });

  it("replies from other editors without /NM, nested two deep, attach to the first markup; /RT /Group is not a reply", () => {
    const doc = new mupdf.PDFDocument();
    const pageObj = doc.addPage([0, 0, 595, 842], 0, {}, "");
    doc.insertPage(-1, pageObj);
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const sq = page.createAnnotation("Square");
    sq.setRect([100, 100, 200, 200]);
    sq.setContents("parent");
    const parent = sq.getObject();
    const mkText = (irt: mupdf.PDFObject, contents: string, rt: string) => {
      const o = doc.addObject({ Type: doc.newName("Annot"), Subtype: doc.newName("Text"), Rect: [0, 0, 20, 20], IRT: irt, RT: doc.newName(rt), Contents: doc.newString(contents), T: doc.newString("Other app"), M: doc.newString("D:20261016010000Z") });
      page.getObject().get("Annots").push(o);
      return o;
    };
    const a = mkText(parent, "level one", "R");
    mkText(a, "level two", "R");
    mkText(parent, "grouped note", "Group");
    const bytes = doc.saveToBuffer("").asUint8Array().slice();
    const e = new EngineCore();
    const info = e.open(bytes, "other.pdf");
    const ms = e.readMarkups(info.docId);
    const sqm = ms.find((m) => m.contents === "parent")!;
    expect(sqm.replies.map((r) => r.contents)).toEqual(["level one", "level two"]);
    expect(sqm.replies[1].inReplyTo).toBe(sqm.replies[0].id);
    expect(ms.some((m) => m.contents === "grouped note")).toBe(true);
  });

  it("thread order puts answers under what they answer; deleting a reply takes its answers with it", () => {
    const rs = [reply("c", "c", "3", "a"), reply("a", "a", "1"), reply("b", "b", "2"), reply("d", "d", "4", "c")];
    expect(threadOrder(rs).map((x) => [x.reply.id, x.depth])).toEqual([
      ["a", 0],
      ["c", 1],
      ["d", 2],
      ["b", 0],
    ]);
    expect([...withDescendants(rs, "a")].sort()).toEqual(["a", "c", "d"]);
  });
});
