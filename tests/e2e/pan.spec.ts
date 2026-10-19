import { expect, test, type Page } from "@playwright/test";
import { openFixture, waitForPage } from "./helpers";

// real scroll bars, as on Windows (headless hides them but keeps their gutter)
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const pageBox = async (page: Page) => {
  const current = await page.evaluate(() => {
    const s = (window as unknown as { __drawset: { useApp: { getState: () => any } } }).__drawset.useApp.getState();
    return s.tabs.find((x: any) => x.key === s.active).currentPage as number;
  });
  return (await page.locator(`.page[data-page="${current}"]`).boundingBox())!;
};
const near = (a: number, b: number, tol = 2) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const room = (page: Page) => page.getByTestId("viewer").evaluate((el) => ({ w: el.scrollWidth - el.clientWidth, h: el.scrollHeight - el.clientHeight }));

test("pressing the wheel and dragging moves the page every way, even when it fits the window", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  // one page at a time, fitted: there is nothing to scroll either way
  await page.keyboard.press("Control+4");
  await page.keyboard.press("Control+9");
  await expect.poll(async () => (await room(page)).w).toBe(0);
  await expect.poll(async () => (await room(page)).h).toBe(0);
  const b0 = await pageBox(page);
  const v = (await page.getByTestId("viewer").boundingBox())!;
  await page.evaluate(() => {
    window.addEventListener("mousedown", (e) => {
      if (e.button === 1) (window as unknown as { __middlePrevented: boolean }).__middlePrevented = e.defaultPrevented;
    });
  });

  const start = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  // the browser's own wheel-button scrolling is turned off here
  expect(await page.evaluate(() => (window as unknown as { __middlePrevented: boolean }).__middlePrevented)).toBe(true);
  await expect(page.getByTestId("viewer")).toHaveCSS("cursor", "grabbing");
  // right and down
  await page.mouse.move(start.x + 150, start.y + 100, { steps: 6 });
  let b = await pageBox(page);
  near(b.x, b0.x + 150);
  near(b.y, b0.y + 100);
  // left and up, past where it started
  await page.mouse.move(start.x - 200, start.y - 120, { steps: 8 });
  b = await pageBox(page);
  near(b.x, b0.x - 200);
  near(b.y, b0.y - 120);
  await page.mouse.up({ button: "middle" });
  // it stays where it was left
  b = await pageBox(page);
  near(b.x, b0.x - 200);
  near(b.y, b0.y - 120);
  await expect(page.getByTestId("viewer")).toHaveCSS("cursor", "default");

  // however far it is dragged, some of the page stays in the window
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + 5000, start.y + 5000, { steps: 10 });
  await page.mouse.up({ button: "middle" });
  b = await pageBox(page);
  near(b.x, v.x + v.width - 80, 20);
  near(b.y, v.y + v.height - 80, 20);

  // dragged back to where it was, the extra room goes again
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x - (b.x - b0.x), start.y - (b.y - b0.y), { steps: 10 });
  await page.mouse.up({ button: "middle" });
  b = await pageBox(page);
  near(b.x, b0.x);
  near(b.y, b0.y);
  expect(await room(page)).toEqual({ w: 0, h: 0 });
});

test("zooming with the wheel after dragging the page keeps the spot under the pointer; fit page puts it back", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  await page.keyboard.press("Control+4");
  await page.keyboard.press("Control+9");
  const b0 = await pageBox(page);
  const v = (await page.getByTestId("viewer").boundingBox())!;
  // drag the page's top right corner towards the middle of the window
  const from = { x: b0.x + b0.width - 40, y: b0.y + 40 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2, { steps: 10 });
  await page.mouse.up({ button: "middle" });
  const b1 = await pageBox(page);
  near(b1.x + b1.width - 40, v.x + v.width / 2);
  near(b1.y + 40, v.y + v.height / 2);
  // zoom in and out over it: that corner stays under the pointer (the wheel zooms one page at a time)
  const fx = (v.x + v.width / 2 - b1.x) / b1.width;
  const fy = (v.y + v.height / 2 - b1.y) / b1.height;
  for (const dy of [-400, 600]) {
    await page.mouse.wheel(0, dy);
    await expect.poll(async () => (await pageBox(page)).width).not.toBeCloseTo(b1.width, 0);
    await page.waitForTimeout(150);
    const b = await pageBox(page);
    near(b.x + b.width * fx, v.x + v.width / 2, 3);
    near(b.y + b.height * fy, v.y + v.height / 2, 3);
  }
  // fit page puts the page back in the middle
  await page.keyboard.press("Control+9");
  await expect.poll(async () => Math.round((await pageBox(page)).x)).toBe(Math.round(b0.x));
  near((await pageBox(page)).y, b0.y);
  expect(await room(page)).toEqual({ w: 0, h: 0 });
});

test("Space-drag and the Pan tool also move a page sideways when it fills the width", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "set-200.pdf");
  await waitForPage(page);
  // a toolbar button clicked with the mouse keeps the focus; Space still pans and does not press it
  await page.getByTestId("tb-markups-list").click();
  await expect(page.getByTestId("tb-markups-list")).toHaveClass(/active/);
  // continuous, fit width: the page is as wide as the window
  await page.keyboard.press("Control+5");
  await page.keyboard.press("Control+0");
  const v = (await page.getByTestId("viewer").boundingBox())!;
  await expect.poll(async () => (await pageBox(page)).width).toBeGreaterThan(v.width - 80);
  await expect.poll(async () => (await room(page)).w).toBe(0);
  const b0 = await pageBox(page);
  const at = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  await page.keyboard.down("Space");
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  let b = await pageBox(page);
  near(b.x, b0.x + 120);
  near(b.y, b0.y + 60);
  await expect(page.getByTestId("tb-markups-list")).toHaveClass(/active/);
  await page.getByTestId("tool-pan").click();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 240, at.y - 60, { steps: 6 });
  await page.mouse.up();
  b = await pageBox(page);
  near(b.x, b0.x - 120);
  near(b.y, b0.y);
  // further down the set, scrolling still works as before
  await page.mouse.wheel(0, 800);
  await expect.poll(async () => (await page.locator('.page[data-page="0"]').boundingBox())!.y).toBeLessThan(b0.y - 400);
});

test("markups move with the page while it scrolls, without lagging behind", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.keyboard.press("Control+0");
  await expect.poll(async () => (await room(page)).h).toBeGreaterThan(300);
  const v = (await page.getByTestId("viewer").boundingBox())!;
  // scrolled, before anything is drawn again: the markup layer has moved with the pages
  const r = await page.getByTestId("viewer").evaluate((el) => {
    const layer = el.querySelector("canvas.overlay") as HTMLCanvasElement;
    const pg = el.querySelector(".page") as HTMLElement;
    const before = { layer: layer.getBoundingClientRect().top, page: pg.getBoundingClientRect().top };
    el.scrollTop += 150;
    const during = { layer: layer.getBoundingClientRect().top, page: pg.getBoundingClientRect().top };
    return { before, during };
  });
  near(r.during.page - r.before.page, -150, 0.5);
  near(r.during.layer - r.before.layer, -150, 0.5);
  // drawn again for the new spot, it lines up with the window
  await expect.poll(async () => Math.round((await page.locator("canvas.overlay").first().boundingBox())!.y)).toBe(Math.round(v.y));
});
