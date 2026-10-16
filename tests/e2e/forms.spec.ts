import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { openFixture, pagePoint, waitForPage } from "./helpers";

const values = (bytes: Uint8Array) => {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const out: Record<string, string> = {};
  for (const w of (doc.loadPage(0) as mupdf.PDFPage).getWidgets()) if (w.getValue() !== "Off" || !(w.getName() in out)) out[w.getName()] = w.getValue();
  return { out, widgets: (doc.loadPage(0) as mupdf.PDFPage).getWidgets().length };
};

test("fill a form in the panel and on the page, undo, save, then flatten", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await openFixture(page, "form.pdf");
  await waitForPage(page);
  await page.getByTestId("panel-forms").click();
  await expect(page.getByTestId("form-field")).toHaveCount(4);

  const name = page.locator('[data-testid="form-input"][data-field="project_name"]');
  await name.fill("Library fit-out");
  await page.locator('select[data-field="discipline"]').selectOption("Electrical");
  // check boxes and radio buttons toggle where they are drawn (page is 595 x 842 pt)
  const box = await pagePoint(page, 168 / 595, (842 - 650) / 842);
  await page.mouse.click(box.x, box.y);
  await expect(page.locator('[data-field="approved"]')).toBeChecked();
  const tender = await pagePoint(page, 287 / 595, (842 - 552) / 842);
  await page.mouse.click(tender.x, tender.y);
  await expect(page.locator('input[data-field="stage"][value="Tender"]')).toBeChecked();
  await expect(page.getByTestId("form-summary")).toHaveText("4 fields, 4 unsaved");

  // undo the radio button
  await page.locator(".viewer").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator('input[data-field="stage"][value="Tender"]')).not.toBeChecked();

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const saved = values(new Uint8Array(readFileSync(await (await dl).path())));
  expect(saved.out.project_name).toBe("Library fit-out");
  expect(saved.out.discipline).toBe("Electrical");
  expect(saved.out.approved).not.toBe("Off");
  expect(saved.out.stage).toBe("Off");
  await expect(page.getByTestId("form-summary")).toHaveText("4 fields");

  page.once("dialog", (d) => d.accept());
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("form-flatten").click();
  const flat = new Uint8Array(readFileSync(await (await dl2).path()));
  expect(values(flat).widgets).toBe(0);
  const text = mupdf.Document.openDocument(flat, "application/pdf").loadPage(0).toStructuredText("").asText();
  expect(text).toContain("Library fit-out");
  await expect(page.getByTestId("forms-panel")).toContainText("This document has no form fields.");
});
