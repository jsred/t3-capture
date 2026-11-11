// Test end-to-end de la versión de Chrome: carga dist/chrome en Chromium
// (Playwright) y recorre el flujo completo contra un T3 simulado que, igual
// que el real, responde 403 a cualquier request a /mcp con header Origin.
//
//   npm run test:chrome
//   npm run test:chrome -- --live <código de t3 pair>
//
// Con --live, además empareja la extensión con el T3 real (127.0.0.1:3773)
// desde la página de ajustes y verifica que el compositor carga proyectos y
// modelos reales. No crea hilos. La sesión queda en T3 → Settings →
// Connections como "T3 Capture (Chrome)" y se puede revocar desde ahí.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startMockT3 } from "./mock-t3.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const liveIndex = process.argv.indexOf("--live");
const liveCode = liveIndex > 0 ? process.argv[liveIndex + 1] : null;

execFileSync("node", [path.join(root, "scripts/build-chrome.mjs")], { stdio: "inherit" });
const extensionDir = path.join(root, "dist/chrome");

const { base, mock, TOKEN, close: closeMock } = await startMockT3();

// ---------- Chromium con la extensión ----------
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3c-chrome-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: !process.env.HEADED,
  viewport: { width: 1100, height: 760 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
});
const errors = [];
context.on("weberror", (e) => errors.push(e.error().message));
if (process.env.DEBUG) context.on("console", (m) => console.log("  [console]", m.type(), m.text()));

let sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
const extensionId = new URL(sw.url()).host;
const extUrl = (p) => `chrome-extension://${extensionId}/${p}`;
console.log("✓ service worker cargado:", extensionId);

// La página de ajustes se abre sola al instalar.
async function waitForPage(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = context.pages().find((p) => predicate(p.url()));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no se abrió la página esperada");
}
await (await waitForPage((u) => u.includes("options.html"))).close();

const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
assert.equal(rules.length, 1);
assert.deepEqual(rules[0].action.requestHeaders, [{ header: "origin", operation: "remove" }]);
assert.deepEqual(rules[0].condition.initiatorDomains, [extensionId]);
console.log("✓ regla declarativeNetRequest que quita el Origin hacia /mcp");

// Control: sin la regla, Chrome manda `Origin: chrome-extension://…` y T3 responde 403.
const mcpStatus = () =>
  sw.evaluate(
    (origin) => fetch(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status),
    base,
  );
await sw.evaluate(() => chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] }));
assert.equal(await mcpStatus(), 403, "sin la regla, el Origin llega y T3 rechaza");
await sw.evaluate((r) => chrome.declarativeNetRequest.updateDynamicRules({ addRules: r }), rules);
assert.equal(await mcpStatus(), 401, "con la regla, el request pasa el filtro de Origin");
mock.originRejected = 0;
console.log("✓ control: sin la regla T3 responde 403; con la regla pasa");

await sw.evaluate(
  ([origin, token]) =>
    chrome.storage.local.set({
      servers: [{ id: "env-mock", origin, label: "Mac simulada", environmentId: "env-mock", token, expiresAt: Date.now() + 1e9, addedAt: Date.now() }],
      systemPrompts: { default: "Respondé en español.", projects: { p1: { prompt: "Usá pnpm y corré los tests.", title: "Tienda", device: "Mac simulada" } } },
    }),
  [base, TOKEN],
);

// ---------- ajustes: prueba de conexión ----------
const settings = await context.newPage();
await settings.goto(extUrl("options/options.html"));
await settings.waitForSelector(".server .state.ok", { timeout: 15_000 });
assert.equal(await settings.locator("#perm").isHidden(), true, "el permiso <all_urls> está concedido");
assert.equal(await settings.inputValue("#sp-default"), "Respondé en español.");
assert.equal(await settings.locator(".sp-project .sp-title").textContent(), "Tienda");
assert.equal(await settings.inputValue(".sp-project .sp-text"), "Usá pnpm y corré los tests.");
await settings.waitForFunction(() => document.getElementById("sp-project-select").options[0]?.textContent === "No hay más proyectos");
await settings.locator("#system-prompts").screenshot({ path: path.join(root, "test/options-system-prompts.png") });
assert.equal(mock.originRejected, 0, "ningún request a /mcp llegó con Origin");
console.log("✓ ajustes: dispositivo conectado (MCP sin Origin desde la página de la extensión) e instrucciones del sistema");
await settings.close();

