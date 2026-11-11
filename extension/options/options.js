import "../lib/browser-shim.js";
import { DEFAULT_ORIGIN, McpClient, normalizeOrigin, pairWithCode, parsePairingInput, signInWithBrowser } from "../lib/t3client.js";
import {
  getServers,
  getSettings,
  getSystemPrompts,
  removeServer,
  saveDefaultSystemPrompt,
  saveProjectSystemPrompt,
  saveServer,
  updateSettings,
} from "../lib/store.js";
import { openShortcutSettings } from "../lib/platform.js";

const $ = (id) => document.getElementById(id);
const ALL_URLS = { origins: ["<all_urls>"] };

// ---------- permisos ----------
async function checkPermission() {
  const ok = await browser.permissions.contains(ALL_URLS);
  $("perm").classList.toggle("hidden", ok);
}
$("grant").addEventListener("click", async () => {
  await browser.permissions.request(ALL_URLS);
  checkPermission();
});
checkPermission();

// ---------- dispositivos ----------
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

async function testServer(server, node) {
  const state = node.querySelector(".state");
  const links = node.querySelector(".links");
  state.textContent = "probando…";
  state.className = "pill state";
  try {
    const client = new McpClient(server);
    const env = await client.environment();
    const linked = await client.environmentLinks();
    state.textContent = "conectado";
    state.classList.add("ok");
    if (env?.label && env.label !== server.label) {
      await saveServer({ ...server, label: env.label, environmentId: env.environmentId });
      node.querySelector(".label").textContent = env.label;
    }
    links.textContent = linked.length
      ? `Entornos vinculados: ${linked.map((l) => `${l.label} (${l.status})`).join(", ")}`
      : "";
  } catch (error) {
    state.textContent = error.name === "T3AuthError" ? "volvé a conectar" : "sin conexión";
    state.classList.add("err");
    state.title = error.message;
  }
}

async function renderServers() {
  const servers = await getServers();
  const container = $("servers");
  container.innerHTML = "";
  if (!servers.length) {
    container.innerHTML = '<div class="muted small">Ninguno todavía.</div>';
    return;
  }
  for (const server of servers) {
    const node = $("server-tpl").content.firstElementChild.cloneNode(true);
    node.querySelector(".label").textContent = server.label || server.origin;
    const expiry = server.expiresAt ? ` · token vence el ${fmtDate(server.expiresAt)}` : "";
    node.querySelector(".origin").textContent = `${server.origin}${expiry}`;
    node.querySelector(".test").addEventListener("click", () => testServer(server, node));
    node.querySelector(".remove").addEventListener("click", async () => {
      if (!confirm(`¿Quitar ${server.label || server.origin}? Podés revocar la sesión en T3 → Settings → Connections.`)) return;
      await removeServer(server.id);
      renderServers();
    });
    container.append(node);
    testServer(server, node);
  }
}

// ---------- emparejar ----------
$("pair-input").addEventListener("input", () => {
  const { origin } = parsePairingInput($("pair-input").value);
  if (origin) $("origin-input").value = origin;
});

