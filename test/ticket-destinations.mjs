import assert from "node:assert/strict";

export async function testTicketDestinations({ context, extUrl, startCapture, page }) {
  const trelloCards = [];
  const trelloFiles = [];
  const notionPages = [];
  const notionUploads = [];
  const trelloUrl = "https://trello.com/c/test";
  const notionUrl = "https://www.notion.so/test";
  const notionPageId = "e658e580-c1c3-471c-a412-2727f680dd13";
  let notionReads = 0;
  let trelloAttachmentReads = 0;

  await context.route("https://api.trello.com/1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.headers().authorization, 'OAuth oauth_consumer_key="test-key", oauth_token="test-trello-token"');
    assert.equal(url.searchParams.has("token"), false);
    if (url.pathname === "/1/members/me") return route.fulfill({ json: { id: "member" } });
    if (url.pathname === "/1/members/me/boards") return route.fulfill({ json: [{ id: "board", name: "Producto" }] });
    if (url.pathname === "/1/boards/board/lists") return route.fulfill({ json: [{ id: "list", name: "Por hacer" }] });
    if (url.pathname === "/1/cards") {
      trelloCards.push(request.postDataJSON());
      return route.fulfill({ json: { id: "card", shortUrl: trelloUrl } });
    }
    assert.equal(url.pathname, "/1/cards/card/attachments");
    if (request.method() === "GET") {
      trelloAttachmentReads++;
      return route.fulfill({ json: trelloFiles.map((name) => ({ name })) });
    }
    assert.match(request.headers()["content-type"], /^multipart\/form-data; boundary=/);
    const name = request.postDataBuffer()?.toString().match(/filename="([^"]+)"/)?.[1];
    trelloFiles.push(name);
    if (trelloFiles.length === 1) return route.fulfill({ status: 503 }); // La subida se guardó, pero se perdió la confirmación.
    assert.ok(request.postDataBuffer()?.includes(Buffer.from("Última línea del contexto")));
    return route.fulfill({ json: { name } });
  });

  await context.route("https://api.notion.com/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(request.headers().authorization, "Bearer test-notion-token");
    assert.equal(request.headers()["notion-version"], "2026-03-11");
    if (url.pathname === "/v1/users/me") return route.fulfill({ json: {
      id: "notion-bot", bot: { workspace_limits: { max_file_upload_size_in_bytes: 5_242_880 } },
    } });
    if (url.pathname === "/v1/search") {
      const body = request.postDataJSON();
      assert.deepEqual(body.filter, { property: "object", value: "data_source" });
      if (!body.start_cursor) return route.fulfill({ json: { results: [], next_cursor: "next" } });
      assert.equal(body.start_cursor, "next");
      return route.fulfill({ json: { results: [{ id: "source", title: [{ plain_text: "Incidencias" }], properties: { Incidencia: { id: "title", type: "title" } } }], next_cursor: null } });
    }
    if (url.pathname === "/v1/file_uploads") {
      notionUploads.push(request.postDataJSON());
      return route.fulfill({ json: { id: "upload" } });
    }
    if (url.pathname === "/v1/file_uploads/upload/send") {
      assert.match(request.headers()["content-type"], /^multipart\/form-data; boundary=/);
      assert.match(request.postDataBuffer()?.toString() ?? "", /filename="captura-1-.+\.png"/);
      return route.fulfill({ json: { id: "upload", status: "uploaded" } });
    }
    if (url.pathname === `/v1/pages/${notionPageId}`) {
      assert.equal(request.method(), "GET");
      notionReads++;
      return route.fulfill({ json: { id: notionPageId, url: notionUrl } });
    }
    assert.equal(url.pathname, "/v1/pages");
    notionPages.push(request.postDataJSON());
    const additional_data = notionPages.length === 1 ? { committed_resource_id: notionPageId } : {};
    return route.fulfill({ status: 503, json: { code: "service_unavailable", additional_data } });
  });

  const openComposer = async () => {
    await page.bringToFront();
    const opened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html") });
    await startCapture("visible");
    return opened;
  };

  const trello = await openComposer();
  await trello.selectOption("#destination", "trello");
  await trello.waitForFunction(() => document.getElementById("ticket-status").textContent.includes("Conectá Trello"));
  assert.ok(await trello.locator("#submit").isDisabled());
  assert.ok(await trello.locator("#model-section").isHidden());

  const settings = await context.newPage();
  await settings.goto(extUrl("options/options.html"));
  await settings.fill('#trello-form [name="apiKey"]', "test-key");
  await settings.fill('#trello-form [name="token"]', "test-trello-token");
  await settings.click('#trello-form [type="submit"]');
  await settings.waitForSelector("#trello-form [data-disconnect]:not(.hidden)");
  assert.equal(await settings.inputValue('#trello-form [name="token"]'), "");
  await settings.fill('#notion-form [name="token"]', "test-notion-token");
  await settings.click('#notion-form [type="submit"]');
  await settings.waitForSelector("#notion-form [data-disconnect]:not(.hidden)");

  await trello.selectOption("#trello-board", "board");
  assert.ok(await trello.locator("#submit").isDisabled());
  await trello.selectOption("#trello-list", "list");
  await trello.fill("#title", "Checkout roto");
  await trello.fill("#user-text", `Detalle del checkout\n${"a".repeat(16_400)}\nÚltima línea del contexto`);
  await trello.click("#preview-details summary");
  await trello.waitForSelector("#preview-note:not(.hidden)");
  assert.match(await trello.textContent("#preview-note"), /contexto-completo\.md/);
  await trello.click("#submit");
  await trello.waitForSelector("#done-retry:not(.hidden)");
  assert.match(await trello.textContent("#done-warning"), /La tarjeta se creó/);
  assert.equal(await trello.getAttribute("#done-link", "href"), trelloUrl);
  await trello.close();
  const popup = await context.newPage();
  await popup.goto(extUrl("popup/popup.html"));
  await popup.click("#pending-trello summary");
  const reopened = context.waitForEvent("page", { predicate: (p) => p.url().includes("composer.html") });
  await popup.getByRole("button", { name: /Checkout roto/ }).click();
  const resumed = await reopened;
  await resumed.waitForSelector("#done-retry:not(.hidden)");
  assert.equal(await resumed.getAttribute("#done-link", "href"), trelloUrl);
  await settings.click("#trello-form [data-disconnect]");
  await settings.waitForFunction(() => document.querySelector('#trello-form [role="status"]').textContent === "Sin conectar");
  await resumed.click("#done-retry");
  await resumed.waitForFunction(() => document.getElementById("done-warning").textContent.includes("Conectá Trello"));
  assert.equal(trelloAttachmentReads, 0, "el reintento respeta la desconexión");
  await settings.fill('#trello-form [name="apiKey"]', "test-key");
  await settings.fill('#trello-form [name="token"]', "test-trello-token");
  await settings.click('#trello-form [type="submit"]');
  await settings.waitForSelector("#trello-form [data-disconnect]:not(.hidden)");
  await resumed.click("#done-retry");
  await resumed.waitForFunction(() => document.getElementById("done-retry").classList.contains("hidden"));
  assert.equal(trelloCards.length, 1);
  assert.equal(trelloAttachmentReads, 1);
  assert.equal(trelloCards[0].idList, "list");
  assert.equal(trelloCards[0].name, "Checkout roto");
  assert.ok(trelloCards[0].desc.length <= 16_384);
  assert.equal(trelloFiles.length, 2);
  assert.match(trelloFiles[0], /^captura-1-.+\.png$/);
  assert.equal(trelloFiles[1], "contexto-completo.md");
  assert.equal(await resumed.evaluate(async () => {
    const { getCapture } = await import(chrome.runtime.getURL("lib/db.js"));
    return await getCapture(new URLSearchParams(location.search).get("id"));
  }), undefined);
  await resumed.close();

  const notion = await openComposer();
  await notion.selectOption("#destination", "notion");
  assert.ok(await notion.locator("#submit").isDisabled());
  await notion.selectOption("#notion-source", "source");
  await notion.fill("#user-text", "X".repeat(200_001));
  await notion.click("#submit");
  await notion.waitForFunction(() => document.getElementById("status").textContent.includes("La descripción supera el límite"));
  assert.equal(notionUploads.length, 0, "valida el texto antes de subir archivos");
  await notion.fill("#user-text", "El checkout falla");
  await notion.locator("#inc-console").evaluate((box) => { box.checked = false; });
  await notion.click("#submit");
  await notion.waitForSelector("#done:not(.hidden)");
  assert.equal(await notion.getAttribute("#done-link", "href"), notionUrl);
  assert.equal(notionPages.length, 1);
  assert.equal(notionReads, 1, "recupera la página guardada sin repetir el POST");
  assert.equal(notionUploads.length, 1);
  const created = notionPages[0];
  assert.deepEqual(created.parent, { type: "data_source_id", data_source_id: "source" });
  assert.equal(created.properties.title.title[0].text.content, "El checkout falla");
  assert.equal(created.children[0].paragraph.rich_text[0].text.content, "El checkout falla");
  assert.equal(created.children[1].image.file_upload.id, "upload");
  const captured = created.children[2].code.rich_text.map((part) => part.text.content).join("");
  assert.match(captured, /Contexto capturado desde el navegador/);
  assert.doesNotMatch(captured, /### Consola|instrucciones_del_sistema/);
  await notion.close();

  const ambiguous = await openComposer();
  await ambiguous.selectOption("#destination", "notion");
  await ambiguous.selectOption("#notion-source", "source");
  await ambiguous.locator("#shots input").uncheck();
  await ambiguous.click("#submit");
  await ambiguous.waitForFunction(() => document.getElementById("status").textContent.includes("no pudimos confirmar"));
  assert.equal(notionPages.length, 2, "un error ambiguo no reenvía la creación");
  assert.equal(notionUploads.length, 1, "respeta la captura desmarcada");
  assert.equal(notionReads, 1, "un error sin ID no se puede recuperar con GET");
  assert.ok(await ambiguous.evaluate(async () => {
    const { getCapture } = await import(chrome.runtime.getURL("lib/db.js"));
    return !!(await getCapture(new URLSearchParams(location.search).get("id")));
  }));
  await ambiguous.close();

  await settings.click("#notion-form [data-disconnect]");
  await settings.waitForFunction(() => document.querySelector('#notion-form [role="status"]').textContent === "Sin conectar");
  assert.equal(await settings.evaluate(async () => (await chrome.storage.local.get("notionConnection")).notionConnection), undefined);
  await settings.close();
  console.log("✓ tickets sin T3: reintento de Trello tras cerrar, desconexión y recuperación de Notion sin duplicar el POST");
}
