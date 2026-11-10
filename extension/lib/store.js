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
