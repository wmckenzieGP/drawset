import { expect, test, type Page } from "@playwright/test";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

type Pt = [number, number];
const app = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __drawset: { useApp: { getState: () => any }; useCursor: { getState: () => any } } }).__drawset;
    const s = d.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return {
      selection: t.selection as string[],
      pages: t.state.pages.map((p: any) => p.id) as string[],
      current: t.currentPage as number,
      undo: t.undo.length as number,
      right: s.rightPanel as string | null,
      cursor: d.useCursor.getState() as { pageId: string | null; pt: Pt | null },
      markups: Object.values(t.state.markups).map((m: any) => ({ id: m.id, kind: m.kind, pageId: m.pageId, rect: m.rect as number[], contents: m.contents as string, status: m.status as string, group: m.group as string | undefined, locked: !!m.locked, image: !!m.image })),
    };
  });
const centre = (r: number[]): Pt => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
const near = (a: Pt, b: Pt, tol = 2) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

async function setup(page: Page) {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  // zoom out so both pages are on screen
  for (let i = 0; i < 4; i++) await page.keyboard.press("Minus");
  await expect(page.locator('.page[data-page="1"]')).toBeVisible();
}

/** Draws a rectangle on page `index` and leaves it selected. */
async function rectangle(page: Page, a: [number, number], b: [number, number], index = 0) {
  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, a[0], a[1], index), await pagePoint(page, b[0], b[1], index));
  const s = await app(page);
  return s.markups.find((m) => m.id === s.selection[0])!;
}

/** Moves the pointer to a spot on a page and returns that spot in page space. */
async function pointAt(page: Page, fx: number, fy: number, index = 0): Promise<Pt> {
  const p = await pagePoint(page, fx, fy, index);
  await page.mouse.move(p.x, p.y);
  return (await app(page)).cursor.pt!;
}

test("Ctrl+V pastes centred on the pointer, on whichever page it is over; Ctrl+Shift+V pastes in place", async ({ page }) => {
  await setup(page);
  const original = await rectangle(page, [0.15, 0.15], [0.25, 0.22]);
  await page.keyboard.press("Control+c");

  // over page 1, the copy lands under the pointer
  const at = await pointAt(page, 0.7, 0.6);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe((await markups(page)).length);
  let s = await app(page);
  const first = s.markups.find((m) => m.id === s.selection[0])!;
  expect(first.id).not.toBe(original.id);
  expect(first.kind).toBe("rectangle");
  expect(near(centre(first.rect), at)).toBe(true);
  // same size as the original
  expect(Math.abs(first.rect[2] - first.rect[0] - (original.rect[2] - original.rect[0]))).toBeLessThan(0.5);

  // over page 2, it lands on page 2
  const at2 = await pointAt(page, 0.3, 0.4, 1);
  const before = s.markups.length;
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(before + 1);
  s = await app(page);
  const second = s.markups.find((m) => m.id === s.selection[0])!;
  expect(second.pageId).toBe(s.pages[1]);
  expect(near(centre(second.rect), at2)).toBe(true);

  // at the very edge of the page, the paste is kept on the page
  await pointAt(page, 0.995, 0.995, 1);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(before + 2);
  s = await app(page);
  const edge = s.markups.find((m) => m.id === s.selection[0])!;
  const pageBox = await page.evaluate(() => {
    const st = (window as any).__drawset.useApp.getState();
    const t = st.tabs.find((x: any) => x.key === st.active);
    return t.state.pages[1].info.bounds as number[];
  });
  expect(edge.rect[2]).toBeLessThanOrEqual(pageBox[2] + 0.01);
  expect(edge.rect[3]).toBeLessThanOrEqual(pageBox[3] + 0.01);

  // paste in place keeps the copied spot, on the page in view
  await page.mouse.move(5, 500);
  await page.keyboard.press("Control+Shift+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(before + 3);
  s = await app(page);
  const inPlace = s.markups.find((m) => m.id === s.selection[0])!;
  expect(near(centre(inPlace.rect), centre(edge.rect), 0.01)).toBe(true);

  // one undo per paste
  await page.keyboard.press("Control+z");
  expect((await app(page)).markups.length).toBe(before + 2);
});

test("cut and paste moves a markup to the pointer; text and pictures copied elsewhere paste at the pointer", async ({ page }) => {
  await setup(page);
  const r = await rectangle(page, [0.2, 0.2], [0.3, 0.3]);
  await page.keyboard.press("Control+x");
  expect((await app(page)).markups.find((m) => m.id === r.id)).toBeUndefined();
  const at = await pointAt(page, 0.6, 0.5);
  const n = (await app(page)).markups.length;
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 1);
  let s = await app(page);
  expect(near(centre(s.markups.find((m) => m.id === s.selection[0])!.rect), at)).toBe(true);

  // text copied in another program becomes a text box under the pointer
  await page.evaluate(() => navigator.clipboard.writeText("Check duct size\nwith mechanical"));
  const at2 = await pointAt(page, 0.4, 0.7);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 2);
  s = await app(page);
  const box = s.markups.find((m) => m.id === s.selection[0])!;
  expect(box.kind).toBe("textbox");
  expect(box.contents).toBe("Check duct size\nwith mechanical");
  expect(near(centre(box.rect), at2)).toBe(true);

  // a picture (a screenshot, say) becomes an image markup under the pointer
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 20);
    const g = c.getContext("2d")!;
    g.fillStyle = "#c00";
    g.fillRect(0, 0, 40, 20);
    const blob = await c.convertToBlob({ type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  const at3 = await pointAt(page, 0.5, 0.3);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 3);
  s = await app(page);
  const img = s.markups.find((m) => m.id === s.selection[0])!;
  expect(img.kind).toBe("image");
  expect(near(centre(img.rect), at3)).toBe(true);

  // copying a markup again takes over from the picture
  await page.keyboard.press("Control+c");
  await pointAt(page, 0.2, 0.85);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 4);
  s = await app(page);
  expect(s.markups.find((m) => m.id === s.selection[0])!.kind).toBe("image");
});

