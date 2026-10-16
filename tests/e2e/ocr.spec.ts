import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { openFixture, waitForPage } from "./helpers";

const pageText = (bytes: Uint8Array) => mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0).toStructuredText("").asText();

test("recognise text on a scan offline, search it, undo and save", async ({ page }) => {
  test.setTimeout(120000);
  // text recognition must not reach the internet: every request stays on the app's own server
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !["blob:", "data:"].includes(u.protocol)) external.push(r.url());
  });
  await page.goto("/");
  await openFixture(page, "scanned-text.pdf");
  await waitForPage(page);

  // nothing to find before recognition
  await page.getByTestId("panel-search").click();
  await page.getByTestId("search-input").fill("MILLIMETRES");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("0 results", { timeout: 20000 });

  await page.getByTestId("menu-tools").click();
  await page.getByRole("menuitem", { name: "Recognise text (OCR)…" }).click();
  await expect(page.getByTestId("ocr-dialog")).toBeVisible();
  await page.getByTestId("ocr-current").check();
  await page.getByTestId("ocr-start").click();
  await expect(page.getByTestId("ocr-progress")).toBeVisible();
  await expect(page.getByTestId("ocr-dialog")).toBeHidden({ timeout: 90000 });
  await expect(page.getByText(/Recognised \d+ words on 1 page/)).toBeVisible();

  await page.getByTestId("search-input").fill("MILLIMETRES");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 result", { timeout: 20000 });

  // undo removes the text again; redo brings it back
  await page.getByTestId("search-input").blur();
  await page.keyboard.press("Control+z");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("0 results", { timeout: 20000 });
  await page.getByTestId("search-input").blur();
  await page.keyboard.press("Control+y");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 result", { timeout: 20000 });

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  expect(pageText(bytes)).toContain("ALL DIMENSIONS ARE IN MILLIMETRES");
  expect(pageText(bytes)).toContain("HOSPITAL STAGE 2");

  // a second run skips the page, which now has text
  await page.getByTestId("menu-tools").click();
  await page.getByRole("menuitem", { name: "Recognise text (OCR)…" }).click();
  await page.getByTestId("ocr-start").click();
  await expect(page.getByText(/already has text|already have text/)).toBeVisible({ timeout: 20000 });
  expect(external).toEqual([]);
});
