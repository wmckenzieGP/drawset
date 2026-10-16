/** Reads PDF annotations into Drawset markups. Nothing here writes to the document. */
import * as mupdf from "mupdf";
import { apply, bboxOf, type Matrix, type Pt, type Quad, type Rect, transformRect } from "../../markup/geometry";
import { DEFAULT_STYLE, type FontFamily, type LineEnd, LINE_ENDS, type MarkupKind, type Reply, type ReviewStatus, type RGB } from "../../markup/model";
import type { MarkupRecord } from "../types";
import { PRIVATE_KEY } from "./annotWrite";
import { readMeasure, safePageScale } from "./measureDict";
import { isMeasure, type PageScale } from "../../markup/measure";

const SKIP_SUBTYPES = new Set(["Popup", "Widget", "Link"]);

function str(o: mupdf.PDFObject): string {
  return o.isString() ? o.asString() : "";
}

function name(o: mupdf.PDFObject): string {
  return o.isName() ? o.asName() : "";
}

function numArray(o: mupdf.PDFObject): number[] {
  const out: number[] = [];
  if (!o.isArray()) return out;
  for (let i = 0; i < o.length; i++) {
    const v = o.get(i);
    out.push(v.isNumber() ? v.asNumber() : 0);
  }
  return out;
}

function rgb(o: mupdf.PDFObject): RGB | null {
  const a = numArray(o);
  if (a.length === 3) return [a[0], a[1], a[2]];
  if (a.length === 1) return [a[0], a[0], a[0]];
  if (a.length === 4) return [(1 - a[0]) * (1 - a[3]), (1 - a[1]) * (1 - a[3]), (1 - a[2]) * (1 - a[3])];
  return null;
}

/** Parses a PDF date (D:YYYYMMDDHHmmSSOHH'mm) to ISO; empty string when absent. */
export function parsePdfDate(s: string): string {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s.trim());
  if (!m) return "";
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", sign, oh = "00", om = "00"] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (sign === "+" || sign === "-") t -= (sign === "+" ? 1 : -1) * (+oh * 60 + +om) * 60000;
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
}

function pointsFrom(arr: number[], ctm: Matrix): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) pts.push(apply(ctm, [arr[i], arr[i + 1]]));
  return pts;
}

function lineEnd(n: string): LineEnd {
  return (LINE_ENDS as string[]).includes(n) ? (n as LineEnd) : "None";
}

const DA_FONTS: Record<string, FontFamily> = { helv: "Helvetica", helvetica: "Helvetica", arial: "Helvetica", tiro: "Times-Roman", times: "Times-Roman", "times-roman": "Times-Roman", cour: "Courier", courier: "Courier" };

function parseDA(da: string): { font: FontFamily; size: number; color: RGB } {
  const font = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da);
  const g = /([\d.]+)\s+g(?:\s|$)/.exec(da);
  const c = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const family = font ? (DA_FONTS[font[1].toLowerCase()] ?? (/times/i.test(font[1]) ? "Times-Roman" : /cour/i.test(font[1]) ? "Courier" : "Helvetica")) : "Helvetica";
  const size = font ? parseFloat(font[2]) || 12 : 12;
  const color: RGB = c ? [+c[1], +c[2], +c[3]] : g ? [+g[1], +g[1], +g[1]] : [0, 0, 0];
  return { font: family, size: size > 0 ? size : 12, color };
}

/** Follows a chain of dictionary keys; MuPDF throws on get() of a missing (null) object. */
export function dig(obj: mupdf.PDFObject, ...keys: string[]): mupdf.PDFObject {
  let o = obj;
  for (const k of keys) {
    if (!o.isDictionary() && !o.isStream()) return mupdf.PDFObject.Null;
    o = o.get(k);
  }
  return o;
}

