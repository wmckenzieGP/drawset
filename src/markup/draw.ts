/** Draws appearance ops on a 2D canvas (the markup overlay and printing). */
import type { Appearance, DrawOp, PathOp, TextFont } from "./appearance";
import type { RGB } from "./model";

const CSS_FONTS: Record<TextFont, string> = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, 'Liberation Sans', sans-serif",
  "Times-Roman": "'Times New Roman', Times, 'Liberation Serif', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', monospace",
};

export const rgbCss = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

function tracePath(ctx: CanvasRenderingContext2D, op: PathOp) {
  ctx.beginPath();
  for (const s of op.segs) {
    if (s[0] === "M") ctx.moveTo(s[1], s[2]);
    else if (s[0] === "L") ctx.lineTo(s[1], s[2]);
    else if (s[0] === "C") ctx.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
    else ctx.closePath();
  }
}

const CAPS: CanvasLineCap[] = ["butt", "round", "square"];
const JOINS: CanvasLineJoin[] = ["miter", "round", "bevel"];

/** `alpha`: the opacity of lines and text, and of fills; when absent the context's own alpha is used for both. */
export function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp, image?: CanvasImageSource | null, alpha?: { line: number; fill: number }) {
  if (alpha) ctx.globalAlpha = alpha.line;
  if (op.t === "path") {
    if (!op.fill && !op.stroke) return;
    tracePath(ctx, op);
    if (op.fill) {
      if (alpha) ctx.globalAlpha = alpha.fill;
      ctx.fillStyle = rgbCss(op.fill);
      ctx.fill(op.evenOdd ? "evenodd" : "nonzero");
    }
    if (op.stroke) {
      if (alpha) ctx.globalAlpha = alpha.line;
      ctx.strokeStyle = rgbCss(op.stroke);
      ctx.lineWidth = op.width;
      ctx.lineCap = CAPS[op.cap ?? 0];
      ctx.lineJoin = JOINS[op.join ?? 0];
      ctx.setLineDash(op.dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (op.t === "text") {
    ctx.fillStyle = rgbCss(op.color);
    ctx.font = `${op.font === "Helvetica-Bold" ? "bold " : ""}${op.size}px ${CSS_FONTS[op.font]}`;
    ctx.textBaseline = "alphabetic";
    for (const l of op.lines) ctx.fillText(l.s, l.x, l.y);
  } else if (image) {
    const r = op.rect;
    ctx.drawImage(image, r[0], r[1], r[2] - r[0], r[3] - r[1]);
  }
}

/** Draws an appearance; the caller has set the page-space transform on `ctx`. */
export function drawAppearance(ctx: CanvasRenderingContext2D, ap: Appearance, image?: CanvasImageSource | null) {
  ctx.save();
  const alpha = { line: ap.opacity, fill: ap.fillOpacity };
  for (const op of ap.ops) drawOp(ctx, op, image, alpha);
  ctx.restore();
}
