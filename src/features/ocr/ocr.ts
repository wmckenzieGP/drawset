/** Recognising text on scanned pages and keeping the result as an undoable, invisible text layer. */
import { engine } from "../../engine/client";
import type { OcrPage } from "../../engine/types";
import { commit, useApp } from "../../state/store";
import { createRecogniser } from "./recognise";

/** Scans are rendered at 300 dpi for recognition, capped so a large sheet stays within memory. */
export const OCR_DPI = 300;
export const OCR_MAX_PX = 7000;

export interface OcrProgress {
  done: number;
  total: number;
  /** Page position (0-based) being read. */
  page: number | null;
}

export interface OcrResult {
  pages: number;
  words: number;
  skipped: number;
}

/**
 * Recognises text on the pages at `positions` and adds it as one undoable step. Pages that already have text
 * are skipped when `skipText` is set (pages recognised earlier in this session are read again).
 * Returns null when cancelled.
 */
export async function runOcr(
  key: string,
  positions: number[],
  opts: { skipText?: boolean; onProgress?: (p: OcrProgress) => void; cancelled?: () => boolean } = {},
): Promise<OcrResult | null> {
  const t = useApp.getState().tabs.find((x) => x.key === key);
  if (!t) return null;
  const srcs = positions.map((i) => t.state.pages[i]?.src).filter((s): s is number => s !== undefined);
  const counts = opts.skipText ? await engine().textCounts(t.docId, srcs) : srcs.map(() => 0);
  const todo = srcs.map((src, i) => ({ src, pos: positions[i] })).filter((p, i) => counts[i] === 0 || t.state.ocr?.[p.src]);
  const result: Record<number, OcrPage> = {};
  let words = 0;
  if (todo.length) {
    const rec = await createRecogniser();
    try {
      for (let i = 0; i < todo.length; i++) {
        if (opts.cancelled?.()) return null;
        opts.onProgress?.({ done: i, total: todo.length, page: todo[i].pos });
        const img = await engine().ocrImage(t.docId, todo[i].src, OCR_DPI, OCR_MAX_PX);
        const found = await rec.recognise(img.png);
        result[todo[i].src] = { matrix: img.matrix, words: found };
        words += found.length;
      }
    } finally {
      await rec.close();
    }
    if (opts.cancelled?.()) return null;
    opts.onProgress?.({ done: todo.length, total: todo.length, page: null });
    commit(key, "Recognise text", (s) => ({ ...s, ocr: { ...s.ocr, ...result } }));
  }
  return { pages: todo.length, words, skipped: srcs.length - todo.length };
}
