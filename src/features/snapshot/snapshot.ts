/**
 * Snapshot: an area of a page, with the markups on it, copied as a picture. Pasted in Drawset it lands at the size
 * it was taken; other programs get the picture from the system clipboard.
 */
import { engine } from "../../engine/client";
import { copyPicture } from "../../app/clipboard";
import { displayMatrix, transformRect, type Rect } from "../../markup/geometry";
import type { Markup } from "../../markup/model";
import { buildPlan } from "../../state/documents";
import { flash, useApp, type DocTab } from "../../state/store";
import { imageAt } from "../viewer/create";

/** Taken at 300 dpi, or less where the picture would be more than MAX_PX across. */
const DPI = 300;
const MAX_PX = 6000;

/** The part of `area` on the page (a snapshot only takes what is on the page). */
export function snapshotArea(bounds: Rect, area: Rect): Rect | null {
  const r: Rect = [Math.max(bounds[0], area[0]), Math.max(bounds[1], area[1]), Math.min(bounds[2], area[2]), Math.min(bounds[3], area[3])];
  return r[2] - r[0] >= 2 && r[3] - r[1] >= 2 ? r : null;
}

/** Pixels per point for a snapshot of `r`. */
export function snapshotScale(r: Rect): number {
  return Math.min(DPI / 72, MAX_PX / Math.max(r[2] - r[0], r[3] - r[1]));
}

/** Takes a snapshot of `area` (page space) on page `pageId` and puts it on the clipboard as a picture markup. */
export async function takeSnapshot(tab: DocTab, pageId: string, area: Rect): Promise<Markup | null> {
  const entry = tab.state.pages.find((p) => p.id === pageId);
  const r = entry && snapshotArea(entry.info.bounds, area);
  if (!entry || !r) return null;
  useApp.setState({ busy: "Taking a snapshot…" });
  let temp: string | null = null;
  try {
    // drawn from a copy of the page with its markups saved in, so it looks as it will in any viewer
    const bytes = await engine().saveCopy(tab.docId, buildPlan(tab, tab.state, { pageIds: [pageId] }));
    temp = (await engine().open(bytes, "snapshot")).docId;
    const scale = snapshotScale(r);
    // the copy's page carries the page's rotation, so turn it back to the way markups see the page
    const bmp = await engine().render({ docId: temp, page: 0, scale, rotate: (360 - entry.rotation) % 360, tile: transformRect(r, displayMatrix(entry.info.bounds, scale, 0)), annots: true });
    if (!bmp.image) return null;
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext("2d")!.drawImage(bmp.image, 0, 0);
    bmp.image.close();
    const png = await canvas.convertToBlob({ type: "image/png" });
    const image = { data: new Uint8Array(await png.arrayBuffer()), mime: "image/png" as const, width: bmp.width, height: bmp.height };
    const m = imageAt(pageId, [r[0], r[1]], [r[2], r[3]], image);
    if (!m) return null;
    const snap: Markup = { ...m, rect: r, subject: "Snapshot" };
    await copyPicture(tab.docId, snap, png);
    flash("Snapshot copied. Paste it with Ctrl+V, here or in another program.");
    return snap;
  } catch {
    flash("The snapshot could not be taken.", "error");
    return null;
  } finally {
    useApp.setState({ busy: null });
    if (temp) await engine().close(temp);
  }
}
