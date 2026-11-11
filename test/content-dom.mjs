// Ejercita los content scripts en Chromium headless con un stub de `browser`.
// Los dos scripts corren en el mismo mundo acá; el puente de componentes
// React/Vue (eventos t3capture:probe) funciona igual.
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { buildPrompt, summarize, autoTitle } from "../extension/lib/format.js";

const read = (p) => fs.readFileSync(new URL(`../extension/${p}`, import.meta.url), "utf8");
const PAGE = `<!doctype html><html><head><title>Tienda demo</title></head><body>
<header><nav><a href="/">Inicio</a></nav></header>
<main class="layout">
  <form id="checkout">
    <label for="email">Email</label><input id="email" name="email" type="email">
    <label for="pw">Clave</label><input id="pw" name="password" type="password">
    <button type="button" data-testid="buy-button" class="btn btn-primary">Comprar ahora</button>
  </form>
  <div class="card"><p>Un párrafo <span class="hint">con detalle</span></p></div>
</main>
<script>
  const btn = document.querySelector('[data-testid=buy-button]');
  btn.__reactFiber$x1 = { type: { name: 'BuyButton' }, _debugSource: { fileName: 'src/Buy.tsx', lineNumber: 12 },
                          return: { type: { name: 'CheckoutForm' }, return: { type: 'form', return: null } } };
  btn.addEventListener('click', async () => {
    console.error('Pago falló', new Error('boom'));
    await fetch('/api/pay', { method: 'POST' }).catch(() => {});
    history.pushState({}, '', '/checkout/error');
  });
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) { res.writeHead(500); return res.end("err"); }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE);
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.addInitScript(`window.browser = {
  storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
  runtime: { onMessage: { addListener(fn) { window.__t3listener = fn; } } },
  menus: { getTargetElement: (sel) => document.querySelector(sel) },
};`);
await page.addInitScript(read("content/recorder-main.js"));
await page.addInitScript(read("content/content.js"));
await page.goto(url);

await page.fill("#email", "ana@example.com");
await page.fill("#pw", "supersecreta");
await page.click("[data-testid=buy-button]");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");

const run = (msg) => page.evaluate((m) => new Promise((resolve) => window.__t3listener(m, {}, resolve)), msg);
assert.deepEqual(await run({ type: "t3capture:ping" }), { ok: true });

// 1) elemento directo (como desde el menú contextual)
const direct = await run({ type: "t3capture:run", mode: "element", fromContextMenu: true, targetElementId: "[data-testid=buy-button]" });
assert.equal(direct.element.selector, 'button[data-testid="buy-button"]');
assert.deepEqual(direct.element.framework.react.components, ["BuyButton", "CheckoutForm"]);
assert.equal(direct.element.framework.react.source, "src/Buy.tsx:12");
assert.equal(direct.element.role, "button");
const inputs = direct.interactions.filter((e) => e.type === "input");
assert.equal(inputs.find((e) => e.target === "#email").value, "ana@example.com");
assert.equal(inputs.find((e) => e.target === "#pw").value, "[oculto]");
assert.ok(direct.interactions.some((e) => e.type === "click" && e.text === "Comprar ahora"));
assert.ok(direct.interactions.some((e) => e.type === "navigate" && e.detail.endsWith("/checkout/error")));
assert.ok(direct.console.some((c) => c.level === "error" && c.message.includes("Pago falló") && c.message.includes("Error: boom")));
assert.ok(direct.network.some((n) => n.url.endsWith("/api/pay") && n.status === 500 && n.method === "POST"));
console.log("✓ elemento directo + grabación (inputs, password oculto, click, consola, red, navegación)");

// 1b) click derecho sin menus.getTargetElement (Chrome): último elemento con contextmenu
await page.click("#email", { button: "right" });
const fromContext = await run({ type: "t3capture:run", mode: "element", fromContextMenu: true });
assert.equal(fromContext.element.selector, "#email");
console.log("✓ click derecho → último elemento del menú contextual");

// 2) selector interactivo: hover sobre el span, ↑ al <p>, click
const picking = run({ type: "t3capture:run", mode: "element" });
await page.waitForSelector("t3-capture-overlay", { state: "attached" });
const span = await page.locator(".hint").boundingBox();
await page.mouse.move(span.x + 5, span.y + 5);
await page.mouse.move(span.x + 6, span.y + 6);
await page.keyboard.press("ArrowUp");
await page.screenshot({ path: "test/picker.png" });
await page.mouse.click(span.x + 6, span.y + 6);
const picked = await picking;
assert.equal(picked.element.tag, "p");
assert.equal(await page.locator("t3-capture-overlay").count(), 0);
assert.ok(!picked.interactions.some((e) => e.type === "click" && e.t > direct.capturedAt), "el click de selección no debe llegar a la página");
console.log("✓ selector interactivo (↑ padre, overlay removido, click bloqueado):", picked.element.selector);

// 3) Escape cancela
const cancelled = run({ type: "t3capture:run", mode: "element" });
await page.waitForSelector("t3-capture-overlay", { state: "attached" });
await page.keyboard.press("Escape");
assert.deepEqual(await cancelled, { cancelled: true });
console.log("✓ Esc cancela");

// 4) área
const area = run({ type: "t3capture:run", mode: "area" });
await page.waitForSelector("t3-capture-overlay", { state: "attached" });
const form = await page.locator("#checkout").boundingBox();
await page.mouse.move(form.x + 2, form.y + 2);
await page.mouse.down();
await page.mouse.move(form.x + form.width - 2, form.y + form.height - 2, { steps: 5 });
await page.mouse.up();
const areaResult = await area;
assert.ok(areaResult.rect.width > 50);
assert.ok(areaResult.element);
console.log("✓ área:", Math.round(areaResult.rect.width), "x", Math.round(areaResult.rect.height), "→", areaResult.element.selector);

// 5) prompt
const prompt = buildPrompt(direct, { userText: "El botón de compra tira 500.\nRevisalo.", screenshotNames: ["captura-1-crop.png (Elemento)"] });
assert.ok(prompt.startsWith("El botón de compra tira 500."));
for (const needle of ["## Contexto capturado", "button[data-testid=\"buy-button\"]", "`<BuyButton>`", "| POST | **500** |", "ERROR", "[oculto]", "```html"]) {
  assert.ok(prompt.includes(needle), `falta ${needle}`);
}
assert.equal(autoTitle(direct, "El botón de compra tira 500.\nRevisalo."), "El botón de compra tira 500.");
console.log("✓ prompt:", prompt.length, "caracteres ·", JSON.stringify(summarize(direct)));
fs.writeFileSync("test/sample-prompt.md", prompt);

await browser.close();
server.close();
