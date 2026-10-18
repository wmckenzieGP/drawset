/**
 * Writes a Drawset markup into a PDF annotation dictionary, following the ISO 32000-2 mapping in SPEC.md.
 * Only the keys Drawset manages are written; every other key on an existing annotation is left untouched.
 * The appearance stream is set last with setAppearance so MuPDF never replaces it with its own.
 */
import * as mupdf from "mupdf";
import { writeLinkTarget } from "./links";
import { apply, dist, inflate, invert, type Matrix, type Pt, type Rect, transformRect } from "../../markup/geometry";
import { arcPoints, buildAppearance, calloutLeader, type TextFont } from "../../markup/appearance";
import { appearanceToPdf, FONT_RESOURCE } from "../../markup/pdfAppearance";
import { colourHex, newId, type Markup, type RGB } from "../../markup/model";
import { dimensionLine, isMeasure, measureValue } from "../../markup/measure";
import { measureObject } from "./measureDict";

export const PRIVATE_KEY = "DrawsetData";

export function subtypeFor(m: Markup): mupdf.PDFAnnotationType {
  switch (m.kind) {
    case "rectangle":
      return "Square";
    case "ellipse":
      return "Circle";
    case "line":
    case "arrow":
      return "Line";
    case "polyline":
      return "PolyLine";
    case "polygon":
    case "cloud":
      return "Polygon";
    case "pen":
    case "highlighter":
      return "Ink";
    case "textbox":
    case "callout":
      return "FreeText";
    case "note":
      return "Text";
    case "highlight":
      return "Highlight";
    case "underline":
      return "Underline";
    case "strikeout":
      return "StrikeOut";
    case "stamp":
    case "image":
      return "Stamp";
    case "length":
    case "dimension":
      return "Line";
    case "polylength":
    case "angle":
    case "arc":
      return "PolyLine";
    case "area":
    case "perimeter":
    case "volume":
      return "Polygon";
    case "radius":
    case "diameter":
      return "Circle";
    case "count":
      return "Ink";
    case "redact":
    case "erase":
      return "Redact";
    case "link":
      return "Link";
    case "foreign":
      return m.subtype as mupdf.PDFAnnotationType;
  }
}

/** PDF date string (UTC). */
export function pdfDate(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS_FONT: Record<string, string> = { Helvetica: "Helvetica", "Times-Roman": "Times New Roman", Courier: "Courier" };
const ALIGN = ["left", "center", "right"];

export function richText(m: Markup): string {
  const s = m.style;
  const style = `font-size:${s.fontSize.toFixed(1)}pt;text-align:${ALIGN[s.align]};color:${colourHex(s.textColor)};font-weight:normal;font-style:normal;font-family:${CSS_FONT[s.fontFamily]};font-stretch:normal`;
  const paras = m.contents
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((p) => `<p dir="ltr"><span style="font-family:${CSS_FONT[s.fontFamily]}">${xmlEscape(p)}</span></p>`)
    .join("");
  return `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" xfa:APIVersion="Acrobat:11.0.0" xfa:spec="2.0.2" style="${style}">${paras}</body>`;
}

export function defaultStyleString(m: Markup): string {
  const s = m.style;
  return `font: ${CSS_FONT[s.fontFamily]} ${s.fontSize.toFixed(1)}pt; text-align:${ALIGN[s.align]}; color:${colourHex(s.textColor)}`;
}

/** Per-document cache of the standard font dictionaries used by appearance streams. */
const fontCache = new WeakMap<mupdf.PDFDocument, Map<TextFont, mupdf.PDFObject>>();
function fontObject(doc: mupdf.PDFDocument, font: TextFont): mupdf.PDFObject {
  let map = fontCache.get(doc);
  if (!map) fontCache.set(doc, (map = new Map()));
  let obj = map.get(font);
  if (!obj) {
    obj = doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: FONT_RESOURCE[font].base, Encoding: "WinAnsiEncoding" });
    map.set(font, obj);
  }
  return obj;
}

