const TRELLO_API = "https://api.trello.com/1";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const TRELLO_DESCRIPTION_LIMIT = 16_384;
const NOTION_TEXT_LIMIT = 2_000;
const NOTION_MAX_TEXT_ITEMS = 100;
const NOTION_MAX_IMAGE_BYTES = 20_000_000;
const NOTION_MAX_REQUEST_BYTES = 500_000;
const NOTION_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const TICKET_LABELS = { trello: "Trello", notion: "Notion" };

const ERROR_MESSAGES = {
  400: "Revisá el destino y el tamaño del contenido.",
  401: "Revisá las credenciales en Ajustes.",
  403: "Revisá que la conexión tenga permiso para hacer esta operación.",
  404: "El destino no existe o la conexión no tiene acceso.",
  413: "El contenido supera el tamaño permitido.",
  429: "Se alcanzó el límite de solicitudes. Probá de nuevo en unos segundos.",
};

class TicketApiError extends Error {
  constructor(provider, status) {
    super(`${provider} respondió con un error (${status}). ${ERROR_MESSAGES[status] ?? "Probá de nuevo más tarde."}`);
    this.status = status;
  }
}

async function request(provider, url, headers, { method = "GET", body, timeout = 30_000 } = {}) {
  const multipart = body instanceof FormData;
  const options = {
    method,
    headers: { Accept: "application/json", ...headers, ...(body && !multipart ? { "Content-Type": "application/json" } : {}) },
    body: multipart ? body : body && JSON.stringify(body),
    credentials: "omit",
    redirect: "error",
  };
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new Error(`No se pudo conectar con ${provider}.`);
    }
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (response.status === 429 && attempt < 2 && retryAfter > 0 && retryAfter <= 5) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (!response.ok) {
      const error = new TicketApiError(provider, response.status);
      if (provider === "Notion" && response.status === 503) {
        const details = await response.json().catch(() => null);
        const id = details?.additional_data?.committed_resource_id;
        if (typeof id === "string" && NOTION_ID.test(id)) error.committedResourceId = id;
      }
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${provider} devolvió una respuesta inesperada.`);
    }
  }
}

async function createTicket(provider, send) {
  try {
    const result = await send();
    if (!result?.id) throw new Error(`${provider} devolvió una respuesta inesperada.`);
    return result;
  } catch (error) {
    if (error instanceof TicketApiError && error.status < 500 && error.status !== 408) throw error;
    throw new Error(`${error.message} Revisá el destino antes de reintentar: no pudimos confirmar si se creó el ticket.`);
  }
}

function uploadForm(blob, name) {
  const form = new FormData();
  form.append("file", blob, name);
  return form;
}

// No cortar un par sustituto (p. ej. un emoji) en el límite de la API.
function textPrefix(text, length) {
  const end = /[\uD800-\uDBFF]/.test(text.charAt(length - 1)) ? length - 1 : length;
  return text.slice(0, end);
}

export function prepareTrelloDescription(description) {
  if (description.length <= TRELLO_DESCRIPTION_LIMIT) return { description };
  const name = "contexto-completo.md";
  const note = `\n\nEl contenido completo está en el adjunto ${name}.`;
  const limit = TRELLO_DESCRIPTION_LIMIT - note.length;
  const prefix = textPrefix(description, limit);
  const lastSection = prefix.lastIndexOf("\n\n##");
  return {
    description: `${lastSection > 0 ? prefix.slice(0, lastSection) : prefix.trimEnd()}${note}`,
    attachment: { name, blob: new Blob([description], { type: "text/markdown" }) },
  };
}

export class TrelloClient {
  constructor({ apiKey, token }) {
    this.headers = { Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"` };
  }

  request(path, options) {
    return request("Trello", `${TRELLO_API}${path}`, this.headers, options);
  }

  checkConnection() {
    return this.request("/members/me?fields=id");
  }

  boards() {
    return this.request("/members/me/boards?filter=open&fields=name");
  }

  lists(boardId) {
    return this.request(`/boards/${encodeURIComponent(boardId)}/lists?filter=open&fields=name`);
  }

  createCard(listId, title, description) {
    return createTicket("Trello", () => this.request("/cards", {
      method: "POST", body: { idList: listId, name: title, desc: description },
    }));
  }

  attachFile(cardId, { blob, name }) {
    const body = uploadForm(blob, name);
    body.append("name", name);
    return this.request(`/cards/${encodeURIComponent(cardId)}/attachments`, { method: "POST", body });
  }

  attachments(cardId) {
    return this.request(`/cards/${encodeURIComponent(cardId)}/attachments?fields=name`);
  }
}

