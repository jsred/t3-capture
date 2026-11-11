// Genera los PNG de extension/icons a partir de icon.svg (Chrome no acepta
// SVG en el manifest ni en las notificaciones). Correr tras cambiar el SVG:
//   node scripts/render-icons.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const svg = fs.readFileSync(new URL("../extension/icons/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.waitForFunction(() => document.images[0].complete);
  const out = new URL(`../extension/icons/icon-${size}.png`, import.meta.url);
  await page.screenshot({ path: out.pathname, omitBackground: true });
  console.log(`icons/icon-${size}.png`);
}
await browser.close();