function nums(doc: mupdf.PDFDocument, values: number[]): mupdf.PDFObject {
  const arr = doc.newArray();
  for (const v of values) arr.push(doc.newReal(Math.round(v * 1e6) / 1e6));
  return arr;
}

function colour(doc: mupdf.PDFDocument, c: RGB): mupdf.PDFObject {
  return nums(doc, c);
}

function userPts(m: Matrix, pts: readonly Pt[]): number[] {
  return pts.flatMap((p) => apply(m, p));
}

const FLAG_HIDDEN = 2;
const FLAG_PRINT = 4;
const FLAG_NO_ZOOM = 8;
const FLAG_NO_ROTATE = 16;
const FLAG_LOCKED = 128;

export interface WriteContext {
  doc: mupdf.PDFDocument;
  page: mupdf.PDFPage;
  /** page space → user space */
  toUser: Matrix;
  defaultAuthor: string;
}

/** Updates only /Rect of an annotation whose appearance is kept (foreign or loaded stamp). */
function writeRectOnly(ctx: WriteContext, obj: mupdf.PDFObject, m: Markup) {
  obj.put("Rect", nums(ctx.doc, transformRect(m.rect, ctx.toUser)));
}

/** /Contents: the comment, or for measurements the value followed by the comment. */
export function contentsFor(m: Markup): string {
  if (!isMeasure(m.kind)) return m.contents;
  const v = measureValue(m).text;
  return m.contents ? `${v}\n${m.contents}` : v;
}

function putCommon(ctx: WriteContext, obj: mupdf.PDFObject, m: Markup) {
  const { doc } = ctx;
  obj.put("NM", doc.newString(m.id));
  obj.put("T", doc.newString(m.author || ctx.defaultAuthor));
  obj.put("Subj", doc.newString(m.subject));
  obj.put("Contents", doc.newString(contentsFor(m)));
  obj.put("CreationDate", doc.newString(pdfDate(m.created)));
  obj.put("M", doc.newString(pdfDate(m.modified)));
  let flags = obj.get("F").isNumber() ? obj.get("F").asNumber() : 0;
  flags |= FLAG_PRINT;
  flags = m.locked ? flags | FLAG_LOCKED : flags & ~FLAG_LOCKED;
  flags = m.hidden ? flags | FLAG_HIDDEN : flags & ~FLAG_HIDDEN;
  if (m.kind === "note") flags |= FLAG_NO_ZOOM | FLAG_NO_ROTATE;
  obj.put("F", doc.newInteger(flags));
  if (m.style.opacity < 1) obj.put("CA", doc.newReal(m.style.opacity));
  else obj.delete("CA");
}

function putBorder(ctx: WriteContext, obj: mupdf.PDFObject, m: Markup) {
  const { doc } = ctx;
  const bs = doc.newDictionary();
  bs.put("Type", doc.newName("Border"));
  bs.put("W", doc.newReal(m.style.color ? m.style.width : 0));
  if (m.style.dash && m.style.dash.length) {
    bs.put("S", doc.newName("D"));
    bs.put("D", nums(doc, m.style.dash));
  } else bs.put("S", doc.newName("S"));
  obj.put("BS", bs);
  obj.delete("Border");
}

function putColour(ctx: WriteContext, obj: mupdf.PDFObject, key: string, c: RGB | null) {
  if (c) obj.put(key, colour(ctx.doc, c));
  else obj.delete(key);
}

