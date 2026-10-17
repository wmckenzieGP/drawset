import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { openFixture, waitForPage } from "./helpers";

test("overlay: identical pages show no colour, different files do, align by points, export an image PDF", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);

  await page.getByTestId("menu-tools").click();
  await page.getByRole("menuitem", { name: "Overlay pages…" }).click();
  const canvas = page.getByTestId("overlay-canvas");
  await expect(canvas).toHaveAttribute("data-ready", "1");
  // only one file open: page 1 against itself
  await expect(canvas).toHaveAttribute("data-colour", "0.00000");
  await expect(page.getByTestId("overlay-status")).toContainText("No differences");
  await page.keyboard.press("Escape");

  await openFixture(page, "dense-a1.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-tools").click();
  await page.getByRole("menuitem", { name: "Overlay pages…" }).click();
  await expect(canvas).toHaveAttribute("data-ready", "1");
  await page.getByTestId("overlay-b-file").selectOption({ label: "calibration.pdf" });
  await expect.poll(async () => Number(await canvas.getAttribute("data-colour"))).toBeGreaterThan(0.0005);
  const both = Number(await canvas.getAttribute("data-colour"));

  // hiding blue leaves only red ink
  await page.getByTestId("overlay-show-b").uncheck();
  await expect.poll(async () => Number(await canvas.getAttribute("data-colour"))).not.toBe(both);
  await page.getByTestId("overlay-show-b").check();

  // two points on red, then two on blue
  await page.getByTestId("overlay-align").click();
  await expect(page.getByTestId("overlay-status")).toContainText("point 1 of 2 on the red page");
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
  await at(0.2, 0.2);
  await at(0.8, 0.2);
  await expect(page.getByTestId("overlay-status")).toContainText("on the blue page");
  await at(0.2, 0.2);
  await at(0.8, 0.2);
  await expect(page.getByTestId("overlay-status")).not.toContainText("Click");

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const dl = page.waitForEvent("download");
  await page.getByTestId("overlay-export").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  expect(doc.countPages()).toBe(1);
  const p = doc.loadPage(0) as mupdf.PDFPage;
  const text = p.toStructuredText("").asText();
  expect(text).toContain("image-based, not vector content");
  expect(text).toContain("Aligned by two points");
  expect(p.getObject().get("Resources").get("XObject").get("Im0").get("Subtype").asName()).toBe("Image");
});
