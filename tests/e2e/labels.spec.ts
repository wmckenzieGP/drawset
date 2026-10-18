import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, openFixture, pagePoint, waitForPage } from "./helpers";

test("label all pages from the title block box, make bookmarks, and save them", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Label pages from title block…" }).click();
  // A1 landscape: the sheet-number cell is the bottom-right corner of the title block
  const w = 2383.94;
  const h = 1683.78;
  await drag(page, await pagePoint(page, (w - 140) / w, (h - 80) / h), await pagePoint(page, (w - 20) / w, (h - 20) / h));
  await expect(page.getByTestId("label-summary")).toHaveText("Found text on 200 of 200 pages. Pages with nothing in the box keep their label.", { timeout: 20000 });
  await expect(page.getByTestId("label-preview").locator("li").first()).toContainText("M-1 → M-001");
  await page.getByTestId("label-apply").click();
  await expect(page.getByTestId("goto-page")).toHaveValue("M-001");
  await page.getByTestId("panel-bookmarks").click();
  await expect(page.getByText("M-150", { exact: true })).toBeAttached();

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  expect(doc.loadPage(41).getLabel()).toBe("M-042");
  expect(doc.loadOutline()?.length).toBe(200);
});