// ---------- página: eventos y selector ----------
const page = await context.newPage();
await page.goto(`${base}/tienda`);
await page.fill("#email", "ana@example.com");
await page.fill("#pw", "supersecreta");
await page.click("[data-testid=buy-button]");
await page.waitForTimeout(300);

const findTab = () =>
  sw.evaluate(async (origin) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(origin))?.id, base);
const tabId = await findTab();
assert.ok(tabId, "pestaña de prueba");

const startCapture = (mode, opts) =>
  sw.evaluate(
    async ([id, m, o]) => {
      const tab = await chrome.tabs.get(id);
      globalThis.__t3capture.startCapture(tab, m, o);
    },
    [tabId, mode, opts],
  );

await page.bringToFront();
const composerOpened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html"), timeout: 20_000 });
await startCapture("element");
await page.waitForSelector("t3-capture-overlay", { state: "attached" });
const btnBox = await page.locator("[data-testid=buy-button]").boundingBox();
await page.mouse.move(btnBox.x + 10, btnBox.y + 10);
await page.mouse.move(btnBox.x + 12, btnBox.y + 12);
await page.mouse.click(btnBox.x + 12, btnBox.y + 12);
const composer = await composerOpened;
console.log("✓ selector de elemento → compositor abierto");

// ---------- compositor ----------
await composer.waitForFunction(() => !document.getElementById("submit").disabled, null, { timeout: 20_000 });
assert.equal(await composer.locator("#shots img").count(), 2, "dos capturas (recorte + página marcada)");
await composer.click("#preview-details summary");
await composer.waitForFunction(() => document.getElementById("preview").textContent.length > 0);
const prompt = await composer.textContent("#preview");
for (const needle of ['button[data-testid="buy-button"]', "<BuyButton>", "src/Buy.tsx:12", "Pago falló", "/api/pay", "[oculto]", "/checkout/error"]) {
  assert.ok(prompt.includes(needle), `el mensaje debería incluir ${needle}`);
}
console.log("✓ contexto: selector, componentes React (puente al mundo de la página), consola, red, navegación, password oculto");

await composer.fill("#user-text", "El botón de compra devuelve 500, arreglalo");
await composer.selectOption("#project", "__scratch__");
assert.equal(await composer.textContent("#sp-source"), "· default");
assert.equal(await composer.inputValue("#system-prompt"), "Respondé en español.");
await composer.selectOption("#project", "p1");
assert.equal(await composer.textContent("#sp-source"), "· del proyecto «Tienda»");
assert.equal(await composer.inputValue("#system-prompt"), "Usá pnpm y corré los tests.");
await composer.click("#sp-details summary");
await composer.locator("#sp-details").evaluate((d) => d.closest("section").scrollIntoView());
await composer.screenshot({ path: path.join(root, "test/composer-system-prompt.png") });
await composer.selectOption('#model-options select[data-option-id="effort"]', '"xhigh"');
await composer.selectOption("#runtime", "auto-accept-edits");
await composer.click("#submit");
await composer.waitForSelector("#done:not(.hidden)", { timeout: 20_000 });

