import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, openFixture, pagePoint, waitForPage } from "./helpers";

test("reply to a markup and to a reply, see the thread in the Markups List, undo, and save with /IRT", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-rectangle").click();
  await drag(page, await pagePoint(page, 0.2, 0.2), await pagePoint(page, 0.3, 0.3));

  await page.getByTestId("reply-input").fill("Is this wall fire rated?");
  await page.getByTestId("reply-add").click();
  await expect(page.getByTestId("reply")).toHaveCount(1);
  await page.getByTestId("reply-answer").click();
  await page.getByTestId("reply-input").fill("Yes, FRL 90/90/90.");
  await page.getByTestId("reply-input").press("Control+Enter");
  await expect(page.getByTestId("reply")).toHaveCount(2);
  await expect(page.getByTestId("reply").nth(1)).toHaveAttribute("style", /margin-left: 14px/);

  await page.getByTestId("tb-markups-list").click();
  const toggle = page.getByTestId("ml-replies-toggle");
  await expect(toggle).toHaveText("▸ 2");
  await toggle.click();
  await expect(page.getByTestId("ml-reply-row")).toHaveCount(2);
  await expect(page.getByTestId("ml-reply-row").nth(1)).toContainText("FRL 90/90/90");
  // filtering finds markups by their replies
  await page.getByTestId("ml-filter").fill("FRL");
  await expect(page.getByTestId("ml-count")).toContainText("1 of 1");
  await page.getByTestId("ml-filter").fill("");

  // each reply is an undo step
  await page.getByTestId("ml-filter").focus();
  await page.locator("body").click({ position: { x: 5, y: 990 } });
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("ml-reply-row")).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("ml-reply-row")).toHaveCount(2);

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const annots = (doc.loadPage(0) as mupdf.PDFPage).getObject().get("Annots");
  const replies: mupdf.PDFObject[] = [];
  let square: mupdf.PDFObject | null = null;
  for (let i = 0; i < annots.length; i++) {
    const a = annots.get(i);
    if (a.get("Subtype").asName() === "Square") square = a;
    if (a.get("RT").isName() && a.get("RT").asName() === "R") replies.push(a);
  }
  expect(replies).toHaveLength(2);
  const first = replies.find((r) => r.get("Contents").asString().startsWith("Is this"))!;
  const second = replies.find((r) => r.get("Contents").asString().startsWith("Yes"))!;
  expect(first.get("IRT").asIndirect()).toBe(square!.asIndirect());
  expect(second.get("IRT").asIndirect()).toBe(first.asIndirect());
});
