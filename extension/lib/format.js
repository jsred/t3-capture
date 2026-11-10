// Arma el mensaje para el agente a partir de la captura.

const MODE_LABEL = { element: "Elemento seleccionado", area: "Área seleccionada", visible: "Captura visible" };
const MAX_MESSAGE = 110_000; // T3 acepta hasta 120 000 caracteres

const clip = (s, n) => {
  s = String(s ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const cell = (s, n = 80) => clip(s, n).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ⏎ ");

const fence = (text, lang = "") => {
  const body = String(text ?? "");
  const ticks = body.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${body}\n${ticks}`;
};

function relTime(t, ref) {
  const s = (t - ref) / 1000;
  return s >= 0 ? `+${s.toFixed(1)}s` : `${s.toFixed(1)}s`;
}

export function autoTitle(capture, userText) {
  const firstLine = String(userText || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (firstLine) return clip(firstLine, 80);
  const where = capture?.page?.title || capture?.page?.url || "página";
  return clip(`${MODE_LABEL[capture?.mode] || "Captura"}: ${where}`, 80);
}

export function summarize(capture) {
  const consoleErrors = (capture.console ?? []).filter((c) => c.level === "error").length;
  const failedRequests = (capture.network ?? []).filter((n) => !n.ok).length;
  return {
    interactions: capture.interactions?.length ?? 0,
    console: capture.console?.length ?? 0,
    consoleErrors,
    network: capture.network?.length ?? 0,
    failedRequests,
  };
}

function elementSection(el) {
  const lines = [`### ${el.note ? "Elemento en el área" : "Elemento seleccionado"}`];
  if (el.note) lines.push(`_${el.note}._`);
  lines.push(`- **Selector:** \`${el.selector}\``);
  lines.push(`- **XPath:** \`${el.xpath}\``);
  lines.push(`- **Etiqueta:** \`<${el.tag}>\`${el.role ? ` · rol \`${el.role}\`` : ""}${el.accessibleName ? ` · nombre accesible "${clip(el.accessibleName, 120)}"` : ""}`);
  const r = el.rect;
  if (r) lines.push(`- **Caja:** ${r.width}×${r.height}px en (${r.x}, ${r.y}) del viewport · (${r.pageX}, ${r.pageY}) de la página`);
  if (el.framework?.react) {
    const { components, source } = el.framework.react;
    lines.push(`- **Componentes React (de adentro hacia afuera):** ${components.map((c) => `\`<${c}>\``).join(" ← ")}${source ? ` · fuente \`${source}\`` : ""}`);
  }
  if (el.framework?.vue) {
    const { components, file } = el.framework.vue;
    lines.push(`- **Componentes Vue:** ${components.map((c) => `\`<${c}>\``).join(" ← ")}${file ? ` · archivo \`${file}\`` : ""}`);
  }
  if (el.state && Object.keys(el.state).length) lines.push(`- **Estado:** ${Object.entries(el.state).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
  if (el.ancestors?.length) lines.push(`- **Ancestros:** ${el.ancestors.map((a) => `\`${a}\``).join(" › ")}`);
  if (el.text) lines.push("", "**Texto visible:**", fence(clip(el.text, 1500)));
  if (el.styles && Object.keys(el.styles).length) {
    lines.push("", "**Estilos computados (relevantes):**", fence(Object.entries(el.styles).map(([k, v]) => `${k}: ${v};`).join("\n"), "css"));
  }
  if (el.outerHTML) lines.push("", "**HTML:**", fence(el.outerHTML, "html"));
  return lines.join("\n");
}

function interactionDetail(e) {
  const parts = [];
  if (e.text) parts.push(`"${e.text}"`);
  if (e.value !== undefined) parts.push(`valor: ${JSON.stringify(e.value)}`);
  if (e.key) parts.push(e.key);
  if (e.detail) parts.push(e.detail);
  if (e.x !== undefined && e.type !== "scroll") parts.push(`@${e.x},${e.y}`);
  if (e.type === "scroll") parts.push(`y=${e.y}`);
  return parts.join(" · ");
}

function interactionsSection(list, ref, max) {
  const items = list.slice(-max);
  const omitted = list.length - items.length;
  const rows = items.map((e) => `| ${relTime(e.t, ref)} | ${e.type} | ${e.target ? `\`${cell(e.target, 70)}\`` : ""} | ${cell(interactionDetail(e), 100)} |`);
  return [
    `### Interacciones recientes (${items.length}${omitted ? ` de ${list.length}` : ""}, la más reciente al final)`,
    "| t | evento | objetivo | detalle |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function consoleSection(list, ref, max) {
  // Prioriza errores y advertencias si hay que recortar.
  let items = list.slice(-max);
  if (list.length > max) {
    const important = list.filter((c) => c.level === "error" || c.level === "warn");
    const rest = list.filter((c) => !(c.level === "error" || c.level === "warn"));
    items = [...important.slice(-max), ...rest.slice(-Math.max(0, max - important.length))]
      .sort((a, b) => a.t - b.t)
      .slice(-max);
  }
  const body = items
    .map((c) => `[${relTime(c.t, ref)}] ${c.level.toUpperCase()}${c.uncaught ? " (no capturado)" : ""}: ${clip(c.message, 1200)}${c.source ? `\n    en ${c.source}` : ""}`)
    .join("\n");
  return [`### Consola (${items.length}${list.length > items.length ? ` de ${list.length}` : ""})`, fence(body, "text")].join("\n");
}

function networkSection(list, ref, max) {
  let items = list.slice(-max);
  if (list.length > max) {
    const failed = list.filter((n) => !n.ok);
    const ok = list.filter((n) => n.ok);
    items = [...failed.slice(-max), ...ok.slice(-Math.max(0, max - failed.length))].sort((a, b) => a.t - b.t).slice(-max);
  }
  const rows = items.map(
    (n) => `| ${relTime(n.t, ref)} | ${n.method} | ${n.ok ? n.status : `**${n.status || "ERR"}**`} | ${n.ms ?? ""}ms | \`${cell(n.url, 140)}\`${n.error ? ` ${cell(n.error, 80)}` : ""} |`,
  );
  return [
    `### Red (${items.length}${list.length > items.length ? ` de ${list.length}` : ""} requests fetch/XHR)`,
    "| t | método | estado | duración | URL |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/**
 * @param capture  captura guardada por el background
 * @param options  { userText, includeDom, includeInteractions, includeConsole, includeNetwork,
 *                   screenshotNames, maxEvents, maxConsole, maxNetwork }
 */
export function buildPrompt(capture, options) {
  const {
    userText = "",
    includeDom = true,
    includeInteractions = true,
    includeConsole = true,
    includeNetwork = true,
    screenshotNames = [],
    maxEvents = 60,
    maxConsole = 40,
    maxNetwork = 40,
  } = options ?? {};
  const ref = capture.capturedAt ?? Date.now();
  const page = capture.page ?? {};
  const out = [];

  out.push(userText.trim() || "_(Sin instrucciones adicionales: revisá el contexto capturado y proponé qué hacer.)_");
  out.push("", "---", "", "## Contexto capturado desde el navegador");
  out.push(`- **Captura:** ${MODE_LABEL[capture.mode] || capture.mode} · ${new Date(ref).toISOString()}`);
  out.push(`- **URL:** ${page.url}`);
  if (page.title) out.push(`- **Título:** ${page.title}`);
  if (page.viewport) out.push(`- **Viewport:** ${page.viewport.width}×${page.viewport.height} @${page.viewport.dpr}x · scroll y=${page.scroll?.y ?? 0} de ${page.scroll?.height ?? "?"}px · tema ${page.colorScheme ?? "?"}`);
  if (page.userAgent) out.push(`- **Navegador:** ${page.userAgent}`);
  if (screenshotNames.length) out.push(`- **Capturas adjuntas:** ${screenshotNames.join(", ")}`);
  out.push("- Los tiempos son relativos al momento de la captura (t=0).");
  if (page.selectedText) out.push("", "**Texto seleccionado en la página:**", fence(page.selectedText));

  if (includeDom && capture.element) out.push("", elementSection(capture.element));
  if (includeInteractions && capture.interactions?.length) out.push("", interactionsSection(capture.interactions, ref, maxEvents));
  if (includeConsole && capture.console?.length) out.push("", consoleSection(capture.console, ref, maxConsole));
  if (includeNetwork && capture.network?.length) out.push("", networkSection(capture.network, ref, maxNetwork));

  let message = out.join("\n");
  if (message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE)}\n\n_(contexto truncado por tamaño)_`;
  return message;
}
