/**
 * Text recognition with tesseract.js, run entirely on this computer. The worker, WebAssembly cores and
 * English data are bundled with the app (see vite.config.ts); nothing is downloaded.
 */
import type { OcrWord } from "../../engine/types";

export interface Recogniser {
  /** Words found in a PNG image, in its pixels. */
  recognise(png: Uint8Array): Promise<OcrWord[]>;
  close(): Promise<void>;
}

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TWord {
  text: string;
  confidence: number;
  bbox: TBox;
}
interface TLine {
  words: TWord[];
  baseline?: TBox & { has_baseline?: boolean };
}
export interface TesseractPage {
  blocks?: { paragraphs: { lines: TLine[] }[] }[] | null;
}

/** Words below this confidence are noise (specks read as punctuation), not text. */
const MIN_CONFIDENCE = 25;

/** Flattens tesseract's block tree to words, each with its baseline taken from its line. */
export function wordsFrom(page: TesseractPage): OcrWord[] {
  const out: OcrWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const b = line.baseline;
        for (const w of line.words) {
          const text = w.text.trim();
          if (!text || w.confidence < MIN_CONFIDENCE || !/[\p{L}\p{N}]/u.test(text)) continue;
          const { x0, y0, x1, y1 } = w.bbox;
          let baseline = y1;
          if (b && b.has_baseline !== false && b.x1 !== b.x0) {
            const at = b.y0 + ((b.y1 - b.y0) * ((x0 + x1) / 2 - b.x0)) / (b.x1 - b.x0);
            // a baseline outside the word's box is a bad fit for this word
            if (at > y0 && at <= y1 + 1) baseline = at;
          }
          out.push({ text, bbox: [x0, y0, x1, y1], baseline });
        }
      }
    }
  }
  return out;
}

let factory: (() => Promise<Recogniser>) | null = null;

/** Replaces how recognisers are made (tests run tesseract in Node). */
export function setRecogniserFactory(f: (() => Promise<Recogniser>) | null) {
  factory = f;
}

export async function createRecogniser(): Promise<Recogniser> {
  if (factory) return factory();
  const { createWorker } = await import("tesseract.js");
  const base = new URL("ocr/", document.baseURI).href;
  const worker = await createWorker("eng", 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: "none",
  });
  return {
    async recognise(png) {
      const res = await worker.recognize(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }), {}, { blocks: true, text: false });
      return wordsFrom(res.data as unknown as TesseractPage);
    },
    async close() {
      await worker.terminate();
    },
  };
}
