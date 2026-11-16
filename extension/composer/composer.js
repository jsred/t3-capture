import "../lib/browser-shim.js";
import { McpClient, T3ToolError } from "../lib/t3client.js";
import { deleteCapture, getCapture } from "../lib/db.js";
import {
  getPrefs,
  getServers,
  getSettings,
  getSystemPrompts,
  resolveSystemPrompt,
  saveDefaultSystemPrompt,
  saveProjectSystemPrompt,
  updatePrefs,
} from "../lib/store.js";
import { autoTitle, buildPrompt, summarize } from "../lib/format.js";

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { element: "Elemento", area: "Área", visible: "Captura visible" };
const OPTION_LABEL = { effort: "Reasoning effort", reasoningEffort: "Reasoning effort", fastMode: "Fast mode", serviceTier: "Service tier" };
const RUNTIME_LABEL = {
  "approval-required": "Pedir aprobación",
  "auto-accept-edits": "Aceptar ediciones",
  auto: "Automático",
  "full-access": "Acceso total",
};
const ALL_RUNTIME_MODES = Object.keys(RUNTIME_LABEL);
const THREAD_STATUS_LABEL = {
  idle: "Sin actividad", preparing: "Preparando", queued: "En cola", starting: "Iniciando",
  running: "En curso", waiting: "Esperando respuesta", completed: "Completado",
  interrupted: "Interrumpido", failed: "Con error", cancelled: "Cancelado", rolled_back: "Revertido",
};

const state = {
  capture: null,
  settings: null,
  prefs: {},
  servers: [],
  clients: new Map(), // serverId -> McpClient
  devices: [], // { key, serverId, environmentId|null, label, reachable }
  providers: [], // capacidades del dispositivo elegido
  projects: [],
  loadSeq: 0,
  deviceReady: false,
  threads: [],
  threadCursor: null,
  threadLoadSeq: 0,
  threadsLoading: false,
  threadSearchTimer: null,
  sending: false,
  requestId: null,
  systemPrompts: { default: "", projects: {} },
  systemPromptEdited: false, // editada a mano para este hilo
};

const setStatus = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = `grow small ${kind || "muted"}`;
};

const clientFor = (serverId) => {
  if (!state.clients.has(serverId)) {
    const server = state.servers.find((s) => s.id === serverId);
    state.clients.set(serverId, new McpClient(server));
  }
  return state.clients.get(serverId);
};

const currentDevice = () => state.devices.find((d) => d.key === $("device").value);
const existingDestination = () => $("destination").value === "existing";
const currentThread = () => state.threads.find((t) => t.threadId === $("thread").value);

function syncSubmit() {
  $("submit").disabled = state.sending || !state.deviceReady || (existingDestination()
    ? !!currentDevice()?.environmentId || state.threadsLoading || !currentThread()
    : !findModel($("model").value));
}

