// Genera las imágenes para las stores (Chrome Web Store y addons.mozilla.org)
// con la extensión real en Chromium, contra el T3 simulado de test/mock-t3.mjs.
//
//   npm run store:assets
//
// Salida en store/images/: capturas 1280×800 y tile promocional 440×280, en
// JPEG (la Chrome Web Store no acepta PNG con canal alfa).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMockT3 } from "../test/mock-t3.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "store/images");
fs.mkdirSync(out, { recursive: true });

execFileSync("node", [path.join(root, "scripts/build-chrome.mjs")], { stdio: "inherit" });
const extensionDir = path.join(root, "dist/chrome");
const { base, TOKEN, close: closeMock } = await startMockT3({ label: "MacBook Pro" });

const SHOP = "https://shop.example.com";
const DEMO = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Checkout · Tienda</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1d1d1f; background: #f4f4f7; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 18px 48px; background: #fff; border-bottom: 1px solid #e5e5ea; }
  header b { font-size: 20px; letter-spacing: -0.02em; }
  header nav a { margin-left: 28px; color: #555; text-decoration: none; }
  main { display: grid; grid-template-columns: 1.3fr 1fr; gap: 32px; max-width: 1080px; margin: 40px auto; padding: 0 32px; }
  .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { margin: 0 0 20px; font-size: 24px; letter-spacing: -0.02em; }
  label { display: block; margin: 14px 0 6px; font-size: 13px; color: #666; }
  input { width: 100%; padding: 11px 13px; border: 1px solid #d2d2d7; border-radius: 10px; font: inherit; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .item { display: flex; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
  .thumb { width: 64px; height: 64px; border-radius: 12px; background: linear-gradient(135deg, #a5b4fc, #6366f1); }
  .total { display: flex; justify-content: space-between; margin-top: 18px; font-size: 18px; font-weight: 600; }
  button { width: 100%; margin-top: 22px; padding: 15px; border: 0; border-radius: 12px; background: #111; color: #fff; font: 600 16px/1 inherit; cursor: pointer; }
  .error { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #fff1f0; color: #b42318; font-size: 14px; display: none; }
</style></head><body>
<header><b>Tienda</b><nav><a href="#">Productos</a><a href="#">Ofertas</a><a href="#">Carrito (1)</a></nav></header>
<main>
  <section class="card">
    <h1>Datos de pago</h1>
    <label for="email">Email</label><input id="email" type="email" value="ana@example.com">
    <label for="card">Tarjeta</label><input id="card" value="4242 4242 4242 4242">
    <div class="row"><div><label for="exp">Vencimiento</label><input id="exp" value="12/29"></div>
    <div><label for="cvc">CVC</label><input id="cvc" type="password" value="123"></div></div>
  </section>
  <aside class="card">
    <h1>Tu pedido</h1>
    <div class="item"><div class="thumb"></div><div><b>Auriculares Aura</b><br><span style="color:#777">Negro · 1 unidad</span></div></div>
    <div class="total"><span>Total</span><span>$129</span></div>
    <button data-testid="pay-button">Pagar $129</button>
    <div class="error" id="err">No pudimos procesar el pago. Probá de nuevo.</div>
  </aside>
</main>
<script>
  const btn = document.querySelector('[data-testid=pay-button]');
  btn.__reactFiber$demo = { type: { name: 'PayButton' }, _debugSource: { fileName: 'src/checkout/PayButton.tsx', lineNumber: 41 },
    return: { type: { name: 'OrderSummary' }, return: { type: { name: 'CheckoutPage' }, return: null } } };
  btn.addEventListener('click', async () => {
    const res = await fetch('/api/payments', { method: 'POST', body: '{}' });
    if (!res.ok) {
      console.error('Pago rechazado', new Error('PaymentIntent failed: amount must be in cents'));
      document.getElementById('err').style.display = 'block';
    }
  });
</script></body></html>`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3c-store-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
await context.route(`${SHOP}/**`, (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname.startsWith("/api/")) return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"internal"}' });
  return route.fulfill({ contentType: "text/html; charset=utf-8", body: DEMO });
});

context.on("console", (m) => process.env.DEBUG && console.log("  [console]", m.type(), m.text()));
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
const extensionId = new URL(sw.url()).host;
const extUrl = (p) => `chrome-extension://${extensionId}/${p}`;
await sw.evaluate(
  ([origin, token]) =>
    chrome.storage.local.set({
      servers: [{ id: "env-mock", origin, label: "MacBook Pro", environmentId: "env-mock", token, expiresAt: Date.now() + 1e9, addedAt: Date.now() }],
      systemPrompts: {
        default: "Respondé en español. Antes de cambiar código, explicá la causa.",
        projects: { p1: { prompt: "Usá pnpm. Corré `pnpm test` antes de terminar y no toques la carpeta legacy/.", title: "Tienda", device: "MacBook Pro" } },
      },
    }),
  [base, TOKEN],
);
await new Promise((r) => setTimeout(r, 500));
for (const p of context.pages()) if (p.url().includes("options.html")) await p.close();

const raw = {};
const shot = async (page, name, opts = {}) => (raw[name] = (await page.screenshot({ type: "png", ...opts })).toString("base64"));

// 1. Selector sobre la página
const page = await context.newPage();
await page.goto(`${SHOP}/checkout`);
await page.click("[data-testid=pay-button]");
await page.waitForSelector("#err", { state: "visible" });
const tabId = await sw.evaluate(async (shop) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(shop))?.id, SHOP);
await page.bringToFront();
const composerOpened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html"), timeout: 20_000 });
await sw.evaluate(async (id) => {
  globalThis.__t3capture.startCapture(await chrome.tabs.get(id), "element");
}, tabId);
await page.waitForSelector("t3-capture-overlay", { state: "attached" });
const box = await page.locator("[data-testid=pay-button]").boundingBox();
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.move(box.x + 40, box.y + 22);
await page.waitForTimeout(300);
await shot(page, "picker");
await page.mouse.click(box.x + 40, box.y + 22);

// 2-3. Compositor
const composer = await composerOpened;
await composer.setViewportSize({ width: 720, height: 1000 });
await composer.waitForFunction(() => !document.getElementById("submit").disabled, null, { timeout: 20_000 });
await composer.fill("#user-text", "Al pagar aparece «No pudimos procesar el pago» y /api/payments devuelve 500. Encontrá la causa y arreglalo.");
await composer.selectOption("#project", "p1");
await composer.waitForTimeout(300);
await shot(composer, "composer");
await composer.click("#sp-details summary");
await composer.locator("#sp-details").evaluate((d) => d.closest("section").scrollIntoView());
await composer.selectOption('#model-options select[data-option-id="effort"]', '"xhigh"');
await composer.waitForTimeout(200);
await shot(composer, "destination");
await composer.close();

// 4. Ajustes
const settings = await context.newPage();
await settings.setViewportSize({ width: 640, height: 1000 });
await settings.goto(extUrl("options/options.html"));
await settings.waitForSelector(".server .state.ok", { timeout: 15_000 });
await settings.waitForTimeout(300);
await settings.locator("#system-prompts").evaluate((el) => el.scrollIntoView({ block: "center" }));
await settings.waitForTimeout(200);
await shot(settings, "options");
await context.close();
closeMock();

// ---------- composición ----------
const icon = fs.readFileSync(path.join(root, "extension/icons/icon.svg"), "base64");
const browser = await chromium.launch();
const canvas = await browser.newPage({ deviceScaleFactor: 1 });
const FRAME_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #fff; overflow: hidden;
         background: radial-gradient(1200px 700px at 10% 0%, #2a2a6e 0%, #111118 60%); }
  h2 { font-size: 40px; line-height: 1.12; letter-spacing: -0.025em; font-weight: 750; }
  p { margin-top: 18px; font-size: 20px; line-height: 1.45; color: #b8b8d0; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 650; color: #c9c9ff; margin-bottom: 26px; }
  .brand img { width: 36px; height: 36px; }
  .shot { border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); display: block; }`;
const brand = `<div class="brand"><img src="data:image/svg+xml;base64,${icon}">T3 Capture</div>`;

async function render(name, html, width = 1280, height = 800) {
  await canvas.setViewportSize({ width, height });
  await canvas.setContent(`<style>${FRAME_CSS}</style>${html}`);
  await canvas.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await canvas.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 92 });
  console.log(`✓ store/images/${name}.jpg`);
}

const img = (name) => `data:image/png;base64,${raw[name]}`;

// Título arriba, captura de página completa abajo.
const topLayout = (title, text, name) => `
  <div style="padding:44px 64px 0">${brand}<h2>${title}</h2><p style="margin-top:10px">${text}</p></div>
  <img class="shot" src="${img(name)}" style="position:absolute;left:50%;transform:translateX(-50%);top:250px;width:1040px">`;

// Texto a la izquierda, captura alta a la derecha.
const sideLayout = (title, text, name, top = 70) => `
  <div style="position:absolute;left:72px;top:0;bottom:0;width:470px;display:flex;flex-direction:column;justify-content:center">
    ${brand}<h2>${title}</h2><p>${text}</p></div>
  <img class="shot" src="${img(name)}" style="position:absolute;right:72px;top:${top}px;width:580px">`;

await render("1-seleccionar", topLayout("Elegí el elemento que falla", "Click derecho, atajo o el botón de la barra. Con ↑ ↓ subís o bajás en el árbol del DOM.", "picker"));
await render(
  "2-contexto",
  sideLayout(
    "El agente recibe todo el contexto",
    "Capturas, selector, HTML, componentes de React o Vue con su archivo, y los errores de consola, requests e interacciones previas.",
    "composer",
  ),
);
await render(
  "3-destino",
  sideLayout("Proyecto, modelo y esfuerzo", "Elegí dispositivo, proyecto, workspace, modelo, reasoning effort y permisos antes de crear el hilo.", "destination"),
);
await render(
  "4-instrucciones",
  sideLayout("Instrucciones por proyecto", "Un system prompt default y otro por proyecto, que van al principio de cada hilo nuevo.", "options"),
);

await render(
  "promo-440x280",
  `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 34px">
     <div class="brand" style="font-size:26px;margin-bottom:14px"><img src="data:image/svg+xml;base64,${icon}" style="width:52px;height:52px">T3 Capture</div>
     <h2 style="font-size:25px">De un bug en el navegador a un hilo de T3 Code</h2></div>`,
  440,
  280,
);
await browser.close();
