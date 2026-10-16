import { expect, type Page } from "@playwright/test";
import path from "node:path";

export const fixture = (name: string) => path.resolve("fixtures", name);

export async function openFixture(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("tb-open").click();
  await (await chooser).setFiles(fixture(name));
  await expect(page.locator(".tab", { hasText: name })).toBeVisible();
}

/** Waits until the first page preview is drawn. */
export async function waitForPage(page: Page) {
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 15000 });
}
