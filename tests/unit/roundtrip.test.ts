import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { createCanvas } from "@napi-rs/canvas";
import { EngineCore } from "../../src/engine/core/engineCore";
import { DEFAULT_STYLE, type Markup, type MarkupKind } from "../../src/markup/model";
import { openMupdf, renderMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, diffFraction, renderPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

/** A blank A4 page, so render comparisons only see the markup. */
function blankPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

function png(w: number, h: number): Uint8Array {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2060c0";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffcc00";
  ctx.fillRect(w / 4, h / 4, w / 2, h / 2);
  return new Uint8Array(c.toBuffer("image/png"));
}

const style = (over: Partial<Markup["style"]> = {}) => ({ ...DEFAULT_STYLE, ...over });

interface Case {
  kind: MarkupKind;
  m: Partial<Markup>;
  subtype: string;
  check: (o: mupdf.PDFObject) => void;
}

const name = (o: mupdf.PDFObject, k: string) => (o.get(k).isName() ? o.get(k).asName() : null);
const arr = (o: mupdf.PDFObject, k: string) => {
  const a = o.get(k);
  return a.isArray() ? Array.from({ length: a.length }, (_, i) => a.get(i)) : [];
};

const CASES: Case[] = [
  { kind: "rectangle", m: { style: style({ fill: [0, 0.5, 1], dash: [6, 3] }) }, subtype: "Square", check: (o) => expect(name(o.get("BS"), "S")).toBe("D") },
  { kind: "ellipse", m: { style: style({ fill: [1, 1, 0] }) }, subtype: "Circle", check: (o) => expect(arr(o, "IC").length).toBe(3) },
  {
    kind: "line",
    m: { points: [[100, 300], [400, 300]], rect: [100, 300, 400, 300] },
    subtype: "Line",
    check: (o) => {
      expect(arr(o, "L").length).toBe(4);
      expect(name(o, "IT")).toBeNull();
    },
  },
  {
    kind: "arrow",
    m: { points: [[100, 350], [400, 450]], style: style({ lineEnd: "ClosedArrow", width: 2 }) },
    subtype: "Line",
    check: (o) => {
      expect(arr(o, "LE").map((x) => x.asName())).toEqual(["None", "ClosedArrow"]);
      expect(name(o, "IT")).toBe("LineArrow");
    },
  },
  {
    kind: "polyline",
    m: { points: [[100, 500], [200, 560], [300, 500], [400, 560]] },
    subtype: "PolyLine",
    check: (o) => expect(arr(o, "Vertices").length).toBe(8),
  },
  {
    kind: "polygon",
    m: { points: [[100, 600], [300, 600], [250, 700]], style: style({ fill: [0.8, 0.9, 1] }) },
    subtype: "Polygon",
    check: (o) => {
      expect(arr(o, "Vertices").length).toBe(6);
      expect(o.get("BE").isNull()).toBe(true);
    },
  },
  {
    kind: "cloud",
    m: { points: [[320, 600], [520, 600], [520, 760], [320, 760]], style: style({ cloudIntensity: 1 }) },
    subtype: "Polygon",
    check: (o) => {
      expect(name(o.get("BE"), "S")).toBe("C");
      expect(o.get("BE").get("I").asNumber()).toBe(1);
      expect(name(o, "IT")).toBe("PolygonCloud");
    },
  },
  {
    kind: "pen",
    m: { inks: [[[100, 100], [150, 140], [200, 110], [260, 160]], [[110, 180], [250, 190]]], style: style({ width: 2 }) },
    subtype: "Ink",
    check: (o) => {
      expect(arr(o, "InkList").length).toBe(2);
      expect(o.get("BM").isNull()).toBe(true);
    },
  },
  {
    kind: "highlighter",
    m: { inks: [[[300, 120], [500, 120]]], style: style({ color: [1, 0.9, 0], width: 14, opacity: 0.6 }) },
    subtype: "Ink",
    check: (o) => {
      expect(name(o, "BM")).toBe("Multiply");
      expect(o.get("CA").asNumber()).toBeCloseTo(0.6, 3);
    },
  },
  {
    kind: "textbox",
    m: { rect: [100, 220, 300, 280], contents: "Check level\nRL 12.450", style: style({ fill: [1, 1, 0.85], fontSize: 11 }) },
    subtype: "FreeText",
    check: (o) => {
      expect(o.get("DA").asString()).toMatch(/^\/Helv 11 Tf/);
      expect(o.get("RC").asString()).toContain("Check level");
      expect(o.get("DS").isString()).toBe(true);
      expect(o.get("CL").isNull()).toBe(true);
    },
  },
  {
    kind: "callout",
    m: { rect: [330, 220, 520, 270], points: [[300, 330], [330, 245]], contents: "Confirm size", style: style({ lineStart: "OpenArrow" }) },
    subtype: "FreeText",
    check: (o) => {
      expect(name(o, "IT")).toBe("FreeTextCallout");
      expect([4, 6]).toContain(arr(o, "CL").length);
      expect(o.get("RD").isArray()).toBe(true);
    },
  },
  { kind: "note", m: { rect: [540, 40, 560, 60], contents: "See detail 4" }, subtype: "Text", check: (o) => expect(o.get("Popup").isDictionary()).toBe(true) },
  {
    kind: "highlight",
    m: { quads: [[100, 400, 260, 400, 100, 414, 260, 414]], style: style({ color: [1, 0.85, 0] }) },
    subtype: "Highlight",
    check: (o) => expect(arr(o, "QuadPoints").length).toBe(8),
  },
  { kind: "underline", m: { quads: [[100, 420, 260, 420, 100, 434, 260, 434]] }, subtype: "Underline", check: (o) => expect(arr(o, "QuadPoints").length).toBe(8) },
  { kind: "strikeout", m: { quads: [[100, 440, 260, 440, 100, 454, 260, 454]] }, subtype: "StrikeOut", check: (o) => expect(arr(o, "QuadPoints").length).toBe(8) },
  {
    kind: "stamp",
    m: { rect: [300, 40, 480, 90], stampId: "approved", stampText: ["APPROVED", "Test Author 16/10/2026"] },
    subtype: "Stamp",
    check: (o) => {
      expect(o.get("AP").get("N").readStream().asString()).toContain("Tj");
      expect(o.get("DrawsetData").asString()).toContain('"stampId":"approved"');
    },
  },
  {
    kind: "image",
    m: { rect: [100, 600, 220, 690], image: { data: png(60, 45), mime: "image/png", width: 60, height: 45 } },
    subtype: "Stamp",
    check: (o) => {
      expect(name(o, "IT")).toBe("StampImage");
      expect(o.get("AP").get("N").get("Resources").get("XObject").get("Im0").get("Subtype").asName()).toBe("Image");
    },
  },
];

describe("markup round trips", () => {
  for (const c of CASES) {
    it(`${c.kind} writes ${c.subtype} with standard keys, reads back, and renders the same in pdf.js`, async () => {
      const e = new EngineCore();
      const src = blankPdf();
      const info = e.open(src, "blank.pdf");
      const m = mk(c.kind, { contents: "", ...c.m });
      const res = e.save(info.docId, plan(info, [m]), "incremental");

      // dictionary keys
      const doc = openMupdf(res.bytes);
      const annots = doc.loadPage(0).getAnnotations();
      const a = annots.find((x) => x.getObject().get("NM").isString() && x.getObject().get("NM").asString() === m.id);
      expect(a, "annotation with our /NM").toBeDefined();
      const o = a!.getObject();
      expect(a!.getType()).toBe(c.subtype);
      for (const k of ["T", "Subj", "Contents", "CreationDate", "M", "NM"]) expect(o.get(k).isString(), k).toBe(true);
      expect(o.get("AP").get("N").isStream()).toBe(true);
      expect(JSON.parse(o.get("DrawsetData").asString()).kind).toBe(c.kind);
      c.check(o);

      // reads back as the same kind and place
      const back = res.markups.find((x) => x.id === m.id)!;
      expect(back.kind).toBe(c.kind);
      if (["rectangle", "ellipse", "textbox", "callout", "stamp", "image"].includes(c.kind)) for (let i = 0; i < 4; i++) expect(back.rect[i]).toBeCloseTo(m.rect[i], 2);
      for (let i = 0; i < m.points.length; i++) {
        expect(back.points[i][0]).toBeCloseTo(m.points[i][0], 2);
        expect(back.points[i][1]).toBeCloseTo(m.points[i][1], 2);
      }
      expect(back.quads.length, "quads").toBe(m.quads.length);
      for (let i = 0; i < m.quads.length; i++) for (let k = 0; k < 8; k++) expect(back.quads[i][k]).toBeCloseTo(m.quads[i][k], 2);
      expect(back.link, "only links have a target").toBeUndefined();
      if (m.contents) expect(back.contents).toBe(m.contents);

      // pdf.js sees the annotation and draws it like MuPDF does
      const pj = await annotationsPdfjs(res.bytes, 0);
      expect(pj.some((x) => x.subtype === c.subtype)).toBe(true);
      const scale = 1;
      const [ra, rb] = [renderMupdf(res.bytes, 0, scale), await renderPdfjs(res.bytes, 0, scale)];
      const inked = (r: typeof ra) => {
        let n = 0;
        for (let i = 0; i < r.data.length; i += 4) if (r.data[i] < 240 || r.data[i + 1] < 240 || r.data[i + 2] < 240) n++;
        return n;
      };
      const ink = inked(ra);
      expect(ink, "MuPDF draws something").toBeGreaterThan(20);
      // notes are drawn by each viewer's own icon; compare amount of ink only loosely
      if (c.kind === "note") return;
      const diff = diffFraction(ra, rb) * ra.width * ra.height;
      expect(diff / ink).toBeLessThan(0.12);
    });
  }

  it("saving then reopening changes nothing further when nothing was edited", () => {
    const e = new EngineCore();
    const info = e.open(blankPdf(), "blank.pdf");
    const ms = CASES.map((c) => mk(c.kind, { ...c.m }));
    const first = e.save(info.docId, plan(info, ms), "full");
    const again = e.readMarkups(first.info.docId);
    expect(again.length).toBe(ms.length);
    expect(new Set(again.map((x) => x.id))).toEqual(new Set(ms.map((x) => x.id)));
  });
});
