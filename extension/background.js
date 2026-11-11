import "./lib/browser-shim.js";
import { putCapture, pruneCaptures } from "./lib/db.js";

// Firefox: página de eventos (background.scripts). Chrome: service worker.
const IS_SERVICE_WORKER = typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope;
const PERMISSIONS = browser.runtime.getManifest().permissions || [];
const menus = browser.menus ?? browser.contextMenus;

// ---------- Origin para /mcp ----------
// El MCP de T3 rechaza con 403 cualquier request con un header Origin que no
// tenga en su lista (protección contra DNS rebinding), y el navegador manda
// `Origin: moz-extension://…` / `chrome-extension://…` en los POST de la
// extensión. Lo quitamos solo en los requests de esta extensión a `/mcp`.
const MCP_URL_REGEX = "^https?://[^/]+/mcp([?#].*)?$";
const ORIGIN_RULE_ID = 1;

if (PERMISSIONS.includes("webRequestBlocking")) {
  // Firefox: webRequest bloqueante.
  const EXTENSION_BASE = browser.runtime.getURL("");
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const fromExtension = (details.originUrl || details.documentUrl || "").startsWith(EXTENSION_BASE);
      if (!fromExtension || new URL(details.url).pathname !== "/mcp") return {};
      return { requestHeaders: details.requestHeaders.filter((h) => h.name.toLowerCase() !== "origin") };
    },
    { urls: ["http://*/mcp", "https://*/mcp"], types: ["xmlhttprequest"] },
    ["blocking", "requestHeaders"],
  );
} else if (browser.declarativeNetRequest) {
  // Chrome (MV3 no tiene webRequest bloqueante): regla de declarativeNetRequest
  // limitada a requests iniciados por la propia extensión.
  installOriginRule().catch((error) => console.error("[t3-capture] regla de Origin", error));
}

async function installOriginRule() {
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ORIGIN_RULE_ID],
    addRules: [
      {
        id: ORIGIN_RULE_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: {
          regexFilter: MCP_URL_REGEX,
          initiatorDomains: [browser.runtime.id],
          resourceTypes: ["xmlhttprequest"],
        },
      },
    ],
  });
}

const MAX_IMAGE_BYTES = 9.5 * 1024 * 1024; // T3 acepta hasta 10 MB por imagen
const MAX_IMAGE_SIDE = 4000;

// ---------- menús contextuales ----------
const MENU_CONTEXTS = ["page", "frame", "selection", "link", "editable", "image", "video", "audio"];

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  await menus.removeAll();
  menus.create({ id: "t3-element", title: "Crear hilo de T3 con este elemento", contexts: MENU_CONTEXTS });
  menus.create({ id: "t3-area", title: "Crear hilo de T3 con un área…", contexts: MENU_CONTEXTS });
  menus.create({ id: "t3-visible", title: "Crear hilo de T3 con captura visible", contexts: MENU_CONTEXTS });
  if (reason === "install") browser.runtime.openOptionsPage();
});

browser.runtime.onStartup.addListener(() => pruneCaptures().catch(() => {}));

menus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  // targetElementId solo existe en Firefox; en Chrome el content script usa
  // el último elemento sobre el que se hizo click derecho.
  if (info.menuItemId === "t3-element") startCapture(tab, "element", { fromContextMenu: true, targetElementId: info.targetElementId });
  if (info.menuItemId === "t3-area") startCapture(tab, "area");
  if (info.menuItemId === "t3-visible") startCapture(tab, "visible");
});

// ---------- atajos ----------
browser.commands.onCommand.addListener(async (command, commandTab) => {
  const tab = commandTab?.id ? commandTab : (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) return;
  const mode = { "pick-element": "element", "pick-area": "area", "capture-visible": "visible" }[command];
  if (mode) startCapture(tab, mode);
});

// ---------- mensajes del popup ----------
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "t3capture:start") {
    browser.tabs.get(message.tabId).then((tab) => startCapture(tab, message.mode));
    sendResponse({ ok: true });
  }
  return false;
});

// ---------- captura ----------
async function ensureContentScripts(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "t3capture:ping" });
    return true;
  } catch {
    // Pestaña abierta antes de instalar la extensión: inyectamos ahora.
    // Los eventos anteriores a este momento no quedan registrados.
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ["content/recorder-main.js"], world: "MAIN" });
      await browser.scripting.executeScript({ target: { tabId }, files: ["lib/browser-shim.js", "content/content.js"] });
      return true;
    } catch {
      return false;
    }
  }
}

function notify(message) {
  browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-128.png"),
    title: "T3 Capture",
    message,
  });
}

// Una captura a la vez por pestaña. Si la pestaña navega mientras se elige,
// sendMessage se rechaza y se libera.
const busyTabs = new Set();

