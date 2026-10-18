import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fixture, openFixture, waitForPage } from "./helpers";

const planted = JSON.parse(readFileSync(fixture("set-200.json"), "utf8")).planted as Record<string, number>;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
});

test("thumbnail, bookmark and page label navigation", async ({ page }) => {
  await page.getByTestId("thumb-2").click();
  await expect(page.getByTestId("page-position")).toHaveText("(3 of 200)");
  await page.getByTestId("panel-bookmarks").click();
  await page.getByTestId("bookmarks").locator(".bm-title").nth(2).click();
  await expect(page.getByTestId("page-position")).toHaveText("(101 of 200)");
  const go = page.getByTestId("goto-page");
  await go.click();
  await go.fill("M-42");
  await go.press("Enter");
  await expect(page.getByTestId("page-position")).toHaveText("(42 of 200)");
});

test("rotate view turns pages 90°", async ({ page }) => {
  const first = page.locator('.page[data-page="0"]');
  const before = (await first.boundingBox())!;
  await page.keyboard.press("Control+Shift+Equal");
  await expect.poll(async () => {
    const b = (await first.boundingBox())!;
    return Math.sign(b.width - b.height);
  }).toBe(-Math.sign(before.width - before.height));
});

test("search finds every planted term", async ({ page }) => {
  await page.getByTestId("panel-search").click();
  await page.getByTestId("search-input").fill("PLANTED-TERM-");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText(`${Object.keys(planted).length} results`, { timeout: 20000 });
  const [term, pageIdx] = Object.entries(planted)[5];
  await page.getByTestId("search-input").fill(term);
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 result");
  await page.getByTestId("search-results").locator("li button").first().click();
  await expect(page.getByTestId("page-position")).toHaveText(`(${pageIdx + 1} of 200)`);
});

test("zoom and fit commands change the scale", async ({ page }) => {
  // a wide, short window so fitting the width and fitting the page differ
  await page.setViewportSize({ width: 1700, height: 650 });
  await page.keyboard.press("Control+9");
  const zoom = page.getByTestId("zoom");
  await expect.poll(() => zoom.inputValue()).not.toBe("");
  await page.waitForTimeout(200);
  const z0 = await zoom.inputValue();
  await page.keyboard.press("Control+Equal");
  await expect(zoom).not.toHaveValue(z0);
  await page.keyboard.press("Control+9");
  await expect(zoom).toHaveValue(z0);
  await page.keyboard.press("Control+0");
  await expect(zoom).not.toHaveValue(z0);
});
