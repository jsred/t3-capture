// T3 simulado para los tests end-to-end: MCP mínimo (Streamable HTTP con
// respuestas JSON), subida de adjuntos y una página de prueba con un botón
// "React". Igual que el T3 real, responde 403 a /mcp si llega un header Origin.
import http from "node:http";

export const PAGE = `<!doctype html><html><head><title>Tienda demo</title></head><body style="font:16px sans-serif;padding:40px">
<form id="checkout">
  <label for="email">Email</label> <input id="email" name="email" type="email">
  <label for="pw">Clave</label> <input id="pw" name="password" type="password">
  <button type="button" data-testid="buy-button" style="padding:12px 20px">Comprar ahora</button>
</form>
<script>
  const btn = document.querySelector('[data-testid=buy-button]');
  btn.__reactFiber$x1 = { type: { name: 'BuyButton' }, _debugSource: { fileName: 'src/Buy.tsx', lineNumber: 12 },
                          return: { type: { name: 'CheckoutForm' }, return: null } };
  btn.addEventListener('click', async () => {
    console.error('Pago falló', new Error('boom'));
    await fetch('/api/pay', { method: 'POST' }).catch(() => {});
    history.pushState({}, '', '/checkout/error');
  });
</script></body></html>`;

export const TOKEN = "test-token";

export async function startMockT3() {
  const mock = { originRejected: 0, mcpCalls: [], uploads: [], launch: null };
  let base;
  const tool = (result) => ({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
  const TOOLS = {
    t3_environment_read: () => ({ environmentId: "env-mock", label: "Mac simulada" }),
    t3_project_list: () => ({ projects: [{ id: "p1", title: "Tienda", workspaceRoot: "/tmp/tienda", updatedAt: "2026-11-10T00:00:00Z" }], nextCursor: null }),
    orchestrator_capabilities: () => ({
      providers: [
        {
          providerInstanceId: "claudeAgent",
          displayName: "Claude",
          models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5", options: [{ id: "effort", values: ["low", "medium", "high", "xhigh"], default: "high" }] }],
          runtimeModes: ["approval-required", "auto-accept-edits", "full-access"],
        },
      ],
    }),
    t3_attachment_prepare_upload: () => {
      const id = `pending-${mock.uploads.length + 1}-${Date.now()}`;
      return { attachmentId: id, relativeUrl: `/api/attachments/upload/${id}` };
    },
    t3_thread_launch: (args) => {
      mock.launch = args;
      return { threadId: "t1", link: `${base}/thread/t1`, status: "preparing" };
    },
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    if (url.pathname === "/mcp" && req.method === "POST") {
      if (req.headers.origin) {
        mock.originRejected++;
        res.writeHead(403);
        return res.end("Forbidden origin");
      }
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401);
        return res.end();
      }
      const msg = JSON.parse(body.toString());
      if (!("id" in msg)) {
        res.writeHead(202);
        return res.end();
      }
      let result;
      if (msg.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-t3", version: "0" } };
      else if (msg.method === "tools/list") result = { tools: Object.keys(TOOLS).map((name) => ({ name, inputSchema: { type: "object" } })) };
      else if (msg.method === "tools/call") {
        mock.mcpCalls.push(msg.params.name);
        result = tool(TOOLS[msg.params.name](msg.params.arguments));
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    }
    if (url.pathname.startsWith("/api/attachments/upload/")) {
      mock.uploads.push({ type: req.headers["content-type"], auth: req.headers.authorization, bytes: body });
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(500);
      return res.end("err");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, mock, TOKEN, close: () => server.close() };
}

