import { expect, test, type Page } from "@playwright/test";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

const bounds = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    return s.tabs.find((x: any) => x.key === s.active).state.pages[0].info.bounds as number[];
  });

test("dragging a callout's text box leaves its arrow tip in place; dragging its leader moves it all", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  const b0 = await bounds(page);
  const pg = (await page.locator('.page[data-page="0"]').boundingBox())!;
  const screen = (pt: number[]) => ({ x: pg.x + (pt[0] / b0[2]) * pg.width, y: pg.y + (pt[1] / b0[3]) * pg.height });

  await page.keyboard.press("q");
  await drag(page, await pagePoint(page, 0.3, 0.4), await pagePoint(page, 0.45, 0.3), 10);
  await page.getByTestId("text-editor").fill("Tip stays");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const c = (await markups(page)).find((m) => m.contents === "Tip stays")!;
  expect(c.kind).toBe("callout");
  const [tip, knee] = c.points;

  // the box dragged right and down: the box and the bend follow, the tip does not
  // a quarter of the way along, clear of the resize handles
  const inBox = screen([c.rect[0] + (c.rect[2] - c.rect[0]) / 4, (c.rect[1] + c.rect[3]) / 2]);
  await drag(page, inBox, { x: inBox.x + 120, y: inBox.y + 90 }, 10);
  let m = (await markups(page)).find((x) => x.id === c.id)!;
  expect(m.points[0]).toEqual(tip);
  expect(m.points[1][0]).toBeGreaterThan(knee[0] + 20);
  expect(m.points[1][1]).toBeGreaterThan(knee[1] + 20);
  expect(m.rect[0]).toBeGreaterThan(c.rect[0] + 20);

  // undone in one step
  await page.keyboard.press("Control+z");
  m = (await markups(page)).find((x) => x.id === c.id)!;
  expect(m.rect).toEqual(c.rect);

  // picked up by the leader, the whole callout moves, tip and all
  const onLeader = screen([(tip[0] + knee[0]) / 2, (tip[1] + knee[1]) / 2]);
  await drag(page, onLeader, { x: onLeader.x - 60, y: onLeader.y + 50 }, 10);
  m = (await markups(page)).find((x) => x.id === c.id)!;
  expect(m.points[0][0]).toBeLessThan(tip[0] - 10);
  expect(m.points[0][1]).toBeGreaterThan(tip[1] + 10);
  expect(m.rect[0]).toBeLessThan(c.rect[0] - 10);
});
