// Sube una versión nueva a la Chrome Web Store y la manda a revisión, con la
// API v2 (https://developer.chrome.com/docs/webstore/api/reference/rest).
// La primera publicación se hace a mano desde el panel de desarrollador: la
// API no crea ítems ni completa la ficha o las prácticas de privacidad.
//
//   CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… CWS_REFRESH_TOKEN=… \
//   CWS_PUBLISHER_ID=… CWS_ITEM_ID=… npm run publish:chrome
//
// Con --upload-only sube el paquete pero no lo manda a revisión.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = (name) => process.env[name] || (console.error(`Falta la variable ${name}`), process.exit(1));
const clientId = env("CWS_CLIENT_ID");
const clientSecret = env("CWS_CLIENT_SECRET");
const refreshToken = env("CWS_REFRESH_TOKEN");
const item = `publishers/${env("CWS_PUBLISHER_ID")}/items/${env("CWS_ITEM_ID")}`;
const API = "https://chromewebstore.googleapis.com";

execFileSync("node", [path.join(root, "scripts/build-chrome.mjs")], { stdio: "inherit" });
const { version } = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const zip = fs.readFileSync(path.join(root, `dist/t3-capture-chrome-${version}.zip`));

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
});
const { access_token: accessToken, error_description: tokenError } = await tokenRes.json();
if (!accessToken) throw new Error(`No se pudo obtener el token de Google: ${tokenError || tokenRes.status}`);
const auth = { authorization: `Bearer ${accessToken}` };

async function call(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { ...auth, ...headers }, body });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json.error?.message || text}`);
  return json;
}

let upload = await call("POST", `${API}/upload/v2/${item}:upload`, zip, { "content-type": "application/zip" });
for (let i = 0; upload.uploadState === "IN_PROGRESS" && i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const status = await call("GET", `${API}/v2/${item}:fetchStatus`);
  upload = { ...upload, uploadState: status.lastAsyncUploadState ?? upload.uploadState };
}
if (upload.uploadState !== "SUCCEEDED") throw new Error(`La subida no terminó bien: ${JSON.stringify(upload)}`);
console.log(`✓ ${version} subida a la Chrome Web Store`);

if (process.argv.includes("--upload-only")) process.exit(0);
const published = await call("POST", `${API}/v2/${item}:publish`, "{}", { "content-type": "application/json" });
console.log(`✓ enviada a revisión: ${published.state ?? JSON.stringify(published)}`);
