import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, fixture, pagePoint, waitForPage } from "./helpers";

test("open a protected file, unlock it to save markups, then remove its security", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("tb-open").click();
  await (await chooser).setFiles(fixture("secured.pdf"));
  await expect(page.getByTestId("ask-dialog")).toContainText("secured.pdf is protected");
  await page.getByTestId("ask-input").fill("wrong");
  await page.getByTestId("ask-ok").click();
  await expect(page.getByTestId("ask-dialog")).toContainText("That password is not right");
  await page.getByTestId("ask-input").fill("drawset");
  await page.getByTestId("ask-ok").click();
  await waitForPage(page);
  await expect(page.getByTestId("security-status")).toHaveText("Restricted");

  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, 0.6, 0.6), await pagePoint(page, 0.8, 0.7));
  await page.getByTestId("tb-save").click();
  await expect(page.getByTestId("ask-dialog")).toContainText("do not allow adding or changing markups");
  await page.getByTestId("ask-input").fill("owner-pw");
  const dl = page.waitForEvent("download");
  await page.getByTestId("ask-ok").click();
  const saved = new Uint8Array(readFileSync(await (await dl).path()));
  const d = mupdf.Document.openDocument(saved, "application/pdf");
  expect(d.needsPassword()).toBe(true);
  expect(d.authenticatePassword("drawset")).toBeGreaterThan(0);
  expect((d.loadPage(0) as mupdf.PDFPage).getAnnotations().some((a) => a.getType() === "Square")).toBe(true);
  await expect(page.getByTestId("security-status")).toHaveText("Secured");

  await page.getByTestId("security-status").click();
  await expect(page.getByTestId("security-current")).toContainText("Password to open");
  await page.getByTestId("sec-remove").click();
  await expect(page.getByTestId("security-status")).toHaveText("Unsecured on save");
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const clear = new Uint8Array(readFileSync(await (await dl2).path()));
  expect(mupdf.Document.openDocument(clear, "application/pdf").needsPassword()).toBe(false);
  await expect(page.getByTestId("security-status")).toBeHidden();

  // and set new security from the dialog
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Security…" }).click();
  await page.getByTestId("sec-open").check();
  await page.getByTestId("sec-pw").fill("site-2026");
  await page.getByTestId("sec-pw2").fill("site-2026");
  await page.getByTestId("sec-apply").click();
  const dl3 = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const again = mupdf.Document.openDocument(new Uint8Array(readFileSync(await (await dl3).path())), "application/pdf");
  expect(again.needsPassword()).toBe(true);
  expect(again.authenticatePassword("site-2026")).toBeGreaterThan(0);
});
