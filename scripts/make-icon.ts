/** Renders build/icon.svg (original Drawset artwork) to build/icon.png and public/icon.png at 512 px. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";

const img = await loadImage(readFileSync("build/icon.svg"));
const canvas = createCanvas(512, 512);
canvas.getContext("2d").drawImage(img, 0, 0, 512, 512);
const png = canvas.toBuffer("image/png");
writeFileSync("build/icon.png", png);
writeFileSync("public/icon.png", png);
