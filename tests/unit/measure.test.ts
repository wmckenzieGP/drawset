import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { EngineCore } from "../../src/engine/core/engineCore";
import { apply, type Matrix, type Pt } from "../../src/markup/geometry";
import { DEFAULT_STYLE, type Markup } from "../../src/markup/model";
import { METRIC_PRESETS, IMPERIAL_PRESETS, measureValue, netArea, parseRatio, scaleFromMeasure, scaleFromPoints, scaleLabel, unitsPerPoint, type PageScale } from "../../src/markup/measure";
import { openMupdf } from "./helpers/mupdf";
import { annotationsPdfjs, openPdfjs } from "./helpers/pdfjs";
import { mk, plan } from "./helpers/markups";

const known = JSON.parse(readFileSync("fixtures/calibration.json", "utf8"));
const read = (n: string) => new Uint8Array(readFileSync(`fixtures/${n}`));
const S100: PageScale = { ...METRIC_PRESETS.find((p) => p.label === "1:100")!.scale, displayUnit: "m", precision: 2 };
const within = (v: number, want: number) => expect(Math.abs(v - want) / want).toBeLessThan(0.001);

function m(kind: Markup["kind"], points: Pt[], over: Partial<Markup> = {}) {
  return mk(kind, { points, style: { ...DEFAULT_STYLE, fontSize: 10 }, measure: { scale: S100, cutouts: [] }, ...over });
}

describe("scales", () => {
  it("presets and labels", () => {
    expect(scaleLabel(S100)).toBe("1:100");
    expect(scaleLabel({ ...IMPERIAL_PRESETS[4].scale, displayUnit: "ft", precision: 2 })).toBe('1/4" = 1\'-0"');
    // 1:100 in metres: one point is 0.3528 mm on paper, 35.28 mm real
    expect(unitsPerPoint(S100)).toBeCloseTo(0.0352777778, 9);
    expect(parseRatio("1 mm = 100 mm")).toEqual({ paper: 1, paperUnit: "mm", real: 100, realUnit: "mm" });
    expect(parseRatio('1/4 in = 1 ft')).toBeNull();
    expect(parseRatio("0.25 in = 1 ft")).toEqual({ paper: 0.25, paperUnit: "in", real: 1, realUnit: "ft" });
  });

  it("reads scales other editors write, trusting the conversion factor", () => {
    const s = scaleFromMeasure("1 in = 10 ft", "ft", 10 / 72, 100)!;
    expect(s.displayUnit).toBe("ft");
    expect(s.precision).toBe(2);
    expect(unitsPerPoint(s)).toBeCloseTo(10 / 72, 9);
    const odd = scaleFromMeasure("1:100 custom", "m", 0.0352777778, 1000)!;
    expect(unitsPerPoint(odd)).toBeCloseTo(0.0352777778, 9);
  });

  it("two-point calibration on the calibration sheet", () => {
    const h = known.horizontal;
    const pts = Math.hypot(h.to[0] - h.from[0], h.to[1] - h.from[1]);
    const s = scaleFromPoints(pts, 10, "m", 3);
    within(unitsPerPoint(s) * pts, 10);
    expect(scaleLabel({ ...s, paperUnit: "mm", realUnit: "mm", real: s.real * 1000 })).toBe("1:100");
  });
});

