// Cliente de T3 Code: OAuth (PKCE + registro dinámico) y MCP sobre HTTP.
// T3 expone un servidor MCP estándar en `<origin>/mcp`. Es la misma API que
// usan los agentes, así que la extensión no depende de detalles internos.

export const DEFAULT_ORIGIN = "http://127.0.0.1:3773";
const CLIENT_NAME = "T3 Capture (Zen)";
const MCP_PROTOCOL_VERSION = "2025-06-18";

export class T3AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "T3AuthError";
  }
}

export class T3ToolError extends Error {
  constructor(tool, message) {
    super(message);
    this.name = "T3ToolError";
    this.tool = tool;
  }
}

// ---------- utilidades ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomB64url = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function pkcePair() {
  const verifier = randomB64url(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

export function normalizeOrigin(value) {
  const raw = String(value || "").trim() || DEFAULT_ORIGIN;
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  return url.origin;
}

/**
 * Acepta un código de emparejamiento suelto ("4PL6ANUJRH23"), un link de
 * emparejamiento ("http://host:3773/pair#token=...") o un app link
 * ("t3code://pair?pairingUrl=...").
 */
export function parsePairingInput(input) {
  const text = String(input || "").trim();
  if (!text) return {};
  try {
    let url = new URL(text);
    if (url.protocol === "t3code:") {
      const inner = url.searchParams.get("pairingUrl");
      if (inner) url = new URL(inner);
    }
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const code = hash.get("token") || url.searchParams.get("token") || undefined;
    return { origin: url.protocol.startsWith("http") ? url.origin : undefined, code };
  } catch {
    return { code: text };
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function describeOAuthError(body, fallback) {
  return body?.error_description || body?.message || body?.error || body?._raw || fallback;
}

// ---------- OAuth ----------

async function register(origin, redirectUri) {
  const res = await fetch(`${origin}/oauth/mcp/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri] }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new T3AuthError(describeOAuthError(body, `Registro rechazado (${res.status})`));
  return body.client_id;
}

async function exchangeCode({ origin, clientId, redirectUri, code, verifier }) {
  const res = await fetch(`${origin}/oauth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new T3AuthError(describeOAuthError(body, `No se pudo obtener el token (${res.status})`));
  return {
    token: body.access_token,
    scope: body.scope,
    expiresAt: Date.now() + Number(body.expires_in || 0) * 1000,
    clientId,
  };
}

function readRedirect(redirectTo, state) {
  const url = new URL(redirectTo);
  const error = url.searchParams.get("error");
  if (error) throw new T3AuthError(url.searchParams.get("error_description") || error);
  if (url.searchParams.get("state") !== state) throw new T3AuthError("La respuesta de T3 no coincide con la solicitud (state).");
  const code = url.searchParams.get("code");
  if (!code) throw new T3AuthError("T3 no devolvió un código de autorización.");
  return code;
}

/**
 * Empareja con un código de `t3 pair`. No abre ninguna ventana: registra el
 * cliente, aprueba con el código y canjea el token (como hace T3 al vincular
 * otro entorno).
 */
export async function pairWithCode({ origin, code, redirectUri, access = "full-access" }) {
  origin = normalizeOrigin(origin);
  const clientId = await register(origin, redirectUri);
  const { verifier, challenge } = await pkcePair();
  const state = randomB64url(16);
  const authorization = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: `${origin}/mcp`,
  };
  const res = await fetch(`${origin}/oauth/mcp/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorization, decision: { _tag: "pairing-code", access, code: code.trim() } }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.redirectTo) throw new T3AuthError(describeOAuthError(body, `T3 rechazó el código (${res.status})`));
  const authCode = readRedirect(body.redirectTo, state);
  return exchangeCode({ origin, clientId, redirectUri, code: authCode, verifier });
}

/**
 * Flujo OAuth estándar en una ventana: T3 muestra su pantalla de aprobación.
 * `launchWebAuthFlow` es `browser.identity.launchWebAuthFlow`.
 */
export async function signInWithBrowser({ origin, redirectUri, launchWebAuthFlow }) {
  origin = normalizeOrigin(origin);
  const clientId = await register(origin, redirectUri);
  const { verifier, challenge } = await pkcePair();
  const state = randomB64url(16);
  const url = new URL(`${origin}/oauth/mcp/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: `${origin}/mcp`,
  }).toString();
  const redirectTo = await launchWebAuthFlow({ url: url.toString(), interactive: true });
  const code = readRedirect(redirectTo, state);
  return exchangeCode({ origin, clientId, redirectUri, code, verifier });
}

// ---------- MCP ----------

function parseMcpBody(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    // Streamable HTTP: nos quedamos con el último mensaje JSON-RPC con id.
    const messages = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        try {
          return JSON.parse(line.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter((m) => m && ("result" in m || "error" in m));
    return messages.pop() ?? null;
  }
  return text ? JSON.parse(text) : null;
}

export class McpClient {
  constructor({ origin, token }) {
    this.origin = normalizeOrigin(origin);
    this.token = token;
    this.sessionId = null;
    this.nextId = 1;
    this.initializing = null;
    this.toolNames = null;
  }

  async post(payload) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    let res;
    try {
      res = await fetch(`${this.origin}/mcp`, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (cause) {
      throw new Error(`No se pudo conectar con T3 en ${this.origin}. ¿Está abierto T3 Code?`, { cause });
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 401 || res.status === 403) {
      throw new T3AuthError("T3 rechazó la sesión de la extensión. Volvé a conectarla en Ajustes.");
    }
    const text = await res.text();
    if (!("id" in payload)) return null;
    if (this.sessionId && (res.status === 404 || (res.status === 400 && /session/i.test(text)))) {
      const err = new Error("Sesión MCP expirada");
      err.sessionExpired = true;
      throw err;
    }
    if (!res.ok && !text) throw new Error(`T3 respondió ${res.status}`);
    const message = parseMcpBody(text, res.headers.get("content-type") || "");
    if (!message) throw new Error(`Respuesta vacía de T3 (${res.status})`);
    if (message.error) throw new Error(message.error.message || JSON.stringify(message.error));
    return message.result;
  }

  async request(method, params) {
    await this.ensureInitialized();
    try {
      return await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params });
    } catch (error) {
      if (!error.sessionExpired) throw error;
      this.sessionId = null;
      this.initializing = null;
      await this.ensureInitialized();
      return this.post({ jsonrpc: "2.0", id: this.nextId++, method, params });
    }
  }

  ensureInitialized() {
    if (!this.initializing) {
      this.initializing = (async () => {
        await this.post({
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "t3-capture-zen", version: "0.1.0" },
          },
        });
        await this.post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      })().catch((error) => {
        this.initializing = null;
        throw error;
      });
    }
    return this.initializing;
  }

  async listToolNames() {
    if (!this.toolNames) {
      const result = await this.request("tools/list", {});
      this.toolNames = new Set((result?.tools ?? []).map((t) => t.name));
    }
    return this.toolNames;
  }

  async call(name, args = {}) {
    const result = await this.request("tools/call", { name, arguments: args });
    const text = (result?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (result?.isError) throw new T3ToolError(name, text || `${name} falló`);
    if (result?.structuredContent !== undefined) return result.structuredContent;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---- operaciones de alto nivel ----

  environment(environmentId) {
    return this.call("t3_environment_read", environmentId ? { environmentId } : {});
  }

  /** Entornos vinculados (otras máquinas). Solo existe con "Linked environments" activado en T3. */
  async environmentLinks() {
    const tools = await this.listToolNames();
    if (!tools.has("t3_environment_links")) return [];
    try {
      const result = await this.call("t3_environment_links", {});
      return result?.links ?? [];
    } catch {
      return [];
    }
  }

  async projects(environmentId, max = 300) {
    const projects = [];
    let cursor = 0;
    while (cursor !== undefined && cursor !== null && projects.length < max) {
      const args = { limit: 100, cursor };
      if (environmentId) args.environmentId = environmentId;
      const page = await this.call("t3_project_list", args);
      projects.push(...(page?.projects ?? []));
      cursor = page?.nextCursor;
    }
    return projects.filter((p) => !p.deletedAt);
  }

  capabilities(environmentId, search) {
    const args = {};
    if (environmentId) args.environmentId = environmentId;
    if (search) args.search = search;
    return this.call("orchestrator_capabilities", args);
  }

  /** Sube un Blob y devuelve el descriptor de adjunto que espera `t3_thread_launch`. */
  async uploadAttachment(blob, name) {
    const mimeType = blob.type || "application/octet-stream";
    const type = mimeType.startsWith("image/") ? "image" : "file";
    const prepared = await this.call("t3_attachment_prepare_upload", {
      upload: { type, name, mimeType, sizeBytes: blob.size },
    });
    const res = await fetch(`${this.origin}${prepared.relativeUrl}`, {
      method: "POST",
      headers: { "content-type": mimeType, authorization: `Bearer ${this.token}` },
      body: blob,
    });
    if (!res.ok) throw new Error(`No se pudo subir ${name} (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return { type, id: prepared.attachmentId, name, mimeType, sizeBytes: blob.size };
  }

  launchThread(input) {
    return this.call("t3_thread_launch", input);
  }
}
