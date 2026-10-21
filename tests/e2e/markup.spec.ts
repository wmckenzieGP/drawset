import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
});

test("draws each shape tool, then undoes and redoes", async ({ page }) => {
  const shapes = ["rectangle", "ellipse", "line", "arrow", "cloud", "pen", "highlighter"];
  for (const [i, tool] of shapes.entries()) {
    await page.getByTestId(`tool-${tool}`).click();
    const y = 0.15 + i * 0.1;
    await drag(page, await pagePoint(page, 0.2, y), await pagePoint(page, 0.35, y + 0.06));
  }
  const ms = await markups(page);
  expect(ms.map((m) => m.kind).sort()).toEqual([...shapes].sort());
  await expect(page.getByTestId("markup-count")).toHaveText(`${shapes.length} markups`);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("markup-count")).toHaveText(`${shapes.length - 1} markups`);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("markup-count")).toHaveText(`${shapes.length} markups`);
});

test("polyline and polygon by clicking points", async ({ page }) => {
  for (const tool of ["polyline", "polygon"]) {
    await page.getByTestId(`tool-${tool}`).click();
    const y = tool === "polyline" ? 0.3 : 0.6;
    for (const [fx, fy] of [[0.5, y], [0.6, y + 0.05], [0.7, y]]) {
      const p = await pagePoint(page, fx, fy);
      await page.mouse.click(p.x, p.y);
    }
    const last = await pagePoint(page, 0.75, y + 0.08);
    await page.mouse.dblclick(last.x, last.y);
  }
  expect((await markups(page)).map((m) => m.kind).sort()).toEqual(["polygon", "polyline"]);
});

test("moves and resizes a markup with the select tool, and undo restores it", async ({ page }) => {
  await page.getByTestId("tool-rectangle").click();
  const a = await pagePoint(page, 0.3, 0.3);
  const b = await pagePoint(page, 0.5, 0.5);
  await drag(page, a, b);
  await page.getByTestId("tool-select").click();
  const [before] = await markups(page);
  // grab the top edge a quarter of the way along (away from the handles) and move it
  const grab = { x: a.x + (b.x - a.x) / 4, y: a.y };
  await drag(page, grab, { x: grab.x + 60, y: grab.y + 30 });
  const [moved] = await markups(page);
  expect(moved.rect[0]).toBeGreaterThan(before.rect[0] + 5);
  expect(moved.rect[2] - moved.rect[0]).toBeCloseTo(before.rect[2] - before.rect[0], 1);
  // bottom-right handle resizes
  const br = { x: b.x + 60, y: b.y + 30 };
  await drag(page, br, { x: br.x + 40, y: br.y + 40 });
  const [resized] = await markups(page);
  expect(resized.rect[2] - resized.rect[0]).toBeGreaterThan(moved.rect[2] - moved.rect[0] + 5);
  await page.getByTestId("tb-undo").click();
  await page.getByTestId("tb-undo").click();
  const [back] = await markups(page);
  expect(back.rect).toEqual(before.rect);
});

test("text box: type text, set status, save, and the file has the markup", async ({ page }) => {
  await page.getByTestId("tool-textbox").click();
  await drag(page, await pagePoint(page, 0.6, 0.2), await pagePoint(page, 0.8, 0.27));
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Check RL 12.450");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await markups(page))[0]?.contents).toBe("Check RL 12.450");
  await page.getByTestId("tool-select").click();
  const p = await pagePoint(page, 0.7, 0.235);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("prop-status")).toBeVisible();
  await page.getByTestId("prop-status").selectOption("Accepted");
  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const file = await (await dl).path();
  const bytes = new Uint8Array(readFileSync(file));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const annots = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations();
  const ft = annots.find((x) => x.getType() === "FreeText")!;
  expect(ft.getObject().get("Contents").asString()).toBe("Check RL 12.450");
  const state = annots.find((x) => x.getObject().get("StateModel").isName());
  expect(state?.getObject().get("State").asName()).toBe("Accepted");
  await expect(page.getByTestId("markup-count")).toHaveText("1 markup");
});