function putPrivate(ctx: WriteContext, obj: mupdf.PDFObject, m: Markup) {
  const data: Record<string, unknown> = { v: 1, kind: m.kind };
  if (isMeasure(m.kind)) {
    // /Contents carries the measured value (as other editors show it); the user's comment lives here
    data.comment = m.contents;
    data.fontSize = m.style.fontSize;
    data.font = m.style.fontFamily;
    if (m.measure?.cutouts.length) data.cutouts = m.measure.cutouts.map((c) => userPts(ctx.toUser, c).map((v) => Math.round(v * 1e6) / 1e6));
    if (m.kind === "volume") data.depth = m.measure?.depth ?? 1;
  }
  // control points the standard keys cannot hold (the arc's middle point, a circle's centre and edge, the dimension offset)
  if (m.kind === "arc" || m.kind === "radius" || m.kind === "diameter" || m.kind === "dimension") data.pts = userPts(ctx.toUser, m.points).map((v) => Math.round(v * 1e6) / 1e6);
  if (m.stampId) data.stampId = m.stampId;
  if (m.stampText) data.stampText = m.stampText;
  if (m.kind === "textbox" || m.kind === "callout") {
    data.font = m.style.fontFamily;
    data.align = m.style.align;
  }
  obj.put(PRIVATE_KEY, ctx.doc.newString(JSON.stringify(data)));
}

/**
 * Writes `m` into `obj` (an annotation dictionary of the right subtype) and sets its appearance.
 * `annot` is the MuPDF annotation wrapper for the same dictionary.
 */
