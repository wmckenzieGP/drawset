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

/** A point on page `index` as a fraction of its on-screen box. */
export async function pagePoint(page: Page, fx: number, fy: number, index = 0) {
  const box = (await page.locator(`.page[data-page="${index}"]`).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

export async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 8) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

/** Reads the active tab's markups from the app store. */
export async function markups(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return t ? (Object.values(t.state.markups) as any[]).map((m) => ({ id: m.id, kind: m.kind, rect: m.rect as number[], status: m.status, contents: m.contents, locked: m.locked })) : [];
  });
}
