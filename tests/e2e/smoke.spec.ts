import { expect, test } from "@playwright/test";
import { openFixture, waitForPage } from "./helpers";

test("opens the 200-page set and shows the first page quickly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("welcome-open")).toBeVisible();
  const t0 = Date.now();
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  const ms = Date.now() - t0;
  expect(ms).toBeLessThan(2000);
  await expect(page.getByTestId("page-position")).toHaveText("(1 of 200)");
  await expect(page.getByTestId("markup-count")).toHaveText("0 markups");
});
