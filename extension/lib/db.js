// Capturas en IndexedDB: las imágenes pueden pesar varios MB, más de lo que
// conviene guardar en storage.session.

const DB_NAME = "t3-capture";
const STORE = "captures";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => (result = r));
    t.oncomplete = () => {
      db.close();
      resolve(result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const putCapture = (capture) => tx("readwrite", (s) => promisify(s.put(capture)));
export const getCapture = (id) => tx("readonly", (s) => promisify(s.get(id)));
export const deleteCapture = (id) => tx("readwrite", (s) => promisify(s.delete(id)));

export async function pruneCaptures() {
  const all = await tx("readonly", (s) => promisify(s.getAll()));
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const c of all ?? []) if ((c.createdAt ?? 0) < cutoff) await deleteCapture(c.id);
}
