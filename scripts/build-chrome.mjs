// Genera la versión para Chrome (y otros navegadores Chromium) a partir de
// extension/, que es la fuente común y tiene el manifest de Firefox:
//   dist/chrome/                        carpeta para "Cargar descomprimida"
//   dist/t3-capture-chrome-<versión>.zip
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "extension");
const out = path.join(root, "dist", "chrome");

export function chromeManifest(firefox) {
  const m = structuredClone(firefox);
  delete m.browser_specific_settings;
  m.minimum_chrome_version = "120";

  // Service worker en vez de página de eventos.
  m.background = { service_worker: firefox.background.scripts[0], type: "module" };

  // menus → contextMenus; sin webRequest bloqueante (no existe en MV3 de
  // Chrome): el Origin hacia /mcp se quita con declarativeNetRequest.
  const drop = new Set(["menus", "webRequest", "webRequestBlocking"]);
  m.permissions = [
    ...firefox.permissions.filter((p) => !drop.has(p)),
    "contextMenus",
    "declarativeNetRequestWithHostAccess",
  ];

  // Chrome no acepta SVG en íconos.
  const pngs = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
  m.icons = pngs;
  m.action = { ...firefox.action, default_icon: pngs };

  // `author` en Chrome tiene que ser un objeto { email } o no estar.
  delete m.author;
  return m;
}

function validate(m) {
  const problems = [];
  if (m.manifest_version !== 3) problems.push("manifest_version debe ser 3");
  if (!m.background?.service_worker) problems.push("falta background.service_worker");
  if (m.background?.scripts) problems.push("background.scripts no va en Chrome");
  for (const p of m.permissions) if (["menus", "webRequestBlocking"].includes(p)) problems.push(`permiso no válido en Chrome: ${p}`);
  const suggested = Object.values(m.commands || {}).filter((c) => c.suggested_key).length;
  if (suggested > 4) problems.push(`Chrome admite hasta 4 atajos sugeridos (hay ${suggested})`);
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    m.options_ui?.page,
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of files) if (!fs.existsSync(path.join(out, f))) problems.push(`no existe ${f}`);
  if (problems.length) throw new Error(`Manifest de Chrome inválido:\n- ${problems.join("\n- ")}`);
}

const firefox = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const manifest = chromeManifest(firefox);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (f) => !path.basename(f).startsWith(".") });
fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
validate(manifest);

const zip = path.join(root, "dist", `t3-capture-chrome-${manifest.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out });
console.log(`dist/chrome/ y ${path.relative(root, zip)}`);
