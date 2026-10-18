import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { openFixture, waitForPage } from "./helpers";

const pageText = (bytes: Uint8Array, i: number) => mupdf.Document.openDocument(bytes, "application/pdf").loadPage(i).toStructuredText("").asText();

test("add a footer with variables and a watermark, save, then remove them", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Headers, footers and watermark…" }).click();
  const footer = page.getByTestId("hf-bc");
  await footer.click();
  await footer.pressSequentially("Sheet ");
  await page.getByTestId("hf-var-page").click();
  await footer.pressSequentially(" of ");
  await page.getByTestId("hf-var-pages").click();
  await expect(footer).toHaveValue("Sheet {page} of {pages}");
  await page.getByTestId("hf-tr").fill("{label}");
  await page.getByTestId("hf-wm-on").check();
  await page.getByTestId("hf-wm-text").fill("FOR REVIEW");
  await page.getByTestId("hf-apply").click();
  await expect(page.getByTestId("hf-dialog")).toBeHidden();

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  expect(pageText(bytes, 0)).toContain("Sheet 1 of 200");
  expect(pageText(bytes, 0)).toContain("FOR REVIEW");
  expect(pageText(bytes, 41)).toContain("Sheet 42 of 200");
  expect(pageText(bytes, 41)).toContain("M-42");

  // the settings come back with the file and can be removed
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Headers, footers and watermark…" }).click();
  await expect(page.getByTestId("hf-bc")).toHaveValue("Sheet {page} of {pages}");
  await page.getByTestId("hf-remove").click();
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const clean = new Uint8Array(readFileSync(await (await dl2).path()));
  expect(pageText(clean, 0)).not.toContain("Sheet 1 of 200");
  expect(pageText(clean, 0)).not.toContain("FOR REVIEW");
});