// ---------- captura ----------
async function loadCapture() {
  const id = new URLSearchParams(location.search).get("id");
  const capture = id ? await getCapture(id) : null;
  if (!capture) {
    document.body.innerHTML = '<p class="muted" style="padding:24px">La captura ya no existe. Volvé a capturar desde la página.</p>';
    throw new Error("captura no encontrada");
  }
  state.capture = capture;
  capture.shots = (capture.shots ?? []).map((s) => ({ ...s, url: URL.createObjectURL(s.blob) }));

  $("page-title").textContent = capture.page?.title || "(sin título)";
  $("page-url").textContent = capture.page?.url || "";
  $("mode-pill").textContent = MODE_LABEL[capture.mode] || capture.mode;
  if (capture.favIconUrl && /^https?:|^data:/.test(capture.favIconUrl)) {
    $("favicon").src = capture.favIconUrl;
    $("favicon").classList.remove("hidden");
  }
  document.title = `T3 · ${capture.page?.title || "Nuevo hilo"}`;

  for (const shot of capture.shots) {
    const card = document.createElement("div");
    card.className = `shot${shot.include ? "" : " off"}`;
    const img = document.createElement("img");
    img.src = shot.url;
    img.alt = shot.label;
    img.addEventListener("click", () => {
      $("lightbox-img").src = shot.url;
      $("lightbox").showModal();
    });
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = shot.include;
    box.addEventListener("change", () => {
      shot.include = box.checked;
      card.classList.toggle("off", !box.checked);
      renderPreview();
    });
    label.append(box, ` ${shot.label}`);
    card.append(img, label);
    $("shots").append(card);
  }

  const el = capture.element;
  if (el) {
    $("element-card").classList.remove("hidden");
    $("el-descriptor").textContent = el.selector;
    $("el-size").textContent = el.rect ? `${el.rect.width}×${el.rect.height}` : "";
    const meta = [];
    const comps = el.framework?.react?.components || el.framework?.vue?.components;
    if (comps?.length) meta.push(`Componentes: ${comps.slice(0, 4).map((c) => `<${c}>`).join(" ← ")}`);
    if (el.framework?.react?.source) meta.push(`Fuente: ${el.framework.react.source}`);
    if (el.role) meta.push(`rol ${el.role}`);
    if (el.accessibleName) meta.push(`“${el.accessibleName.slice(0, 80)}”`);
    $("el-meta").textContent = meta.join(" · ");
    $("el-html").textContent = el.outerHTML;
  } else {
    $("inc-dom").closest("label").classList.add("hidden");
  }

  const s = summarize(capture);
  $("lbl-interactions").textContent = `Interacciones (${s.interactions})`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  $("lbl-console").textContent = `Consola (${s.console}${s.consoleErrors ? `, ${plural(s.consoleErrors, "error", "errores")}` : ""})`;
  $("lbl-network").textContent = `Red (${s.network}${s.failedRequests ? `, ${plural(s.failedRequests, "fallida", "fallidas")}` : ""})`;
  if (!s.interactions) $("inc-interactions").closest("label").classList.add("hidden");
  if (!s.console) $("inc-console").closest("label").classList.add("hidden");
  if (!s.network) $("inc-network").closest("label").classList.add("hidden");
}

// ---------- mensaje ----------
const includedShots = () => state.capture.shots.filter((s) => s.include);

function shotFileName(shot, index) {
  const ext = shot.blob.type === "image/jpeg" ? "jpg" : "png";
  return `captura-${index + 1}-${shot.kind}.${ext}`;
}

function currentPrompt() {
  const st = state.settings;
  return buildPrompt(state.capture, {
    systemPrompt: existingDestination() ? "" : $("system-prompt").value,
    userText: $("user-text").value,
    includeDom: $("inc-dom").checked,
    includeInteractions: $("inc-interactions").checked,
    includeConsole: $("inc-console").checked,
    includeNetwork: $("inc-network").checked,
    screenshotNames: includedShots().map((s, i) => `${shotFileName(s, i)} (${s.label})`),
    maxEvents: st.maxEventsInPrompt,
    maxConsole: st.maxConsoleInPrompt,
    maxNetwork: st.maxNetworkInPrompt,
  });
}

function renderPreview() {
  if ($("preview-details").open) $("preview").textContent = currentPrompt();
}

