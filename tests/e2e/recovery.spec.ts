import { expect, test } from "@playwright/test";
import { drag, fixture, markups, openFixture, pagePoint, waitForPage } from "./helpers";

const journalNow = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __drawset: { journalNow: () => Promise<void> } }).__drawset.journalNow());

test("unsaved markups survive a crash and are offered back at the next start", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, 0.6, 0.2), await pagePoint(page, 0.75, 0.35));
  await page.keyboard.press("c");
  await drag(page, await pagePoint(page, 0.2, 0.6), await pagePoint(page, 0.3, 0.7));
  expect(await markups(page)).toHaveLength(2);
  await journalNow(page);

  // "crash": the page goes away without saving
  await page.reload();
  await expect(page.getByTestId("recovery-dialog")).toBeVisible();
  await expect(page.getByTestId("recovery-item")).toContainText("calibration.pdf");
  await expect(page.getByTestId("recovery-item")).toContainText("2 markups");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("recovery-restore").click();
  await (await chooser).setFiles(fixture("calibration.pdf"));
  await expect(page.getByTestId("recovery-dialog")).toBeHidden();
  await expect.poll(async () => (await markups(page)).map((m) => m.kind).sort()).toEqual(["cloud", "rectangle"]);
  await expect(page.locator(".tab", { hasText: "calibration.pdf" })).toContainText("•");

  // saved: nothing to recover next time
  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  await dl;
  await journalNow(page);
  await page.reload();
  await expect(page.getByTestId("tb-open")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("recovery-dialog")).toBeHidden();
});
