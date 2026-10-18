import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { drag, markups, openFixture, pagePoint, waitForPage } from "./helpers";

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return { tool: s.tools.tool, scale: t.view.scale, mode: t.view.mode, current: t.currentPage, selection: t.selection as string[], left: s.leftPanel, right: s.rightPanel, pages: t.state.pages.map((p: any) => p.id) as string[], markups: Object.values(t.state.markups).map((m: any) => ({ id: m.id, pageId: m.pageId })) };
  });
const scrollTop = (page: Page) => page.getByTestId("viewer").evaluate((el) => el.scrollTop);

test("a text box dragged onto the next page lands there and can still be selected", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  // zoom out so both pages are on screen
  for (let i = 0; i < 4; i++) await page.keyboard.press("Minus");
  await expect(page.locator('.page[data-page="1"]')).toBeVisible();
  await page.keyboard.press("t");
  await drag(page, await pagePoint(page, 0.3, 0.8), await pagePoint(page, 0.5, 0.9));
  await page.getByTestId("text-editor").fill("Moves pages");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const box = (await markups(page)).find((m) => m.contents === "Moves pages")!;
  // drag it from page 1 down onto page 2
  await drag(page, await pagePoint(page, 0.4, 0.85), await pagePoint(page, 0.4, 0.3, 1), 12);
  const s = await state(page);
  expect(s.markups.find((m) => m.id === box.id)!.pageId).toBe(s.pages[1]);
  // click elsewhere, then on it again: it is selected
  const empty = await pagePoint(page, 0.9, 0.1, 1);
  await page.mouse.click(empty.x, empty.y);
  expect((await state(page)).selection).toEqual([]);
  const on = await pagePoint(page, 0.4, 0.3, 1);
  await page.mouse.click(on.x, on.y);
  expect((await state(page)).selection).toEqual([box.id]);
});

test("page layouts: single page, continuous, side by side; page keys and the navigation bar", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  expect((await state(page)).mode).toBe("continuous");
  await page.keyboard.press("Control+4");
  await expect(page.locator(".page")).toHaveCount(1);
  await expect(page.getByTestId("mode-single")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("page-position")).toHaveText("(2 of 200)");
  await expect(page.locator('.page[data-page="1"]')).toBeVisible();
  await page.keyboard.press("Control+ArrowRight");
  await expect(page.getByTestId("page-position")).toHaveText("(3 of 200)");
  await page.getByTestId("nav-prev").click();
  await expect(page.getByTestId("page-position")).toHaveText("(2 of 200)");
  await page.keyboard.press("End");
  await expect(page.getByTestId("page-position")).toHaveText("(200 of 200)");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("page-position")).toHaveText("(1 of 200)");
  // side by side shows a pair, and steps by two
  await page.keyboard.press("Control+6");
  await expect(page.locator(".page")).toHaveCount(2);
  const [a, b] = [(await page.locator('.page[data-page="0"]').boundingBox())!, (await page.locator('.page[data-page="1"]').boundingBox())!];
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  expect(Math.abs(b.y - a.y)).toBeLessThan(1);
  await page.getByTestId("nav-next").click();
  await expect(page.locator('.page[data-page="2"]')).toBeVisible();
  await expect(page.locator('.page[data-page="3"]')).toBeVisible();
  // continuous side by side: pairs in a column
  await page.keyboard.press("Control+7");
  await expect(page.getByTestId("mode-continuousSideBySide")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+5");
  expect((await state(page)).mode).toBe("continuous");
  // the page stays where it was
  await expect(page.getByTestId("page-position")).toHaveText("(3 of 200)");
});

