import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { EngineCore } from "../../src/engine/core/engineCore";
import { boundsOf, centredOn, keptWithin } from "../../src/markup/arrange";
import { eraseStrokes, simplifyStroke, smoothCurve } from "../../src/markup/ink";
import { buildAppearance, signatureFrameHeight } from "../../src/markup/appearance";
import { distToSegment, type Pt } from "../../src/markup/geometry";
import { hoverText } from "../../src/features/viewer/controller";
import { signatureCaption } from "../../src/features/signature/signatures";
import { mk, plan } from "./helpers/markups";

const centre = (r: number[]): Pt => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

describe("pasting where the pointer is", () => {
  it("moves markups as one so the middle of what they cover lands on the point", () => {
    const a = mk("rectangle", { rect: [100, 100, 200, 150] });
    const b = mk("line", { points: [[300, 120], [340, 180]], rect: [300, 120, 340, 180] });
    const moved = centredOn([a, b], [500, 500]);
    const c = centre(boundsOf(moved));
    expect(c[0]).toBeCloseTo(500, 6);
    expect(c[1]).toBeCloseTo(500, 6);
    // the two keep their places relative to each other
    expect(moved[1].points[0][0] - moved[0].rect[0]).toBeCloseTo(200, 6);
  });

  it("keeps a paste near the edge on the page, and leaves one already inside alone", () => {
    const page: [number, number, number, number] = [0, 0, 595, 842];
    const r = mk("rectangle", { rect: [560, 820, 660, 870] });
    const [k] = keptWithin(page, [r]);
    const b = boundsOf([k]);
    expect(b[2]).toBeLessThanOrEqual(595 + 1e-9);
    expect(b[3]).toBeLessThanOrEqual(842 + 1e-9);
    const inside = mk("rectangle", { rect: [100, 100, 200, 150] });
    expect(keptWithin(page, [inside])[0]).toBe(inside);
  });
});

describe("freehand strokes", () => {
  it("thins out points on straight runs but keeps the corners", () => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 50; i++) pts.push([i, 0]);
    for (let i = 1; i <= 50; i++) pts.push([50, i]);
    const s = simplifyStroke(pts, 0.3);
    expect(s).toEqual([[0, 0], [50, 0], [50, 50]]);
  });

  it("draws a smooth curve through every point", () => {
    const pts: Pt[] = [[0, 0], [10, 10], [20, 0], [30, 10]];
    const c = smoothCurve(pts)!;
    expect(c.start).toEqual([0, 0]);
    expect(c.curves.map((x) => x[2])).toEqual(pts.slice(1));
    expect(smoothCurve([[0, 0], [1, 1]])).toBeNull();
    // the pen's appearance is made of curves
    const ap = buildAppearance(mk("pen", { inks: [pts] }));
    expect(ap.ops[0].t === "path" && ap.ops[0].segs.some((s) => s[0] === "C")).toBe(true);
  });

  it("the eraser cuts a stroke in two, removes one it covers, and leaves locked ones alone", () => {
    const line: Pt[] = [[0, 100], [200, 100]];
    const pen = mk("pen", { inks: [line], rect: [0, 100, 200, 100], style: { ...mk("pen").style, width: 2 } });
    const { changed, removed } = eraseStrokes([pen], [100, 90], [100, 110], 5);
    expect(removed).toEqual([]);
    expect(changed[0].inks).toHaveLength(2);
    // nothing of what is left is within reach of the eraser
    for (const s of changed[0].inks) for (const p of s) expect(distToSegment(p, [100, 90], [100, 110])).toBeGreaterThan(5);
    const all = eraseStrokes([pen], [-10, 100], [210, 100], 5);
    expect(all.removed).toEqual([pen.id]);
    expect(eraseStrokes([{ ...pen, locked: true }], [100, 90], [100, 110], 5).changed).toEqual([]);
    // away from the stroke nothing changes
    expect(eraseStrokes([pen], [100, 300], [120, 300], 5)).toEqual({ changed: [], removed: [] });
  });
});