test("built-in stamp and note", async ({ page }) => {
  await page.getByTestId("tool-stamp").click();
  await page.getByTestId("stamp-approved").click();
  const p = await pagePoint(page, 0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId("tool-note").click();
  const q = await pagePoint(page, 0.8, 0.8);
  await page.mouse.click(q.x, q.y);
  await expect.poll(async () => (await markups(page)).map((m) => m.kind).sort()).toEqual(["note", "stamp"]);
});

test("save a copy keeps the document open and unsaved; flatten asks first", async ({ page }) => {
  await page.getByTestId("tool-rectangle").click();
  await drag(page, await pagePoint(page, 0.3, 0.3), await pagePoint(page, 0.5, 0.5));
  const copy = page.waitForEvent("download");
  await page.keyboard.press("Control+Shift+S");
  const copyBytes = new Uint8Array(readFileSync(await (await copy).path()));
  const cdoc = mupdf.Document.openDocument(copyBytes, "application/pdf").asPDF()!;
  expect((cdoc.loadPage(0) as mupdf.PDFPage).getAnnotations().map((a) => a.getType())).toContain("Square");
  await expect(page.locator(".tab").first()).toContainText("•");

  // cancelling the confirmation changes nothing
  page.once("dialog", (d) => d.dismiss());
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Flatten markups…" }).click();
  await expect(page.getByTestId("markup-count")).toHaveText("1 markup");

  page.once("dialog", (d) => d.accept());
  const dl = page.waitForEvent("download");
  await page.getByTestId("menu-document").click();
  await page.getByRole("menuitem", { name: "Flatten markups…" }).click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  expect((doc.loadPage(0) as mupdf.PDFPage).getAnnotations()).toHaveLength(0);
  await expect(page.getByTestId("markup-count")).toHaveText("0 markups");
});

test("properties panel changes are single undo steps and reach the saved file", async ({ page }) => {
  await page.getByTestId("tool-arrow").click();
  await drag(page, await pagePoint(page, 0.3, 0.3), await pagePoint(page, 0.6, 0.4));
  await expect(page.getByTestId("prop-width")).toBeVisible();
  await page.getByTestId("prop-width").fill("4");
  await page.getByTestId("prop-dash").selectOption({ index: 1 });
  await page.getByTestId("prop-line-start").selectOption("Circle");
  const style = () => page.evaluate(() => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return (Object.values(t.state.markups)[0] as any).style;
  });
  expect((await style()).width).toBe(4);
  expect((await style()).dash).not.toBeNull();
  // Ctrl+Z from a list in the panel undoes the last change (text fields keep their own undo)
  await page.getByTestId("prop-line-start").focus();
  await page.keyboard.press("Control+z");
  expect((await style()).lineStart).toBe("None");
  expect((await style()).dash).not.toBeNull();
  await page.keyboard.press("Control+y");
  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const line = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations().find((a) => a.getType() === "Line")!.getObject();
  expect(line.get("BS").get("W").asNumber()).toBe(4);
  expect(line.get("BS").get("S").asName()).toBe("D");
  expect(line.get("LE").get(0).asName()).toBe("Circle");
});

test("a box's fill opacity is set apart from its line's, and Highlight lets the drawing show through", async ({ page }) => {
  await page.getByTestId("tool-rectangle").click();
  await drag(page, await pagePoint(page, 0.3, 0.3), await pagePoint(page, 0.6, 0.5));
  await page.getByTestId("prop-fill").fill("#ffff00");
  await page.getByTestId("prop-opacity").fill("80");
  await page.getByTestId("prop-fill-opacity").fill("40");
  await page.getByTestId("prop-highlight").check();
  const style = () => page.evaluate(() => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return (Object.values(t.state.markups)[0] as any).style;
  });
  expect(await style()).toMatchObject({ fill: [1, 1, 0], opacity: 0.8, fillOpacity: 0.4, blend: "Multiply" });
  // drawn on the layer that blends like a highlighter
  const inked = () => page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(".overlay-multiply")!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  await expect.poll(inked).toBeGreaterThan(1000);
  // Highlight off again is one undo away
  await page.getByTestId("prop-highlight").uncheck();
  expect((await style()).blend).toBeUndefined();
  await expect.poll(inked).toBe(0);
  await page.keyboard.press("Control+z");
  expect((await style()).blend).toBe("Multiply");

  const dl = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const bytes = new Uint8Array(readFileSync(await (await dl).path()));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const sq = (doc.loadPage(0) as mupdf.PDFPage).getAnnotations().find((a) => a.getType() === "Square")!.getObject();
  expect(sq.get("CA").asNumber()).toBeCloseTo(0.8, 3);
  expect(sq.get("ca").asNumber()).toBeCloseTo(0.4, 3);
  expect(sq.get("BM").asName()).toBe("Multiply");
});