// ---------- dispositivos ----------
async function loadDevices() {
  state.servers = await getServers();
  if (!state.servers.length) {
    setStatus("Conectá T3 en Ajustes para poder enviar capturas.", "error");
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = " Abrir ajustes";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
    });
    $("status").append(a);
    return;
  }
  const select = $("device");
  select.innerHTML = "<option>Cargando…</option>";
  const groups = await Promise.all(
    state.servers.map(async (server) => {
      const client = clientFor(server.id);
      const devices = [{ key: `${server.id}|`, serverId: server.id, environmentId: null, label: server.label || server.origin, reachable: true }];
      try {
        const links = await client.environmentLinks();
        for (const link of links) {
          if (link.environmentId === server.environmentId) continue;
          devices.push({
            key: `${server.id}|${link.environmentId}`,
            serverId: server.id,
            environmentId: link.environmentId,
            label: `${link.label} (vía ${server.label})`,
            reachable: link.status === "reachable",
            status: link.status,
          });
        }
      } catch (error) {
        devices[0].reachable = false;
        devices[0].error = error.message;
      }
      return devices;
    }),
  );
  state.devices = groups.flat();
  select.innerHTML = "";
  for (const d of state.devices) {
    const option = new Option(d.reachable ? d.label : `${d.label} — ${d.status || "sin conexión"}`, d.key);
    option.disabled = !d.reachable;
    if (d.error) option.title = d.error;
    select.append(option);
  }
  const preferred = state.devices.find((d) => d.key === state.prefs.deviceKey && d.reachable) || state.devices.find((d) => d.reachable);
  if (preferred) select.value = preferred.key;
  else setStatus(state.devices[0]?.error || "Ningún dispositivo responde. ¿Está abierto T3 Code?", "error");
  await loadDeviceData();
}

async function loadDeviceData() {
  const device = currentDevice();
  const seq = ++state.loadSeq;
  state.deviceReady = false;
  resetThreads();
  $("project").disabled = true;
  $("model").disabled = true;
  syncSubmit();
  if (!device?.reachable) return;
  setStatus(`Cargando proyectos y modelos de ${device.label}…`);
  try {
    const client = clientFor(device.serverId);
    const [projects, caps] = await Promise.allSettled([client.projects(device.environmentId), client.capabilities(device.environmentId)]);
    if (seq !== state.loadSeq) return;
    if (projects.status === "rejected") throw projects.reason;
    state.projects = projects.value;
    state.providers = caps.status === "fulfilled" ? usableProviders(caps.value.providers) : [];
    state.deviceReady = true;
    renderProjects();
    renderModels();
    syncDestination();
  } catch (error) {
    if (seq !== state.loadSeq) return;
    console.error(error);
    setStatus(error.message, "error");
  }
}

// ---------- proyectos ----------
function renderProjects() {
  const select = $("project");
  select.innerHTML = "";
  const sorted = [...state.projects].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  for (const p of sorted) {
    const option = new Option(p.title, p.id);
    option.title = p.workspaceRoot;
    select.append(option);
  }
  select.append(existingDestination()
    ? new Option("Todos los proyectos (incluye Scratch)", "__all__")
    : new Option("Scratch (carpeta nueva, sin proyecto)", "__scratch__"));
  const remembered = state.prefs.projectByDevice?.[$("device").value];
  select.value = remembered && [...select.options].some((o) => o.value === remembered) ? remembered : select.options[0].value;
  select.disabled = !state.deviceReady;
  syncWorkspace();
}

// ---------- destino e hilos existentes ----------
function resetThreads() {
  clearTimeout(state.threadSearchTimer);
  state.threadLoadSeq++;
  state.threads = [];
  state.threadCursor = null;
  state.threadsLoading = false;
  $("thread").replaceChildren(new Option("Elegí un hilo…", ""));
  $("thread").disabled = true;
  $("threads-more").classList.add("hidden");
}

function syncDestination() {
  const existing = existingDestination();
  $("existing-fields").classList.toggle("hidden", !existing);
  for (const id of ["new-fields", "sp-details", "model-section"]) $(id).classList.toggle("hidden", existing);
  $("submit").replaceChildren(existing ? "Enviar al hilo " : "Crear hilo ");
  const shortcut = document.createElement("kbd");
  shortcut.textContent = "⌘↵";
  $("submit").append(shortcut);
  renderPreview();
  if (existing) {
    if (state.deviceReady) setStatus("");
    loadThreads();
  } else {
    resetThreads();
    if (state.deviceReady) {
      const noModel = !findModel($("model").value);
      setStatus(noModel ? "Este dispositivo no tiene proveedores de IA habilitados." : "", noModel ? "error" : "");
    }
  }
  syncSubmit();
}

