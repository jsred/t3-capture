import "../lib/browser-shim.js";
import { getServers } from "../lib/store.js";

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "t3capture:start", mode: button.dataset.mode, tabId: tab.id });
    window.close();
  });
}

const openSettings = (e) => {
  e?.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
};
document.getElementById("settings").addEventListener("click", openSettings);
document.getElementById("connect").addEventListener("click", openSettings);

if ((await getServers()).length === 0) document.getElementById("no-server").classList.remove("hidden");

const commands = await browser.commands.getAll();
for (const kbd of document.querySelectorAll("kbd[data-command]")) {
  const shortcut = commands.find((c) => c.name === kbd.dataset.command)?.shortcut;
  if (shortcut) kbd.textContent = shortcut.replace(/\+/g, " ");
}