test("the wheel scrolls or zooms by layout, Ctrl does the other, and the bar switches it", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  const v = (await page.getByTestId("viewer").boundingBox())!;
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  // continuous: the wheel scrolls
  await expect(page.getByTestId("wheel-mode")).toHaveAttribute("data-wheel", "scroll");
  const s0 = await state(page);
  const t0 = await scrollTop(page);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(t0 + 100);
  expect((await state(page)).scale).toBe(s0.scale);
  // Ctrl+wheel zooms
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await state(page)).scale).toBeGreaterThan(s0.scale);
  // switch the wheel to zoom for continuous layouts
  await page.getByTestId("wheel-mode").click();
  await expect(page.getByTestId("wheel-mode")).toHaveAttribute("data-wheel", "zoom");
  const s1 = (await state(page)).scale;
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await state(page)).scale).toBeLessThan(s1);
  // single page: the wheel zooms by default; set it to scroll and scrolling past the end turns the page
  await page.keyboard.press("Control+4");
  await page.keyboard.press("Control+9");
  await expect(page.getByTestId("wheel-mode")).toHaveAttribute("data-wheel", "zoom");
  await page.getByTestId("wheel-mode").click();
  await expect(page.getByTestId("wheel-mode")).toHaveAttribute("data-wheel", "scroll");
  const before = (await state(page)).current;
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await state(page)).current).toBe(before + 1);
  // the choice is remembered
  await page.reload();
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await expect(page.getByTestId("wheel-mode")).toHaveAttribute("data-wheel", "zoom");
});

test("tool and panel keys, the shortcut list, and moving a panel to the other side", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const keys: [string, string][] = [["r", "rectangle"], ["c", "cloud"], ["t", "textbox"], ["h", "highlight"], ["Shift+Alt+L", "length"], ["Shift+Alt+A", "area"], ["Shift+Alt+C", "count"], ["Shift+N", "polyline"], ["Shift+P", "polygon"], ["d", "strikeout"], ["Shift+V", "pan"], ["v", "select"]];
  for (const [k, tool] of keys) {
    await page.keyboard.press(k);
    expect((await state(page)).tool, k).toBe(tool);
  }
  // panels: Alt+P closes Properties, Alt+B opens Bookmarks
  await page.keyboard.press("Alt+P");
  expect((await state(page)).right).toBeNull();
  await page.keyboard.press("Alt+B");
  expect((await state(page)).left).toBe("bookmarks");
  // menus show the same keys
  await page.getByTestId("menu-view").click();
  await expect(page.getByRole("menuitem", { name: /Single page.*Ctrl\+4/ })).toBeVisible();
  await page.keyboard.press("Escape");
  // F1 lists every shortcut
  await page.keyboard.press("F1");
  await expect(page.getByTestId("shortcuts-dialog")).toContainText("Continuous side by side");
  await page.keyboard.press("Escape");
  // right-click a panel button to move it
  await page.getByTestId("panel-toolchest").click({ button: "right" });
  await page.getByTestId("panel-move").click();
  expect((await state(page)).right).toBe("toolchest");
  await expect(page.locator(".main > .panel-bar").last().getByTestId("panel-toolchest")).toBeVisible();
});

test("Ctrl+drag copies a markup, Ctrl+click toggles it, Alt+Z fits a text box, highlight off text draws a band", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, 0.2, 0.2), await pagePoint(page, 0.3, 0.3));
  await page.keyboard.press("v");
  const [rect] = await markups(page);
  // Ctrl+drag leaves the original and adds a copy where it was dropped
  await page.keyboard.down("Control");
  await drag(page, await pagePoint(page, 0.2, 0.22), await pagePoint(page, 0.5, 0.22), 10);
  await page.keyboard.up("Control");
  const after = await markups(page);
  expect(after).toHaveLength(2);
  expect(after.find((m) => m.id === rect.id)!.rect).toEqual(rect.rect);
  const copy = after.find((m) => m.id !== rect.id)!;
  expect(copy.kind).toBe("rectangle");
  expect(copy.rect[0]).toBeGreaterThan(rect.rect[2]);
  // Ctrl+click without moving adds the original to the selection
  await page.keyboard.down("Control");
  const p = await pagePoint(page, 0.2, 0.28);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Control");
  expect((await state(page)).selection.sort()).toEqual([rect.id, copy.id].sort());
  // undo removes the copy
  await page.keyboard.press("Control+z");
  expect(await markups(page)).toHaveLength(1);

  // Alt+Z shrinks a text box to its text
  await page.keyboard.press("t");
  await drag(page, await pagePoint(page, 0.2, 0.5), await pagePoint(page, 0.7, 0.8));
  await page.getByTestId("text-editor").fill("Short");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const tb = (await markups(page)).find((m) => m.contents === "Short")!;
  const tp = await pagePoint(page, 0.21, 0.51);
  await page.mouse.click(tp.x, tp.y);
  await page.keyboard.press("Alt+z");
  const fitted = (await markups(page)).find((m) => m.id === tb.id)!;
  expect(fitted.rect[2] - fitted.rect[0]).toBeLessThan(tb.rect[2] - tb.rect[0]);
  expect(fitted.rect[3] - fitted.rect[1]).toBeLessThan(tb.rect[3] - tb.rect[1]);

  // the highlight tool on an empty area draws a highlighter band
  await page.keyboard.press("h");
  await drag(page, await pagePoint(page, 0.1, 0.9), await pagePoint(page, 0.5, 0.92));
  await expect.poll(async () => (await markups(page)).some((m) => m.kind === "highlighter")).toBe(true);
});

