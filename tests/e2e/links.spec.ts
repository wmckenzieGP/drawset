import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test("draw a link to a sheet, follow it, go back, change it to a web address, and save", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.keyboard.press("Shift+H");
  await drag(page, await pagePoint(page, 0.3, 0.3), await pagePoint(page, 0.5, 0.45));
  await expect(page.getByTestId("link-dialog")).toBeVisible();
  await page.getByTestId("link-page").fill("M-42");
  await page.getByTestId("link-note").fill("Plant room");
  await page.getByTestId("link-ok").click();
  const ms = await markups(page);
  expect(ms.map((m) => m.kind)).toEqual(["link"]);
  await expect(page.getByTestId("prop-link-target")).toHaveText("Page M-42 (42)");

  // a plain click with the select tool follows it
  await page.keyboard.press("Escape");
  await page.locator(".viewer").first().click({ position: { x: 5, y: 5 } });
  const mid = await pagePoint(page, 0.4, 0.37);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByTestId("page-position")).toHaveText("(42 of 200)");
  await expect(page.getByTestId("goto-page")).toHaveValue("M-42");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("page-position")).toHaveText("(1 of 200)");
  await page.getByTestId("nav-forward").click();
  await expect(page.getByTestId("page-position")).toHaveText("(42 of 200)");
  await page.getByTestId("nav-back").click();
  await expect(page.getByTestId("page-position")).toHaveText("(1 of 200)");

  // Shift-click selects it; change the target to a web address with a border
  const mid2 = await pagePoint(page, 0.4, 0.37);
  await page.keyboard.down("Shift");
  await page.mouse.click(mid2.x, mid2.y);
  await page.keyboard.up("Shift");
  await page.getByTestId("prop-link-edit").click();
  await page.getByTestId("link-type-url").check();
  await page.getByTestId("link-url").fill("example.com/specs");
  await page.getByTestId("link-border").check();
  await page.getByTestId("link-ok").click();
  await expect(page.getByTestId("prop-link-target")).toHaveText("https://example.com/specs");

  // following a web link asks first (cancelled here)
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.keyboard.press("Escape");
  await page.locator(".viewer").first().click({ position: { x: 5, y: 5 } });
  await page.mouse.click(mid2.x, mid2.y);
  await expect.poll(() => asked).toContain("https://example.com/specs");

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const p0 = mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0);
  expect(p0.getLinks().map((l) => l.getURI())).toEqual(["https://example.com/specs"]);
});
