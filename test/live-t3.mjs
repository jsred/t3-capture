// Prueba contra un T3 real. Uso: node test/live-t3.mjs <código-de-t3-pair> [origin]
import { McpClient, pairWithCode, parsePairingInput } from "../extension/lib/t3client.js";
import assert from "node:assert/strict";

const [code, origin = "http://127.0.0.1:3773"] = process.argv.slice(2);
assert.deepEqual(parsePairingInput("http://192.168.0.5:3773/pair#token=ABC123"), { origin: "http://192.168.0.5:3773", code: "ABC123" });
assert.deepEqual(parsePairingInput("t3code://pair?pairingUrl=http%3A%2F%2F10.0.0.2%3A3773%2Fpair%23token%3DXYZ"), { origin: "http://10.0.0.2:3773", code: "XYZ" });
assert.deepEqual(parsePairingInput("  4PL6ANUJRH23 "), { code: "4PL6ANUJRH23" });
console.log("✓ parsePairingInput");

const auth = await pairWithCode({ origin, code, redirectUri: "https://t3-capture-test.extensions.allizom.org/" });
assert.ok(auth.token && auth.expiresAt > Date.now());
console.log("✓ pairWithCode — token vence", new Date(auth.expiresAt).toISOString());

const client = new McpClient({ origin, token: auth.token });
const env = await client.environment();
console.log("✓ environment:", env.label, env.environmentId);
console.log("✓ links:", (await client.environmentLinks()).length);
const projects = await client.projects();
console.log("✓ projects:", projects.length, projects.slice(0, 3).map((p) => p.title).join(", "));
const caps = await client.capabilities();
const enabled = caps.providers.filter((p) => p.models.length && !p.constraints.length);
console.log("✓ providers:", enabled.map((p) => `${p.providerInstanceId}[${p.models.map((m) => m.id).join(",")}]`).join(" "));
const png = new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")], { type: "image/png" });
const att = await client.uploadAttachment(png, "captura.png");
assert.equal(att.type, "image");
console.log("✓ uploadAttachment:", att.id);
await client.call("t3_attachment_discard", { attachmentId: att.id });
console.log("✓ attachment discarded");
// sesión MCP expirada → reintento transparente
client.sessionId = "00000000-0000-0000-0000-000000000000";
await client.environment();
console.log("✓ re-init tras sesión inválida");
