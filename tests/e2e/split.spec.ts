import { expect, test, type Page } from "@playwright/test";
import { fixture, openFixture, waitForPage } from "./helpers";

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    return { active: s.active, split: s.split, tabs: s.tabs.map((t: any) => ({ key: t.key, name: t.name, scale: t.view.scale, page: t.currentPage })) };
  });

test("split view shows two files side by side with pan, zoom and page kept in step", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  // a second copy of the set (a later revision, say) beside the first
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("tb-open").click();
  await (await chooser).setFiles(fixture("set-200.pdf"));
  await expect(page.locator(".tab")).toHaveCount(2);
  await waitForPage(page);
  await page.locator(".tab").first().click();
  await page.getByTestId("menu-view").click();
  await page.getByRole("menuitem", { name: "Split view" }).click();
  await expect(page.getByTestId("split-left").getByTestId("viewer")).toBeVisible();
  await expect(page.getByTestId("split-right").getByTestId("viewer")).toBeVisible();

  // zoom with the wheel over the left pane: the right pane takes the same zoom
  const left = page.getByTestId("split-left").getByTestId("viewer");
  const right = page.getByTestId("split-right").getByTestId("viewer");
  const lb = (await left.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => {
    const s = await state(page);
    return Math.abs(s.tabs[0].scale - s.tabs[1].scale) < 1e-9 && s.tabs[0].scale > 0.3;
  }).toBe(true);

  // scrolling the left pane moves the right one to the same spot
  await left.evaluate((el) => (el.scrollTop += 3000));
  await expect.poll(async () => Math.abs((await left.evaluate((el) => el.scrollTop)) - (await right.evaluate((el) => el.scrollTop)))).toBeLessThan(2);

  // clicking the right pane makes its file the active one
  const rb = (await right.boundingBox())!;
  await page.mouse.click(rb.x + 20, rb.y + rb.height - 20);
  await expect.poll(async () => (await state(page)).split.focus).toBe("right");
  const s = await state(page);
  expect(s.active).toBe(s.split.right);
  expect(s.split.right).not.toBe(s.split.left);
  // the page number followed too
  expect(s.tabs[0].page).toBe(s.tabs[1].page);
  expect(s.tabs[0].page).toBeGreaterThan(0);

  // sync off: scrolling one pane leaves the other alone
  await page.getByTestId("menu-view").click();
  await page.getByRole("menuitem", { name: "Stop syncing split panes" }).click();
  const before = await left.evaluate((el) => el.scrollTop);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await right.evaluate((el) => (el.scrollTop += 500));
  await page.waitForTimeout(300);
  expect(await left.evaluate((el) => el.scrollTop)).toBe(before);
});
