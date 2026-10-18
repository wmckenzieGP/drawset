import type { Pt, Quad, Rect } from "./geometry";
import type { PageScale } from "./measure";

/**
 * A markup as Drawset edits it. Coordinates are in page space: MuPDF's page coordinates for the page as
 * loaded (origin top-left, y down, points, /Rotate applied). Markups are immutable: every edit produces a
 * new object, which is how saving finds what changed (identity against the last saved baseline).
 */
export type MarkupKind =
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "polyline"
  | "polygon"
  | "cloud"
  | "pen"
  | "highlighter"
  | "textbox"
  | "callout"
  | "note"
  | "highlight"
  | "underline"
  | "strikeout"
  | "stamp"
  | "image"
  | "signature"
  | "length"
  | "polylength"
  | "area"
  | "perimeter"
  | "count"
  | "angle"
  | "arc"
  | "dimension"
  | "volume"
  | "radius"
  | "diameter"
  | "redact"
  | "erase"
  | "link"
  | "foreign";

export type RGB = [number, number, number];
export type LineEnd = "None" | "OpenArrow" | "ClosedArrow" | "Circle" | "Square" | "Diamond" | "Butt" | "Slash" | "ROpenArrow" | "RClosedArrow";
export const LINE_ENDS: LineEnd[] = ["None", "OpenArrow", "ClosedArrow", "Circle", "Square", "Diamond", "Butt", "Slash", "ROpenArrow", "RClosedArrow"];
export type ReviewStatus = "None" | "Accepted" | "Rejected" | "Completed" | "Cancelled";
export const STATUSES: ReviewStatus[] = ["None", "Accepted", "Rejected", "Completed"];
export type FontFamily = "Helvetica" | "Times-Roman" | "Courier";
export const FONT_FAMILIES: FontFamily[] = ["Helvetica", "Times-Roman", "Courier"];

export interface MarkupStyle {
  /** Stroke / text-markup colour; null means no stroke. */
  color: RGB | null;
  /** Interior fill; null means no fill. */
  fill: RGB | null;
  /** 0–1, written as /CA. */
  opacity: number;
  /** Line width in points. */
  width: number;
  /** Dash pattern in points, null for solid. */
  dash: number[] | null;
  lineStart: LineEnd;
  lineEnd: LineEnd;
  /** Cloud bump intensity (/BE /I), 0–2. */
  cloudIntensity: number;
  fontFamily: FontFamily;
  fontSize: number;
  textColor: RGB;
  /** 0 left, 1 centre, 2 right. */
  align: 0 | 1 | 2;
}

export interface Reply {
  id: string;
  /** Id of the reply this one answers; absent when it answers the markup itself. */
  inReplyTo?: string;
  author: string;
  contents: string;
  created: string;
  modified: string;
  objNum?: number;
}

export interface MarkupImage {
  /** PNG or JPEG bytes. */
  data: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export interface Markup {
  /** Unique id, written as /NM. */
  id: string;
  pageId: string;
  kind: MarkupKind;
  /** PDF /Subtype; for foreign annotations the original subtype. */
  subtype: string;
  /** Frame for box-like kinds (rectangle, ellipse, text box, note, stamp, image); bounding box otherwise. */
  rect: Rect;
  /** Vertices: line/arrow (2 points), polyline, polygon, cloud; callout leader [tip, knee?, box anchor]. */
  points: Pt[];
  /** Ink strokes for pen and highlighter. */
  inks: Pt[][];
  /** Text-markup quads (MuPDF order: upper-left, upper-right, lower-left, lower-right). */
  quads: Quad[];
  style: MarkupStyle;
  /** /Contents: the comment, or the text of a text box / callout. */
  contents: string;
  author: string;
  subject: string;
  /** ISO 8601 timestamps. */
  created: string;
  modified: string;
  status: ReviewStatus;
  locked: boolean;
  /** Note icon (/Name). */
  icon: string;
  /** Built-in stamp id (vector) when kind is stamp. */
  stampId?: string;
  /** Stamp text lines for built-in stamps. */
  stampText?: string[];
  image?: MarkupImage;
  /** A signature's line under the picture: the signer's name and the date signed. */
  caption?: string;
  /** Keep the annotation's existing appearance stream; geometry edits only move/scale /Rect. */
  keepAppearance?: boolean;
  /** For copies of kept appearances: object number of the annotation whose /AP is reused. */
  apFrom?: number;
  /** PDF object number once the markup exists in the file. */
  objNum?: number;
  replies: Reply[];
  /** Hidden from view (/F Hidden) — kept and preserved but not drawn. */
  hidden?: boolean;
  /** Measurements: the scale they are measured at (the page's) and area cutouts. */
  measure?: MeasureData;
  /** Hyperlink target (link kind). */
  link?: LinkTarget;
  /** Grouped markups: the id of the group's first markup (written as /IRT to it with /RT /Group). Absent on that first markup itself. */
  group?: string;
}

/** Where a link goes. Pages are physical page indices in the open document (0-based). */
export type LinkTarget = { type: "page"; page: number } | { type: "url"; url: string } | { type: "file"; path: string; page?: number };

export interface MeasureData {
  scale: PageScale | null;
  /** Holes subtracted from an area, page space. */
  cutouts: Pt[][];
  /** Volume: depth in metres. */
  depth?: number;
}

export const DEFAULT_STYLE: MarkupStyle = {
  color: [0.9, 0.1, 0.1],
  fill: null,
  opacity: 1,
  width: 1.5,
  dash: null,
  lineStart: "None",
  lineEnd: "None",
  cloudIntensity: 1,
  fontFamily: "Helvetica",
  fontSize: 12,
  textColor: [0.9, 0.1, 0.1],
  align: 0,
};

export const KIND_LABELS: Record<MarkupKind, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  polyline: "Polyline",
  polygon: "Polygon",
  cloud: "Cloud",
  pen: "Pen",
  highlighter: "Highlighter",
  textbox: "Text Box",
  callout: "Callout",
  note: "Note",
  highlight: "Text Highlight",
  underline: "Underline",
  strikeout: "Strikethrough",
  stamp: "Stamp",
  image: "Image",
  signature: "Signature",
  length: "Length",
  polylength: "Polylength",
  area: "Area",
  perimeter: "Perimeter",
  count: "Count",
  angle: "Angle",
  redact: "Redaction",
  erase: "Erase",
  arc: "Arc",
  dimension: "Dimension",
  volume: "Volume",
  radius: "Radius",
  diameter: "Diameter",
  link: "Link",
  foreign: "Annotation",
};

/** Which kinds use the frame rect as their primary geometry. */
export const BOX_KINDS: ReadonlySet<MarkupKind> = new Set(["rectangle", "ellipse", "textbox", "note", "stamp", "image", "signature", "foreign", "redact", "erase", "link"]);
export const VERTEX_KINDS: ReadonlySet<MarkupKind> = new Set(["line", "arrow", "polyline", "polygon", "cloud", "length", "polylength", "area", "perimeter", "count", "angle", "arc", "dimension", "volume", "radius", "diameter"]);
export const TEXT_MARKUP_KINDS: ReadonlySet<MarkupKind> = new Set(["highlight", "underline", "strikeout"]);

let idCounter = 0;
/** Unique /NM: time + random + counter. */
export function newId(): string {
  idCounter = (idCounter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 2176782336).toString(36).padStart(6, "0");
  return `drawset-${Date.now().toString(36)}-${rand}-${idCounter.toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function colourHex(c: RGB | null): string {
  if (!c) return "";
  return "#" + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function hexColour(hex: string): RGB {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** DD/MM/YYYY HH:MM in local time. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
