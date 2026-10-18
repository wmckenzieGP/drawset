/** Turning a drawn, typed or scanned signature into a picture with a clear background, cropped to the ink. */
import type { Pt } from "../../markup/geometry";
import { smoothCurve } from "../../markup/ink";
import type { MarkupImage } from "../../markup/model";

/** How much sharper than on screen the saved picture is (so it prints cleanly). */
const SHARPEN = 4;
/** The longest side a saved signature picture may have, in pixels. */
const MAX_SIDE = 1600;

export const INK_COLOURS = { black: "#111111", blue: "#0b2f8f" } as const;
export type InkColour = keyof typeof INK_COLOURS;

/** Windows handwriting fonts tried for a typed signature, best first; ones not installed are skipped. */
export const SCRIPT_FONTS = ["Segoe Script", "Lucida Handwriting", "Ink Free", "Brush Script MT", "Freestyle Script", "Mistral"];

/** The handwriting fonts installed here, plus the system's own as a fallback. */
export function installedScriptFonts(): string[] {
  const g = document.createElement("canvas").getContext("2d");
  if (!g) return ["cursive"];
  const sample = "Signature abcdefghijklmnopqrstuvwxyz";
  const width = (font: string) => {
    g.font = font;
    return g.measureText(sample).width;
  };
  const base = ["monospace", "serif"].map((f) => width(`40px ${f}`));
  const found = SCRIPT_FONTS.filter((name) => ["monospace", "serif"].some((f, i) => Math.abs(width(`40px "${name}", ${f}`) - base[i]) > 0.5));
  return [...found, "cursive"];
}

export const fontStack = (name: string) => (name === "cursive" ? "cursive" : `"${name}", cursive`);

/** Draws strokes (in the pad's pixels) smoothly, as the pen tool does on the page. */
export function strokePath(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, strokes: Pt[][]) {
  g.beginPath();
  for (const s of strokes) {
    if (!s.length) continue;
    g.moveTo(s[0][0], s[0][1]);
    if (s.length === 1) g.lineTo(s[0][0] + 0.01, s[0][1]);
    const c = smoothCurve(s);
    if (c) for (const [c1, c2, e] of c.curves) g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
    else for (const p of s.slice(1)) g.lineTo(p[0], p[1]);
  }
  g.stroke();
}

/** A drawn signature, `strokes` in pad pixels on a pad `w`×`h`, with the pen `width` pixels wide. */
export async function drawnSignature(strokes: Pt[][], w: number, h: number, colour: InkColour, width: number): Promise<MarkupImage | null> {
  if (!strokes.some((s) => s.length)) return null;
  const c = new OffscreenCanvas(w * SHARPEN, h * SHARPEN);
  const g = c.getContext("2d")!;
  g.scale(SHARPEN, SHARPEN);
  g.strokeStyle = INK_COLOURS[colour];
  g.lineWidth = width;
  g.lineCap = "round";
  g.lineJoin = "round";
  strokePath(g, strokes);
  return cropped(c);
}

/** A typed signature: the name in a handwriting font. */
export async function typedSignature(text: string, font: string, colour: InkColour): Promise<MarkupImage | null> {
  const t = text.trim();
  if (!t) return null;
  const size = 96;
  const probe = new OffscreenCanvas(10, 10).getContext("2d")!;
  probe.font = `${size}px ${fontStack(font)}`;
  const w = Math.ceil(probe.measureText(t).width + size);
  const c = new OffscreenCanvas(w, Math.ceil(size * 2));
  const g = c.getContext("2d")!;
  g.font = `${size}px ${fontStack(font)}`;
  g.fillStyle = INK_COLOURS[colour];
  g.textBaseline = "middle";
  g.fillText(t, size / 2, size);
  return cropped(c);
}

/**
 * A photo or scan of a signature. With `clearPaper`, the paper is made see-through: white goes clear and the
 * ink keeps its colour, fading out at its edges.
 */
export async function pictureSignature(bytes: Uint8Array, clearPaper: boolean): Promise<MarkupImage | null> {
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const s = Math.min(1, (MAX_SIDE * 1.5) / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (clearPaper) {
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    // the paper is about as light as the lightest tenth of the picture
    const lum = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.round(lum(i))]++;
    let paper = 255;
    for (let n = 0, v = 255; v >= 0; v--) if ((n += hist[v]) >= d.length / 40) { paper = v; break; }
    const clear = paper - 25;
    const solid = Math.max(0, paper - 110);
    for (let i = 0; i < d.length; i += 4) {
      const l = lum(i);
      const a = l >= clear ? 0 : l <= solid ? 1 : (clear - l) / (clear - solid);
      d[i + 3] = Math.round(d[i + 3] * a);
    }
    g.putImageData(img, 0, 0);
  }
  return cropped(c);
}

/** The picture cropped to its ink (with a small margin) and no bigger than MAX_SIDE, as PNG. */
async function cropped(c: OffscreenCanvas): Promise<MarkupImage | null> {
  const g = c.getContext("2d")!;
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let [x0, y0, x1, y1] = [c.width, c.height, -1, -1];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 2;
  [x0, y0, x1, y1] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(c.width - 1, x1 + m), Math.min(c.height - 1, y1 + m)];
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const out = new OffscreenCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const og = out.getContext("2d")!;
  og.imageSmoothingQuality = "high";
  og.drawImage(c, x0, y0, w, h, 0, 0, out.width, out.height);
  const data2 = new Uint8Array(await (await out.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { data: data2, mime: "image/png", width: out.width, height: out.height };
}
