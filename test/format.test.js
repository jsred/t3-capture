import { test } from "node:test";
import assert from "node:assert/strict";
import { autoTitle, buildPrompt, summarize } from "../extension/lib/format.js";

const now = 1_800_000_000_000;
const capture = {
  mode: "visible",
  capturedAt: now,
  page: { url: "https://app.test/x", title: "App", viewport: { width: 800, height: 600, dpr: 2 } },
  interactions: Array.from({ length: 100 }, (_, i) => ({ t: now - (100 - i) * 100, type: "click", target: `#b${i}`, text: `B|${i}` })),
  console: [
    ...Array.from({ length: 60 }, (_, i) => ({ t: now - 9000 + i, level: "log", message: `log ${i}` })),
    { t: now - 5000, level: "error", message: "kaboom" },
  ],
  network: [
    { t: now - 3000, method: "GET", url: "https://app.test/ok", status: 200, ok: true, ms: 10 },
    { t: now - 2000, method: "POST", url: "https://app.test/fail", status: 503, ok: false, ms: 30 },
  ],
};

test("respeta los límites y prioriza errores", () => {
  const p = buildPrompt(capture, { userText: "Arreglá esto", maxEvents: 10, maxConsole: 5, maxNetwork: 1 });
  assert.match(p, /Interacciones recientes \(10 de 100/);
  assert.match(p, /#b99/);
  assert.doesNotMatch(p, /#b10`/);
  assert.match(p, /B\\\|99/, "escapa | en tablas");
  assert.match(p, /ERROR: kaboom/, "conserva errores al recortar la consola");
  assert.match(p, /\*\*503\*\*/, "conserva requests fallidos al recortar");
  assert.doesNotMatch(p, /app\.test\/ok/);
});

test("las secciones se pueden desactivar", () => {
  const p = buildPrompt(capture, { includeInteractions: false, includeConsole: false, includeNetwork: false });
  assert.doesNotMatch(p, /Interacciones|Consola|### Red/);
  assert.match(p, /Sin instrucciones adicionales/);
});

test("título automático y resumen", () => {
  assert.equal(autoTitle(capture, "\n  primera línea\nsegunda"), "primera línea");
  assert.equal(autoTitle(capture, ""), "Captura visible: App");
  assert.deepEqual(summarize(capture), { interactions: 100, console: 61, consoleErrors: 1, network: 2, failedRequests: 1 });
});

test("no rompe bloques de código con ``` en el HTML", () => {
  const p = buildPrompt({ ...capture, mode: "element", element: { tag: "pre", selector: "pre", xpath: "/pre", outerHTML: "<pre>```js\nx\n```</pre>" } }, {});
  assert.match(p, /````html\n<pre>```js/);
});
