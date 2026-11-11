// Persistencia: conexiones a T3, preferencias del compositor y ajustes.

export const DEFAULT_SETTINGS = {
  captureInputValues: true, // los campos de contraseña / tarjeta siempre se ocultan
  captureConsoleLogs: true, // console.log/info además de warn/error
  maxEventsInPrompt: 60,
  maxConsoleInPrompt: 40,
  maxNetworkInPrompt: 40,
};

export async function getServers() {
  const { servers = [] } = await browser.storage.local.get("servers");
  return servers;
}

export async function saveServer(server) {
  const servers = await getServers();
  const index = servers.findIndex((s) => s.id === server.id);
  if (index >= 0) servers[index] = { ...servers[index], ...server };
  else servers.push(server);
  await browser.storage.local.set({ servers });
  return server;
}

export async function removeServer(id) {
  const servers = (await getServers()).filter((s) => s.id !== id);
  await browser.storage.local.set({ servers });
}

export async function getPrefs() {
  const { prefs = {} } = await browser.storage.local.get("prefs");
  return prefs;
}

export async function updatePrefs(patch) {
  const prefs = { ...(await getPrefs()), ...patch };
  await browser.storage.local.set({ prefs });
  return prefs;
}

export async function getSettings() {
  const { settings = {} } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function updateSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ settings });
  return settings;
}

// ---------- instrucciones del sistema ----------
// T3 no tiene un campo de system prompt al crear un hilo: estas instrucciones
// van al principio del primer mensaje. La del proyecto reemplaza a la default.
// { default: string, projects: { [projectId]: { prompt, title, device } } }

export async function getSystemPrompts() {
  const { systemPrompts = {} } = await browser.storage.local.get("systemPrompts");
  return { default: systemPrompts.default ?? "", projects: systemPrompts.projects ?? {} };
}

async function setSystemPrompts(systemPrompts) {
  await browser.storage.local.set({ systemPrompts });
  return systemPrompts;
}

export async function saveDefaultSystemPrompt(prompt) {
  const sp = await getSystemPrompts();
  return setSystemPrompts({ ...sp, default: prompt.trim() });
}

/** Guarda la instrucción de un proyecto. Con `prompt` vacío la borra. */
export async function saveProjectSystemPrompt(projectId, { prompt, title, device }) {
  const sp = await getSystemPrompts();
  const projects = { ...sp.projects };
  if (prompt === null || prompt === undefined) delete projects[projectId];
  else projects[projectId] = { prompt: prompt.trim(), title: title ?? projects[projectId]?.title ?? projectId, device: device ?? projects[projectId]?.device ?? null };
  return setSystemPrompts({ ...sp, projects });
}

/** Qué instrucción corresponde a un proyecto: { text, source: "project" | "default" | null }. */
export function resolveSystemPrompt(sp, projectId) {
  const project = projectId ? sp.projects[projectId]?.prompt?.trim() : "";
  if (project) return { text: project, source: "project" };
  const fallback = sp.default?.trim();
  if (fallback) return { text: fallback, source: "default" };
  return { text: "", source: null };
}
