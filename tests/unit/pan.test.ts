import { describe, expect, it } from "vitest";
import { computeLayout, KEEP_IN_VIEW, NO_SLACK, PAD, placeView } from "../../src/features/viewer/layout";

const page = (i: number) => ({ id: `p${i}`, src: i, rotation: 0 as const, scale: null, label: String(i + 1), info: { bounds: [0, 0, 400, 300] as [number, number, number, number], rotate: 0 } }) as never;
const VIEW_W = 1000;
const VIEW_H = 800;
// one 400×300 page, centred in a 1000×800 window: nothing to scroll
const fitted = (slack = NO_SLACK) => computeLayout([page(0)], 1, 0, VIEW_W, "single", 0, slack);

describe("dragging the page past where scrolling stops", () => {
  it("slack moves the pages and makes room around them", () => {
    const a = fitted();
    const b = fitted({ l: 50, t: 30, r: 20, b: 10 });
    expect(b.pages[0].x).toBe(a.pages[0].x + 50);
    expect(b.pages[0].y).toBe(a.pages[0].y + 30);
    expect(b.width).toBe(a.width + 70);
    expect(b.height).toBe(a.height + 40);
    expect(a.pages[0].y).toBe(PAD);
  });

  it("room is added on the side the page is dragged to, and the window stays put over it", () => {
    const l = fitted();
    // the page dragged 150 right and 100 down: the window's top left goes to (-150, -100)
    const to = placeView(l, NO_SLACK, VIEW_W, VIEW_H, -150, -100, true);
    expect(to.slack.l).toBe(150);
    expect(to.slack.t).toBe(100);
    expect([to.left, to.top]).toEqual([0, 0]);
    const moved = fitted(to.slack);
    expect(moved.pages[0].x - to.left).toBe(l.pages[0].x + 150);
    expect(moved.pages[0].y - to.top).toBe(l.pages[0].y + 100);
  });

  it("dragged back, the room stays while dragging and goes when the drag ends", () => {
    const grown = { l: 150, t: 100, r: 0, b: 0 };
    const l = fitted(grown);
    // back to where it started: (150, 100) in the grown layout
    const during = placeView(l, grown, VIEW_W, VIEW_H, 150, 100, true);
    expect(during.slack.l).toBe(150);
    expect([during.left, during.top]).toEqual([150, 100]);
    const after = placeView(l, grown, VIEW_W, VIEW_H, 150, 100);
    expect(after.slack).toEqual(NO_SLACK);
    expect([after.left, after.top]).toEqual([0, 0]);
  });

  it("however far it is dragged, some of the page stays in the window", () => {
    const l = fitted();
    const p = l.pages[0];
    const right = placeView(l, NO_SLACK, VIEW_W, VIEW_H, -1e6, -1e6, true);
    const moved = fitted(right.slack).pages[0];
    // the page's left and top edges stop KEEP_IN_VIEW short of the window's right and bottom edges
    expect(moved.x - right.left).toBeCloseTo(VIEW_W - KEEP_IN_VIEW);
    expect(moved.y - right.top).toBeCloseTo(VIEW_H - KEEP_IN_VIEW);
    const left = placeView(l, NO_SLACK, VIEW_W, VIEW_H, 1e6, 1e6, true);
    const back = fitted(left.slack).pages[0];
    expect(back.x + p.w - left.left).toBeCloseTo(KEEP_IN_VIEW);
    expect(back.y + p.h - left.top).toBeCloseTo(KEEP_IN_VIEW);
  });

  it("within the usual scrolling range no room is added", () => {
    const pages = Array.from({ length: 4 }, (_, i) => page(i));
    const l = computeLayout(pages, 2, 0, VIEW_W, "continuous");
    const to = placeView(l, NO_SLACK, VIEW_W, VIEW_H, 0, 400);
    expect(to.slack).toEqual(NO_SLACK);
    expect([to.left, to.top]).toEqual([0, 400]);
  });
});
