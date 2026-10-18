import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { createCanvas } from "@napi-rs/canvas";
import { EngineCore } from "../../src/engine/core/engineCore";
import { applyTemplate, CHEST_KINDS, markupFromTool, setFromJson, setToJson, toolFromMarkup } from "../../src/features/toolchest/chest";
import { DEFAULT_STYLE, type Markup, type MarkupKind } from "../../src/markup/model";
import type { PageScale } from "../../src/markup/measure";
import type { PageEntry } from "../../src/state/store";
import { mk, plan } from "./helpers/markups";

function blankPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

function png(w: number, h: number): Uint8Array {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c02060";
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(c.toBuffer("image/png"));
}

const SCALE: PageScale = { paper: 1, paperUnit: "mm", real: 100, realUnit: "mm", displayUnit: "m", precision: 2 };
const odd = { ...DEFAULT_STYLE, color: [0.1, 0.6, 0.3] as [number, number, number], fill: [1, 0.8, 0.2] as [number, number, number], opacity: 0.55, width: 3.25, dash: [5, 2], lineStart: "Circle" as const, lineEnd: "OpenArrow" as const, cloudIntensity: 2, fontFamily: "Courier" as const, fontSize: 13, textColor: [0, 0, 0.7] as [number, number, number], align: 1 as const };
const tri = [[100, 100], [220, 120], [160, 230]] as [number, number][];

const CASES: Partial<Record<MarkupKind, Partial<Markup>>> = {
  rectangle: { rect: [100, 100, 240, 180] },
  ellipse: { rect: [100, 100, 240, 180] },
  line: { points: [[100, 100], [260, 150]] },
  arrow: { points: [[100, 100], [260, 150]] },
  polyline: { points: tri },
  polygon: { points: tri },
  cloud: { points: tri },
  pen: { inks: [[[100, 100], [120, 130], [150, 120]]] },
  highlighter: { inks: [[[100, 100], [200, 100]]] },
  textbox: { rect: [100, 100, 260, 150], contents: "WATERPROOF\nmembrane" },
  callout: { rect: [200, 100, 320, 140], points: [[120, 200], [190, 120]], contents: "Confirm on site" },
  note: { rect: [100, 100, 120, 120], contents: "Check fall", icon: "Key" },
  stamp: { rect: [100, 100, 280, 150], stampId: "approved", stampText: ["APPROVED", "W. Tester 16/10/2026"] },
  image: { rect: [100, 100, 160, 145], image: { data: png(40, 30), mime: "image/png", width: 40, height: 30 } },
  length: { points: [[100, 100], [300, 100]], measure: { scale: SCALE, cutouts: [] } },
  polylength: { points: tri, measure: { scale: SCALE, cutouts: [] } },
  area: { points: [[100, 100], [300, 100], [300, 300], [100, 300]], measure: { scale: SCALE, cutouts: [[[150, 150], [200, 150], [200, 200], [150, 200]]] } },
  perimeter: { points: tri, measure: { scale: SCALE, cutouts: [] } },
  count: { points: [[100, 100], [140, 100], [180, 120]], measure: { scale: SCALE, cutouts: [] } },
  angle: { points: [[100, 200], [150, 100], [250, 120]], measure: { scale: SCALE, cutouts: [] } },
  arc: { points: [[100, 200], [150, 120], [250, 160]] },
  dimension: { points: [[100, 200], [300, 200], [200, 170]], measure: { scale: SCALE, cutouts: [] } },
  radius: { points: [[200, 200], [240, 230]], measure: { scale: SCALE, cutouts: [] } },
  diameter: { points: [[200, 200], [240, 230]], measure: { scale: SCALE, cutouts: [] } },
  volume: { points: [[100, 100], [300, 100], [300, 300], [100, 300]], measure: { scale: SCALE, cutouts: [], depth: 2.4 } },
};

const page: PageEntry = { id: "p0", src: 0, info: { index: 0, bounds: [0, 0, 595, 842], rotate: 0, label: "1", ctm: [1, 0, 0, -1, 0, 842], scale: SCALE }, rotation: 0, scale: SCALE, label: "1" };