async function loadThreads(more = false) {
  const device = currentDevice();
  if (!more) resetThreads();
  if (!existingDestination() || !state.deviceReady || !device?.reachable) return;
  if (device.environmentId) {
    $("thread-status").textContent = "Para enviar a un hilo existente, conectá esta máquina directamente desde Ajustes y elegí esa conexión en Dispositivo.";
    $("threads-refresh").disabled = true;
    syncSubmit();
    return;
  }
  const seq = ++state.threadLoadSeq;
  state.threadsLoading = true;
  $("thread").disabled = true;
  $("threads-refresh").disabled = true;
  $("threads-more").disabled = true;
  $("thread-status").textContent = "Cargando hilos…";
  syncSubmit();
  try {
    const projectId = $("project").value;
    const page = await clientFor(device.serverId).threads({
      projectId: projectId === "__all__" ? undefined : projectId,
      search: $("thread-search").value.trim(),
      cursor: more ? state.threadCursor : 0,
    });
    if (seq !== state.threadLoadSeq) return;
    const selected = $("thread").value;
    const known = new Set(state.threads.map((t) => t.threadId));
    state.threads.push(...(page.threads ?? []).filter((t) => !t.archived && !known.has(t.threadId)));
    state.threadCursor = page.nextCursor ?? null;
    $("thread").replaceChildren(new Option("Elegí un hilo…", ""));
    for (const thread of state.threads) {
      const project = state.projects.find((p) => p.id === thread.projectId);
      const prefix = projectId === "__all__" && project ? `${project.title} · ` : "";
      $("thread").append(new Option(`${prefix}${thread.title || "(sin título)"} · ${THREAD_STATUS_LABEL[thread.status] || thread.status}`, thread.threadId));
    }
    $("thread").value = selected;
    $("thread-status").textContent = state.threads.length
      ? `${state.threads.length} hilos. Elegí dónde enviar la captura.`
      : "No hay hilos que coincidan. Probá otro proyecto o cambiá la búsqueda.";
  } catch (error) {
    if (seq !== state.threadLoadSeq) return;
    $("thread-status").textContent = `No se pudieron cargar los hilos: ${error.message}`;
  } finally {
    if (seq === state.threadLoadSeq) {
      state.threadsLoading = false;
      $("thread").disabled = !state.threads.length;
      $("threads-refresh").disabled = false;
      $("threads-more").disabled = false;
      $("threads-more").classList.toggle("hidden", state.threadCursor === null);
      syncSubmit();
    }
  }
}

function syncWorkspace() {
  const projectId = $("project").value;
  const scratch = projectId === "__scratch__";
  $("workspace-field").classList.toggle("hidden", scratch);
  const project = state.projects.find((p) => p.id === projectId);
  const remembered = state.prefs.workspaceByProject?.[projectId];
  $("workspace").value = remembered || (project?.defaultThreadEnvMode === "worktree" ? "worktree" : "root");
  $("baseref").value = state.prefs.baseRefByProject?.[projectId] || "main";
  syncBaseRef();
  syncSystemPrompt();
}

// ---------- instrucciones del sistema ----------
function projectLabel() {
  return $("project").selectedOptions[0]?.textContent || $("project").value;
}

