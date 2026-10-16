/**
 * MuPDF implementation of the engine operations. Runs in Node (unit tests) and inside the Web Worker.
 * Methods are synchronous; the worker wraps them in messages.
 */
import * as mupdf from "mupdf";
import { concat, displayMatrix, type Matrix, type Pt, type Quad, type Rect, scaleM, transformRect, translateM } from "../../markup/geometry";
import type { Markup } from "../../markup/model";
import type { DocInfo, MarkupRecord, OutlineNode, PageInfo, RenderRequest, SavePlan, SearchHit } from "../types";
import { readPageMarkups } from "./annotRead";
import { deleteAnnotationTree, ensurePopup, invertCtm, PRIVATE_KEY, subtypeFor, writeMarkup, writeStatus, type WriteContext } from "./annotWrite";
import { safePageScale, writePageScale } from "./measureDict";

export interface RawBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

class Lru<K, V extends { destroy?: () => void }> {
  private map = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const [oldK, oldV] = this.map.entries().next().value as [K, V];
      this.map.delete(oldK);
      oldV.destroy?.();
    }
  }
  clear() {
    for (const v of this.map.values()) v.destroy?.();
    this.map.clear();
  }
}

interface OpenDoc {
  doc: mupdf.PDFDocument;
  name: string;
  lists: Lru<number, mupdf.DisplayList>;
  annotLists: Lru<number, mupdf.DisplayList>;
  stext: Lru<number, mupdf.StructuredText>;
}

let nextDoc = 1;

export function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pdf = doc.asPDF();
  if (!pdf) throw new Error("This file is not a PDF.");
  if (pdf.needsPassword()) throw new Error("This PDF is protected with a password. Password-protected files are not supported yet.");
  return pdf;
}

function pageRotate(page: mupdf.PDFPage): number {
  const r = page.getObject().getInheritable("Rotate");
  const v = r.isNumber() ? r.asNumber() : 0;
  return ((Math.round(v / 90) * 90) % 360 + 360) % 360;
}

export function pageInfo(doc: mupdf.PDFDocument, index: number): PageInfo {
  const page = doc.loadPage(index);
  let label: string;
  try {
    label = page.getLabel();
  } catch {
    label = "";
  }
  const scale = safePageScale(page);
  return { index, bounds: page.getBounds() as Rect, rotate: pageRotate(page), label: label || String(index + 1), ctm: page.getTransform() as Matrix, scale };
}

function outlineNodes(doc: mupdf.PDFDocument, items: ReturnType<mupdf.Document["loadOutline"]>): OutlineNode[] {
  if (!items) return [];
  return items.map((it) => {
    let page: number | null = typeof it.page === "number" && it.page >= 0 ? it.page : null;
    if (page === null && it.uri) {
      try {
        const p = doc.resolveLink(it.uri);
        page = p >= 0 ? p : null;
      } catch {
        page = null;
      }
    }
    return { title: it.title ?? "", page, uri: it.uri && !it.uri.startsWith("#") ? it.uri : undefined, children: outlineNodes(doc, it.down ?? null) };
  });
}

/**
 * MuPDF's graftPage leaves /Annots and /VP behind, so markups are copied separately. Back-references to the source
 * page (/P) and links to its other pages would drag the whole source page tree along, so /P is rewritten and
 * page links and form widgets (which need the source's form) are not carried across.
 */
function copyAnnotations(dst: mupdf.PDFDocument, graft: mupdf.PDFGraftMap, src: mupdf.PDFDocument, srcIndex: number, dstIndex: number) {
  const srcPage = src.findPage(srcIndex);
  // page scales (viewports) are not copied by graftPage either
  const vp = srcPage.get("VP");
  if (vp.isArray()) dst.findPage(dstIndex).put("VP", graft.graftObject(vp));
  const annots = srcPage.get("Annots");
  if (!annots.isArray()) return;
  const keep = src.newArray();
  for (let i = 0; i < annots.length; i++) {
    const ref = annots.get(i);
    const a = ref.resolve();
    if (!a.isDictionary()) continue;
    const sub = a.get("Subtype").isName() ? a.get("Subtype").asName() : "";
    if (sub === "Widget") continue;
    if (sub === "Link" && (a.get("Dest").isArray() || (a.get("A").isDictionary() && a.get("A").get("D").isArray()))) continue;
    a.delete("P");
    keep.push(ref);
  }
  const copied = graft.graftObject(keep);
  const page = dst.findPage(dstIndex);
  for (let i = 0; i < copied.length; i++) copied.get(i).resolve().put("P", page);
  page.put("Annots", copied);
}

