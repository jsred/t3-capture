// Test end-to-end de la versión de Firefox/Zen: instala el .xpi en una
// instancia headless con perfil temporal (vía geckodriver) y recorre el flujo
// contra el T3 simulado de mock-t3.mjs. No toca tu perfil.
//
//   npm run test:firefox
//
// Necesita geckodriver (https://github.com/mozilla/geckodriver/releases) en el
// PATH o en GECKODRIVER, y el navegador en FIREFOX_BIN (por defecto, Zen en
// /Applications).
//
// WebDriver no puede ejecutar scripts en páginas moz-extension://. Por eso
// las extensiones corren en el proceso principal (extensions.webextensions.remote
// = false) y esas páginas se manejan desde el contexto chrome de Marionette.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { startMockT3 } from "./mock-t3.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const ADDON_ID = manifest.browser_specific_settings.gecko.id;
const UUID = "5b0e3c1a-7d2f-4c6e-9a8b-1f2e3d4c5b6a";
const EXT = `moz-extension://${UUID}/`;
const binary = process.env.FIREFOX_BIN || "/Applications/Zen.app/Contents/MacOS/zen";
const geckodriver = process.env.GECKODRIVER || "geckodriver";

execFileSync("npm", ["run", "-s", "build:firefox"], { cwd: root, stdio: "inherit" });
const xpi = path.join(root, `dist/t3-capture-firefox-${manifest.version}.xpi`);

const { base, mock, TOKEN, close: closeMock } = await startMockT3();