export function writeMarkup(ctx: WriteContext, annot: mupdf.PDFAnnotation, m: Markup) {
  const { doc } = ctx;
  const obj = annot.getObject();
  if (m.keepAppearance && !obj.get("AP").isDictionary() && m.apFrom !== undefined) {
    copyAppearance(ctx, annot, m, m.apFrom);
    putCommon(ctx, obj, m);
    return;
  }
  if (m.kind === "foreign" || m.keepAppearance) {
    writeRectOnly(ctx, obj, m);
    if (m.kind !== "foreign") {
      putCommon(ctx, obj, m);
    } else {
      // foreign annotations: only the fields the properties panel can change
      obj.put("Contents", doc.newString(m.contents));
      obj.put("M", doc.newString(pdfDate(m.modified)));
    }
    return;
  }
  const s = m.style;
  const T = ctx.toUser;
  putCommon(ctx, obj, m);
  putPrivate(ctx, obj, m);
  putColour(ctx, obj, "C", s.color);
  obj.delete("RD");

  switch (m.kind) {
    case "rectangle":
    case "ellipse":
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      obj.delete("BE");
      break;
    case "line":
    case "arrow": {
      obj.put("L", nums(doc, userPts(T, m.points.slice(0, 2))));
      const le = doc.newArray();
      le.push(doc.newName(s.lineStart));
      le.push(doc.newName(s.lineEnd));
      obj.put("LE", le);
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      if (m.kind === "arrow") obj.put("IT", doc.newName("LineArrow"));
      else if (obj.get("IT").isName() && obj.get("IT").asName() === "LineArrow") obj.delete("IT");
      break;
    }
    case "polyline": {
      obj.put("Vertices", nums(doc, userPts(T, m.points)));
      const le = doc.newArray();
      le.push(doc.newName(s.lineStart));
      le.push(doc.newName(s.lineEnd));
      obj.put("LE", le);
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      break;
    }
    case "polygon":
    case "cloud": {
      obj.put("Vertices", nums(doc, userPts(T, m.points)));
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      if (m.kind === "cloud") {
        obj.put("BE", { S: doc.newName("C"), I: doc.newReal(s.cloudIntensity) });
        obj.put("IT", doc.newName("PolygonCloud"));
      } else {
        obj.delete("BE");
        if (obj.get("IT").isName() && obj.get("IT").asName() === "PolygonCloud") obj.delete("IT");
      }
      break;
    }
    case "pen":
    case "highlighter": {
      const ink = doc.newArray();
      for (const stroke of m.inks) ink.push(nums(doc, userPts(T, stroke)));
      obj.put("InkList", ink);
      putBorder(ctx, obj, m);
      if (m.kind === "highlighter") obj.put("BM", doc.newName("Multiply"));
      else obj.delete("BM");
      break;
    }
    case "textbox":
    case "callout": {
      const res = FONT_RESOURCE[s.fontFamily].name;
      obj.put("DA", doc.newString(`/${res} ${s.fontSize} Tf ${s.textColor.map((v) => Math.round(v * 1000) / 1000).join(" ")} rg`));
      obj.put("DS", doc.newString(defaultStyleString(m)));
      obj.put("RC", doc.newString(richText(m)));
      obj.put("Q", doc.newInteger(s.align));
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      if (m.kind === "callout" && m.points.length >= 1) {
        obj.put("IT", doc.newName("FreeTextCallout"));
        const leader = calloutLeader(m);
        obj.put("CL", nums(doc, userPts(T, leader)));
        obj.put("LE", doc.newName(s.lineStart));
      } else {
        obj.delete("CL");
        obj.delete("LE");
        if (obj.get("IT").isName() && obj.get("IT").asName() === "FreeTextCallout") obj.delete("IT");
      }
      break;
    }
    case "note":
      obj.put("Name", doc.newName(m.icon || "Comment"));
      if (!obj.get("Open").isBoolean()) obj.put("Open", false);
      break;
    case "highlight":
    case "underline":
    case "strikeout":
      obj.put("QuadPoints", nums(doc, m.quads.flatMap((q) => userPts(T, [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]))));
      break;
    case "stamp":
    case "image":
      obj.put("Name", doc.newName(m.image ? "Image" : "Draft"));
      if (m.image) obj.put("IT", doc.newName("StampImage"));
      break;
    case "arc": {
      obj.put("Vertices", nums(doc, userPts(T, arcPoints(m))));
      const le = doc.newArray();
      le.push(doc.newName(s.lineStart));
      le.push(doc.newName(s.lineEnd));
      obj.put("LE", le);
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      obj.delete("IT");
      break;
    }
    case "dimension": {
      // a dimension line: /L the measured points, /LL the offset of the dimension line (leader lines), /LLE their overshoot
      const [ua, ub] = [userPts(T, [m.points[0]]), userPts(T, [m.points[1]])];
      obj.put("L", nums(doc, [...ua, ...ub]));
      const { a2 } = dimensionLine(m.points);
      const u2 = userPts(T, [a2]);
      const dx = ub[0] - ua[0];
      const dy = ub[1] - ua[1];
      const len = Math.hypot(dx, dy) || 1;
      // positive /LL is anticlockwise from the line's direction in user space
      obj.put("LL", doc.newReal(((u2[0] - ua[0]) * -dy + (u2[1] - ua[1]) * dx) / len));
      obj.put("LLE", doc.newReal(3));
      obj.put("Cap", doc.newBoolean(true));
      obj.put("CP", doc.newName("Top"));
      const le = doc.newArray();
      le.push(doc.newName(s.lineStart));
      le.push(doc.newName(s.lineEnd));
      obj.put("LE", le);
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      obj.put("IT", doc.newName("LineDimension"));
      if (m.measure?.scale) obj.put("Measure", measureObject(doc, m.measure.scale));
      else obj.delete("Measure");
      break;
    }
    case "radius":
    case "diameter":
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      obj.delete("BE");
      if (m.measure?.scale) obj.put("Measure", measureObject(doc, m.measure.scale));
      else obj.delete("Measure");
      break;
    case "length":
    case "polylength":
    case "area":
    case "volume":
    case "perimeter":
    case "angle": {
      if (m.kind === "length") obj.put("L", nums(doc, userPts(T, m.points.slice(0, 2))));
      else obj.put("Vertices", nums(doc, userPts(T, m.points)));
      if (m.kind === "length" || m.kind === "polylength" || m.kind === "angle") {
        const le = doc.newArray();
        le.push(doc.newName(s.lineStart));
        le.push(doc.newName(s.lineEnd));
        obj.put("LE", le);
      }
      putColour(ctx, obj, "IC", s.fill);
      putBorder(ctx, obj, m);
      const it = m.kind === "length" ? "LineDimension" : m.kind === "polylength" ? "PolyLineDimension" : m.kind === "angle" ? null : "PolygonDimension";
      if (it) obj.put("IT", doc.newName(it));
      else obj.delete("IT");
      if (it && m.measure?.scale) obj.put("Measure", measureObject(doc, m.measure.scale));
      else obj.delete("Measure");
      obj.delete("BE");
      break;
    }
    case "redact":
    case "erase": {
      if (m.quads.length) obj.put("QuadPoints", nums(doc, m.quads.flatMap((q) => userPts(T, [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]))));
      else obj.delete("QuadPoints");
      // what the area looks like once applied: black for a redaction, nothing for an erase
      if (m.kind === "redact") obj.put("IC", colour(doc, [0, 0, 0]));
      else obj.delete("IC");
      obj.delete("OverlayText");
      obj.delete("Repeat");
      break;
    }
    case "count": {
      const ink = doc.newArray();
      for (const p of m.points) ink.push(nums(doc, userPts(T, [p])));
      obj.put("InkList", ink);
      putBorder(ctx, obj, m);
      putColour(ctx, obj, "IC", s.fill);
      if (m.measure?.scale) obj.put("Measure", measureObject(doc, m.measure.scale));
      break;
    }
  }

  // appearance stream (last, so MuPDF keeps it)
  const ap = buildAppearance(m);
  const pdf = appearanceToPdf(ap, T);
  const rect = pdf.bbox;
  if (m.kind === "callout" || m.kind === "rectangle" || m.kind === "ellipse" || m.kind === "radius" || m.kind === "diameter") {
    // /RD: distances from /Rect to the text box, or to the outer edge of the shape's border (user space)
    const r = m.points.length >= 2 ? dist(m.points[0], m.points[1]) : 0;
    const circle: Rect = m.points.length >= 2 ? [m.points[0][0] - r, m.points[0][1] - r, m.points[0][0] + r, m.points[0][1] + r] : m.rect;
    const inner = m.kind === "callout" ? m.rect : inflate(m.kind === "radius" || m.kind === "diameter" ? circle : m.rect, s.color ? s.width / 2 : 0);
    const box = transformRect(inner, T);
    obj.put("RD", nums(doc, [box[0] - rect[0], box[1] - rect[1], rect[2] - box[2], rect[3] - box[3]].map((v) => Math.max(0, v))));
  }
  obj.put("Rect", nums(doc, rect));
  const resources: Record<string, unknown> = {};
  if (pdf.fonts.length) {
    const fonts: Record<string, mupdf.PDFObject> = {};
    for (const f of pdf.fonts) fonts[FONT_RESOURCE[f].name] = fontObject(doc, f);
    resources.Font = fonts;
  }
  if (pdf.usesGState) {
    const gs: Record<string, unknown> = { Type: doc.newName("ExtGState"), CA: ap.opacity, ca: ap.opacity };
    if (ap.blend !== "Normal") gs.BM = doc.newName(ap.blend);
    resources.ExtGState = { GS0: gs };
  }
  if (pdf.usesImage && m.image) {
    resources.XObject = { Im0: doc.addImage(new mupdf.Image(m.image.data)) };
  }
  annot.setAppearance(null, null, mupdf.Matrix.identity, rect, resources, pdf.content);
  // setAppearance may adjust /Rect; keep ours exactly
  obj.put("Rect", nums(doc, rect));
}

