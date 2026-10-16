import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { drag, fixture, openFixture, pagePoint, waitForPage } from "./helpers";

/** Screenshots for docs/screenshots (run with SCREENSHOTS=1). */
test.skip(!process.env.SCREENSHOTS, "screenshots only on request");

const known = JSON.parse(readFileSync(fixture("calibration.json"), "utf8"));
const A3 = [420 * 72 / 25.4, 297 * 72 / 25.4];

test("markups and measurements", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tb-markups-list").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/markups.png" });

  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const at = async (p: number[]) => {
    const box = (await page.locator('.page[data-page="0"]').boundingBox())!;
    return { x: box.x + (p[0] / A3[0]) * box.width, y: box.y + ((A3[1] - p[1]) / A3[1]) * box.height };
  };
  await page.getByTestId("calibrate-open").click();
  await page.getByTestId("cal-preset").selectOption("1:100");
  await page.getByTestId("cal-display").selectOption("m");
  await page.getByTestId("cal-ok").click();
  await page.getByTestId("tool-length").click();
  await drag(page, await at(known.horizontal.from), await at(known.horizontal.to), 10);
  const r = known.room.rect;
  await page.getByTestId("tool-area").click();
  const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  for (const [i, p] of corners.entries()) {
    const s = await at(p);
    if (i === 3) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
  await page.getByTestId("tool-angle").click();
  for (const p of [known.hypotenuse.to, known.hypotenuse.from, [known.hypotenuse.to[0], known.hypotenuse.from[1]]]) {
    const s = await at(p);
    await page.mouse.click(s.x, s.y);
  }
  await page.getByTestId("tool-count").click();
  for (const fx of [0.75, 0.8, 0.85]) {
    const s = await pagePoint(page, fx, 0.85);
    await page.mouse.click(s.x, s.y);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/measurements.png" });
});