describe("measurements", () => {
  it("measure the calibration sheet within 0.1%", () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    const ctm = info.pages[0].ctm as Matrix;
    const P = (p: number[]): Pt => apply(ctm, [p[0], p[1]]);
    const r = known.room.rect;
    const c = known.room.cutout;
    const room = [P([r[0], r[1]]), P([r[2], r[1]]), P([r[2], r[3]]), P([r[0], r[3]])];
    const hole = [P([c[0], c[1]]), P([c[2], c[1]]), P([c[2], c[3]]), P([c[0], c[3]])];
    within(measureValue(m("length", [P(known.horizontal.from), P(known.horizontal.to)])).value, 10);
    within(measureValue(m("length", [P(known.vertical.from), P(known.vertical.to)])).value, 5);
    within(measureValue(m("length", [P(known.hypotenuse.from), P(known.hypotenuse.to)])).value, 5);
    within(measureValue(m("area", room)).value, known.room.areaM2);
    within(measureValue(m("area", room, { measure: { scale: S100, cutouts: [hole] } })).value, known.room.netAreaM2);
    within(measureValue(m("perimeter", room)).value, known.room.perimeterM);
    within(measureValue(m("polylength", room.slice(0, 3))).value, 12);
    expect(measureValue(m("angle", [room[1], room[0], room[3]])).value).toBeCloseTo(90, 6);
    expect(measureValue(m("count", room)).value).toBe(4);
    expect(measureValue(m("area", room)).text).toBe("32.00 m²");
  });

  it("areas with cutouts match analytic values, including overlapping and outside cutouts", () => {
    const sq: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(netArea(sq, [])).toBeCloseTo(100, 9);
    expect(netArea(sq, [[[2, 2], [4, 2], [4, 4], [2, 4]]])).toBeCloseTo(96, 9);
    // two overlapping cutouts count their union once
    expect(netArea(sq, [[[2, 2], [6, 2], [6, 6], [2, 6]], [[4, 4], [8, 4], [8, 8], [4, 8]]])).toBeCloseTo(100 - 28, 9);
    // a cutout half outside only removes the inside part
    expect(netArea(sq, [[[8, 8], [12, 8], [12, 12], [8, 12]]])).toBeCloseTo(96, 9);
    // triangle
    expect(netArea([[0, 0], [4, 0], [0, 3]], [])).toBeCloseTo(6, 9);
  });

  it("save /VP and measurement annotations; values are identical after reopening", async () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    const ctm = info.pages[0].ctm as Matrix;
    const P = (p: number[]): Pt => apply(ctm, [p[0], p[1]]);
    const r = known.room.rect;
    const c = known.room.cutout;
    const room = [P([r[0], r[1]]), P([r[2], r[1]]), P([r[2], r[3]]), P([r[0], r[3]])];
    const hole = [P([c[0], c[1]]), P([c[2], c[1]]), P([c[2], c[3]]), P([c[0], c[3]])];
    const ms = [
      m("length", [P(known.horizontal.from), P(known.horizontal.to)], { contents: "Wall A" }),
      m("polylength", room.slice(0, 3)),
      m("area", room, { measure: { scale: S100, cutouts: [hole] }, style: { ...DEFAULT_STYLE, fill: [0.2, 0.6, 1], opacity: 0.4, fontSize: 10 } }),
      m("perimeter", room),
      m("count", room),
      m("angle", [room[1], room[0], room[3]]),
    ];
    const before = ms.map((x) => measureValue(x).value);
    const p = plan(info, ms);
    p.pages[0].scale = S100;
    const res = e.save(info.docId, p, "incremental");
    expect(res.info.pages[0].scale).toEqual(S100);
    const back = ms.map((x) => res.markups.find((r) => r.id === x.id)!);
    expect(back.map((b) => b.kind)).toEqual(ms.map((x) => x.kind));
    back.forEach((b, i) => {
      expect(Math.abs(measureValue(b as unknown as Markup).value - before[i]) / before[i]).toBeLessThan(1e-6); // MuPDF stores reals as 32-bit floats
      expect(measureValue(b as unknown as Markup).text).toBe(measureValue(ms[i]).text);
    });
    expect(back[0].contents).toBe("Wall A");

    // dictionaries
    const doc = openMupdf(res.bytes);
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const vp = page.getObject().get("VP").get(0);
    expect(vp.get("Type").asName()).toBe("Viewport");
    expect(vp.get("BBox").length).toBe(4);
    const meas = vp.get("Measure");
    expect(meas.get("Subtype").asName()).toBe("RL");
    expect(meas.get("R").asString()).toBe("1 mm = 100 mm");
    expect(meas.get("X").get(0).get("U").asString()).toBe("m");
    expect(meas.get("X").get(0).get("C").asNumber()).toBeCloseTo(0.0352778, 6);
    expect(meas.get("A").get(0).get("U").asString()).toBe("m²");
    const byNm = (id: string) => page.getAnnotations().find((a) => a.getObject().get("NM").asString() === id)!.getObject();
    const len = byNm(ms[0].id);
    expect(len.get("Subtype").asName()).toBe("Line");
    expect(len.get("IT").asName()).toBe("LineDimension");
    expect(len.get("Measure").get("Subtype").asName()).toBe("RL");
    expect(len.get("Contents").asString()).toBe("10.00 m\nWall A");
    expect(byNm(ms[1].id).get("IT").asName()).toBe("PolyLineDimension");
    expect(byNm(ms[2].id).get("IT").asName()).toBe("PolygonDimension");
    expect(byNm(ms[2].id).get("Contents").asString()).toBe("30.00 m²");

    // pdf.js reads the file and the annotations
    const pj = await annotationsPdfjs(res.bytes, 0);
    expect(pj.filter((a) => ["Line", "PolyLine", "Polygon", "Ink"].includes(a.subtype)).length).toBe(6);
    const pdoc = await openPdfjs(res.bytes);
    expect(pdoc.numPages).toBe(1);
    await pdoc.destroy();
  });

  it("removing a scale keeps smaller detail viewports", () => {
    const e = new EngineCore();
    const info = e.open(read("calibration.pdf"), "calibration.pdf");
    // add a detail viewport by hand
    const p0 = plan(info, []);
    p0.pages[0].scale = S100;
    const saved = e.save(info.docId, p0, "full");
    const doc = openMupdf(saved.bytes);
    const page = doc.loadPage(0) as mupdf.PDFPage;
    const detail = doc.newDictionary();
    detail.put("Type", doc.newName("Viewport"));
    detail.put("BBox", [10, 10, 100, 100]);
    detail.put("Measure", { Type: doc.newName("Measure"), Subtype: doc.newName("RL"), R: doc.newString("1 mm = 5 mm"), X: [{ U: doc.newString("mm"), C: 1.763889, D: 1 }] });
    page.getObject().get("VP").push(detail);
    const bytes = doc.saveToBuffer("").asUint8Array().slice();
    const info2 = e.open(bytes, "x.pdf");
    expect(info2.pages[0].scale).toEqual(S100);
    const p1 = plan(info2, []);
    p1.pages[0].scale = null;
    const res = e.save(info2.docId, p1, "full");
    expect(res.info.pages[0].scale).toBeNull();
    const vps = (openMupdf(res.bytes).loadPage(0) as mupdf.PDFPage).getObject().get("VP");
    expect(vps.length).toBe(1);
    expect(vps.get(0).get("Measure").get("R").asString()).toBe("1 mm = 5 mm");
  });
});