function richText(text, field) {
  const pieces = [];
  while (text.length) {
    const content = textPrefix(text, NOTION_TEXT_LIMIT);
    pieces.push({ type: "text", text: { content } });
    text = text.slice(content.length);
    if (pieces.length === NOTION_MAX_TEXT_ITEMS && text.length) {
      throw new Error(`${field} supera el límite de Notion. Acortá el texto e intentá de nuevo.`);
    }
  }
  return pieces;
}

export class NotionClient {
  constructor({ token, maxFileBytes = NOTION_MAX_IMAGE_BYTES }) {
    this.headers = { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION };
    this.maxFileBytes = Math.min(maxFileBytes, NOTION_MAX_IMAGE_BYTES);
  }

  request(path, options) {
    return request("Notion", `${NOTION_API}${path}`, this.headers, options);
  }

  checkConnection() {
    return this.request("/users/me");
  }

  async dataSources() {
    const sources = [];
    let cursor;
    do {
      const page = await this.request("/search", {
        method: "POST",
        body: { filter: { property: "object", value: "data_source" }, ...(cursor ? { start_cursor: cursor } : {}) },
      });
      for (const source of page.results) {
        const titleProperty = Object.values(source.properties ?? {}).find((property) => property.type === "title")?.id;
        if (!titleProperty || source.in_trash) continue;
        const name = source.title?.map((part) => part.plain_text).join("") || "(sin título)";
        sources.push({ id: source.id, name, titleProperty });
      }
      cursor = page.next_cursor;
    } while (cursor);
    return sources;
  }

  async uploadImage({ blob, name }) {
    const { id } = await this.request("/file_uploads", {
      method: "POST", body: { mode: "single_part", filename: name, content_type: blob.type },
    });
    const upload = await this.request(`/file_uploads/${encodeURIComponent(id)}/send`, {
      method: "POST", body: uploadForm(blob, name),
    });
    if (upload.status !== "uploaded") throw new Error(`Notion no confirmó la subida de ${name}.`);
    return id;
  }

  preparePage(source, title, { description, context }, files) {
    const children = [];
    if (description) children.push({ type: "paragraph", paragraph: { rich_text: richText(description, "La descripción") } });
    const uploads = files.map((file) => {
      if (file.blob.size > this.maxFileBytes) {
        throw new Error(`La captura «${file.label}» supera el límite de archivos de Notion. Desmarcala o hacé una captura más chica.`);
      }
      // El marcador ocupa los mismos bytes que el ID que devuelve la subida.
      const file_upload = { id: "00000000-0000-0000-0000-000000000000" };
      children.push({ type: "image", image: { type: "file_upload", file_upload, caption: richText(file.label) } });
      return { file, uploadRef: file_upload };
    });
    children.push({ type: "code", code: { language: "markdown", rich_text: richText(context, "El contexto") } });
    const body = {
      parent: { type: "data_source_id", data_source_id: source.id },
      properties: { [source.titleProperty]: { type: "title", title: richText(title, "El título") } },
      children,
    };
    if (new TextEncoder().encode(JSON.stringify(body)).length > NOTION_MAX_REQUEST_BYTES) {
      throw new Error("El ticket supera el tamaño máximo de Notion. Acortá la descripción o quitá secciones de contexto.");
    }
    return { body, uploads };
  }

  createPage(body) {
    return createTicket("Notion", async () => {
      try {
        return await this.request("/pages", { method: "POST", body, timeout: 65_000 });
      } catch (error) {
        const id = error.committedResourceId;
        if (!id) throw error;
        const url = `https://www.notion.so/${id.replaceAll("-", "")}`;
        const page = await this.request(`/pages/${id}`).catch(() => null);
        return { id, url: page?.url || url };
      }
    });
  }
}
