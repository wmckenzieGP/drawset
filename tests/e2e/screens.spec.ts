import { test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { drag, fixture, openFixture, pagePoint, waitForPage } from "./helpers";

/** Screenshots for docs/screenshots (run with SCREENSHOTS=1). */
test.skip(!process.env.SCREENSHOTS, "screenshots only on request");

const known = JSON.parse(readFileSync(fixture("calibration.json"), "utf8"));
const A3 = [420 * 72 / 25.4, 297 * 72 / 25.4];

test("markups and measurements", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tb-markups-list").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/markups.png" });

  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const at = async (p: number[]) => {
    const box = (await page.locator('.page[data-page="0"]').boundingBox())!;
    return { x: box.x + (p[0] / A3[0]) * box.width, y: box.y + ((A3[1] - p[1]) / A3[1]) * box.height };
  };
  await page.getByTestId("calibrate-open").click();
  await page.getByTestId("cal-preset").selectOption("1:100");
  await page.getByTestId("cal-display").selectOption("m");
  await page.getByTestId("cal-ok").click();
  await page.getByTestId("tool-length").click();
  await drag(page, await at(known.horizontal.from), await at(known.horizontal.to), 10);
  const r = known.room.rect;
  await page.getByTestId("tool-area").click();
  const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  for (const [i, p] of corners.entries()) {
    const s = await at(p);
    if (i === 3) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
  await page.getByTestId("tool-angle").click();
  for (const p of [known.hypotenuse.to, known.hypotenuse.from, [known.hypotenuse.to[0], known.hypotenuse.from[1]]]) {
    const s = await at(p);
    await page.mouse.click(s.x, s.y);
  }
  await page.getByTestId("tool-count").click();
  for (const fx of [0.75, 0.8, 0.85]) {
    const s = await pagePoint(page, fx, 0.85);
    await page.mouse.click(s.x, s.y);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/measurements.png" });
});

test("overlay, Tool Chest and replies", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-cloud").click();
  await drag(page, await pagePoint(page, 0.55, 0.25), await pagePoint(page, 0.75, 0.45));
  await page.getByTestId("prop-subject").fill("Fire rating query");
  await page.getByTestId("prop-subject").press("Enter");
  await page.getByTestId("reply-input").fill("Is this wall fire rated?");
  await page.getByTestId("reply-add").click();
  await page.getByTestId("reply-answer").click();
  await page.getByTestId("reply-input").fill("Yes, FRL 90/90/90 to the stair core.");
  await page.getByTestId("reply-add").click();
  await page.getByTestId("panel-toolchest").click();
  await page.getByTestId("tc-add").click();
  await page.getByTestId("tb-markups-list").click();
  await page.getByTestId("ml-show-replies").check();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "docs/screenshots/replies-toolchest.png" });

  await openFixture(page, "dense-a1.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Overlay pages…" }).click();
  await page.getByTestId("overlay-b-file").selectOption({ label: "calibration.pdf" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/overlay.png" });
});

test("Tier 3: compare, split view, forms, headers, links, security, OCR", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await openFixture(page, "calibration-rev.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Compare documents…" }).click();
  await page.getByTestId("overlay-cloud-all").click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.getByTestId("tb-markups-list").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/compare.png" });
  await page.getByTestId("tb-markups-list").click();

  await page.getByTestId("menu-view").click();
  await page.getByRole("menuitem", { name: "Split view" }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/split-view.png" });
  await page.getByTestId("menu-view").click();
  await page.getByRole("menuitem", { name: "Close split view" }).click();

  await openFixture(page, "form.pdf");
  await waitForPage(page);
  await page.getByTestId("panel-forms").click();
  await page.getByTestId("form-input").first().fill("Library fit-out");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/forms.png" });

  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Headers, footers and watermark…" }).click();
  await page.getByTestId("hf-bc").fill("Sheet {page} of {pages}");
  await page.getByTestId("hf-tr").fill("{label}");
  await page.getByTestId("hf-wm-on").check();
  await page.getByTestId("hf-wm-text").fill("FOR REVIEW");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/header-footer.png" });
  await page.getByTestId("hf-apply").click();
  await page.waitForTimeout(1200);
  await page.getByTestId("tool-link").click();
  await drag(page, await pagePoint(page, 0.1, 0.1), await pagePoint(page, 0.3, 0.2));
  await page.getByTestId("link-type-page").check();
  await page.getByTestId("link-page").fill("42");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/screenshots/link.png" });
  await page.getByTestId("link-ok").click();

  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Security…" }).click();
  await page.getByTestId("sec-open").check();
  await page.getByTestId("sec-restrict").check();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/screenshots/security.png" });
  await page.keyboard.press("Escape");

  await openFixture(page, "scanned-text.pdf");
  await waitForPage(page);
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Recognise text (OCR)…" }).click();
  await page.getByTestId("ocr-start").click();
  await page.getByTestId("ocr-dialog").waitFor({ state: "hidden", timeout: 90000 });
  await page.getByTestId("panel-search").click();
  await page.getByTestId("search-input").fill("DIMENSIONS");
  await page.getByTestId("search-input").press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/ocr.png" });
});
