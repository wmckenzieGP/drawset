/** Turns appearance ops (page space) into a PDF content stream in PDF user space. */
import { type Matrix, type Rect, transformRect } from "./geometry";
import type { Appearance, DrawOp, TextFont } from "./appearance";

export const FONT_RESOURCE: Record<TextFont, { name: string; base: string }> = {
  Helvetica: { name: "Helv", base: "Helvetica" },
  "Helvetica-Bold": { name: "HeBo", base: "Helvetica-Bold" },
  "Times-Roman": { name: "TiRo", base: "Times-Roman" },
  Courier: { name: "Cour", base: "Courier" },
};

const n = (v: number) => {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

// WinAnsiEncoding for the code points 0x80–0x9F that differ from Latin-1
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89,
  0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
};

/** A PDF literal string in WinAnsi encoding; characters outside WinAnsi become '?'. */
export function winAnsiLiteral(s: string): string {
  let out = "(";
  for (const ch of s) {
    let c = ch.codePointAt(0) ?? 63;
    if (WIN_ANSI_EXTRA[c] !== undefined) c = WIN_ANSI_EXTRA[c];
    else if (c > 255 || (c >= 0x80 && c < 0xa0)) c = 63;
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += String.fromCharCode(c);
  }
  return out + ")";
}

export interface PdfAppearance {
  content: string;
  /** BBox in user space. */
  bbox: Rect;
  fonts: TextFont[];
  /** True when the content uses /GS0 (opacity or blend). */
  usesGState: boolean;
  /** True when text is drawn under /GS1, whose fill opacity is the line opacity (the fill's own opacity differs). */
  usesTextGState: boolean;
  /** Image XObject /Im0 is referenced. */
  usesImage: boolean;
}

function colourOp(c: [number, number, number], stroke: boolean) {
  return `${n(c[0])} ${n(c[1])} ${n(c[2])} ${stroke ? "RG" : "rg"}`;
}

function opContent(op: DrawOp, fonts: Set<TextFont>, textGState: boolean): string {
  if (op.t === "path") {
    if (!op.fill && !op.stroke) return "";
    const parts: string[] = [];
    if (op.stroke) {
      parts.push(colourOp(op.stroke, true), `${n(op.width)} w`, `${op.cap ?? 0} J`, `${op.join ?? 0} j`);
      parts.push(op.dash && op.dash.length ? `[${op.dash.map(n).join(" ")}] 0 d` : "[] 0 d");
    }
    if (op.fill) parts.push(colourOp(op.fill, false));
    for (const s of op.segs) {
      if (s[0] === "M") parts.push(`${n(s[1])} ${n(s[2])} m`);
      else if (s[0] === "L") parts.push(`${n(s[1])} ${n(s[2])} l`);
      else if (s[0] === "C") parts.push(`${n(s[1])} ${n(s[2])} ${n(s[3])} ${n(s[4])} ${n(s[5])} ${n(s[6])} c`);
      else parts.push("h");
    }
    const paint = op.fill && op.stroke ? (op.evenOdd ? "B*" : "B") : op.fill ? (op.evenOdd ? "f*" : "f") : "S";
    parts.push(paint);
    return parts.join("\n");
  }
  if (op.t === "text") {
    fonts.add(op.font);
    const res = FONT_RESOURCE[op.font].name;
    const lines = op.lines
      .filter((l) => l.s.length > 0)
      .map((l) => `1 0 0 -1 ${n(l.x)} ${n(l.y)} Tm ${winAnsiLiteral(l.s)} Tj`);
    if (lines.length === 0) return "";
    const text = `BT\n${colourOp(op.color, false)}\n/${res} ${n(op.size)} Tf\n${lines.join("\n")}\nET`;
    // text is painted with the fill opacity, so when the fill has its own, text takes the line opacity back
    return textGState ? `q /GS1 gs\n${text}\nQ` : text;
  }
  // image: unit square mapped to rect, flipped because page space is y-down
  const r = op.rect;
  return `q ${n(r[2] - r[0])} 0 0 ${n(-(r[3] - r[1]))} ${n(r[0])} ${n(r[3])} cm /Im0 Do Q`;
}

/**
 * @param pageToUser inverse of the page transform (page space → PDF user space)
 */
export function appearanceToPdf(ap: Appearance, pageToUser: Matrix): PdfAppearance {
  const fonts = new Set<TextFont>();
  const textGState = ap.fillOpacity !== ap.opacity;
  const body = ap.ops.map((op) => opContent(op, fonts, textGState)).filter(Boolean);
  const usesGState = ap.opacity < 1 || ap.fillOpacity < 1 || ap.blend !== "Normal";
  const usesTextGState = body.some((b) => b.startsWith("q /GS1 gs"));
  const usesImage = ap.ops.some((o) => o.t === "image");
  const m = pageToUser;
  const content = [
    "q",
    usesGState ? "/GS0 gs" : "",
    `${n(m[0])} ${n(m[1])} ${n(m[2])} ${n(m[3])} ${n(m[4])} ${n(m[5])} cm`,
    ...body,
    "Q",
  ]
    .filter(Boolean)
    .join("\n");
  return { content, bbox: transformRect(ap.bbox, pageToUser), fonts: [...fonts], usesGState, usesTextGState, usesImage };
}
