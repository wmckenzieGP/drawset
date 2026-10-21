import { expect, test, type Page } from "@playwright/test";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const state = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __drawset: { useApp: { getState: () => any }; useCursor: { getState: () => any } } }).__drawset;
    const s = d.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return { tool: s.tools.tool as string, bounds: t.state.pages[0].info.bounds as number[], cursor: d.useCursor.getState().pt as [number, number] | null, subjects: Object.values(t.state.markups).map((m: any) => m.subject as string) };
  });

/** The picture on the system clipboard: its size and how many of its pixels are the markups' red. */
const clipboardPicture = (page: Page) =>
  page.evaluate(async () => {
    const item = (await navigator.clipboard.read()).find((i) => i.types.includes("image/png"));
    if (!item) return null;
    const bmp = await createImageBitmap(await item.getType("image/png"));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 90) red++;
    return { width: bmp.width, height: bmp.height, red };
  });

test("Snapshot copies an area with its markups as a picture; it pastes at the size it was taken", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  // a red box to be caught in the picture
  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, 0.3, 0.3), await pagePoint(page, 0.4, 0.4));
  await page.keyboard.press("Escape");
  expect(await markups(page)).toHaveLength(1);

  const { bounds } = await state(page);
  await page.keyboard.press("g");
  await drag(page, await pagePoint(page, 0.25, 0.25), await pagePoint(page, 0.45, 0.45), 10);
  await expect.poll(() => clipboardPicture(page), { timeout: 15000 }).not.toBeNull();
  const pic = (await clipboardPicture(page))!;
  // 300 dpi: a fifth of the page across, in points, times 300/72
  const wPts = (bounds[2] - bounds[0]) * 0.2;
  const hPts = (bounds[3] - bounds[1]) * 0.2;
  expect(pic.width / ((wPts * 300) / 72)).toBeGreaterThan(0.97);
  expect(pic.width / ((wPts * 300) / 72)).toBeLessThan(1.03);
  expect(pic.red).toBeGreaterThan(200);
  // back to Select, and the document is unchanged
  expect((await state(page)).tool).toBe("select");
  expect(await markups(page)).toHaveLength(1);

  // Ctrl+V pastes it under the pointer, at the size it was taken
  const to = await pagePoint(page, 0.7, 0.7);
  await page.mouse.move(to.x, to.y);
  const at = (await state(page)).cursor!;
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await markups(page)).length).toBe(2);
  const snap = (await markups(page)).find((m) => m.kind === "image")!;
  expect((await state(page)).subjects).toContain("Snapshot");
  const [w, h] = [snap.rect[2] - snap.rect[0], snap.rect[3] - snap.rect[1]];
  expect(Math.abs(w - wPts)).toBeLessThan(wPts * 0.03);
  expect(Math.abs(h - hPts)).toBeLessThan(hPts * 0.03);
  expect(Math.abs((snap.rect[0] + snap.rect[2]) / 2 - at[0])).toBeLessThan(2);
  expect(Math.abs((snap.rect[1] + snap.rect[3]) / 2 - at[1])).toBeLessThan(2);
});
