import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test("mark search results and an area, review, apply: the text is gone from the saved file", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.getByTestId("panel-search").click();
  await page.getByTestId("search-input").fill("CALIBRATION SHEET");
  await page.getByTestId("search-input").press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 result");
  await page.getByTestId("search-redact").click();
  await page.getByTestId("tool-erase").click();
  await drag(page, await pagePoint(page, 0.05, 0.8), await pagePoint(page, 0.3, 0.9));
  await expect.poll(async () => (await markups(page)).map((m) => m.kind).sort()).toEqual(["erase", "redact"]);

  await page.getByTestId("menu-tools").click();
  await page.getByRole("menuitem", { name: "Review and apply redactions…" }).click();
  await expect(page.getByTestId("redact-list").locator("li")).toHaveCount(2);
  const dl = page.waitForEvent("download");
  await page.getByTestId("redact-apply").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const text = (doc.loadPage(0) as mupdf.PDFPage).toStructuredText("").asText();
  expect(text).not.toContain("CALIBRATION SHEET");
  expect(text).toContain("C-D vertical");
  expect((doc.loadPage(0) as mupdf.PDFPage).getAnnotations().filter((a) => a.getType() === "Redact")).toHaveLength(0);
  await expect(page.getByTestId("markup-count")).toHaveText("0 markups");
});