describe("hover details and signatures", () => {
  it("the tooltip names the markup, who made it and its comment", () => {
    const t = hoverText(mk("rectangle", { subject: "Clash", author: "W. McKenzie", contents: "Duct hits beam", replies: [] }));
    expect(t).toMatch(/^Clash · W\. McKenzie · \d\d\/\d\d\/\d{4}/);
    expect(t).toContain("Duct hits beam");
  });

  it("the caption is the name and the date; the frame leaves room for it", () => {
    expect(signatureCaption("William McKenzie", new Date(2026, 9, 18))).toBe("William McKenzie  18/10/2026");
    expect(signatureFrameHeight(40, false)).toBe(40);
    expect(signatureFrameHeight(40, true)).toBeGreaterThan(44);
  });
});

function pdfWithPage(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

async function pixel(png: Uint8Array, x: number, y: number) {
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return Array.from(c.getContext("2d").getImageData(x, y, 1, 1).data);
}

describe("pictures and signatures in the file", () => {
  it("a picture comes back out of the file with its transparency, so it can still be moved and copied", async () => {
    const c = createCanvas(20, 10);
    const g = c.getContext("2d");
    g.fillStyle = "rgba(200,100,50,0.5)";
    g.fillRect(0, 0, 10, 10);
    g.fillStyle = "#0000ff";
    g.fillRect(10, 0, 10, 10);
    const png = new Uint8Array(c.toBuffer("image/png"));
    const e = new EngineCore();
    const info = e.open(pdfWithPage(), "p.pdf");
    const m = mk("image", { rect: [100, 100, 200, 150], image: { data: png, mime: "image/png", width: 20, height: 10 } });
    const res = e.save(info.docId, plan(info, [m]), "full");
    const back = e.readMarkups(res.info.docId)[0];
    expect(back.kind).toBe("image");
    expect(back.keepAppearance).toBeFalsy();
    expect(back.image).toMatchObject({ mime: "image/png", width: 20, height: 10 });
    const px = await pixel(back.image!.data, 2, 2);
    expect(px[3]).toBeGreaterThan(120);
    expect(px[3]).toBeLessThan(135);
    expect(Math.abs(px[0] - 200)).toBeLessThan(4);
    expect(Math.abs(px[1] - 100)).toBeLessThan(4);
    expect(await pixel(back.image!.data, 15, 5)).toEqual([0, 0, 255, 255]);
  });

  it("a signature is a picture stamp with its caption, and reads back as a signature", () => {
    const c = createCanvas(300, 100);
    const g = c.getContext("2d");
    g.strokeStyle = "#111";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(10, 60);
    g.bezierCurveTo(80, 0, 150, 120, 290, 40);
    g.stroke();
    const png = new Uint8Array(c.toBuffer("image/png"));
    const e = new EngineCore();
    const info = e.open(pdfWithPage(), "p.pdf");
    const m = mk("signature", { rect: [300, 600, 441.7, 660], image: { data: png, mime: "image/png", width: 300, height: 100 }, caption: "William McKenzie  18/10/2026", subject: "Signature" });
    const res = e.save(info.docId, plan(info, [m]), "full");
    const doc = mupdf.Document.openDocument(res.bytes, "application/pdf").asPDF()!;
    const annot = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations()[0];
    expect(annot.getType()).toBe("Stamp");
    expect(annot.getObject().get("IT").asName()).toBe("StampImage");
    const back = res.markups.find((x) => x.id === m.id)!;
    expect(back.kind).toBe("signature");
    expect(back.caption).toBe("William McKenzie  18/10/2026");
    expect(back.image?.width).toBe(300);
    for (let i = 0; i < 4; i++) expect(back.rect[i]).toBeCloseTo(m.rect[i], 2);
  });
});
