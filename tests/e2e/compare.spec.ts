import { expect, test } from "@playwright/test";
import { openFixture, waitForPage } from "./helpers";

test("compare two revisions: each change gets a cloud listed in the Markups List, in one undo step", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await openFixture(page, "calibration-rev.pdf");
  await waitForPage(page);

  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Compare documents…" }).click();
  await expect(page.getByTestId("overlay-canvas")).toHaveAttribute("data-ready", "1");
  await expect(page.getByTestId("overlay-a-file")).toHaveValue(/.+/);
  await page.getByTestId("overlay-cloud-all").click();
  await expect(page.getByTestId("overlay-cloud-count")).toHaveText("2 changes clouded on the red pages.");
  await page.keyboard.press("Escape");

  await page.getByTestId("tb-markups-list").click();
  await expect(page.getByTestId("ml-row")).toHaveCount(2);
  await expect(page.getByTestId("ml-row").first()).toContainText("Compare");
  await expect(page.getByTestId("ml-row").first()).toContainText("compared with calibration.pdf page 1");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("ml-row")).toHaveCount(0);
});