function syncSystemPrompt() {
  const projectId = $("project").value;
  const scratch = !projectId || projectId === "__scratch__";
  const resolved = resolveSystemPrompt(state.systemPrompts, scratch ? null : projectId);
  // Si el usuario la editó para este hilo, no la pisamos al cambiar de proyecto.
  if (!state.systemPromptEdited) $("system-prompt").value = resolved.text;
  const source = state.systemPromptEdited
    ? "· editada para este hilo"
    : resolved.source === "project"
      ? `· del proyecto «${projectLabel()}»`
      : resolved.source === "default"
        ? "· default"
        : "· ninguna";
  $("sp-source").textContent = source;
  $("sp-save-project").disabled = scratch;
  $("sp-save-project").textContent = scratch ? "Guardar para este proyecto" : `Guardar para «${projectLabel()}»`;
  renderPreview();
}

async function saveSystemPrompt(target) {
  const text = $("system-prompt").value;
  if (target === "default") {
    state.systemPrompts = await saveDefaultSystemPrompt(text);
  } else {
    state.systemPrompts = await saveProjectSystemPrompt($("project").value, {
      prompt: text,
      title: projectLabel(),
      device: currentDevice()?.label ?? null,
    });
  }
  state.systemPromptEdited = false;
  syncSystemPrompt();
  $("sp-saved").textContent = target === "default" ? "Guardada como default" : "Guardada para el proyecto";
  setTimeout(() => ($("sp-saved").textContent = ""), 2500);
}

function syncBaseRef() {
  const show = $("project").value !== "__scratch__" && $("workspace").value === "worktree";
  $("baseref-field").classList.toggle("hidden", !show);
}

// ---------- modelos ----------
function usableProviders(providers = []) {
  return providers.filter((p) => p.models?.length && !p.constraints?.some((c) => /disabled|deshabilitad/i.test(c)));
}

const modelKey = (instanceId, modelId) => `${instanceId}::${modelId}`;

function findModel(key) {
  const [instanceId, modelId] = key.split("::");
  const provider = state.providers.find((p) => p.providerInstanceId === instanceId);
  const model = provider?.models.find((m) => m.id === modelId);
  return provider && model ? { provider, model } : null;
}

function renderModels(selectKey) {
  const select = $("model");
  select.innerHTML = "";
  for (const provider of state.providers) {
    const group = document.createElement("optgroup");
    group.label = provider.displayName || provider.providerInstanceId;
    for (const model of provider.models) group.append(new Option(model.label || model.id, modelKey(provider.providerInstanceId, model.id)));
    select.append(group);
  }
  if (!select.options.length) {
    setStatus("Este dispositivo no tiene proveedores de IA habilitados.", "error");
    return;
  }
  const wanted = selectKey || state.prefs.modelKey;
  select.value = wanted && findModel(wanted) ? wanted : select.options[0].value;
  select.disabled = false;
  renderModelOptions();
  syncSubmit();
}

const encodeValue = (v) => JSON.stringify(v);
const decodeValue = (s) => JSON.parse(s);

function renderModelOptions() {
  const container = $("model-options");
  container.innerHTML = "";
  const found = findModel($("model").value);
  if (!found) return;
  const { provider, model } = found;
  const remembered = state.prefs.optionsByModel?.[$("model").value] ?? {};
  for (const opt of model.options ?? []) {
    if (!opt.values?.length) continue;
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = OPTION_LABEL[opt.id] || opt.id;
    const select = document.createElement("select");
    select.dataset.optionId = opt.id;
    for (const value of opt.values) {
      const text = typeof value === "boolean" ? (value ? "Sí" : "No") : String(value);
      select.append(new Option(`${text}${value === opt.default ? " (default)" : ""}`, encodeValue(value)));
    }
    const initial = opt.id in remembered ? remembered[opt.id] : opt.default ?? opt.values[0];
    select.value = encodeValue(opt.values.includes(initial) ? initial : opt.values[0]);
    label.append(select);
    container.append(label);
  }

  const modes = provider.runtimeModes?.length ? provider.runtimeModes : ALL_RUNTIME_MODES;
  const runtime = $("runtime");
  runtime.innerHTML = "";
  for (const mode of modes) runtime.append(new Option(RUNTIME_LABEL[mode] || mode, mode));
  const preferredMode = state.prefs.runtimeMode;
  runtime.value = modes.includes(preferredMode) ? preferredMode : modes.includes("full-access") ? "full-access" : modes[0];
}

