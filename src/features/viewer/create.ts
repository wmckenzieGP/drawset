/** Builds new markups from tool input, using the tool's default style. */
import { stampDef, stampSize, textBoxHeight, textPadding } from "../../markup/appearance";
import { bboxOf, normRect, type Pt, type Quad, type Rect } from "../../markup/geometry";
import { KIND_LABELS, newId, nowIso, type Markup, type MarkupKind } from "../../markup/model";
import { applyTemplate } from "../toolchest/chest";
import { defaultStyleFor, useApp, type PageEntry } from "../../state/store";

export function toolStyle(kind: MarkupKind) {
  const s = useApp.getState().tools.defaults[kind];
  return s ? { ...s } : defaultStyleFor(kind);
}

export function baseMarkup(kind: MarkupKind, pageId: string): Markup {
  const now = nowIso();
  const m: Markup = {
    id: newId(),
    pageId,
    kind,
    subtype: "",
    rect: [0, 0, 0, 0],
    points: [],
    inks: [],
    quads: [],
    style: toolStyle(kind),
    contents: "",
    author: useApp.getState().author,
    subject: KIND_LABELS[kind],
    created: now,
    modified: now,
    status: "None",
    locked: false,
    icon: "Comment",
    replies: [],
  };
  // a Tool Chest tool in drawing mode gives the new markup its saved properties
  const chest = useApp.getState().tools.chest;
  return chest && chest.mode === "draw" ? applyTemplate(m, chest.template) : m;
}

export function boxMarkup(kind: MarkupKind, pageId: string, a: Pt, b: Pt): Markup {
  return { ...baseMarkup(kind, pageId), rect: normRect([a[0], a[1], b[0], b[1]]) };
}

export function vertexMarkup(kind: MarkupKind, pageId: string, pts: Pt[]): Markup {
  return { ...baseMarkup(kind, pageId), points: pts, rect: bboxOf(pts) };
}

export function inkMarkup(kind: "pen" | "highlighter", pageId: string, stroke: Pt[]): Markup {
  return { ...baseMarkup(kind, pageId), inks: [stroke], rect: bboxOf(stroke) };
}

export function textMarkup(kind: "highlight" | "underline" | "strikeout", pageId: string, quads: Quad[], text: string): Markup {
  const pts = quads.flatMap((q) => [[q[0], q[1]], [q[6], q[7]]] as Pt[]);
  return { ...baseMarkup(kind, pageId), quads, rect: bboxOf(pts), contents: text };
}

export function textBoxAt(pageId: string, a: Pt, b: Pt | null): Markup {
  const m = baseMarkup("textbox", pageId);
  const w = b ? Math.abs(b[0] - a[0]) : 0;
  const width = w > 10 ? w : 160;
  const h = b && Math.abs(b[1] - a[1]) > 8 ? Math.abs(b[1] - a[1]) : textBoxHeight(m.style.fontFamily, m.style.fontSize, "Ag", width, textPadding(m));
  const x0 = b ? Math.min(a[0], b[0]) : a[0];
  const y0 = b ? Math.min(a[1], b[1]) : a[1];
  return { ...m, rect: [x0, y0, x0 + width, y0 + h] };
}

export function calloutAt(pageId: string, tip: Pt, knee: Pt): Markup {
  const m = baseMarkup("callout", pageId);
  const width = 140;
  const h = textBoxHeight(m.style.fontFamily, m.style.fontSize, "Ag", width, textPadding(m));
  const right = knee[0] >= tip[0];
  const x0 = right ? knee[0] + 12 : knee[0] - 12 - width;
  const rect: Rect = [x0, knee[1] - h / 2, x0 + width, knee[1] + h / 2];
  return { ...m, points: [tip, knee], rect };
}

export function noteAt(pageId: string, p: Pt): Markup {
  return { ...baseMarkup("note", pageId), rect: [p[0], p[1], p[0] + 20, p[1] + 20] };
}

export function stampAt(pageId: string, a: Pt, b: Pt | null): Markup {
  const tools = useApp.getState().tools;
  const image = tools.stampId === "custom" ? tools.pendingImage : null;
  const m = baseMarkup("stamp", pageId);
  let w: number;
  let h: number;
  let stampText: string[] | undefined;
  if (image) {
    const scale = Math.min(1, 200 / Math.max(image.width, image.height));
    w = image.width * scale;
    h = image.height * scale;
  } else {
    const def = stampDef(tools.stampId);
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    stampText = [def.label, `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}  ${useApp.getState().author}`];
    [w, h] = stampSize(stampText);
    m.style = { ...m.style, color: def.color };
  }
  let rect: Rect = [a[0] - w / 2, a[1] - h / 2, a[0] + w / 2, a[1] + h / 2];
  if (b && Math.abs(b[0] - a[0]) > 8 && Math.abs(b[1] - a[1]) > 8) {
    const r = normRect([a[0], a[1], b[0], b[1]]);
    // keep the stamp's proportions inside the dragged box
    const s = Math.min((r[2] - r[0]) / w, (r[3] - r[1]) / h);
    rect = [r[0], r[1], r[0] + w * s, r[1] + h * s];
  }
  return { ...m, rect, stampId: image ? undefined : tools.stampId, stampText, image: image ?? undefined, subject: image ? "Image Stamp" : "Stamp" };
}

export function imageAt(pageId: string, a: Pt, b: Pt | null): Markup | null {
  const image = useApp.getState().tools.pendingImage;
  if (!image) return null;
  const m = baseMarkup("image", pageId);
  const scale = Math.min(1, 300 / Math.max(image.width, image.height));
  let w = image.width * scale;
  let h = image.height * scale;
  let x0 = a[0];
  let y0 = a[1];
  if (b && Math.abs(b[0] - a[0]) > 8 && Math.abs(b[1] - a[1]) > 8) {
    const r = normRect([a[0], a[1], b[0], b[1]]);
    const s = Math.min((r[2] - r[0]) / w, (r[3] - r[1]) / h);
    w *= s;
    h *= s;
    x0 = r[0];
    y0 = r[1];
  }
  return { ...m, rect: [x0, y0, x0 + w, y0 + h], image };
}

/** A measurement on `page` at the page's current scale. */
export function measureAt(kind: MarkupKind, page: PageEntry, pts: Pt[]): Markup {
  return { ...baseMarkup(kind, page.id), points: pts, rect: bboxOf(pts), measure: { scale: page.scale, cutouts: [] } };
}
