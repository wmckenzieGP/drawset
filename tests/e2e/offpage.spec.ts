import { expect, test, type Page } from "@playwright/test";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

const doc = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return {
      selection: t.selection as string[],
      pages: t.state.pages.map((p: any) => ({ id: p.id, bounds: p.info.bounds as number[] })),
      pageOf: Object.fromEntries(Object.values(t.state.markups).map((m: any) => [m.id, m.pageId])) as Record<string, string>,
    };
  });

test("a text box or callout can hang off the page edge and over the next page", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  // zoom out so both pages and the space around them are on screen
  for (let i = 0; i < 4; i++) await page.keyboard.press("Minus");
  await expect(page.locator('.page[data-page="1"]')).toBeVisible();
  const { pages } = await doc(page);
  const b0 = pages[0].bounds;

  await page.keyboard.press("t");
  await drag(page, await pagePoint(page, 0.3, 0.8), await pagePoint(page, 0.6, 0.9));
  await page.getByTestId("text-editor").fill("Hangs off");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const box = (await markups(page)).find((m) => m.contents === "Hangs off")!;
  const h = box.rect[3] - box.rect[1];

  // dragged down so half of it is past the bottom edge (let go over page 1): it stays where it was put
  await drag(page, await pagePoint(page, 0.45, 0.85), await pagePoint(page, 0.45, 0.99), 10);
  let m = (await markups(page)).find((x) => x.id === box.id)!;
  expect(m.rect[3]).toBeGreaterThan(b0[3] + h * 0.2);
  expect(m.rect[1]).toBeLessThan(b0[3]);
  expect((await doc(page)).pageOf[box.id]).toBe(pages[0].id);

  // the part below the page can be clicked to pick it
  const pg = (await page.locator('.page[data-page="0"]').boundingBox())!;
  const screen = (pt: number[]) => ({ x: pg.x + (pt[0] / b0[2]) * pg.width, y: pg.y + (pt[1] / b0[3]) * pg.height });
  const empty = screen([m.rect[0] - 100, b0[3] + 20]);
  await page.mouse.click(empty.x, empty.y);
  expect((await doc(page)).selection).toEqual([]);
  // a quarter of the way along, halfway down the part past the edge (clear of the handles)
  const overhang = screen([m.rect[0] + (m.rect[2] - m.rect[0]) / 4, (b0[3] + m.rect[3]) / 2]);
  expect(overhang.y).toBeGreaterThan(pg.y + pg.height);
  await page.mouse.click(overhang.x, overhang.y);
  expect((await doc(page)).selection).toEqual([box.id]);

  // dragged right so it hangs off the right edge, then nudged further with the arrow key
  await drag(page, overhang, { x: overhang.x + pg.width * 0.5, y: overhang.y }, 10);
  m = (await markups(page)).find((x) => x.id === box.id)!;
  expect(m.rect[2]).toBeGreaterThan(b0[2]);
  const before = m.rect[2];
  await page.keyboard.press("Shift+ArrowRight");
  m = (await markups(page)).find((x) => x.id === box.id)!;
  expect(m.rect[2]).toBeGreaterThan(before);

  // a callout whose text box is drawn past the page's right edge
  await page.keyboard.press("q");
  const tip = await pagePoint(page, 0.8, 0.3);
  await drag(page, tip, { x: pg.x + pg.width + 60, y: tip.y - 40 }, 10);
  await page.getByTestId("text-editor").fill("Off the page");
  await page.keyboard.press("Escape");
  const c = (await markups(page)).find((x) => x.contents === "Off the page")!;
  expect(c.kind).toBe("callout");
  expect(c.rect[2]).toBeGreaterThan(b0[2]);
});
