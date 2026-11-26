import assert from "node:assert/strict";
import { test } from "node:test";
import { NotionClient, prepareTrelloDescription } from "../extension/lib/tickets.js";

const source = { id: "database-source", titleProperty: "title" };

test("Trello conserva el texto completo que cruza el límite, sin separar un emoji", async () => {
  const exact = "x".repeat(16_384);
  assert.deepEqual(prepareTrelloDescription(exact), { description: exact });

  const note = "\n\nEl contenido completo está en el adjunto contexto-completo.md.";
  const prefix = "x".repeat(16_384 - note.length - 1);
  const original = `${prefix}🌿${"y".repeat(note.length)}`;
  const { description, attachment } = prepareTrelloDescription(original);
  assert.equal(description, `${prefix}${note}`);
  assert.equal(await attachment.blob.text(), original);
});

test("Notion separa el texto en fragmentos válidos y conserva los emojis", () => {
  const client = new NotionClient({ token: "test" });
  const description = `${"x".repeat(1_999)}🌿fin`;
  const { body } = client.preparePage(source, "Incidencia", { description, context: "URL" }, []);
  const paragraphs = body.children[0].paragraph.rich_text.map((part) => part.text.content);
  assert.deepEqual(paragraphs, ["x".repeat(1_999), "🌿fin"]);
});

test("Notion valida el tamaño en bytes del ticket y el límite de archivo del workspace", () => {
  const client = new NotionClient({ token: "test", maxFileBytes: 5 });
  const content = { description: "Detalle", context: "URL" };
  const file = { label: "Captura visible", blob: new Blob(["12345"]) };
  assert.equal(client.preparePage(source, "Incidencia", content, [file]).uploads.length, 1);
  assert.throws(() => client.preparePage(source, "Incidencia", content, [
    { ...file, blob: new Blob(["123456"]) },
  ]), /Captura visible.*límite de archivos/);
  const big = "ñ".repeat(150_000);
  assert.throws(() => client.preparePage(source, big, { description: big, context: "URL" }, []), /tamaño máximo/);
});
