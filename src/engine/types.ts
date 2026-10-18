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
  security: DocSecurity;
  /** Drawset header and footer settings saved in the file (JSON), or null. */
  headerFooter: string | null;
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
  /** Drawing order (back to front, by markup id) for physical pages whose markups were rearranged. */
  order?: Record<number, string[]>;
  /** Burn markups into page content (permanent). */
  flatten?: boolean;
  /** Form field values by field name (already applied to the open document; repeated for copies). */
  fieldValues?: Record<string, string>;
  /** New passwords and permissions ("none" removes security); forces a full save. */
  security?: SecuritySpec | "none";
  /** Burn form fields into the page content (permanent). */
  flattenForms?: boolean;
  /** Page labels for the saved pages, in plan order; omitted when unchanged. */
  pageLabels?: string[];
  /** Replacement document outline (pages are physical indices); omitted when unchanged. */
  outline?: OutlineNode[];
  /** Apply every redaction and erase (removes content; forces a full rewrite so no old revision keeps it). */
  applyRedactions?: boolean;
  defaultAuthor: string;
}

export interface SaveResult {
  bytes: Uint8Array;
  info: DocInfo;
  markups: MarkupRecord[];
}

export interface Permissions {
  print: boolean;
  copy: boolean;
  /** Changing the document (content, pages). */
  edit: boolean;
  /** Adding and changing comments and markups. */
  annotate: boolean;
  /** Filling in form fields. */
  form: boolean;
  /** Inserting, deleting and rotating pages. */
  assemble: boolean;
}

export interface DocSecurity {
  encrypted: boolean;
  /** Encryption as MuPDF describes it, e.g. "Standard V5 R6 256-bit AES". */
  method: string;
  /** The file needs a password to open. */
  openPassword: boolean;
  /** Full rights: no restrictions, or the permissions password was given. */
  owner: boolean;
  permissions: Permissions;
}

/** New security to write on save (AES-256). Empty user password: anyone can open it. */
export interface SecuritySpec {
  userPassword: string;
  ownerPassword: string;
  permissions: Permissions;
}

export type HFPosition = "tl" | "tc" | "tr" | "bl" | "bc" | "br";

/** One page's headers, footers and watermark, with variables already filled in. */
export interface Decoration {
  /** Rotation the page will be shown at (the file's plus any page rotation not yet saved). */
  rotate: number;
  items: { pos: HFPosition; text: string }[];
  fontSize: number;
  colour: [number, number, number];
  /** Distance from the page edge, points. */
  margin: number;
  /** fontSize 0 fits the text across the page. */
  watermark: { text: string; fontSize: number; colour: [number, number, number]; opacity: number; angle: number } | null;
}

export type FormFieldType = "text" | "checkbox" | "radio" | "choice" | "button" | "signature";

/** A form field (all widgets sharing one fully qualified name). */
export interface FormField {
  name: string;
  type: FormFieldType;
  /** Text, chosen option, or the on-state name ("Off" when unchecked). */
  value: string;
  options: string[];
  /** On-state names of check boxes and radio buttons. */
  onValues: string[];
  multiline: boolean;
  readOnly: boolean;
  maxLen: number;
  /** Where the field appears: physical page index, page-space rectangle and (buttons) the widget's on-state. */
  widgets: { page: number; rect: Rect; on?: string }[];
}

/** A page's vector geometry for snapping, in page space. */
export interface SnapGeometry {
  /** Straight segments, x0 y0 x1 y1 each. */
  segments: Float64Array;
  /** Path start points and curve end points, x y each (segment ends are in `segments`). */
  points: Float64Array;
  /** True when the page had more geometry than is collected. */
  truncated: boolean;
}

/** One page of an image-only PDF: RGBA pixels shown at pageWidth × pageHeight points, under a caption band. */
export interface ImagePdfPage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  pageWidth: number;
  pageHeight: number;
  /** One or two lines printed above the image (the first says the page is image-based). */
  caption: string[];
}

/** A page rendered for recognition: a greyscale PNG and the matrix from its pixels to PDF user space. */
export interface OcrImage {
  png: Uint8Array;
  width: number;
  height: number;
  matrix: Matrix;
}

/** One recognised word, in image pixels (y down). */
export interface OcrWord {
  text: string;
  bbox: Rect;
  baseline: number;
}

/** A page's recognised text: words in image pixels, and the matrix from those pixels to PDF user space. */
export interface OcrPage {
  matrix: Matrix;
  words: OcrWord[];
}

export interface PdfEngine {
  open(bytes: Uint8Array, name: string, password?: string, keepBytes?: boolean): Promise<DocInfo>;
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
  /** Replaces Drawset's headers, footers and watermark on pages (physical index; null removes); returns pages changed. */
  setDecorations(docId: string, pages: Record<number, Decoration | null>, spec: string | null): Promise<number[]>;
  /** A page's content (no markups) as a greyscale image for text recognition. */
  ocrImage(docId: string, page: number, dpi: number, maxPx: number): Promise<OcrImage>;
  /** How many characters of text each page already has. */
  textCounts(docId: string, pages: number[]): Promise<number[]>;
  /** Replaces the invisible recognised-text layer on pages (physical index; null restores the page as opened); returns pages changed. */
  setOcrLayer(docId: string, pages: Record<number, OcrPage | null>): Promise<number[]>;
  /** Gives full rights with the permissions password; throws WRONG_PASSWORD. */
  unlock(docId: string, password: string): Promise<DocInfo>;
  /** The document's form fields. */
  formFields(docId: string): Promise<FormField[]>;
  /** Fills fields in the open document (by name); returns the physical pages that changed. */
  setFieldValues(docId: string, values: Record<string, string>): Promise<number[]>;
  /** Text inside `rect` (page space) on each of `pages`, for labelling pages from a title-block region. */
  textInRect(docId: string, pages: number[], rect: Rect): Promise<string[]>;
  /** Vector geometry of a page's content (markups excluded) for snapping. */
  snapGeometry(docId: string, page: number): Promise<SnapGeometry>;
  /** A new PDF made of images (overlay export). */
  imagePdf(pages: ImagePdfPage[], title: string): Promise<Uint8Array>;
}