function showStatus(text, kind = "") {
  const el = $("pair-status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function finishPairing(origin, result) {
  const client = new McpClient({ origin, token: result.token });
  const env = await client.environment();
  const server = {
    id: env.environmentId || crypto.randomUUID(),
    origin,
    label: env.label || origin,
    environmentId: env.environmentId,
    token: result.token,
    expiresAt: result.expiresAt,
    clientId: result.clientId,
    addedAt: Date.now(),
  };
  await saveServer(server);
  showStatus(`Conectado a ${server.label}.`, "success");
  $("pair-input").value = "";
  renderServers();
  loadProjectChoices();
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    console.error(error);
    showStatus(error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
}

$("pair-form").addEventListener("submit", (e) => {
  e.preventDefault();
  withBusy($("pair-submit"), async () => {
    const parsed = parsePairingInput($("pair-input").value);
    if (!parsed.code) throw new Error("Pegá un link o código de emparejamiento.");
    const origin = normalizeOrigin($("origin-input").value || parsed.origin || DEFAULT_ORIGIN);
    showStatus("Conectando…");
    const result = await pairWithCode({ origin, code: parsed.code, redirectUri: browser.identity.getRedirectURL() });
    await finishPairing(origin, result);
  });
});

$("oauth-btn").addEventListener("click", () =>
  withBusy($("oauth-btn"), async () => {
    const origin = normalizeOrigin($("origin-input").value || DEFAULT_ORIGIN);
    showStatus("Aprobá el acceso en la ventana de T3…");
    const result = await signInWithBrowser({
      origin,
      redirectUri: browser.identity.getRedirectURL(),
      launchWebAuthFlow: (opts) => browser.identity.launchWebAuthFlow(opts),
    });
    await finishPairing(origin, result);
  }),
);

// ---------- instrucciones del sistema ----------
function flashSaved(text = "Guardado") {
  $("sp-status").textContent = text;
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => ($("sp-status").textContent = ""), 2000);
}

async function renderSystemPrompts() {
  const sp = await getSystemPrompts();
  $("sp-default").value = sp.default;
  const container = $("sp-projects");
  container.innerHTML = "";
  const entries = Object.entries(sp.projects).sort(([, a], [, b]) => (a.title || "").localeCompare(b.title || ""));
  for (const [projectId, entry] of entries) {
    const node = $("sp-project-tpl").content.firstElementChild.cloneNode(true);
    node.dataset.projectId = projectId;
    node.querySelector(".sp-title").textContent = entry.title || projectId;
    node.querySelector(".sp-device").textContent = entry.device || "";
    const text = node.querySelector(".sp-text");
    text.value = entry.prompt;
    text.placeholder = "Instrucciones para este proyecto (vacío = usar la default)";
    text.addEventListener("change", async () => {
      await saveProjectSystemPrompt(projectId, { prompt: text.value });
      flashSaved();
    });
    node.querySelector(".sp-remove").addEventListener("click", async () => {
      await saveProjectSystemPrompt(projectId, { prompt: null });
      renderSystemPrompts();
      loadProjectChoices();
    });
    container.append(node);
  }
}

// Proyectos de todos los dispositivos conectados, para agregar instrucciones.
let projectChoices = [];
async function loadProjectChoices() {
  const select = $("sp-project-select");
  const servers = await getServers();
  const sp = await getSystemPrompts();
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        const projects = await new McpClient(server).projects();
        return projects.map((p) => ({ id: p.id, title: p.title, device: server.label || server.origin }));
      } catch {
        return [];
      }
    }),
  );
  projectChoices = results.flat().filter((p) => !(p.id in sp.projects));
  select.innerHTML = "";
  if (!projectChoices.length) {
    select.append(new Option(servers.length ? "No hay más proyectos" : "Conectá un dispositivo para ver sus proyectos", ""));
  }
  for (const p of projectChoices.sort((a, b) => a.title.localeCompare(b.title))) {
    select.append(new Option(servers.length > 1 ? `${p.title} — ${p.device}` : p.title, p.id));
  }
  $("sp-add").disabled = !projectChoices.length;
}

$("sp-default").addEventListener("change", async (e) => {
  await saveDefaultSystemPrompt(e.target.value);
  flashSaved();
});
$("sp-add").addEventListener("click", async () => {
  const choice = projectChoices.find((p) => p.id === $("sp-project-select").value);
  if (!choice) return;
  await saveProjectSystemPrompt(choice.id, { prompt: "", title: choice.title, device: choice.device });
  await renderSystemPrompts();
  $("sp-projects").querySelector(`[data-project-id="${CSS.escape(choice.id)}"] .sp-text`)?.focus();
  loadProjectChoices();
});
renderSystemPrompts();
loadProjectChoices();

// ---------- ajustes ----------
const settings = await getSettings();
$("set-inputs").checked = settings.captureInputValues;
$("set-max-events").value = settings.maxEventsInPrompt;
$("set-max-console").value = settings.maxConsoleInPrompt;
$("set-max-network").value = settings.maxNetworkInPrompt;
$("set-inputs").addEventListener("change", (e) => updateSettings({ captureInputValues: e.target.checked }));
for (const [id, key] of [
  ["set-max-events", "maxEventsInPrompt"],
  ["set-max-console", "maxConsoleInPrompt"],
  ["set-max-network", "maxNetworkInPrompt"],
]) {
  $(id).addEventListener("change", (e) => updateSettings({ [key]: Math.max(0, Number(e.target.value) || 0) }));
}

const commands = await browser.commands.getAll();
$("shortcuts").textContent = commands
  .filter((c) => c.shortcut)
  .map((c) => `${c.shortcut} (${c.description || c.name})`)
  .join(" · ");
$("edit-shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  openShortcutSettings();
});

renderServers();
