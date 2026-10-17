import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test("Markups List stays smooth with 5,000 markups; filter, bulk status and CSV export", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-rectangle").click();
  await drag(page, await pagePoint(page, 0.2, 0.2), await pagePoint(page, 0.3, 0.3));
  // copy the drawn markup 4,999 times across the pages
  await page.evaluate(() => {
    const store = (window as any).__drawset.useApp;
    const s = store.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    const [m] = Object.values(t.state.markups) as any[];
    const markups: Record<string, any> = { [m.id]: m };
    for (let i = 1; i < 5000; i++) {
      const id = `bulk-${i}`;
      const page = t.state.pages[i % t.state.pages.length];
      markups[id] = { ...m, id, pageId: page.id, contents: i % 10 === 0 ? `Clash ${i}` : `Item ${i}`, author: i % 2 ? "Jo" : "Sam" };
    }
    store.setState({ tabs: s.tabs.map((x: any) => (x.key === t.key ? { ...x, state: { ...x.state, markups } } : x)) });
  });
  await page.getByTestId("tb-markups-list").click();
  await expect(page.getByTestId("ml-count")).toContainText("5,000");
  // the list is virtualised: only a screenful of rows exists
  expect(await page.getByTestId("ml-row").count()).toBeLessThan(80);
  // scrolling to the end keeps frames short
  const frames = await page.getByTestId("ml-body").evaluate(async (el) => {
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      el.scrollTop += 2200;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    return times.sort((a, b) => a - b);
  });
  const p95 = frames[Math.floor(frames.length * 0.95)];
  expect(p95).toBeLessThan(50);
  await page.getByTestId("ml-filter").fill("Clash");
  await expect(page.getByTestId("ml-count")).toContainText("499 of 5,000");
  // select a row and set its status from the list
  await page.getByTestId("ml-row").first().click();
  await page.getByTestId("ml-bulk-status").selectOption("Completed");
  await expect.poll(async () => (await markups(page)).filter((m) => m.status === "Completed").length).toBe(1);
  await expect(page.locator(".ml-row.selected")).toContainText("Completed");
  const dl = page.waitForEvent("download");
  await page.getByTestId("ml-export").click();
  const csv = readFileSync(await (await dl).path(), "utf8");
  expect(csv.trim().split(/\r\n/).length).toBe(500);
});

test("page operations from the thumbnails menu, undo, save", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("panel-thumbnails").click();
  await page.getByTestId("thumb-0").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rotate clockwise" }).click();
  await page.getByTestId("thumb-0").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert blank page after" }).click();
  await expect(page.getByTestId("page-position")).toContainText("of 3");
  await page.getByTestId("thumb-2").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete pages" }).click();
  await expect(page.getByTestId("page-position")).toContainText("of 2");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("page-position")).toContainText("of 3");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("page-position")).toContainText("of 2");
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("page-position")).toContainText("of 3");
  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  expect(doc.countPages()).toBe(3);
  expect(doc.findPage(0).getInheritable("Rotate").asNumber()).toBe(90);
  // markups kept: the square is still on page 1 with its status reply
  const subtypes = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations().map((a) => a.getType());
  expect(subtypes).toContain("Square");
  expect(await markups(page)).toHaveLength(8);
});

test("print view has the chosen pages at actual size", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.evaluate(() => {
    (window as any).__drawsetKeepPrint = true;
    window.print = () => undefined;
  });
  await page.keyboard.press("Control+p");
  await page.getByTestId("print-range").fill("2-4");
  await page.getByTestId("print-actual").check();
  await page.getByTestId("print-go").click();
  const root = page.getByTestId("print-root");
  await expect(root.locator("img")).toHaveCount(3, { timeout: 30000 });
  // the set is A1 landscape: 841 × 594 mm
  const style = (await root.locator("img").first().getAttribute("style"))!;
  const [w, h] = [/width: ([\d.]+)mm/, /height: ([\d.]+)mm/].map((re) => parseFloat(re.exec(style)![1]));
  expect(w).toBeCloseTo(841, 0);
  expect(h).toBeCloseTo(594, 0);
});