test("right-click on a markup opens its menu: properties, status, copy and paste at the click, group, lock", async ({ page }) => {
  await setup(page);
  const a = await rectangle(page, [0.15, 0.15], [0.25, 0.22]);
  await page.keyboard.press("Escape");
  expect((await app(page)).selection).toEqual([]);
  const on = await pagePoint(page, 0.15, 0.185);
  await page.mouse.click(on.x, on.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  // right-click selects what it is on
  expect((await app(page)).selection).toEqual([a.id]);
  await expect(menu.getByTestId("cm-edit.copy")).toBeVisible();
  await expect(menu.getByTestId("cm-edit.paste")).toBeVisible();
  // status submenu
  await menu.getByText("Status").click();
  await page.getByTestId("cm-status-Accepted").click();
  await expect(menu).toBeHidden();
  expect((await app(page)).markups.find((m) => m.id === a.id)!.status).toBe("Accepted");

  // copy from the menu, paste from the page menu where it was opened
  await page.mouse.click(on.x, on.y, { button: "right" });
  await page.getByTestId("cm-edit.copy").click();
  const spot = await pagePoint(page, 0.6, 0.6);
  const where = await pointAt(page, 0.6, 0.6);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await expect(menu.getByTestId("cm-edit.paste")).toBeVisible();
  const n = (await app(page)).markups.length;
  await page.getByTestId("cm-edit.paste").click();
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 1);
  let s = await app(page);
  const b = s.markups.find((m) => m.id === s.selection[0])!;
  // (the right-click lands on a whole pixel, a pixel or two of page space at this zoom)
  expect(near(centre(b.rect), where, 4)).toBe(true);

  // select both and group them from the menu
  await page.keyboard.down("Shift");
  await page.mouse.click(on.x, on.y);
  await page.keyboard.up("Shift");
  expect((await app(page)).selection.sort()).toEqual([a.id, b.id].sort());
  await page.mouse.click(on.x, on.y, { button: "right" });
  // a right-click inside the selection keeps it
  expect((await app(page)).selection.length).toBe(2);
  await page.getByTestId("cm-edit.group").click();
  s = await app(page);
  expect(s.markups.filter((m) => m.group).length).toBe(1);
  // the menu now offers ungroup, and lock
  await page.mouse.click(on.x, on.y, { button: "right" });
  await expect(page.getByTestId("cm-edit.ungroup")).toBeVisible();
  await page.getByTestId("cm-edit.lock").click();
  s = await app(page);
  expect(s.markups.filter((m) => m.id === a.id || m.id === b.id).every((m) => m.locked)).toBe(true);
  await page.mouse.click(on.x, on.y, { button: "right" });
  await expect(page.getByTestId("cm-edit.lock")).toHaveText(/Unlock/);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Properties opens the panel
  await page.mouse.click(on.x, on.y, { button: "right" });
  await page.getByTestId("cm-properties").click();
  await expect(page.getByTestId("properties")).toBeVisible();

  // Reply on a single markup puts the cursor in the reply box
  await rectangle(page, [0.4, 0.8], [0.5, 0.85]);
  await page.keyboard.press("Escape");
  const lone = await pagePoint(page, 0.4, 0.825);
  await page.mouse.click(lone.x, lone.y, { button: "right" });
  await page.getByTestId("cm-reply").click();
  await expect(page.getByTestId("reply-input")).toBeFocused();
});

