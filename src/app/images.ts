import { pickLocalFiles } from "../platform/host";
import type { MarkupImage } from "../markup/model";
import { flash, useApp } from "../state/store";

/** Reads an image file into the form markups store (PNG/JPEG only; other formats are converted to PNG). */
export async function loadImageFile(): Promise<MarkupImage | null> {
  const [f] = await pickLocalFiles("image/png,image/jpeg,image/gif,image/bmp,image/webp");
  if (!f) return null;
  const lower = f.name.toLowerCase();
  return imageFromBytes(f.bytes, lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : lower.endsWith(".png") ? "image/png" : "");
}

/** An image for a markup from file or clipboard bytes; anything but PNG or JPEG is converted to PNG. */
export async function imageFromBytes(bytes: Uint8Array, mime: string): Promise<MarkupImage> {
  const isJpeg = mime === "image/jpeg";
  const isPng = mime === "image/png";
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  if (isJpeg || isPng) return { data: bytes, mime: isJpeg ? "image/jpeg" : "image/png", width: bmp.width, height: bmp.height };
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { data: png, mime: "image/png", width: bmp.width, height: bmp.height };
}

export async function chooseImageTool(tool: "image" | "stamp") {
  const img = await loadImageFile();
  if (!img) return;
  useApp.setState((s) => ({ tools: { ...s.tools, pendingImage: img, tool, stampId: tool === "stamp" ? "custom" : s.tools.stampId } }));
  flash("Click on the page to place the image, or drag to size it.");
}
