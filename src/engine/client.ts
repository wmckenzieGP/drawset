/** Main-thread proxy for the engine worker. All PDF work happens off the UI thread. */
import type { Bitmap, DocInfo, MarkupRecord, PageInfo, PdfEngine, RenderRequest, SavePlan, SaveResult, SearchHit, ImagePdfPage, SnapGeometry, FormField } from "./types";
import type { Pt, Quad, Rect } from "../markup/geometry";

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class WorkerEngine implements PdfEngine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let markReady: () => void = () => {};
    this.ready = new Promise((r) => (markReady = r));
    this.worker.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.ready) return markReady();
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "Engine worker failed"));
      this.pending.clear();
    };
  }

  /** Messages sent before the worker's module (and MuPDF's WebAssembly) has loaded would be lost, so wait for "ready". */
  private async call<T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
    await this.ready;
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args }, transfer);
    });
  }

  open(bytes: Uint8Array, name: string) {
    return this.call<DocInfo>("open", [bytes, name], [bytes.buffer as ArrayBuffer]);
  }
  close(docId: string) {
    return this.call<void>("close", [docId]);
  }
  render(req: RenderRequest) {
    return this.call<Bitmap>("render", [req]);
  }
  renderAnnotation(docId: string, page: number, objNum: number, scale: number) {
    return this.call<Bitmap & { rect: Rect }>("renderAnnotation", [docId, page, objNum, scale]);
  }
  readMarkups(docId: string, pages?: number[]) {
    return this.call<MarkupRecord[]>("readMarkups", [docId, pages]);
  }
  search(docId: string, needle: string, fromPage: number, toPage: number) {
    return this.call<SearchHit[]>("search", [docId, needle, fromPage, toPage]);
  }
  selectText(docId: string, page: number, a: Pt, b: Pt) {
    return this.call<{ quads: Quad[]; text: string }>("selectText", [docId, page, a, b]);
  }
  importPages(docId: string, bytes: Uint8Array, pages?: number[]) {
    return this.call<{ pages: PageInfo[]; markups: MarkupRecord[] }>("importPages", [docId, bytes, pages], [bytes.buffer as ArrayBuffer]);
  }
  addBlankPage(docId: string, width: number, height: number) {
    return this.call<PageInfo>("addBlankPage", [docId, width, height]);
  }
  save(docId: string, plan: SavePlan, mode: "incremental" | "full") {
    return this.call<SaveResult>("save", [docId, plan, mode]);
  }
  saveCopy(docId: string, plan: SavePlan) {
    return this.call<Uint8Array>("saveCopy", [docId, plan]);
  }
  formFields(docId: string) {
    return this.call<FormField[]>("formFields", [docId]);
  }
  setFieldValues(docId: string, values: Record<string, string>) {
    return this.call<number[]>("setFieldValues", [docId, values]);
  }
  textInRect(docId: string, pages: number[], rect: Rect) {
    return this.call<string[]>("textInRect", [docId, pages, rect]);
  }
  snapGeometry(docId: string, page: number) {
    return this.call<SnapGeometry>("snapGeometry", [docId, page]);
  }
  imagePdf(pages: ImagePdfPage[], title: string) {
    return this.call<Uint8Array>("imagePdf", [pages, title], pages.map((p) => p.data.buffer as ArrayBuffer));
  }
}

let instance: PdfEngine | null = null;
export function engine(): PdfEngine {
  if (!instance) instance = new WorkerEngine();
  return instance;
}

/** Replaces the engine (tests run the same core in-process). */
export function setEngine(e: PdfEngine) {
  instance = e;
}