test("right-click on the page: paste here, page layout, rotate and insert pages; the menu while drawing", async ({ page }) => {
  await setup(page);
  const spot = await pagePoint(page, 0.5, 0.5, 1);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  // the page right-clicked becomes the current page
  expect((await app(page)).current).toBe(1);
  await expect(menu.getByTestId("cm-view.fitPage")).toBeVisible();
  await menu.getByText("Rotate page").click();
  await page.getByTestId("cm-rotatePageCw").click();
  const rotation = await page.evaluate(() => {
    const st = (window as any).__drawset.useApp.getState();
    const t = st.tabs.find((x: any) => x.key === st.active);
    return t.state.pages.map((p: any) => p.rotation);
  });
  expect(rotation).toEqual([0, 90]);
  await page.mouse.click(spot.x, spot.y, { button: "right" });
  await page.getByTestId("cm-insertBlank").click();
  await expect.poll(async () => (await app(page)).pages.length).toBe(3);

  // while drawing a polyline: finish from the menu
  await page.keyboard.press("Home");
  await expect(page.locator('.page[data-page="0"]')).toBeInViewport();
  await page.keyboard.press("Shift+n");
  for (const [x, y] of [[0.2, 0.2], [0.3, 0.25], [0.35, 0.35]]) {
    const p = await pagePoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  const p = await pagePoint(page, 0.4, 0.4);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.getByTestId("cm-drawUndoPoint")).toBeEnabled();
  await page.getByTestId("cm-drawUndoPoint").click();
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("cm-drawFinish").click();
  const poly = await page.evaluate(() => {
    const st = (window as any).__drawset.useApp.getState();
    const t = st.tabs.find((x: any) => x.key === st.active);
    return (Object.values(t.state.markups) as any[]).find((m) => m.kind === "polyline")?.points.length;
  });
  // three clicks, one taken back
  expect(poly).toBe(2);
});

test("arrow keys nudge the selection, Esc lets go of it, double-click opens the comment, hovering shows who made it", async ({ page }) => {
  await setup(page);
  const r = await rectangle(page, [0.3, 0.3], [0.4, 0.4]);
  const undo0 = (await app(page)).undo;
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  let s = await app(page);
  const moved = s.markups.find((m) => m.id === r.id)!;
  const scale = await page.evaluate(() => {
    const st = (window as any).__drawset.useApp.getState();
    return st.tabs.find((x: any) => x.key === st.active).view.scale as number;
  });
  expect(moved.rect[0] - r.rect[0]).toBeCloseTo(5 / scale, 3);
  expect(moved.rect[1] - r.rect[1]).toBeCloseTo(10 / scale, 3);
  // the presses undo as one step
  expect(s.undo).toBe(undo0 + 1);
  await page.keyboard.press("Control+z");
  expect((await app(page)).markups.find((m) => m.id === r.id)!.rect).toEqual(r.rect);

  await page.keyboard.press("Escape");
  expect((await app(page)).selection).toEqual([]);

  // hovering a markup shows its subject and author
  const on = await pagePoint(page, 0.3, 0.35);
  await page.mouse.move(on.x, on.y);
  await expect(page.getByTestId("viewer")).toHaveAttribute("title", /Rectangle/);

  // double-click: the comment box opens for it
  await page.mouse.dblclick(on.x, on.y);
  s = await app(page);
  expect(s.selection).toEqual([r.id]);
  await expect(page.getByTestId("prop-comment")).toBeFocused();
  await page.keyboard.type("Clash with duct");
  await page.getByTestId("viewer").click({ position: { x: 5, y: 5 } });
  expect((await app(page)).markups.find((m) => m.id === r.id)!.contents).toBe("Clash with duct");
});

test("a picture dragged from Explorer onto a page lands where it is dropped", async ({ page }) => {
  await setup(page);
  const target = await pagePoint(page, 0.4, 0.5, 1);
  const where = await pointAt(page, 0.4, 0.5, 1);
  const dt = await page.evaluateHandle(async () => {
    const c = new OffscreenCanvas(60, 30);
    const g = c.getContext("2d")!;
    g.fillStyle = "#08f";
    g.fillRect(0, 0, 60, 30);
    const d = new DataTransfer();
    d.items.add(new File([await c.convertToBlob({ type: "image/png" })], "site-photo.png", { type: "image/png" }));
    return d;
  });
  const n = (await app(page)).markups.length;
  await page.getByTestId("viewer").dispatchEvent("drop", { dataTransfer: dt, clientX: target.x, clientY: target.y });
  await expect.poll(async () => (await app(page)).markups.length).toBe(n + 1);
  const s = await app(page);
  const img = s.markups.find((m) => m.id === s.selection[0])!;
  expect(img.kind).toBe("image");
  expect(img.pageId).toBe(s.pages[1]);
  expect(near(centre(img.rect), where, 4)).toBe(true);
});