/**
 * Writes a link into its dictionary. MuPDF keeps links out of its annotation list for loaded pages, so this
 * works on the object directly; the appearance (a border, when there is one) is written by hand.
 */
export function writeLink(ctx: WriteContext, obj: mupdf.PDFObject, m: Markup) {
  const { doc } = ctx;
  putCommon(ctx, obj, m);
  putPrivate(ctx, obj, m);
  putColour(ctx, obj, "C", m.style.color);
  putBorder(ctx, obj, m);
  // the older /Border array too: without it some viewers draw a default black border
  obj.put("Border", nums(doc, [0, 0, m.style.color ? m.style.width : 0]));
  obj.put("H", doc.newName("I"));
  if (m.link) writeLinkTarget(doc, obj, m.link);
  const pdf = appearanceToPdf(buildAppearance(m), ctx.toUser);
  obj.put("Rect", nums(doc, pdf.bbox));
  if (m.style.color && pdf.content.trim()) {
    obj.put("AP", { N: doc.addStream(pdf.content, { Type: doc.newName("XObject"), Subtype: doc.newName("Form"), BBox: nums(doc, pdf.bbox) }) });
  } else obj.delete("AP");
}

/** New annotation reusing another annotation's normal appearance, scaled into the markup's rect. */
function copyAppearance(ctx: WriteContext, annot: mupdf.PDFAnnotation, m: Markup, fromNum: number) {
  const { doc } = ctx;
  const obj = annot.getObject();
  const src = doc.newIndirect(fromNum).resolve();
  const ap = src.get("AP").isDictionary() ? src.get("AP").get("N") : src.get("AP");
  for (const key of ["Name", "IT"]) if (!src.get(key).isNull()) obj.put(key, src.get(key));
  const rect = transformRect(m.rect, ctx.toUser);
  if (!ap.isStream()) {
    obj.put("Rect", nums(doc, rect));
    return;
  }
  const bb = ap.get("BBox").isArray() ? [0, 1, 2, 3].map((i) => ap.get("BBox").get(i).asNumber()) : [0, 0, 1, 1];
  const mt = ap.get("Matrix").isArray() ? [0, 1, 2, 3, 4, 5].map((i) => ap.get("Matrix").get(i).asNumber()) : [1, 0, 0, 1, 0, 0];
  const fb = transformRect([bb[0], bb[1], bb[2], bb[3]], mt as Matrix);
  const sx = (rect[2] - rect[0]) / (fb[2] - fb[0] || 1);
  const sy = (rect[3] - rect[1]) / (fb[3] - fb[1] || 1);
  const content = `q ${sx} 0 0 ${sy} ${rect[0] - fb[0] * sx} ${rect[1] - fb[1] * sy} cm /X0 Do Q`;
  annot.setAppearance(null, null, mupdf.Matrix.identity, rect, { XObject: { X0: ap } }, content);
  obj.put("Rect", nums(doc, rect));
}

