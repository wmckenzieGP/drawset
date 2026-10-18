import { expect, test, type Page } from "@playwright/test";
import { drag, openFixture, pagePoint, waitForPage } from "./helpers";

const inks = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return {
      tool: s.tools.tool as string,
      undo: t.undo.length as number,
      pens: (Object.values(t.state.markups) as any[]).filter((m) => m.kind === "pen" && m.id.startsWith("drawset-")).map((m) => ({ id: m.id as string, strokes: m.inks.length as number, points: m.inks.map((k: any[]) => k.length) as number[] })),
    };
  });

/** A wavy stroke across part of the page. */
async function scribble(page: Page, x0: number, x1: number, y: number) {
  const a = await pagePoint(page, x0, y);
  const b = await pagePoint(page, x1, y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const f = i / 24;
    await page.mouse.move(a.x + (b.x - a.x) * f, a.y + Math.sin(f * Math.PI * 4) * 12);
  }
  await page.mouse.up();
}

test("the pen stays in hand, strokes drawn close together are one markup, each stroke undoes on its own", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.keyboard.press("p");
  await scribble(page, 0.2, 0.4, 0.3);
  await scribble(page, 0.2, 0.4, 0.35);
  // a click makes a dot (the dot over an i)
  const dot = await pagePoint(page, 0.42, 0.3);
  await page.mouse.click(dot.x, dot.y);
  let s = await inks(page);
  expect(s.tool).toBe("pen");
  expect(s.pens).toHaveLength(1);
  expect(s.pens[0].strokes).toBe(3);
  // smoothing keeps strokes light: far fewer points than pointer moves would give for a straight run
  expect(s.pens[0].points[0]).toBeGreaterThan(4);
  await page.keyboard.press("Control+z");
  s = await inks(page);
  expect(s.pens[0].strokes).toBe(2);

  // after a pause, a new markup starts
  await page.waitForTimeout(1700);
  await scribble(page, 0.5, 0.7, 0.3);
  s = await inks(page);
  expect(s.pens).toHaveLength(2);

  // Esc puts the pen down
  await page.keyboard.press("Escape");
  expect((await inks(page)).tool).toBe("select");
});

test("the eraser rubs out part of a stroke, splitting it, and a whole stroke goes; one undo puts it back", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.keyboard.press("p");
  // a straight stroke
  await drag(page, await pagePoint(page, 0.2, 0.5), await pagePoint(page, 0.6, 0.5), 30);
  await page.keyboard.press("Escape");
  const before = await inks(page);
  expect(before.pens).toHaveLength(1);
  await page.getByTestId("tool-inkEraser").click();
  // rub across the middle
  await drag(page, await pagePoint(page, 0.4, 0.45), await pagePoint(page, 0.4, 0.55), 10);
  let s = await inks(page);
  expect(s.pens).toHaveLength(1);
  expect(s.pens[0].strokes).toBe(2);
  expect(s.undo).toBe(before.undo + 1);
  // rub out what is left
  await drag(page, await pagePoint(page, 0.19, 0.5), await pagePoint(page, 0.61, 0.5), 40);
  s = await inks(page);
  expect(s.pens).toHaveLength(0);
  await page.keyboard.press("Control+z");
  s = await inks(page);
  expect(s.pens[0].strokes).toBe(2);
  await page.keyboard.press("Control+z");
  expect((await inks(page)).pens[0].strokes).toBe(1);
});
