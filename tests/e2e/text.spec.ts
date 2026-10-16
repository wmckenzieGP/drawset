import { expect, test, type Page } from "@playwright/test";
import { drag, markups, openFixture, waitForPage } from "./helpers";

/** Screen box of the first search hit for `term` on page 0. */
async function hitBox(page: Page, term: string) {
  await page.getByTestId("panel-search").click();
  await page.getByTestId("search-input").fill(term);
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText(/^1 result/);
  const q = await page.evaluate(() => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    const b = t.state.pages[0].info.bounds;
    return { quad: t.search.hits[0].quads[0] as number[], w: b[2] - b[0], h: b[3] - b[1] };
  });
  const box = (await page.locator('.page[data-page="0"]').boundingBox())!;
  const sx = box.width / q.w;
  const sy = box.height / q.h;
  const x0 = box.x + q.quad[0] * sx;
  const x1 = box.x + q.quad[2] * sx;
  const ym = box.y + ((q.quad[1] + q.quad[5]) / 2) * sy;
  return { a: { x: x0 + 1, y: ym }, b: { x: x1 - 1, y: ym } };
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
});

test("select text and copy it", async ({ page }) => {
  const { a, b } = await hitBox(page, "DRAWSET CALIBRATION SHEET");
  await page.getByTestId("tool-text").click();
  await drag(page, a, b);
  await page.keyboard.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("DRAWSET CALIBRATION SHEET");
});

test("text highlight, underline and strikethrough follow the text", async ({ page }) => {
  const { a, b } = await hitBox(page, "DRAWSET CALIBRATION SHEET");
  for (const [i, tool] of ["highlight", "underline", "strikeout"].entries()) {
    await page.getByTestId(`tool-${tool}`).click();
    await drag(page, a, b);
    await expect.poll(async () => (await markups(page)).length).toBe(i + 1);
  }
  const ms = await markups(page);
  expect(ms.map((m) => m.kind).sort()).toEqual(["highlight", "strikeout", "underline"]);
  for (const m of ms) expect(m.rect[2] - m.rect[0]).toBeGreaterThan(50);
});