function readPrivate(obj: mupdf.PDFObject): Record<string, any> {
  const raw = obj.get(PRIVATE_KEY);
  if (!raw.isString()) return {};
  try {
    const v = JSON.parse(raw.asString());
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function kindFor(subtype: string, obj: mupdf.PDFObject, priv: Record<string, any>): MarkupKind {
  const it = name(obj.get("IT"));
  const pk = priv.kind as MarkupKind | undefined;
  switch (subtype) {
    case "Square":
      return "rectangle";
    case "Circle":
      return "ellipse";
    case "Line":
      if (pk === "arrow" || pk === "line" || pk === "length") return pk;
      if (it === "LineDimension") return "length";
      return it === "LineArrow" || /Arrow/.test(obj.get("LE").toString()) ? "arrow" : "line";
    case "PolyLine":
      if (pk === "angle" || pk === "polylength") return pk;
      return it === "PolyLineDimension" ? "polylength" : "polyline";
    case "Polygon":
      if (pk === "area" || pk === "perimeter") return pk;
      if (it === "PolygonDimension") return "area";
      return name(dig(obj, "BE", "S")) === "C" || it === "PolygonCloud" ? "cloud" : "polygon";
    case "Ink":
      if (pk === "count") return "count";
      return pk === "highlighter" || name(obj.get("BM")) === "Multiply" ? "highlighter" : "pen";
    case "FreeText":
      return it === "FreeTextCallout" ? "callout" : "textbox";
    case "Text":
      return "note";
    case "Highlight":
      return "highlight";
    case "Underline":
      return "underline";
    case "StrikeOut":
      return "strikeout";
    case "Stamp":
      return pk === "image" || it === "StampImage" ? "image" : "stamp";
    default:
      return "foreign";
  }
}

/** Reads every markup on one page. `pageIndex` is the physical index. */
export function readPageMarkups(page: mupdf.PDFPage, pageIndex: number): MarkupRecord[] {
  const ctm = page.getTransform() as Matrix;
  const pageScale: PageScale | null = safePageScale(page);
  const pageObj = page.getObject();
  const annots = pageObj.get("Annots");
  if (!annots.isArray()) return [];

  type Entry = { num: number; obj: mupdf.PDFObject; subtype: string };
  const entries: Entry[] = [];
  for (let i = 0; i < annots.length; i++) {
    const ref = annots.get(i);
    const obj = ref.resolve();
    if (!obj.isDictionary()) continue;
    const subtype = name(obj.get("Subtype"));
    if (!subtype || SKIP_SUBTYPES.has(subtype)) continue;
    entries.push({ num: ref.isIndirect() ? ref.asIndirect() : 0, obj, subtype });
  }

  // statuses and replies hang off their parent via /IRT
  const statusOf = new Map<number, { state: ReviewStatus; when: string }>();
  const repliesOf = new Map<number, Reply[]>();
  const childNums = new Set<number>();
  for (const e of entries) {
    const irt = e.obj.get("IRT");
    if (!irt.isIndirect()) continue;
    const parent = irt.asIndirect();
    childNums.add(e.num);
    const model = name(e.obj.get("StateModel"));
    const when = parsePdfDate(str(e.obj.get("M"))) || parsePdfDate(str(e.obj.get("CreationDate")));
    if (model === "Review" || (e.obj.get("State").isName() && model === "")) {
      const st = name(e.obj.get("State"));
      const state: ReviewStatus = st === "Accepted" || st === "Rejected" || st === "Completed" || st === "Cancelled" ? st : "None";
      const prev = statusOf.get(parent);
      if (!prev || when >= prev.when) statusOf.set(parent, { state, when });
    } else if (model === "") {
      const list = repliesOf.get(parent) ?? [];
      list.push({
        id: str(e.obj.get("NM")) || `obj-${e.num}`,
        author: str(e.obj.get("T")),
        contents: str(e.obj.get("Contents")),
        created: parsePdfDate(str(e.obj.get("CreationDate"))) || when,
        modified: when,
        objNum: e.num,
      });
      repliesOf.set(parent, list);
    }
  }

  const out: MarkupRecord[] = [];
  for (const e of entries) {
    if (childNums.has(e.num)) continue;
    const { obj, subtype, num } = e;
    const priv = readPrivate(obj);
    const kind = kindFor(subtype, obj, priv);
    const rectUser = numArray(obj.get("Rect"));
    const rect: Rect = rectUser.length === 4 ? transformRect([Math.min(rectUser[0], rectUser[2]), Math.min(rectUser[1], rectUser[3]), Math.max(rectUser[0], rectUser[2]), Math.max(rectUser[1], rectUser[3])], ctm) : [0, 0, 0, 0];
    const flags = obj.get("F").isNumber() ? obj.get("F").asNumber() : 0;
    const bs = obj.get("BS");
    let width = bs.isDictionary() && bs.get("W").isNumber() ? bs.get("W").asNumber() : NaN;
    if (Number.isNaN(width)) {
      const border = numArray(obj.get("Border"));
      width = border.length >= 3 ? border[2] : 1;
    }
    const dashArr = bs.isDictionary() && name(bs.get("S")) === "D" ? numArray(bs.get("D")) : [];
    const color = rgb(obj.get("C"));
    const fill = rgb(obj.get("IC"));
    const ca = obj.get("CA");
    const le = obj.get("LE");
    const leNames = le.isArray() ? [name(le.get(0)), name(le.get(1))] : le.isName() ? [le.asName(), "None"] : ["None", "None"];
    const created = parsePdfDate(str(obj.get("CreationDate")));
    const modified = parsePdfDate(str(obj.get("M"))) || created;
    const da = parseDA(str(obj.get("DA")));
    const style = {
      ...DEFAULT_STYLE,
      color,
      fill,
      opacity: ca.isNumber() ? ca.asNumber() : 1,
      width: width >= 0 ? width : 1,
      dash: dashArr.length ? dashArr : null,
      lineStart: lineEnd(leNames[0]),
      lineEnd: lineEnd(leNames[1]),
      cloudIntensity: dig(obj, "BE", "I").isNumber() ? dig(obj, "BE", "I").asNumber() : 1,
      fontFamily: (priv.font as FontFamily) ?? da.font,
      fontSize: da.size,
      textColor: da.color,
      align: (obj.get("Q").isNumber() ? Math.max(0, Math.min(2, obj.get("Q").asNumber())) : 0) as 0 | 1 | 2,
    };
    const rec: MarkupRecord = {
      id: str(obj.get("NM")) || `obj-${num}`,
      pageIndex,
      kind,
      subtype,
      rect,
      points: [],
      inks: [],
      quads: [],
      style,
      contents: str(obj.get("Contents")),
      author: str(obj.get("T")),
      subject: str(obj.get("Subj")),
      created: created || modified,
      modified,
      status: statusOf.get(num)?.state ?? "None",
      locked: (flags & 128) !== 0,
      hidden: (flags & 2) !== 0,
      icon: name(obj.get("Name")) || "Comment",
      objNum: num,
      replies: (repliesOf.get(num) ?? []).sort((a, b) => a.created.localeCompare(b.created)),
    };
    const rd = numArray(obj.get("RD"));
    const inner = (): Rect => {
      if (rd.length !== 4 || rectUser.length !== 4) return rect;
      const u = [Math.min(rectUser[0], rectUser[2]), Math.min(rectUser[1], rectUser[3]), Math.max(rectUser[0], rectUser[2]), Math.max(rectUser[1], rectUser[3])];
      return transformRect([u[0] + rd[0], u[1] + rd[1], u[2] - rd[2], u[3] - rd[3]], ctm);
    };
    switch (kind) {
      case "rectangle":
      case "ellipse": {
        // the border is drawn inside /Rect − /RD; Drawset's frame is the centre line of the border
        const h = color ? rec.style.width / 2 : 0;
        const r = inner();
        rec.rect = r[2] - r[0] > 2 * h && r[3] - r[1] > 2 * h ? [r[0] + h, r[1] + h, r[2] - h, r[3] - h] : r;
        break;
      }
      case "line":
      case "arrow":
      case "length":
        rec.points = pointsFrom(numArray(obj.get("L")), ctm).slice(0, 2);
        break;
      case "polyline":
      case "polygon":
      case "cloud":
      case "polylength":
      case "area":
      case "perimeter":
      case "angle":
        rec.points = pointsFrom(numArray(obj.get("Vertices")), ctm);
        break;
      case "count": {
        const ink = obj.get("InkList");
        if (ink.isArray()) for (let i = 0; i < ink.length; i++) rec.points.push(...pointsFrom(numArray(ink.get(i)), ctm).slice(0, 1));
        break;
      }
      case "pen":
      case "highlighter": {
        const ink = obj.get("InkList");
        if (ink.isArray()) for (let i = 0; i < ink.length; i++) rec.inks.push(pointsFrom(numArray(ink.get(i)), ctm));
        break;
      }
      case "highlight":
      case "underline":
      case "strikeout": {
        const q = numArray(obj.get("QuadPoints"));
        for (let i = 0; i + 7 < q.length; i += 8) {
          const p = pointsFrom(q.slice(i, i + 8), ctm);
          rec.quads.push(p.flat() as Quad);
        }
        break;
      }
      case "textbox":
      case "callout": {
        // the text box is /Rect inset by /RD
        rec.rect = inner();
        if (kind === "callout") {
          const cl = pointsFrom(numArray(obj.get("CL")), ctm);
          // stored as tip, [knee,] anchor; Drawset keeps tip and knee and recomputes the anchor
          rec.points = cl.length >= 3 ? cl.slice(0, 2) : cl.slice(0, 1);
        }
        rec.style.fill = fill;
        break;
      }
      case "stamp":
        if (typeof priv.stampId === "string") {
          rec.stampId = priv.stampId;
          rec.stampText = Array.isArray(priv.stampText) ? priv.stampText.map(String) : undefined;
        } else rec.keepAppearance = true;
        break;
    }
    if ((kind === "line" || kind === "arrow" || kind === "length") && rec.points.length < 2) rec.kind = "foreign";
    if ((kind === "polyline" || kind === "polygon" || kind === "cloud" || kind === "polylength" || kind === "area" || kind === "perimeter") && rec.points.length < 2) rec.kind = "foreign";
    if (kind === "angle" && rec.points.length < 3) rec.kind = "foreign";
    if (kind === "count" && rec.points.length < 1) rec.kind = "foreign";
    if (isMeasure(rec.kind)) {
      // /Contents holds the value; Drawset recomputes it, and keeps the comment from its private data
      if (typeof priv.comment === "string") rec.contents = priv.comment;
      else rec.contents = "";
      if (typeof priv.fontSize === "number") rec.style.fontSize = priv.fontSize;
      else rec.style.fontSize = 10;
      const cut = Array.isArray(priv.cutouts) ? (priv.cutouts as unknown[]).filter(Array.isArray).map((c) => pointsFrom((c as unknown[]).map(Number), ctm)) : [];
      rec.measure = { scale: readMeasure(obj.get("Measure")) ?? pageScale, cutouts: cut };
    }
    if (rec.kind !== "foreign" && rec.points.length > 0 && kind !== "callout") rec.rect = bboxOf(rec.points);
    if (kind === "pen" || kind === "highlighter") rec.rect = bboxOf(rec.inks.flat());
    out.push(rec);
  }
  return out;
}
