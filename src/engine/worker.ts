/// <reference lib="webworker" />
/** Web Worker hosting the MuPDF engine. Messages: { id, method, args } → { id, result } | { id, error }. */
import { EngineCore, type RawBitmap } from "./core/engineCore";

const core = new EngineCore();

type Handler = (...args: any[]) => unknown;
const methods: Record<string, Handler> = {
  open: (bytes: Uint8Array, name: string, password?: string) => core.open(bytes, name, undefined, password),
  unlock: (docId: string, password: string) => core.unlock(docId, password),
  close: (docId: string) => core.close(docId),
  render: (req) => core.render(req),
  renderAnnotation: (docId: string, page: number, objNum: number, scale: number) => core.renderAnnotation(docId, page, objNum, scale),
  readMarkups: (docId: string, pages?: number[]) => core.readMarkups(docId, pages),
  search: (docId: string, needle: string, from: number, to: number) => core.search(docId, needle, from, to),
  selectText: (docId: string, page: number, a, b) => core.selectText(docId, page, a, b),
  importPages: (docId: string, bytes: Uint8Array, pages?: number[]) => core.importPages(docId, bytes, pages),
  addBlankPage: (docId: string, w: number, h: number) => core.addBlankPage(docId, w, h),
  save: (docId: string, plan, mode) => core.save(docId, plan, mode),
  saveCopy: (docId: string, plan) => core.saveCopy(docId, plan),
  imagePdf: (pages, title: string) => core.imagePdf(pages, title),
  snapGeometry: (docId: string, page: number) => core.snapGeometry(docId, page),
  setDecorations: (docId: string, pages, spec) => core.setDecorations(docId, pages, spec),
  formFields: (docId: string) => core.formFields(docId),
  setFieldValues: (docId: string, values) => core.setFieldValues(docId, values),
  textInRect: (docId: string, pages: number[], rect) => core.textInRect(docId, pages, rect),
};

function isBitmap(v: unknown): v is RawBitmap {
  return !!v && typeof v === "object" && (v as RawBitmap).data instanceof Uint8ClampedArray && typeof (v as RawBitmap).width === "number";
}

self.onmessage = async (ev: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = ev.data;
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`Unknown engine method ${method}`);
    let result = fn(...args);
    const transfer: Transferable[] = [];
    if (isBitmap(result)) {
      const { data, width, height, ...rest } = result;
      const image = await createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height));
      transfer.push(image);
      result = { ...rest, width, height, image };
    } else if (result && typeof result === "object" && (result as { bytes?: unknown }).bytes instanceof Uint8Array) {
      transfer.push(((result as { bytes: Uint8Array }).bytes).buffer as ArrayBuffer);
    } else if (result && typeof result === "object" && (result as { segments?: unknown }).segments instanceof Float64Array) {
      const g = result as { segments: Float64Array; points: Float64Array };
      transfer.push(g.segments.buffer as ArrayBuffer, g.points.buffer as ArrayBuffer);
    } else if (result instanceof Uint8Array) {
      transfer.push(result.buffer as ArrayBuffer);
    }
    (self as unknown as Worker).postMessage({ id, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
(self as unknown as Worker).postMessage({ ready: true });
