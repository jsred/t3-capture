import "../lib/browser-shim.js";
import { pendingTrelloCaptures } from "../lib/db.js";
import { openComposer } from "../lib/platform.js";
import { getServers, getTicketConnection } from "../lib/store.js";

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

const [servers, trello, notion] = await Promise.all([getServers(), getTicketConnection("trello"), getTicketConnection("notion")]);
if (!servers.length && !trello && !notion) document.getElementById("no-server").classList.remove("hidden");

const pending = await pendingTrelloCaptures().catch(() => []);
for (const { id, detail } of pending) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = detail;
  button.addEventListener("click", async () => {
    await openComposer(id);
    window.close();
  });
  document.getElementById("pending-trello-list").append(button);
}
document.getElementById("pending-trello").classList.toggle("hidden", !pending.length);

const commands = await browser.commands.getAll();
for (const kbd of document.querySelectorAll("kbd[data-command]")) {
  const shortcut = commands.find((c) => c.name === kbd.dataset.command)?.shortcut;
  if (shortcut) kbd.textContent = shortcut.replace(/\+/g, " ");
}
