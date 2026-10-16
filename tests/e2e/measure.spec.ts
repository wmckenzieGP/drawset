import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, fixture, markups, openFixture, waitForPage } from "./helpers";

const known = JSON.parse(readFileSync(fixture("calibration.json"), "utf8"));
const A3 = [420 * 72 / 25.4, 297 * 72 / 25.4];

/** Screen point of a PDF user-space point on page 0 (no /Rotate on the fixture). */
async function at(page: Page, p: number[]) {
  const box = (await page.locator('.page[data-page="0"]').boundingBox())!;
  return { x: box.x + (p[0] / A3[0]) * box.width, y: box.y + ((A3[1] - p[1]) / A3[1]) * box.height };
}

async function clicks(page: Page, pts: number[][], finish: "dbl" | "none" = "dbl") {
  for (const [i, p] of pts.entries()) {
    const s = await at(page, p);
    if (finish === "dbl" && i === pts.length - 1) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
}

test("calibrate by two points, measure length, area with cutout and count, save with /VP", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-calibrate").click();
  await drag(page, await at(page, known.horizontal.from), await at(page, known.horizontal.to), 12);
  await expect(page.getByTestId("calibrate-dialog")).toBeVisible();
  await page.getByTestId("cal-known").fill("10");
  await page.getByTestId("cal-known-unit").selectOption("m");
  await page.getByTestId("cal-display").selectOption("m");
  await page.getByTestId("cal-precision").selectOption("2");
  await page.getByTestId("cal-ok").click();
  // clicking at screen resolution lands within a pixel; at fit-page scale that is well inside 1:100 ± 0.5%
  await expect(page.getByTestId("page-scale")).toHaveText(/^1:(99|100|101)/);

  // switch to the exact preset so the remaining checks are exact
  await page.getByTestId("calibrate-open").click();
  await page.getByTestId("cal-preset").selectOption("1:100");
  await page.getByTestId("cal-ok").click();
  await expect(page.getByTestId("page-scale")).toHaveText("1:100");

  await page.getByTestId("tool-length").click();
  await drag(page, await at(page, known.vertical.from), await at(page, known.vertical.to), 12);
  await expect(page.getByTestId("measure-value")).toHaveText(/^Length: 5\.0\d m$|^Length: 4\.9\d m$/);

  const r = known.room.rect;
  const c = known.room.cutout;
  await page.getByTestId("tool-area").click();
  await clicks(page, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
  await expect(page.getByTestId("measure-value")).toHaveText(/^Area: 3[12]\.\d\d m²$/);
  await page.getByTestId("tool-cutout").click();
  await clicks(page, [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]]);
  await expect(page.getByTestId("measure-value")).toContainText("(1 cutout)");
  await expect(page.getByTestId("measure-value")).toHaveText(/^Area: (29|30)\.\d\d m²/);

  await page.getByTestId("tool-count").click();
  await clicks(page, [[100, 500], [150, 500], [200, 500]], "none");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await markups(page)).map((m) => m.kind).sort()).toEqual(["area", "count", "length"]);

  // totals in the Markups List
  await page.getByTestId("tb-markups-list").click();
  await expect(page.getByTestId("ml-totals")).toContainText("Count (1): 3");
  const q = page.waitForEvent("download");
  await page.getByTestId("ml-export-quantities").click();
  const csv = readFileSync(await (await q).path(), "utf8");
  expect(csv).toContain("Total,,Area,1 item,");

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const pg = doc.loadPage(0) as mupdf.PDFPage;
  expect(pg.getObject().get("VP").get(0).get("Measure").get("R").asString()).toBe("1 mm = 100 mm");
  const its = pg.getAnnotations().map((a) => a.getObject().get("IT")).filter((x) => x.isName()).map((x) => x.asName()).sort();
  expect(its).toEqual(["LineDimension", "PolygonDimension"]);
  // values survive the save (the app reopens from the saved bytes)
  await page.getByTestId("ml-row").filter({ hasText: "Area" }).click();
  await expect(page.getByTestId("measure-value")).toHaveText(/^Area: (29|30)\.\d\d m²/);
});