// Chrome apaga el service worker tras 30 s sin eventos ni llamadas a la API,
// y elegir un elemento puede llevar más. Mientras dura la selección, una
// llamada barata cada 20 s lo mantiene vivo.
function keepAlive() {
  if (!IS_SERVICE_WORKER) return () => {};
  const timer = setInterval(() => browser.runtime.getPlatformInfo().catch(() => {}), 20_000);
  return () => clearInterval(timer);
}

async function startCapture(tab, mode, { fromContextMenu = false, targetElementId } = {}) {
  if (busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  const release = keepAlive();
  try {
    const injected = await ensureContentScripts(tab.id);
    let data;
    if (injected) {
      data = await browser.tabs.sendMessage(tab.id, { type: "t3capture:run", mode, fromContextMenu, targetElementId });
      if (!data || data.cancelled) return;
      if (data.error) throw new Error(data.error);
    } else if (mode === "visible") {
      // Páginas donde no se puede inyectar (p. ej. visores internos): solo imagen.
      data = { mode, page: { url: tab.url, title: tab.title }, interactions: [], console: [], network: [], capturedAt: Date.now() };
    } else {
      notify("No se puede seleccionar en esta página (página interna del navegador o protegida).");
      return;
    }

    const shots = await takeScreenshots(tab, data);
    const id = crypto.randomUUID();
    await putCapture({ id, createdAt: Date.now(), favIconUrl: tab.favIconUrl || null, ...data, shots });
    await openComposer(id);
  } catch (error) {
    console.error("[t3-capture]", error);
    notify(`No se pudo capturar: ${error.message || error}`);
  } finally {
    release();
    busyTabs.delete(tab.id);
  }
}

// Para los tests end-to-end (test/chrome-e2e.mjs).
globalThis.__t3capture = { startCapture };

async function takeScreenshots(tab, data) {
  let dataUrl;
  for (let attempt = 0; !dataUrl; attempt++) {
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (error) {
      // Chrome permite 2 capturas por segundo (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND).
      if (attempt < 3 && /MAX_CAPTURE|quota/i.test(error?.message || "")) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      console.warn("[t3-capture] captureVisibleTab falló", error);
      return [];
    }
  }
  const full = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const viewportWidth = data.page?.viewport?.width || full.width;
  const scale = full.width / viewportWidth;
  const shots = [];

  if (data.rect && data.mode === "element") {
    shots.push({ kind: "crop", label: "Elemento", blob: await crop(full, data.rect, scale, 12), include: true });
    shots.push({ kind: "full", label: "Página con el elemento marcado", blob: await highlight(full, data.rect, scale), include: true });
  } else if (data.rect && data.mode === "area") {
    shots.push({ kind: "crop", label: "Área seleccionada", blob: await crop(full, data.rect, scale, 0), include: true });
    shots.push({ kind: "full", label: "Página completa (área marcada)", blob: await highlight(full, data.rect, scale), include: false });
  } else {
    shots.push({ kind: "full", label: "Captura visible", blob: await encode(drawScaled(full)), include: true });
  }
  full.close?.();
  return shots;
}

function drawScaled(bitmap, sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height) {
  const factor = Math.min(1, MAX_IMAGE_SIDE / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * factor)), Math.max(1, Math.round(sh * factor)));
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encode(canvas) {
  let blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size > MAX_IMAGE_BYTES) blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return blob;
}

function clampRect(bitmap, rect, scale, pad) {
  const x = Math.max(0, Math.floor((rect.x - pad) * scale));
  const y = Math.max(0, Math.floor((rect.y - pad) * scale));
  const right = Math.min(bitmap.width, Math.ceil((rect.x + rect.width + pad) * scale));
  const bottom = Math.min(bitmap.height, Math.ceil((rect.y + rect.height + pad) * scale));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function crop(bitmap, rect, scale, pad) {
  const r = clampRect(bitmap, rect, scale, pad);
  return encode(drawScaled(bitmap, r.x, r.y, r.width, r.height));
}

function highlight(bitmap, rect, scale) {
  const canvas = drawScaled(bitmap);
  const factor = canvas.width / bitmap.width;
  const ctx = canvas.getContext("2d");
  const r = clampRect(bitmap, rect, scale, 4);
  const lw = Math.max(3, Math.round(3 * scale * factor));
  ctx.strokeStyle = "#ff2d55";
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 3, lw * 1.5]);
  ctx.strokeRect(r.x * factor, r.y * factor, r.width * factor, r.height * factor);
  return encode(canvas);
}

async function openComposer(id) {
  const url = browser.runtime.getURL(`composer/composer.html?id=${encodeURIComponent(id)}`);
  await browser.windows.create({ url, type: "popup", width: 720, height: 920 });
}
