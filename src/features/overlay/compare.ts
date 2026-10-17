/** Compare documents: changed areas found by raster comparison become cloud markups on the newer page. */
import { displayMatrix, invert, transformRect, rectPoints, type Rect } from "../../markup/geometry";
import type { Markup } from "../../markup/model";
import { vertexMarkup } from "../viewer/create";

/** Margin around each changed area, in points, so the cloud surrounds the change rather than touching it. */
export const CLOUD_MARGIN = 6;

/** A pixel rectangle of a page rendered unrotated at `scale`, as a page-space rectangle with a margin. */
export function pixelRectToPage(r: Rect, bounds: Rect, scale: number, margin = CLOUD_MARGIN): Rect {
  const p = transformRect(r, invert(displayMatrix(bounds, scale, 0)));
  return [Math.max(bounds[0], p[0] - margin), Math.max(bounds[1], p[1] - margin), Math.min(bounds[2], p[2] + margin), Math.min(bounds[3], p[3] + margin)];
}

/** One cloud per changed area, listed in the Markups List with what it was compared against. */
export function compareClouds(pageId: string, areas: Rect[], against: string): Markup[] {
  return areas.map((r, i) => {
    const m = vertexMarkup("cloud", pageId, rectPoints(r));
    return {
      ...m,
      style: { ...m.style, color: [0.9, 0.1, 0.1], fill: null, width: 1.5, opacity: 1, cloudIntensity: 1 },
      subject: "Compare",
      contents: `Change ${i + 1} of ${areas.length}, compared with ${against}`,
    };
  });
}
