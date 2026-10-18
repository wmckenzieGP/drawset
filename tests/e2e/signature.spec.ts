import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { openFixture, pagePoint, waitForPage } from "./helpers";

const signatures = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    return {
      tool: s.tools.tool as string,
      list: (Object.values(t.state.markups) as any[])
        .filter((m) => m.kind === "signature")
        .map((m) => ({ id: m.id as string, caption: m.caption as string | undefined, image: m.image ? { w: m.image.width as number, h: m.image.height as number, bytes: m.image.data.length as number } : null, rect: m.rect as number[] })),
    };
  });

/** Signs a wavy name in the pad. */
async function signPad(page: Page) {
  const box = (await page.getByTestId("sig-pad").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 110);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + 40 + i * 10, box.y + 100 + Math.sin(i / 2.5) * 30);
  await page.mouse.up();
  // a second stroke crossing the first
  await page.mouse.move(box.x + 120, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140, { steps: 8 });
  await page.mouse.up();
}

test("draw a signature once, then sign drawings with a click: name and date go underneath, and it saves as a picture stamp", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-signature").click();
  await page.getByTestId("sig-menu-manage").click();
  const dialog = page.getByTestId("signature-dialog");
  await expect(dialog).toBeVisible();
  // the name is needed
  await page.getByTestId("sig-name").fill("");
  await signPad(page);
  await page.getByTestId("sig-save").click();
  await expect(dialog).toBeVisible();
  await page.getByTestId("sig-name").fill("William McKenzie");
  await page.getByTestId("sig-save").click();
  await expect(dialog).toBeHidden();
  expect((await signatures(page)).tool).toBe("signature");

  // the signature follows the pointer, then a click puts it there
  const at = await pagePoint(page, 0.6, 0.7);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  let s = await signatures(page);
  expect(s.tool).toBe("select");
  expect(s.list).toHaveLength(1);
  const sig = s.list[0];
  expect(sig.image!.w).toBeGreaterThan(sig.image!.h);
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  expect(sig.caption).toBe(`William McKenzie  ${today}`);
  // 50 mm wide
  expect(sig.rect[2] - sig.rect[0]).toBeCloseTo((50 * 72) / 25.4, 1);

  // saved as a stamp holding the picture; it comes back as the same signature
  const download = page.waitForEvent("download");
  await page.getByTestId("tb-save").click();
  const saved = mupdf.Document.openDocument(new Uint8Array(readFileSync(await (await download).path())), "application/pdf").asPDF()!;
  const annot = (saved.loadPage(0) as mupdf.PDFPage).getAnnotations().find((a) => JSON.parse(a.getObject().get("DrawsetData").asString() || "{}").kind === "signature")!;
  expect(annot.getType()).toBe("Stamp");
  expect(JSON.parse(annot.getObject().get("DrawsetData").asString()).caption).toBe(`William McKenzie  ${today}`);
  expect(annot.getObject().get("AP").get("N").get("Resources").get("XObject").isDictionary()).toBe(true);
  s = await signatures(page);
  expect(s.list[0].image).not.toBeNull();

  // the signature is remembered for next time: the menu offers it straight away
  await page.reload();
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-signature").click();
  await expect(page.getByTestId("sig-menu-item")).toHaveText(/Sign as William McKenzie/);
  await page.getByTestId("sig-menu-item").click();
  expect((await signatures(page)).tool).toBe("signature");
  // drag a box to size it: it keeps its proportions inside the box
  const a = await pagePoint(page, 0.2, 0.2);
  const b = await pagePoint(page, 0.4, 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  s = await signatures(page);
  const r = s.list[0].rect;
  expect(r[2] - r[0]).toBeGreaterThan(100);
});

test("a typed signature, without the name and date underneath", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-signature").click();
  await page.getByTestId("sig-menu-manage").click();
  await page.getByTestId("sig-mode-type").click();
  await page.getByTestId("sig-name").fill("W. McKenzie");
  await expect(page.locator(".sig-font").first()).toHaveText("W. McKenzie");
  await page.getByTestId("sig-caption").uncheck();
  await page.getByTestId("sig-save").click();
  const at = await pagePoint(page, 0.5, 0.5);
  await page.mouse.click(at.x, at.y);
  const s = await signatures(page);
  expect(s.list).toHaveLength(1);
  expect(s.list[0].caption).toBeUndefined();
  expect(s.list[0].image!.w).toBeGreaterThan(s.list[0].image!.h);

  // deleting it from the dialog
  await page.getByTestId("tool-signature").click();
  await page.getByTestId("sig-menu-manage").click();
  await expect(page.getByTestId("sig-item")).toHaveCount(1);
  await page.getByTestId("sig-delete").click();
  await expect(page.getByTestId("sig-item")).toHaveCount(0);
});

test("a photo of a signature on paper: the paper goes see-through", async ({ page }, info) => {
  // a "photo": dark ink on slightly grey paper
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(600, 240);
  const g = c.getContext("2d");
  g.fillStyle = "#ecebe6";
  g.fillRect(0, 0, 600, 240);
  g.strokeStyle = "#1b2a6b";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(60, 160);
  for (let i = 0; i < 48; i++) g.lineTo(60 + i * 10, 140 + Math.sin(i / 3) * 50);
  g.stroke();
  const file = info.outputPath("signature-photo.png");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, c.toBuffer("image/png"));

  await page.goto("/");
  await openFixture(page, "annotated.pdf");
  await waitForPage(page);
  await page.getByTestId("tool-signature").click();
  await page.getByTestId("sig-menu-manage").click();
  await page.getByTestId("sig-mode-picture").click();
  await page.getByTestId("sig-name").fill("W. McKenzie");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("sig-choose-picture").click();
  await (await chooser).setFiles(file);
  await expect(page.locator(".sig-preview img")).toBeVisible();
  await page.getByTestId("sig-save").click();
  const at = await pagePoint(page, 0.5, 0.5);
  await page.mouse.click(at.x, at.y);
  // the corners (paper) are clear, the ink is solid
  const alpha = await page.evaluate(async () => {
    const s = (window as any).__drawset.useApp.getState();
    const t = s.tabs.find((x: any) => x.key === s.active);
    const m = (Object.values(t.state.markups) as any[]).find((x) => x.kind === "signature");
    const bmp = await createImageBitmap(new Blob([m.image.data], { type: m.image.mime }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g2 = cv.getContext("2d")!;
    g2.drawImage(bmp, 0, 0);
    const d = g2.getImageData(0, 0, bmp.width, bmp.height).data;
    let solid = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) solid++;
    return { corner: d[3], solid };
  });
  expect(alpha.corner).toBe(0);
  expect(alpha.solid).toBeGreaterThan(100);
});