/** The properties a tool must reproduce: everything but identity, author, dates and file links. */
function props(m: Omit<Markup, "pageId"> & { pageIndex?: number }) {
  const { id: _i, objNum: _o, created: _c, modified: _m, author: _a, replies: _r, apFrom: _f, keepAppearance: _k, ...rest } = m as Markup & { pageIndex?: number };
  void [_i, _o, _c, _m, _a, _r, _f, _k];
  return JSON.parse(JSON.stringify(rest, (_k2, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v instanceof Uint8Array ? Array.from(v).length : v)));
}

describe("Tool Chest", () => {
  it("every kind it offers has a case", () => {
    expect([...CHEST_KINDS].sort()).toEqual(Object.keys(CASES).sort());
  });

  it("a tool (through JSON export and import) places a markup with exactly the original's properties, in memory and in the file", () => {
    const originals = Object.entries(CASES).map(([kind, over]) => mk(kind as MarkupKind, { style: { ...odd, ...(kind === "highlighter" ? { width: 12 } : {}) }, subject: `My ${kind}`, ...over }));
    const set = { id: "s", name: "Site tools", tools: originals.map((m) => toolFromMarkup(m)) };
    const imported = setFromJson(setToJson(set));
    expect(imported.name).toBe("Site tools");
    expect(imported.tools.map((t) => t.name)).toEqual(originals.map((m) => m.subject));

    const placed = imported.tools.map((t, i) => {
      const o = originals[i];
      const pts = o.points.length ? o.points : o.inks.flat();
      const r = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : o.rect;
      return markupFromTool(t, page, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], "Someone Else");
    });
    for (let i = 0; i < originals.length; i++) {
      expect(placed[i].author).toBe("Someone Else");
      expect(placed[i].id).not.toBe(originals[i].id);
      expect(props(placed[i])).toEqual(props(originals[i]));
    }

    // both written to a file and read back: the same properties again
    const e = new EngineCore();
    const info = e.open(blankPdf(), "blank.pdf");
    const res = e.save(info.docId, plan(info, [...originals, ...placed]), "incremental");
    const byId = new Map(res.markups.map((m) => [m.id, m]));
    for (let i = 0; i < originals.length; i++) {
      const a = byId.get(originals[i].id)!;
      const b = byId.get(placed[i].id)!;
      expect(props(b)).toEqual(props(a));
    }
  });

  it("placing moves the whole shape, cutouts included, and measurements take the page's scale", () => {
    const area = mk("area", { points: [[0, 0], [100, 0], [100, 100], [0, 100]], measure: { scale: null, cutouts: [[[10, 10], [20, 10], [20, 20]]] }, style: odd });
    const m = markupFromTool(toolFromMarkup(area), page, [300, 400], "A");
    expect(m.points[0]).toEqual([250, 350]);
    expect(m.measure!.cutouts[0][0]).toEqual([260, 360]);
    expect(m.measure!.scale).toEqual(SCALE);
  });

  it("drawing mode gives a new markup the tool's style, subject and text but keeps its own geometry", () => {
    const src = mk("textbox", { style: odd, subject: "Site note", contents: "HOLD", rect: [0, 0, 50, 20] });
    const t = toolFromMarkup(src);
    const fresh = mk("textbox", { rect: [300, 300, 400, 340] });
    const out = applyTemplate(fresh, t.template);
    expect(out.style).toEqual(odd);
    expect(out.subject).toBe("Site note");
    expect(out.contents).toBe("HOLD");
    expect(out.rect).toEqual([300, 300, 400, 340]);
    // a different kind is left alone
    expect(applyTemplate(mk("rectangle"), t.template).subject).toBe("rectangle");
  });

  it("rejects files that are not tool sets", () => {
    expect(() => setFromJson("nope")).toThrow(/not valid JSON/);
    expect(() => setFromJson(JSON.stringify({ format: "other" }))).toThrow(/not a Drawset tool set/);
    expect(() => setFromJson(JSON.stringify({ format: "drawset-toolset", version: 1, tools: [{ name: "x", template: { kind: "redact" } }] }))).toThrow(/not valid/);
  });
});