assert.equal(mock.originRejected, 0, "ningún request a /mcp llegó con Origin");
assert.equal(mock.launch.projectId, "p1");
assert.deepEqual(mock.launch.modelSelection, { instanceId: "claudeAgent", model: "claude-sonnet-5-5", options: [{ id: "effort", value: "xhigh" }] });
assert.equal(mock.launch.runtimeMode, "auto-accept-edits");
assert.equal(mock.launch.attachments.length, 2);
assert.ok(
  mock.launch.message.startsWith("<instrucciones_del_sistema>\nUsá pnpm y corré los tests.\n</instrucciones_del_sistema>\n\nEl botón de compra devuelve 500"),
  "la instrucción del proyecto va al principio del mensaje",
);
assert.equal(mock.uploads.length, 2);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
for (const u of mock.uploads) {
  assert.equal(u.auth, `Bearer ${TOKEN}`);
  assert.ok(u.bytes.subarray(0, 4).equals(PNG), "las capturas son PNG");
}
const pngWidth = (buf) => buf.readUInt32BE(16);
const dpr = await page.evaluate(() => devicePixelRatio);
const expectedCrop = Math.round((btnBox.width + 24) * dpr);
assert.ok(Math.abs(pngWidth(mock.uploads[0].bytes) - expectedCrop) <= 2 * dpr, `recorte de ${pngWidth(mock.uploads[0].bytes)}px, esperado ~${expectedCrop}px`);
assert.equal(pngWidth(mock.uploads[1].bytes), Math.round(1100 * dpr), "captura completa del viewport");
console.log(`✓ hilo creado: 2 PNG subidos (recorte ${pngWidth(mock.uploads[0].bytes)}px), modelo + effort + permisos en t3_thread_launch`);
await composer.close();

// ---------- click derecho (sin menus.getTargetElement) ----------
await page.bringToFront();
await page.click("#email", { button: "right" });
await page.keyboard.press("Escape");
const composer2Opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html"), timeout: 20_000 });
await startCapture("element", { fromContextMenu: true });
const composer2 = await composer2Opened;
await composer2.waitForSelector("#el-descriptor");
await composer2.waitForFunction(() => document.getElementById("el-descriptor").textContent.length > 0);
assert.match(await composer2.textContent("#el-descriptor"), /^#email$/);
console.log("✓ click derecho → elemento correcto sin selector interactivo");

// Instrucción editada en el compositor y guardada como default.
await composer2.click("#sp-details summary");
await composer2.fill("#system-prompt", "Respondé en español y sé breve.");
assert.equal(await composer2.textContent("#sp-source"), "· editada para este hilo");
await composer2.click("#sp-save-default");
await composer2.waitForFunction(() => document.getElementById("sp-saved").textContent.length > 0);
const saved = await sw.evaluate(() => chrome.storage.local.get("systemPrompts"));
assert.equal(saved.systemPrompts.default, "Respondé en español y sé breve.");
assert.equal(saved.systemPrompts.projects.p1.prompt, "Usá pnpm y corré los tests.");
console.log("✓ instrucciones: la del proyecto reemplaza a la default, se editan y guardan desde el compositor");
await composer2.close();

// ---------- captura visible ----------
const composer3Opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html"), timeout: 20_000 });
await page.bringToFront();
await startCapture("visible");
const composer3 = await composer3Opened;
await composer3.waitForFunction(() => document.querySelectorAll("#shots img").length === 1);
console.log("✓ captura visible");
await composer3.close();

// ---------- T3 real (opcional) ----------
if (liveCode) {
  await sw.evaluate(() => chrome.storage.local.set({ servers: [] }));
  const opts = await context.newPage();
  await opts.goto(extUrl("options/options.html"));
  await opts.fill("#pair-input", liveCode);
  await opts.fill("#origin-input", "http://127.0.0.1:3773");
  await opts.click("#pair-submit");
  await opts.waitForSelector("#pair-status.success", { timeout: 20_000 });
  console.log("✓ T3 real:", await opts.textContent("#pair-status"));
  await opts.waitForSelector(".server .state.ok", { timeout: 15_000 });

  const composerLive = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html"), timeout: 20_000 });
  await page.bringToFront();
  await startCapture("visible");
  const live = await composerLive;
  await live.waitForFunction(() => !document.getElementById("submit").disabled, null, { timeout: 30_000 });
  const projects = await live.locator("#project option").count();
  const models = await live.locator("#model option").count();
  assert.ok(models > 0);
  console.log(`✓ T3 real: compositor con ${projects} proyectos y ${models} modelos (sin crear hilo)`);
  await live.close();
}

assert.deepEqual(errors, [], `errores en páginas de la extensión: ${errors.join("\n")}`);
await context.close();
closeMock();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log("\nOK");