// ---------- WebDriver mínimo ----------
const port = 4400 + Math.floor(Math.random() * 500);
const driver = spawn(geckodriver, ["--port", String(port)], {
  stdio: "ignore",
  env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wd(method, url, body) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}

for (let i = 0; ; i++) {
  try {
    if ((await wd("GET", "/status")).ready) break;
  } catch {
    if (i > 50) throw new Error(`No arrancó geckodriver (${geckodriver})`);
  }
  await sleep(100);
}

const { sessionId } = await wd("POST", "/session", {
  capabilities: {
    alwaysMatch: {
      browserName: "firefox",
      "moz:firefoxOptions": {
        binary,
        args: process.env.HEADED ? [] : ["-headless"],
        prefs: {
          "xpinstall.signatures.required": false,
          "extensions.webextensions.remote": false,
          "extensions.webextensions.uuids": JSON.stringify({ [ADDON_ID]: UUID }),
        },
      },
    },
  },
});
const S = `/session/${sessionId}`;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

// Script en una página de la extensión. `fn` recibe (win, doc, ...args) con el
// window de la página (wrappedJSObject). Los objetos se pasan como JSON para
// crearlos dentro de la página.
async function inExtension(prefix, fn, ...args) {
  await wd("POST", `${S}/moz/context`, { context: "chrome" });
  try {
    const result = await wd("POST", `${S}/execute/async`, {
      script: `const done = arguments[arguments.length - 1];
        const [prefix, ...args] = Array.from(arguments).slice(0, -1);
        let win = null;
        for (const w of Services.wm.getEnumerator("navigator:browser"))
          for (const b of w.gBrowser.browsers)
            if (!win && b.currentURI.spec.startsWith(prefix) && b.contentWindow) win = b.contentWindow.wrappedJSObject;
        if (!win) done({ missing: true });
        else Promise.resolve((${fn})(win, win.document, ...args)).then((ok) => done({ ok }), (e) => done({ error: String(e) }));`,
      args: [EXT + prefix, ...args],
    });
    if (result?.error) throw new Error(result.error);
    return result?.missing ? undefined : result?.ok;
  } finally {
    await wd("POST", `${S}/moz/context`, { context: "content" });
  }
}

async function waitInExtension(prefix, fn, label, ...args) {
  for (let i = 0; i < 150; i++) {
    const value = await inExtension(prefix, fn, ...args).catch(() => undefined);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timeout esperando: ${label}`);
}

async function closeExtensionWindow(prefix) {
  await wd("POST", `${S}/moz/context`, { context: "chrome" });
  await wd("POST", `${S}/execute/sync`, {
    script: `for (const w of Services.wm.getEnumerator("navigator:browser"))
               if (w.gBrowser.browsers.some((b) => b.currentURI.spec.startsWith(arguments[0]))) w.close();`,
    args: [EXT + prefix],
  });
  await wd("POST", `${S}/moz/context`, { context: "content" });
}

const go = (url) => wd("POST", `${S}/url`, { url });
const find = async (css) => (await wd("POST", `${S}/element`, { using: "css selector", value: css }))[ELEMENT];
const pageScript = (script) => wd("POST", `${S}/execute/sync`, { script, args: [] });
const pointer = (actions) => wd("POST", `${S}/actions`, { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }] });
const keys = (...values) =>
  wd("POST", `${S}/actions`, { actions: [{ type: "key", id: "kb", actions: values.flatMap((value) => [{ type: "keyDown", value }, { type: "keyUp", value }]) }] });

const startCapture = (mode, opts = {}) =>
  inExtension(
    "options/",
    async (win, _doc, origin, m, o) => {
      const bg = (await win.browser.runtime.getBackgroundPage()).wrappedJSObject;
      const tab = (await win.browser.tabs.query(win.JSON.parse("{}"))).find((t) => t.url?.startsWith(origin));
      bg.__t3capture.startCapture(bg.JSON.parse(JSON.stringify(tab)), m, bg.JSON.parse(o));
      return tab.id;
    },
    base,
    mode,
    JSON.stringify(opts),
  );

try {
  await wd("POST", `${S}/moz/addon/install`, { path: xpi, temporary: true });
  console.log(`✓ ${path.basename(xpi)} instalado en ${execFileSync(binary, ["--version"]).toString().trim()} (headless, perfil temporal)`);

  // ---------- ajustes ----------
  await waitInExtension("options/", (win) => !!win.browser, "página de ajustes");
  await inExtension(
    "options/",
    (win, _doc, json) => win.browser.storage.local.set(win.JSON.parse(json)),
    JSON.stringify({ servers: [{ id: "env-mock", origin: base, label: "Mac simulada", environmentId: "env-mock", token: TOKEN, expiresAt: Date.now() + 1e9, addedAt: Date.now() }] }),
  );
  await inExtension("options/", (win) => void win.location.reload());
  await waitInExtension("options/", (_win, doc) => !!doc.querySelector(".server .state.ok"), "dispositivo conectado");
  assert.equal(mock.originRejected, 0, "ningún request a /mcp llegó con Origin");
  console.log("✓ ajustes: dispositivo conectado (webRequest quita el Origin hacia /mcp)");

  // ---------- página ----------
  const { handle: pageHandle } = await wd("POST", `${S}/window/new`, { type: "tab" });
  await wd("POST", `${S}/window`, { handle: pageHandle });
  await go(`${base}/tienda`);
  await wd("POST", `${S}/element/${await find("#email")}/value`, { text: "ana@example.com" });
  await wd("POST", `${S}/element/${await find("#pw")}/value`, { text: "supersecreta" });
  await wd("POST", `${S}/element/${await find("[data-testid=buy-button]")}/click`, {});
  await sleep(300);

  // ---------- selector de elemento ----------
  await startCapture("element");
  for (let i = 0; i < 100 && !(await pageScript("return !!document.querySelector('t3-capture-overlay')")); i++) await sleep(100);
  const button = { [ELEMENT]: await find("[data-testid=buy-button]") };
  await pointer([
    { type: "pointerMove", origin: button, x: 0, y: 0 },
    { type: "pointerMove", origin: button, x: 2, y: 1 },
    { type: "pointerDown", button: 0 },
    { type: "pointerUp", button: 0 },
  ]);
  await waitInExtension("composer/", (_win, doc) => !doc.getElementById("submit").disabled, "compositor listo");
  console.log("✓ selector de elemento → compositor abierto");

  assert.equal(await inExtension("composer/", (_w, doc) => doc.querySelectorAll("#shots img").length), 2);
  await inExtension("composer/", (_w, doc) => void (doc.getElementById("preview-details").open = true));
  const prompt = await waitInExtension("composer/", (_w, doc) => doc.getElementById("preview").textContent, "preview");
  for (const needle of ['button[data-testid="buy-button"]', "<BuyButton>", "src/Buy.tsx:12", "Pago falló", "/api/pay", "[oculto]", "/checkout/error"]) {
    assert.ok(prompt.includes(needle), `el mensaje debería incluir ${needle}`);
  }
  console.log("✓ contexto: selector, componentes React (puente al mundo de la página), consola, red, navegación, password oculto");

  await inExtension("composer/", (win, doc) => {
    const set = (selector, value) => {
      const el = doc.querySelector(selector);
      el.value = value;
      el.dispatchEvent(new win.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    };
    set("#user-text", "El botón de compra devuelve 500, arreglalo");
    set("#project", "p1");
    set('#model-options select[data-option-id="effort"]', '"xhigh"');
    set("#runtime", "auto-accept-edits");
    doc.getElementById("submit").click();
  });
  await waitInExtension("composer/", (_w, doc) => !doc.getElementById("done").classList.contains("hidden"), "hilo creado");

  assert.equal(mock.originRejected, 0, "ningún request a /mcp llegó con Origin");
  assert.equal(mock.launch.projectId, "p1");
  assert.deepEqual(mock.launch.modelSelection, { instanceId: "claudeAgent", model: "claude-sonnet-5-5", options: [{ id: "effort", value: "xhigh" }] });
  assert.equal(mock.launch.runtimeMode, "auto-accept-edits");
  assert.ok(mock.launch.message.startsWith("El botón de compra devuelve 500"));
  assert.equal(mock.uploads.length, 2);
  for (const u of mock.uploads) assert.ok(u.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "PNG");
  console.log(`✓ hilo creado: 2 PNG subidos (recorte ${mock.uploads[0].bytes.readUInt32BE(16)}px), modelo + effort + permisos en t3_thread_launch`);
  await closeExtensionWindow("composer/");

  // ---------- click derecho ----------
  await wd("POST", `${S}/window`, { handle: pageHandle });
  const email = { [ELEMENT]: await find("#email") };
  await pointer([
    { type: "pointerMove", origin: email, x: 0, y: 0 },
    { type: "pointerDown", button: 2 },
    { type: "pointerUp", button: 2 },
  ]);
  await keys(""); // Escape
  await startCapture("element", { fromContextMenu: true });
  const descriptor = await waitInExtension("composer/", (_w, doc) => doc.getElementById("el-descriptor").textContent, "elemento del click derecho");
  assert.equal(descriptor, "#email");
  console.log("✓ click derecho → elemento correcto");
  await closeExtensionWindow("composer/");

  console.log("\nOK");
} finally {
  await wd("DELETE", S).catch(() => {});
  driver.kill();
  closeMock();
}
