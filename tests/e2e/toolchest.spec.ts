import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

async function fullMarkups(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return (Object.values(t.state.markups) as any[]).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id)).map((m) => ({ kind: m.kind, style: m.style, subject: m.subject, rect: m.rect }));
  });
}

test("save a markup as a tool, draw and place with it, export and import the set, and keep it after a restart", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);

  await page.getByTestId("tool-rectangle").click();
  await drag(page, await pagePoint(page, 0.2, 0.2), await pagePoint(page, 0.3, 0.3));
  await page.getByTestId("prop-width").fill("4");
  await page.getByTestId("prop-dash").selectOption({ index: 2 });
  const original = (await fullMarkups(page))[0];
  expect(original.style.width).toBe(4);

  await page.getByTestId("panel-toolchest").click();
  await page.getByTestId("tc-add").click();
  await expect(page.getByTestId("tc-tool")).toHaveCount(1);

  // drawing mode: a new rectangle with the saved properties
  await page.getByTestId("tc-tool").locator(".tc-use").click();
  await drag(page, await pagePoint(page, 0.5, 0.5), await pagePoint(page, 0.7, 0.6));
  let ms = await fullMarkups(page);
  expect(ms).toHaveLength(2);
  expect(ms[1].style).toEqual(original.style);
  expect(ms[1].subject).toBe(original.subject);

  // copy mode: one click places the same markup, same size
  await page.getByTestId("tc-set").getByTestId("tc-mode").click();
  await expect(page.getByTestId("tc-set").getByTestId("tc-mode")).toHaveText("Copy");
  await page.getByTestId("tc-set").locator(".tc-use").click();
  const at = await pagePoint(page, 0.6, 0.8);
  await page.mouse.click(at.x, at.y);
  ms = await fullMarkups(page);
  expect(ms).toHaveLength(3);
  expect(ms[2].style).toEqual(original.style);
  expect(ms[2].rect[2] - ms[2].rect[0]).toBeCloseTo(original.rect[2] - original.rect[0], 6);
  await expect(page.getByTestId("tc-recents").getByTestId("tc-tool")).toHaveCount(1);

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // export, then import as a second set
  const dl = page.waitForEvent("download");
  await page.getByTestId("tc-export-set").click();
  const file = await (await dl).path();
  const json = JSON.parse(readFileSync(file, "utf8"));
  expect(json.format).toBe("drawset-toolset");
  expect(json.tools[0].template.style.width).toBe(4);
  await page.getByTestId("tc-import-file").setInputFiles({ name: "site.json", mimeType: "application/json", buffer: readFileSync(file) });
  await expect(page.getByTestId("tc-set")).toHaveCount(2);

  // the chest is kept on this computer between sessions
  await page.reload();
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.getByTestId("panel-toolchest").click();
  await expect(page.getByTestId("tc-set")).toHaveCount(2);
  expect((await markups(page)).length).toBe(0);
});
