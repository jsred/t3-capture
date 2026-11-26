import "./browser-shim.js";

// "firefox" (Zen, Firefox…) o "chrome" (Chrome, Brave, Arc, Edge…).
export const BROWSER = globalThis.location?.protocol === "moz-extension:" ? "firefox" : "chrome";
export const IS_FIREFOX = BROWSER === "firefox";

export function extensionVersion() {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return "dev";
  }
}

export function openComposer(id) {
  const url = browser.runtime.getURL(`composer/composer.html?id=${encodeURIComponent(id)}`);
  return browser.windows.create({ url, type: "popup", width: 720, height: 920 });
}

// Abre la pantalla del navegador donde se cambian los atajos de la extensión.
export async function openShortcutSettings() {
  if (IS_FIREFOX) {
    if (browser.commands.openShortcutSettings) return browser.commands.openShortcutSettings();
    return browser.tabs.create({ url: "about:addons" });
  }
  return browser.tabs.create({ url: "chrome://extensions/shortcuts" });
}