/** Adds (or updates) a hidden review-state reply for `parent`, as other PDF editors read statuses. */
export function writeStatus(ctx: WriteContext, parentObj: mupdf.PDFObject, m: Markup) {
  const { doc, page } = ctx;
  const pageObj = page.getObject();
  const annots = pageObj.get("Annots");
  const parentNum = parentObj.asIndirect();
  // find the latest existing state reply for this parent
  let latest: { obj: mupdf.PDFObject; state: string; author: string } | null = null;
  if (annots.isArray()) {
    for (let i = 0; i < annots.length; i++) {
      const a = annots.get(i);
      const irt = a.get("IRT");
      if (irt.isIndirect() && irt.asIndirect() === parentNum && a.get("StateModel").isName() && a.get("StateModel").asName() === "Review") {
        latest = { obj: a, state: a.get("State").isName() ? a.get("State").asName() : "None", author: a.get("T").isString() ? a.get("T").asString() : "" };
      }
    }
  }
  const current = latest?.state ?? "None";
  if (current === m.status) return;
  const author = ctx.defaultAuthor || m.author;
  const r = transformRect(m.rect, ctx.toUser);
  const now = pdfDate(new Date().toISOString());
  const reply = doc.addObject({
    Type: doc.newName("Annot"),
    Subtype: doc.newName("Text"),
    Rect: [r[0], r[3] - 20, r[0] + 20, r[3]],
    IRT: parentObj,
    State: doc.newName(m.status),
    StateModel: doc.newName("Review"),
    T: doc.newString(author),
    Subj: doc.newString("Status"),
    Contents: doc.newString(`${m.status} set by ${author}`),
    NM: doc.newString(newId()),
    CreationDate: doc.newString(now),
    M: doc.newString(now),
    F: FLAG_HIDDEN | FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE,
    Name: doc.newName("Comment"),
    P: pageObj,
  });
  if (!annots.isArray()) pageObj.put("Annots", doc.newArray());
  pageObj.get("Annots").push(reply);
}

