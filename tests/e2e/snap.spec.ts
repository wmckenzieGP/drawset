import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { drag, openFixture, waitForPage } from "./helpers";

const cal = JSON.parse(readFileSync("fixtures/calibration.json", "utf8"));

async function pageSize(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    const b = t.state.pages[0].info.bounds;
    return { w: b[2] - b[0], h: b[3] - b[1] };
  });
}

async function linePoints(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return (Object.values(t.state.markups) as any[]).map((m) => m.points as [number, number][]);
  });
}

/** Screen position of a PDF user-space point, nudged by (dx, dy) screen pixels. */
async function screenAt(page: Page, user: [number, number], dx = 0, dy = 0) {
  const { w, h } = await pageSize(page);
  const box = (await page.locator('.page[data-page="0"]').boundingBox())!;
  return { x: box.x + (user[0] / w) * box.width + dx, y: box.y + ((h - user[1]) / h) * box.height + dy };
}

test("a length drawn near the sheet's line ends snaps onto them; Alt turns snapping off; the grid snaps", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const { h } = await pageSize(page);
  const toPage = (u: [number, number]) => [u[0], h - u[1]];

  await page.getByTestId("tool-length").click();
  // hovering first loads the page's drawing for snapping
  await page.mouse.move((await screenAt(page, cal.horizontal.from, 4, -3)).x, (await screenAt(page, cal.horizontal.from, 4, -3)).y);
  await page.waitForTimeout(300);
  await drag(page, await screenAt(page, cal.horizontal.from, 4, -3), await screenAt(page, cal.horizontal.to, -3, 4));
  let pts = (await linePoints(page))[0];
  for (const [i, end] of [cal.horizontal.from, cal.horizontal.to].entries()) {
    const t = toPage(end);
    expect(Math.abs(pts[i][0] - t[0])).toBeLessThan(0.01);
    expect(Math.abs(pts[i][1] - t[1])).toBeLessThan(0.01);
  }

  // Alt held: the point stays where the pointer is
  await page.getByTestId("tool-length").click();
  await page.keyboard.down("Alt");
  await drag(page, await screenAt(page, cal.vertical.from, 4, -3), await screenAt(page, cal.vertical.to, -3, 4));
  await page.keyboard.up("Alt");
  pts = (await linePoints(page))[1];
  expect(Math.abs(pts[0][0] - toPage(cal.vertical.from)[0])).toBeGreaterThan(0.5);

  // grid only: points land on the 10 mm grid from the page corner
  await page.getByTestId("snap-markups").click();
  await page.getByTestId("snap-content").click();
  await page.getByTestId("snap-grid").click();
  await page.getByTestId("snap-grid-size").selectOption("10");
  await page.getByTestId("tool-line").click();
  await drag(page, await screenAt(page, [205, 500]), await screenAt(page, [433, 610]));
  pts = (await linePoints(page))[2];
  const g = (10 * 72) / 25.4;
  for (const p of pts) for (const v of p) expect(Math.abs(v / g - Math.round(v / g))).toBeLessThan(1e-9);
});