export class EngineCore {
  private docs = new Map<string, OpenDoc>();

  private get(docId: string): OpenDoc {
    const d = this.docs.get(docId);
    if (!d) throw new Error(`Document ${docId} is not open.`);
    return d;
  }

  pdf(docId: string): mupdf.PDFDocument {
    return this.get(docId).doc;
  }

  open(bytes: Uint8Array, name: string, docId?: string): DocInfo {
    const doc = openPdf(bytes);
    const id = docId ?? `doc${nextDoc++}`;
    const prev = this.docs.get(id);
    if (prev) this.dropCaches(prev);
    this.docs.set(id, { doc, name, lists: new Lru(6), annotLists: new Lru(4), stext: new Lru(12) });
    return this.info(id);
  }

  private dropCaches(d: OpenDoc) {
    d.lists.clear();
    d.annotLists.clear();
    d.stext.clear();
  }

  close(docId: string) {
    const d = this.docs.get(docId);
    if (!d) return;
    this.dropCaches(d);
    d.doc.destroy();
    this.docs.delete(docId);
  }

  info(docId: string): DocInfo {
    const { doc, name } = this.get(docId);
    const n = doc.countPages();
    const pages: PageInfo[] = [];
    for (let i = 0; i < n; i++) pages.push(pageInfo(doc, i));
    let outline: OutlineNode[];
    try {
      outline = outlineNodes(doc, doc.loadOutline());
    } catch {
      outline = [];
    }
    const title = doc.getMetaData("info:Title") || name;
    const acro = doc.getTrailer().get("Root").get("AcroForm");
    return {
      docId,
      pageCount: n,
      pages,
      outline,
      title,
      canSaveIncrementally: doc.canBeSavedIncrementally(),
      hasForm: acro.isDictionary() && acro.get("Fields").isArray() && acro.get("Fields").length > 0,
    };
  }

  private displayList(d: OpenDoc, index: number, annots: boolean): mupdf.DisplayList {
    const cache = annots ? d.annotLists : d.lists;
    let list = cache.get(index);
    if (!list) {
      const page = d.doc.loadPage(index);
      list = new mupdf.DisplayList(page.getBounds());
      const dev = new mupdf.DisplayListDevice(list);
      page.runPageContents(dev, mupdf.Matrix.identity);
      if (annots) page.runPageAnnots(dev, mupdf.Matrix.identity);
      page.runPageWidgets(dev, mupdf.Matrix.identity);
      dev.close();
      dev.destroy();
      cache.set(index, list);
    }
    return list;
  }