test("Ctrl+B adds a bookmark for the current page, renames it, and it is saved", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("bm-rename")).toBeFocused();
  await page.keyboard.type("Level 2 services");
  await page.keyboard.press("Enter");
  const rows = page.getByTestId("bm-row");
  await expect(rows.filter({ hasText: "Level 2 services" })).toHaveCount(1);
  // jumping away and clicking it comes back to page 3
  await page.keyboard.press("Home");
  await rows.filter({ hasText: "Level 2 services" }).getByRole("button").click();
  await expect(page.getByTestId("page-position")).toHaveText("(3 of 200)");
  // undo and redo
  await page.keyboard.press("Control+z");
  await expect(rows.filter({ hasText: "Level 2 services" })).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(rows.filter({ hasText: "Level 2 services" })).toHaveCount(1);
  // the outline is written to the file
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const saved = mupdf.Document.openDocument(new Uint8Array(readFileSync(await (await download).path())), "application/pdf");
  type Item = { title?: string; page?: number; down?: Item[] };
  const flat = (l: Item[]): Item[] => l.flatMap((o) => [o, ...flat(o.down ?? [])]);
  expect(flat((saved.loadOutline() ?? []) as Item[]).find((o) => o.title === "Level 2 services")?.page).toBe(2);
});

test("Ctrl+G groups markups: clicking one picks them all, they move together, Ctrl+Shift+G ungroups", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  await page.keyboard.press("r");
  await drag(page, await pagePoint(page, 0.1, 0.1), await pagePoint(page, 0.2, 0.2));
  await page.keyboard.press("e");
  await drag(page, await pagePoint(page, 0.4, 0.1), await pagePoint(page, 0.5, 0.2));
  await page.keyboard.press("v");
  const [a, b] = await markups(page);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  // click elsewhere, then on the rectangle: both are selected
  const empty = await pagePoint(page, 0.7, 0.7);
  await page.mouse.click(empty.x, empty.y);
  const edge = await pagePoint(page, 0.1, 0.17);
  await page.mouse.click(edge.x, edge.y);
  expect((await state(page)).selection.sort()).toEqual([a.id, b.id].sort());
  // dragging one moves both
  await drag(page, edge, await pagePoint(page, 0.1, 0.37), 10);
  const moved = await markups(page);
  for (const m of [a, b]) expect(moved.find((x) => x.id === m.id)!.rect[1]).toBeGreaterThan(m.rect[1] + 10);
  // ungroup: a click picks just one
  await page.keyboard.press("Control+Shift+g");
  await page.mouse.click(empty.x, empty.y);
  const edge2 = await pagePoint(page, 0.1, 0.37);
  await page.mouse.click(edge2.x, edge2.y);
  expect((await state(page)).selection).toEqual([a.id]);
});

