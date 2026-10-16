/**
 * The PdfEngine interface: everything the app asks of the PDF engine. MuPDF implements it in a worker;
 * nothing outside src/engine imports mupdf.
 */
import type { Matrix, Pt, Quad, Rect } from "../markup/geometry";
import type { Markup } from "../markup/model";
import type { PageScale } from "../markup/measure";

export interface PageInfo {
  /** Physical index in the engine document. */
  index: number;
  /** Page bounds in page space (MuPDF coordinates, /Rotate applied). */
  bounds: Rect;
  /** /Rotate of the page. */
  rotate: number;
  label: string;
  /** PDF user space → page space. */
  ctm: Matrix;
  /** Calibrated scale from the page's viewports, if any. */
  scale: PageScale | null;
}

export interface OutlineNode {
  title: string;
  page: number | null;
  uri?: string;
  children: OutlineNode[];
}

export interface DocInfo {
  docId: string;
  pageCount: number;
  pages: PageInfo[];
  outline: OutlineNode[];
  title: string;
  canSaveIncrementally: boolean;
  hasForm: boolean;
}

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, row-major. In the browser the worker returns an ImageBitmap instead. */
  data?: Uint8ClampedArray;
  image?: ImageBitmap;
}

export interface RenderRequest {
  docId: string;
  page: number;
  /** Device pixels per point. */
  scale: number;
  /** Extra rotation for display, degrees clockwise (0/90/180/270). */
  rotate: number;
  /** Optional device-space clip [x0, y0, x1, y1]; whole page when omitted. */
  tile?: Rect;
  /** Include annotations (for pdf-like output); the viewer leaves them out and draws markups itself. */
  annots?: boolean;
}

/** A markup as read from a file: pageIndex instead of pageId. */
export type MarkupRecord = Omit<Markup, "pageId"> & { pageIndex: number };

export interface SearchHit {
  page: number;
  quads: Quad[];
}

export interface SavePagePlan {
  /** Physical page index in the engine document. */
  index: number;
  /** Absolute /Rotate to write. */
  rotate: number;
  /** New page scale (null removes it); omitted when unchanged. */
  scale?: PageScale | null;
}

export interface SavePlan {
  pages: SavePagePlan[];
  /** New or changed markups, with the physical page they belong to. */
  upserts: { markup: Markup; page: number }[];
  /** Object numbers of markups that were deleted. */
  deletes: number[];
  /** Burn markups into page content (permanent). */
  flatten?: boolean;
  defaultAuthor: string;
}

export interface SaveResult {
  bytes: Uint8Array;
  info: DocInfo;
  markups: MarkupRecord[];
}

export interface PdfEngine {
  open(bytes: Uint8Array, name: string): Promise<DocInfo>;
  close(docId: string): Promise<void>;
  render(req: RenderRequest): Promise<Bitmap>;
  /** Appearance of one annotation (for annotations Drawset draws from their own /AP). */
  renderAnnotation(docId: string, page: number, objNum: number, scale: number): Promise<Bitmap & { rect: Rect }>;
  readMarkups(docId: string, pages?: number[]): Promise<MarkupRecord[]>;
  search(docId: string, needle: string, fromPage: number, toPage: number): Promise<SearchHit[]>;
  selectText(docId: string, page: number, a: Pt, b: Pt): Promise<{ quads: Quad[]; text: string }>;
  /** Grafts pages from another file (bytes) into the document; returns the new physical page infos and their markups. */
  importPages(docId: string, bytes: Uint8Array, pages?: number[]): Promise<{ pages: PageInfo[]; markups: MarkupRecord[] }>;
  /** Appends a blank page physically; returns its info. */
  addBlankPage(docId: string, width: number, height: number): Promise<PageInfo>;
  /** Writes the plan into the document, saves (incremental when possible) and reopens from the saved bytes. */
  save(docId: string, plan: SavePlan, mode: "incremental" | "full"): Promise<SaveResult>;
  /** Writes the plan into a copy and returns its bytes; the open document is unchanged. */
  saveCopy(docId: string, plan: SavePlan): Promise<Uint8Array>;
}