  /** Renders a page or a tile of it to RGBA on white. */
  render(req: RenderRequest): RawBitmap {
    const d = this.get(req.docId);
    const list = this.displayList(d, req.page, !!req.annots);
    const bounds = list.getBounds() as Rect;
    const m = displayMatrix(bounds, req.scale, req.rotate);
    const full = transformRect(bounds, m);
    const area: Rect = req.tile
      ? [Math.max(0, Math.floor(req.tile[0])), Math.max(0, Math.floor(req.tile[1])), Math.min(Math.ceil(full[2]), Math.ceil(req.tile[2])), Math.min(Math.ceil(full[3]), Math.ceil(req.tile[3]))]
      : [0, 0, Math.max(1, Math.round(full[2])), Math.max(1, Math.round(full[3]))];
    const w = Math.max(1, area[2] - area[0]);
    const h = Math.max(1, area[3] - area[1]);
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [area[0], area[1], area[0] + w, area[1] + h], true);
    pix.clear(255);
    const dev = new mupdf.DrawDevice(m as mupdf.Matrix, pix);
    list.run(dev, mupdf.Matrix.identity);
    dev.close();
    dev.destroy();
    const data = new Uint8ClampedArray(pix.getPixels());
    pix.destroy();
    return { width: w, height: h, data };
  }

  renderAnnotation(docId: string, pageIndex: number, objNum: number, scale: number): RawBitmap & { rect: Rect } {
    const d = this.get(docId);
    const page = d.doc.loadPage(pageIndex);
    const annot = page.getAnnotations().find((a) => a.getObject().asIndirect() === objNum);
    if (!annot) throw new Error("Annotation not found.");
    const rect = annot.getBounds() as Rect;
    const s = scale;
    const w = Math.max(1, Math.ceil((rect[2] - rect[0]) * s));
    const h = Math.max(1, Math.ceil((rect[3] - rect[1]) * s));
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], true);
    pix.clear(0);
    const dev = new mupdf.DrawDevice(concat(translateM(-rect[0], -rect[1]), scaleM(s)) as mupdf.Matrix, pix);
    annot.run(dev, mupdf.Matrix.identity);
    dev.close();
    dev.destroy();
    const data = new Uint8ClampedArray(pix.getPixels());
    pix.destroy();
    // MuPDF pixmaps are premultiplied; ImageData expects straight alpha
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0 && a < 255) {
        data[i] = Math.min(255, (data[i] * 255) / a);
        data[i + 1] = Math.min(255, (data[i + 1] * 255) / a);
        data[i + 2] = Math.min(255, (data[i + 2] * 255) / a);
      }
    }
    return { width: w, height: h, data, rect };
  }

  readMarkups(docId: string, pages?: number[]): MarkupRecord[] {
    const { doc } = this.get(docId);
    const list = pages ?? [...Array(doc.countPages()).keys()];
    const out: MarkupRecord[] = [];
    for (const i of list) out.push(...readPageMarkups(doc.loadPage(i), i));
    return out;
  }

  private stextFor(d: OpenDoc, index: number): mupdf.StructuredText {
    let st = d.stext.get(index);
    if (!st) {
      st = d.doc.loadPage(index).toStructuredText("preserve-whitespace");
      d.stext.set(index, st);
    }
    return st;
  }

  search(docId: string, needle: string, fromPage: number, toPage: number): SearchHit[] {
    const d = this.get(docId);
    const hits: SearchHit[] = [];
    const n = d.doc.countPages();
    if (!needle.trim()) return hits;
    for (let i = Math.max(0, fromPage); i <= Math.min(n - 1, toPage); i++) {
      const res = this.stextFor(d, i).search(needle, undefined);
      for (const quads of res) hits.push({ page: i, quads: quads as Quad[] });
    }
    return hits;
  }

  selectText(docId: string, pageIndex: number, a: Pt, b: Pt): { quads: Quad[]; text: string } {
    const d = this.get(docId);
    const st = this.stextFor(d, pageIndex);
    const quads = st.highlight(a, b, 2000) as Quad[];
    const text = quads.length ? st.copy(a, b) : "";
    return { quads, text };
  }

  importPages(docId: string, bytes: Uint8Array, pages?: number[]): { pages: PageInfo[]; markups: MarkupRecord[] } {
    const d = this.get(docId);
    const src = openPdf(bytes);
    const list = pages ?? [...Array(src.countPages()).keys()];
    const graft = d.doc.newGraftMap();
    const start = d.doc.countPages();
    for (const p of list) {
      graft.graftPage(-1, src, p);
      copyAnnotations(d.doc, graft, src, p, d.doc.countPages() - 1);
    }
    const infos: PageInfo[] = [];
    const markups: MarkupRecord[] = [];
    for (let i = start; i < d.doc.countPages(); i++) {
      infos.push(pageInfo(d.doc, i));
      markups.push(...readPageMarkups(d.doc.loadPage(i), i));
    }
    src.destroy();
    return { pages: infos, markups };
  }

  addBlankPage(docId: string, width: number, height: number): PageInfo {
    const d = this.get(docId);
    const obj = d.doc.addPage([0, 0, width, height], 0, {}, "");
    d.doc.insertPage(-1, obj);
    return pageInfo(d.doc, d.doc.countPages() - 1);
  }

  /** Applies a save plan to `doc` (markups, deletions, rotation, page order, optional flatten). */
  static applyPlan(doc: mupdf.PDFDocument, plan: SavePlan) {
    const byPage = new Map<number, { markup: Markup }[]>();
    for (const u of plan.upserts) {
      const list = byPage.get(u.page) ?? [];
      list.push({ markup: u.markup });
      byPage.set(u.page, list);
    }
    const deletes = new Set(plan.deletes);
    const pageCount = doc.countPages();
    // deletions first (search every page; deleted markups may belong to deleted pages too)
    if (deletes.size) {
      for (let i = 0; i < pageCount; i++) {
        const page = doc.loadPage(i);
        const annots = page.getObject().get("Annots");
        if (!annots.isArray()) continue;
        for (let k = 0; k < annots.length; k++) {
          const a = annots.get(k);
          if (a.isIndirect() && deletes.has(a.asIndirect())) deleteAnnotationTree(doc, page, a.asIndirect());
        }
      }
    }
    for (const [pageIndex, items] of byPage) {
      if (pageIndex < 0 || pageIndex >= pageCount) continue;
      const page = doc.loadPage(pageIndex);
      const ctx: WriteContext = { doc, page, toUser: invertCtm(page.getTransform() as Matrix), defaultAuthor: plan.defaultAuthor };
      const existing = new Map<number, mupdf.PDFAnnotation>();
      for (const a of page.getAnnotations()) existing.set(a.getObject().asIndirect(), a);
      for (const { markup } of items) {
        let annot = markup.objNum !== undefined ? existing.get(markup.objNum) : undefined;
        if (annot && annot.getType() !== subtypeFor(markup) && markup.kind !== "foreign") {
          // subtype changed (e.g. text box ↔ note never happens, but be safe): replace
          deleteAnnotationTree(doc, page, markup.objNum!);
          annot = undefined;
        }
        if (!annot) {
          if (markup.kind === "foreign") continue;
          annot = page.createAnnotation(subtypeFor(markup));
        }
        writeMarkup(ctx, annot, markup);
        const obj = annot.getObject();
        if (markup.kind === "note") ensurePopup(ctx, obj, markup);
        if (markup.kind !== "foreign") writeStatus(ctx, obj, markup);
      }
    }
    if (plan.applyRedactions) EngineCore.applyRedactions(doc);
    // page scales (before rotation, so the viewport box matches the page as it is now)
    for (const p of plan.pages) {
      if (p.scale === undefined || p.index < 0 || p.index >= pageCount) continue;
      writePageScale(doc, doc.loadPage(p.index), p.scale);
    }
    // rotation
    for (const p of plan.pages) {
      if (p.index < 0 || p.index >= pageCount) continue;
      const pageObj = doc.findPage(p.index);
      const cur = pageObj.getInheritable("Rotate");
      const curV = cur.isNumber() ? (((cur.asNumber() % 360) + 360) % 360) : 0;
      if (curV !== p.rotate) pageObj.put("Rotate", doc.newInteger(p.rotate));
    }
    if (plan.flatten) doc.bake(true, false);
    // page order (also drops pages not listed)
    const order = plan.pages.map((p) => p.index);
    const identity = order.length === pageCount && order.every((v, i) => v === i);
    if (!identity) doc.rearrangePages(order);
  }

  /**
   * Applies every /Redact annotation: text under it is removed, image pixels are cleared, and line art
   * entirely inside it is removed. Redactions get a black box; Drawset's erase areas leave the page blank.
   */
  static applyRedactions(doc: mupdf.PDFDocument) {
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      for (const a of page.getAnnotations()) {
        if (a.getType() !== "Redact") continue;
        const priv = a.getObject().get(PRIVATE_KEY);
        const erase = priv.isString() && priv.asString().includes('"kind":"erase"');
        a.applyRedaction(erase ? 0 : 1, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      }
    }
  }

  save(docId: string, plan: SavePlan, mode: "incremental" | "full"): { bytes: Uint8Array; info: DocInfo; markups: MarkupRecord[] } {
    const d = this.get(docId);
    EngineCore.applyPlan(d.doc, plan);
    // after redaction the removed content must not survive in an earlier revision of the file
    const incremental = mode === "incremental" && !plan.applyRedactions && d.doc.canBeSavedIncrementally();
    const bytes = d.doc.saveToBuffer(incremental ? "incremental" : "compress,garbage=compact").asUint8Array().slice();
    const info = this.open(bytes, d.name, docId);
    return { bytes, info, markups: this.readMarkups(docId) };
  }

  saveCopy(docId: string, plan: SavePlan): Uint8Array {
    const d = this.get(docId);
    // work on a copy so the open document keeps its unsaved state
    const tmp = openPdf(d.doc.saveToBuffer("").asUint8Array().slice());
    EngineCore.applyPlan(tmp, plan);
    const bytes = tmp.saveToBuffer("compress,garbage=compact").asUint8Array().slice();
    tmp.destroy();
    return bytes;
  }
}