function selectedOptions() {
  return [...$("model-options").querySelectorAll("select[data-option-id]")].map((s) => ({ id: s.dataset.optionId, value: decodeValue(s.value) }));
}

async function searchModels(query) {
  const device = currentDevice();
  if (!device || !query.trim()) return;
  setStatus(`Buscando “${query}”…`);
  try {
    const caps = await clientFor(device.serverId).capabilities(device.environmentId, query.trim());
    let first = null;
    for (const found of usableProviders(caps.providers)) {
      const existing = state.providers.find((p) => p.providerInstanceId === found.providerInstanceId);
      if (!existing) state.providers.push(found);
      for (const model of found.models) {
        if (!first) first = modelKey(found.providerInstanceId, model.id);
        if (existing && !existing.models.some((m) => m.id === model.id)) existing.models.push(model);
      }
    }
    if (!first) return setStatus(`No hay modelos que coincidan con “${query}”.`, "error");
    renderModels(first);
    setStatus("");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

// ---------- enviar captura ----------
async function submitCapture() {
  if ($("submit").disabled || state.sending) return;
  const device = currentDevice();
  const existing = existingDestination();
  const thread = currentThread();
  const found = findModel($("model").value);
  if (!device || (existing ? !thread || device.environmentId : !found)) return;
  const userText = $("user-text").value;
  const projectId = $("project").value;
  const scratch = projectId === "__scratch__";
  const worktree = !scratch && $("workspace").value === "worktree";
  const baseRef = $("baseref").value.trim() || "main";
  const options = selectedOptions();
  const message = currentPrompt();

  state.sending = true;
  $("app").inert = true;
  syncSubmit();
  try {
    const client = clientFor(device.serverId);
    const shots = includedShots();
    const attachments = [];
    for (const [i, shot] of shots.entries()) {
      setStatus(`Subiendo captura ${i + 1} de ${shots.length}…`);
      attachments.push(await client.uploadAttachment(shot.blob, shotFileName(shot, i)));
    }
    setStatus(existing ? "Enviando al hilo…" : "Creando el hilo…");
    state.requestId ??= `t3capture-${crypto.randomUUID()}`;
    const result = existing ? await client.sendToThread({
      threadId: thread.threadId,
      message,
      attachments,
      clientRequestId: state.requestId,
    }) : await client.launchThread({
      title: $("title").value.trim() || autoTitle(state.capture, userText),
      message,
      modelSelection: { instanceId: found.provider.providerInstanceId, model: found.model.id, ...(options.length ? { options } : {}) },
      runtimeMode: $("runtime").value,
      interactionMode: $("plan").checked ? "plan" : "default",
      clientRequestId: state.requestId,
      ...(attachments.length ? { attachments } : {}),
      ...(device.environmentId ? { environmentId: device.environmentId } : {}),
      ...(scratch ? { scratch: true } : { projectId }),
      ...(worktree ? { workspaceStrategy: { type: "worktree", baseRef } } : {}),
    });

    const key = $("model").value;
    // El envío ya tuvo éxito: un error local no debe habilitar un envío duplicado.
    await updatePrefs({
      deviceKey: device.key,
      projectByDevice: { ...state.prefs.projectByDevice, [device.key]: projectId },
      ...(!existing ? {
        modelKey: key,
        runtimeMode: $("runtime").value,
        workspaceByProject: { ...state.prefs.workspaceByProject, [projectId]: $("workspace").value },
        baseRefByProject: worktree ? { ...state.prefs.baseRefByProject, [projectId]: baseRef } : state.prefs.baseRefByProject,
        optionsByModel: { ...state.prefs.optionsByModel, [key]: Object.fromEntries(options.map((o) => [o.id, o.value])) },
      } : {}),
    }).catch(console.error);
    await deleteCapture(state.capture.id).catch(() => {});
    showDone({ ...result, link: result?.link || (existing ? thread.link : null) }, device, existing ? thread : null, found);
  } catch (error) {
    console.error(error);
    // Error definitivo de T3: el próximo intento es una solicitud nueva.
    if (error instanceof T3ToolError) state.requestId = null;
    const uncertain = existing && !(error instanceof T3ToolError) && state.requestId;
    setStatus(`${error.message || String(error)}${uncertain ? " Revisá el hilo antes de reintentar: no se pudo confirmar el envío." : ""}`, "error");
    state.sending = false;
    $("app").inert = false;
    syncSubmit();
  }
}

function showDone(result, device, thread, found) {
  $("app").classList.add("hidden");
  document.querySelector("footer").classList.add("hidden");
  $("done").classList.remove("hidden");
  const projectLabel = $("project").selectedOptions[0]?.textContent;
  $("done-title").textContent = thread ? "Captura enviada" : "Hilo creado";
  $("done-detail").textContent = thread
    ? `${thread.title} · ${device.label}`
    : `${projectLabel} · ${device.label} · ${found.model.label || found.model.id}`;
  if (result?.link) {
    $("done-link").href = result.link;
    $("done-copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(result.link);
      $("done-copy").textContent = "Copiado";
    });
  } else {
    $("done-link").classList.add("hidden");
    $("done-copy").classList.add("hidden");
  }
  $("done-link").addEventListener("click", () => setTimeout(() => window.close(), 300));
  $("done-close").addEventListener("click", () => window.close());
}

// ---------- eventos ----------
$("device").addEventListener("change", loadDeviceData);
$("destination").addEventListener("change", () => {
  state.requestId = null;
  const projectId = $("project").value;
  renderProjects();
  if ([...$("project").options].some((o) => o.value === projectId)) $("project").value = projectId;
  syncWorkspace();
  syncDestination();
});
$("project").addEventListener("change", () => {
  syncWorkspace();
  if (existingDestination()) loadThreads();
});
$("thread").addEventListener("change", () => {
  state.requestId = null;
  syncSubmit();
});
$("thread-search").addEventListener("input", () => {
  resetThreads();
  syncSubmit();
  state.threadSearchTimer = setTimeout(() => loadThreads(), 250);
});
$("threads-refresh").addEventListener("click", () => loadThreads());
$("threads-more").addEventListener("click", () => loadThreads(true));
$("workspace").addEventListener("change", syncBaseRef);
$("model").addEventListener("change", renderModelOptions);
$("model-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    searchModels(e.target.value);
  }
});
$("preview-details").addEventListener("toggle", renderPreview);
for (const id of ["user-text", "inc-dom", "inc-interactions", "inc-console", "inc-network"]) {
  $(id).addEventListener("input", renderPreview);
  $(id).addEventListener("change", renderPreview);
}
$("system-prompt").addEventListener("input", () => {
  state.systemPromptEdited = true;
  $("sp-source").textContent = "· editada para este hilo";
  renderPreview();
});
$("sp-save-project").addEventListener("click", () => saveSystemPrompt("project"));
$("sp-save-default").addEventListener("click", () => saveSystemPrompt("default"));
$("sp-manage").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});
$("submit").addEventListener("click", submitCapture);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !$("submit").disabled) {
    e.preventDefault();
    submitCapture();
  }
});
$("lightbox").addEventListener("click", () => $("lightbox").close());
window.addEventListener("pagehide", () => state.capture?.shots.forEach((s) => URL.revokeObjectURL(s.url)));

// ---------- inicio ----------
state.settings = await getSettings();
state.prefs = await getPrefs();
state.systemPrompts = await getSystemPrompts();
syncSystemPrompt();
await loadCapture();
$("user-text").focus();
await loadDevices();