/**
 * Brings the markup's reply thread in the file in line with `m.replies`: new replies are added as /Text
 * annotations with /IRT (the markup or the reply they answer) and /RT /R, changed text is updated, and replies
 * that were removed are deleted. Replies have an empty appearance, so viewers list them without drawing an icon.
 */
export function writeReplies(ctx: WriteContext, parentObj: mupdf.PDFObject, m: Markup) {
  const { doc, page } = ctx;
  const pageObj = page.getObject();
  const parentNum = parentObj.asIndirect();
  const isReply = (a: mupdf.PDFObject) => !a.get("StateModel").isName() && !a.get("State").isName() && !(a.get("RT").isName() && a.get("RT").asName() === "Group");
  const thread = new Map<number, mupdf.PDFObject>();
  const members = new Set<number>([parentNum]);
  const annots = pageObj.get("Annots");
  for (let grew = annots.isArray(); grew; ) {
    grew = false;
    for (let i = 0; i < annots.length; i++) {
      const a = annots.get(i);
      if (!a.isIndirect() || members.has(a.asIndirect())) continue;
      const irt = a.get("IRT");
      if (irt.isIndirect() && members.has(irt.asIndirect()) && isReply(a)) {
        thread.set(a.asIndirect(), a);
        members.add(a.asIndirect());
        grew = true;
      }
    }
  }
  const keep = new Set(m.replies.map((r) => r.objNum).filter((n): n is number => n !== undefined));
  for (const num of thread.keys()) if (!keep.has(num)) deleteAnnotationTree(doc, page, num);

  const byId = new Map<string, mupdf.PDFObject>();
  const rect = parentObj.get("Rect");
  const r = rect.isArray() && rect.length === 4 ? [0, 1, 2, 3].map((i) => rect.get(i).asNumber()) : [0, 0, 20, 20];
  // parents before the replies that answer them
  const ordered = [...m.replies].sort((a, b) => a.created.localeCompare(b.created));
  for (const reply of ordered) {
    const irt = (reply.inReplyTo && byId.get(reply.inReplyTo)) || parentObj;
    let obj = reply.objNum !== undefined ? thread.get(reply.objNum) : undefined;
    if (obj) {
      const same = (k: string, v: string) => obj!.get(k).isString() && obj!.get(k).asString() === v;
      if (!same("Contents", reply.contents) || !same("T", reply.author)) {
        obj.put("Contents", doc.newString(reply.contents));
        obj.put("T", doc.newString(reply.author));
        obj.put("M", doc.newString(pdfDate(reply.modified)));
      }
    } else {
      const ap = doc.addStream("", { Type: doc.newName("XObject"), Subtype: doc.newName("Form"), BBox: [0, 0, 0, 0] });
      obj = doc.addObject({
        Type: doc.newName("Annot"),
        Subtype: doc.newName("Text"),
        Rect: [r[0], r[3] - 20, r[0] + 20, r[3]],
        IRT: irt,
        RT: doc.newName("R"),
        T: doc.newString(reply.author),
        Subj: doc.newString("Reply"),
        Contents: doc.newString(reply.contents),
        NM: doc.newString(reply.id),
        CreationDate: doc.newString(pdfDate(reply.created)),
        M: doc.newString(pdfDate(reply.modified)),
        F: FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE,
        Name: doc.newName("Comment"),
        Open: false,
        AP: { N: ap },
        P: pageObj,
      });
      if (!pageObj.get("Annots").isArray()) pageObj.put("Annots", doc.newArray());
      pageObj.get("Annots").push(obj);
    }
    byId.set(reply.id, obj);
  }
}