test("Cloud+, arc, dimension, radius, diameter and volume tools draw from their keys", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const at = (x: number, y: number) => pagePoint(page, x, y);
  const click = async (x: number, y: number) => {
    const p = await at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  // Cloud+: drag the cloud, then click where the text goes; type it
  await page.keyboard.press("k");
  await drag(page, await at(0.1, 0.1), await at(0.25, 0.2));
  const t = await at(0.4, 0.08);
  await page.mouse.move(t.x, t.y, { steps: 4 });
  await page.mouse.click(t.x, t.y);
  await page.getByTestId("text-editor").fill("Check clearance");
  await page.keyboard.press("Escape");
  let ms = await markups(page);
  expect(ms.map((m) => m.kind).sort()).toEqual(["callout", "cloud"]);
  expect(ms.find((m) => m.kind === "callout")!.contents).toBe("Check clearance");
  // the two are grouped
  await page.keyboard.press("v");
  await click(0.9, 0.9);
  await click(0.1, 0.15);
  expect((await state(page)).selection).toHaveLength(2);

  await page.keyboard.press("Shift+C");
  await click(0.1, 0.4);
  await click(0.2, 0.33);
  await click(0.3, 0.4);
  await page.keyboard.press("Shift+L");
  await click(0.4, 0.4);
  await click(0.6, 0.4);
  await click(0.5, 0.35);
  await page.keyboard.press("Shift+Alt+U");
  await drag(page, await at(0.2, 0.6), await at(0.25, 0.6));
  await page.keyboard.press("Shift+Alt+D");
  await drag(page, await at(0.4, 0.6), await at(0.45, 0.6));
  await page.keyboard.press("Shift+Alt+V");
  await click(0.6, 0.6);
  await click(0.8, 0.6);
  await click(0.8, 0.7);
  const last = await at(0.6, 0.7);
  await page.mouse.dblclick(last.x, last.y);
  ms = await markups(page);
  expect(ms.map((m) => m.kind).sort()).toEqual(["arc", "callout", "cloud", "diameter", "dimension", "radius", "volume"]);

  // the volume's depth is set in the Measurements panel and changes its value
  await page.keyboard.press("v");
  await click(0.7, 0.65);
  await expect(page.getByTestId("measure-value")).toContainText("Volume");
  const before = await page.getByTestId("measure-value").textContent();
  await page.getByTestId("volume-depth").fill("2");
  await expect(page.getByTestId("measure-value")).not.toHaveText(before!);
  // and everything survives a save
  const download = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const saved = mupdf.Document.openDocument(new Uint8Array(readFileSync(await (await download).path())), "application/pdf").asPDF()!;
  const kinds = (saved.loadPage(0) as mupdf.PDFPage).getAnnotations().map((a) => JSON.parse(a.getObject().get("DrawsetData").asString() || "{}").kind);
  expect(kinds.sort()).toEqual(["arc", "callout", "cloud", "diameter", "dimension", "radius", "volume"]);
});

test("format painter copies a markup's look; Ctrl+Alt keys align and flip", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "calibration.pdf");
  await waitForPage(page);
  const at = (x: number, y: number) => pagePoint(page, x, y);
  await page.keyboard.press("r");
  await drag(page, await at(0.1, 0.1), await at(0.2, 0.2));
  await page.keyboard.press("e");
  await drag(page, await at(0.4, 0.3), await at(0.5, 0.4));
  const style = () =>
    page.evaluate(() => {
      const s = (window as any).__drawset.useApp.getState();
      const t = s.tabs.find((x: any) => x.key === s.active);
      return Object.values(t.state.markups).map((m: any) => ({ id: m.id, kind: m.kind, width: m.style.width, color: m.style.color, rect: m.rect }));
    });
  // give the rectangle a thick blue line
  await page.keyboard.press("v");
  const edge = await at(0.1, 0.15);
  await page.mouse.click(edge.x, edge.y);
  await page.locator('[data-testid="properties"] input[type="number"]').first().fill("5");
  // Ctrl+Shift+C picks up its format; clicking the ellipse paints it
  await page.mouse.click(edge.x, edge.y);
  await page.keyboard.press("Control+Shift+C");
  expect((await state(page)).tool).toBe("painter");
  const ell = await at(0.4, 0.35);
  await page.mouse.click(ell.x, ell.y);
  const s1 = await style();
  expect(s1.find((m) => m.kind === "ellipse")!.width).toBe(5);
  expect((await state(page)).tool).toBe("select");
  // select both and align their left edges; undo puts the ellipse back
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Alt+L");
  const s2 = await style();
  const [r, e] = [s2.find((m) => m.kind === "rectangle")!, s2.find((m) => m.kind === "ellipse")!];
  expect(Math.abs(r.rect[0] - e.rect[0])).toBeLessThan(0.01);
  await page.keyboard.press("Control+z");
  expect(Math.abs((await style()).find((m) => m.kind === "ellipse")!.rect[0] - e.rect[0])).toBeGreaterThan(10);
});
