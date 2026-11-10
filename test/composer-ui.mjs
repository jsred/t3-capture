// Renderiza el compositor real (extension/composer) en Chromium con un stub de
// `browser`, contra el T3 real. La llamada final t3_thread_launch se intercepta
// (no crea un hilo) para verificar el payload.
// Uso: node test/composer-ui.mjs <token-json-path>
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";

const tokenFile = process.argv[2];
const tok = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
const root = new URL("../extension/", import.meta.url).pathname;
const types = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 1100 }, colorScheme: "dark" });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));

let launchPayload = null;
// Emula el contexto privilegiado de la extensión (sin CORS) y captura el launch.
await page.route("http://127.0.0.1:3773/**", async (route) => {
  const req = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "*", "access-control-allow-methods": "*" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = req.postData() || "";
  if (body.includes('"t3_thread_launch"')) {
    const msg = JSON.parse(body);
    launchPayload = msg.params.arguments;
    const result = { threadId: "fake", link: "http://127.0.0.1:3773/env/fake", status: "preparing" };
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } }) });
  }
  // Igual que el listener webRequest del background: sin Origin hacia /mcp.
  const headers = { ...req.headers() };
  if (new URL(req.url()).pathname === "/mcp") delete headers.origin;
  const response = await route.fetch({ headers });
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});

const store = { servers: [{ id: "local", origin: "http://127.0.0.1:3773", label: "MacBook (test)", token: tok.access_token, expiresAt: Date.now() + 1e9 }], prefs: {}, settings: {} };
await page.addInitScript((s) => {
  const data = JSON.parse(localStorage.getItem("__store") || "null") || s;
  window.__store = data;
  const save = () => localStorage.setItem("__store", JSON.stringify(data));
  window.browser = {
    storage: { local: { get: async (k) => ({ [k]: data[k] }), set: async (o) => (Object.assign(data, o), save()) }, onChanged: { addListener() {} } },
    runtime: { openOptionsPage() {}, getURL: (p) => p },
  };
}, store);

// Siembra una captura en IndexedDB (mismo origen que el compositor).
await page.goto(`${base}/icons/icon.svg`);
await page.evaluate(async () => {
  const { putCapture } = await import("/lib/db.js");
  const canvas = new OffscreenCanvas(400, 240);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#334"; ctx.fillRect(0, 0, 400, 240); ctx.fillStyle = "#fff"; ctx.font = "28px sans-serif"; ctx.fillText("Comprar ahora", 100, 130);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const now = Date.now();
  await putCapture({
    id: "cap1", createdAt: now, mode: "element", capturedAt: now,
    page: { url: "https://shop.example.com/checkout", title: "Checkout · Tienda", viewport: { width: 1280, height: 800, dpr: 2 }, scroll: { y: 0, height: 2000 } },
    element: { tag: "button", selector: 'button[data-testid="buy"]', xpath: "/html[1]/body[1]/button[1]", rect: { x: 10, y: 10, width: 120, height: 40, pageX: 10, pageY: 10 }, role: "button", accessibleName: "Comprar ahora",
               framework: { react: { components: ["BuyButton", "Checkout"], source: "src/Buy.tsx:12" } }, outerHTML: '<button data-testid="buy">Comprar ahora</button>', styles: { display: "inline-flex" }, ancestors: ["form#checkout"] },
    interactions: [{ t: now - 2000, type: "click", target: 'button[data-testid="buy"]', text: "Comprar ahora", x: 20, y: 20 }],
    console: [{ t: now - 1900, level: "error", message: "Pago falló" }],
    network: [{ t: now - 1800, method: "POST", url: "https://shop.example.com/api/pay", status: 500, ok: false, ms: 120 }],
    shots: [{ kind: "crop", label: "Elemento", blob, include: true }, { kind: "full", label: "Página con el elemento marcado", blob, include: true }],
  });
});

await page.goto(`${base}/composer/composer.html?id=cap1`);
await page.waitForFunction(() => !document.getElementById("submit").disabled, null, { timeout: 30000 });
const projects = await page.$$eval("#project option", (o) => o.map((x) => x.textContent));
const models = await page.$$eval("#model option", (o) => o.map((x) => x.value));
console.log("✓ proyectos:", projects.length, "· modelos:", models.length);
assert.ok(projects.includes("Scratch (carpeta nueva, sin proyecto)"));

await page.fill("#user-text", "El botón de compra devuelve 500, arreglalo");
await page.selectOption("#project", "__scratch__");
await page.selectOption("#model", "claudeAgent::claude-sonnet-5-5");
const effortValues = await page.$$eval('#model-options select[data-option-id="effort"] option', (o) => o.map((x) => x.value));
assert.ok(effortValues.includes('"xhigh"'));
await page.selectOption('#model-options select[data-option-id="effort"]', '"xhigh"');
await page.selectOption("#runtime", "auto-accept-edits");
await page.click("#preview-details summary");
await page.screenshot({ path: "test/composer.png", fullPage: true });

await page.click("#submit");
await page.waitForSelector("#done:not(.hidden)", { timeout: 30000 });
await page.screenshot({ path: "test/composer-done.png" });

assert.equal(launchPayload.scratch, true);
assert.deepEqual(launchPayload.modelSelection, { instanceId: "claudeAgent", model: "claude-sonnet-5-5", options: [{ id: "effort", value: "xhigh" }] });
assert.equal(launchPayload.runtimeMode, "auto-accept-edits");
assert.equal(launchPayload.attachments.length, 2);
assert.ok(launchPayload.attachments.every((a) => a.id.startsWith("pending-") && a.type === "image"));
assert.ok(launchPayload.message.startsWith("El botón de compra devuelve 500"));
assert.equal(launchPayload.title, "El botón de compra devuelve 500, arreglalo");
const prefs = await page.evaluate(() => window.__store.prefs);
assert.equal(prefs.modelKey, "claudeAgent::claude-sonnet-5-5");
assert.equal(prefs.optionsByModel["claudeAgent::claude-sonnet-5-5"].effort, "xhigh");
console.log("✓ payload de t3_thread_launch:", JSON.stringify({ ...launchPayload, message: `${launchPayload.message.length} chars`, attachments: launchPayload.attachments.map((a) => a.name) }));
console.log("✓ preferencias guardadas");

// Segundo render: recuerda las preferencias
await page.evaluate(async () => {
  const { putCapture, getCapture } = await import("/lib/db.js");
  void getCapture;
  await putCapture({ id: "cap2", createdAt: Date.now(), mode: "visible", capturedAt: Date.now(), page: { url: "https://x.test", title: "X" }, interactions: [], console: [], network: [], shots: [] });
});
await page.goto(`${base}/composer/composer.html?id=cap2`);
await page.waitForFunction(() => !document.getElementById("submit").disabled, null, { timeout: 30000 });
assert.equal(await page.inputValue("#model"), "claudeAgent::claude-sonnet-5-5");
assert.equal(await page.inputValue('#model-options select[data-option-id="effort"]'), '"xhigh"');
assert.equal(await page.inputValue("#project"), "__scratch__");
console.log("✓ recuerda dispositivo, proyecto, modelo y effort");

await browser.close();
server.close();