/** Creates a /Popup for a note if it has none (Acrobat and other editors expect one). */
export function ensurePopup(ctx: WriteContext, noteObj: mupdf.PDFObject, m: Markup) {
  const { doc, page } = ctx;
  if (noteObj.get("Popup").isDictionary()) return;
  const r = transformRect(m.rect, ctx.toUser);
  const pageObj = page.getObject();
  const popup = doc.addObject({
    Type: doc.newName("Annot"),
    Subtype: doc.newName("Popup"),
    Rect: [r[2] + 10, r[3] - 120, r[2] + 230, r[3]],
    Parent: noteObj,
    Open: false,
    F: FLAG_PRINT | FLAG_NO_ZOOM | FLAG_NO_ROTATE,
  });
  noteObj.put("Popup", popup);
  pageObj.get("Annots").push(popup);
}

/** Removes an annotation plus its popup and every reply/state annotation that points at it. */
export function deleteAnnotationTree(doc: mupdf.PDFDocument, page: mupdf.PDFPage, objNum: number) {
  const pageObj = page.getObject();
  const annots = pageObj.get("Annots");
  if (!annots.isArray()) return;
  const doomed = new Set<number>([objNum]);
  // replies can chain (reply to a reply); iterate until stable
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < annots.length; i++) {
      const a = annots.get(i);
      if (!a.isIndirect()) continue;
      const num = a.asIndirect();
      if (doomed.has(num)) continue;
      const irt = a.get("IRT");
      const parent = a.get("Parent");
      // markups grouped with a deleted one stay (the app regroups them); replies and statuses go with it
      const grouped = a.get("RT").isName() && a.get("RT").asName() === "Group";
      if ((irt.isIndirect() && !grouped && doomed.has(irt.asIndirect())) || (a.get("Subtype").asName() === "Popup" && parent.isIndirect() && doomed.has(parent.asIndirect()))) {
        doomed.add(num);
        grew = true;
      }
    }
  }
  const keep = doc.newArray();
  for (let i = 0; i < annots.length; i++) {
    const a = annots.get(i);
    if (a.isIndirect() && doomed.has(a.asIndirect())) continue;
    keep.push(a);
  }
  pageObj.put("Annots", keep);
}

/**
 * Links grouped markups on the page: each member gets /IRT to the group's first markup and /RT /Group.
 * Markups no longer in a group lose those keys. Runs after every markup on the page is written, so new ones have objects.
 */
export function writeGroups(ctx: WriteContext, markups: Markup[]) {
  const { doc, page } = ctx;
  const annots = page.getObject().get("Annots");
  if (!annots.isArray()) return;
  const byId = new Map<string, mupdf.PDFObject>();
  for (let i = 0; i < annots.length; i++) {
    const a = annots.get(i);
    const nm = a.get("NM");
    if (a.isIndirect() && nm.isString()) byId.set(nm.asString(), a);
  }
  for (const m of markups) {
    const ref = byId.get(m.id);
    if (!ref) continue;
    const obj = ref.resolve();
    const target = m.group && m.group !== m.id ? byId.get(m.group) : undefined;
    if (target) {
      obj.put("IRT", target);
      obj.put("RT", doc.newName("Group"));
    } else if (obj.get("RT").isName() && obj.get("RT").asName() === "Group") {
      obj.delete("IRT");
      obj.delete("RT");
    }
  }
}

export function invertCtm(ctm: Matrix): Matrix {
  return invert(ctm);
}
