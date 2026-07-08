const DB_NAME = 'kannajaburi-trip-media-v1';
const DB_VERSION = 1;
const STORE = 'media';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Cannot open media store'));
  });
  return dbPromise;
}

function txStore(db, mode = 'readonly') {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export function mediaId(prefix = 'media') {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rand[0].toString(36)}${rand[1].toString(36)}`;
}

export async function saveMediaBlob(id, blob, meta = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const record = {
      id,
      blob,
      name: meta.name || 'media-file',
      mimeType: meta.mimeType || blob.type || 'application/octet-stream',
      size: meta.size || blob.size || 0,
      lastModified: meta.lastModified || Date.now(),
      createdAt: meta.createdAt || new Date().toISOString()
    };
    const request = txStore(db, 'readwrite').put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error || new Error('Cannot save media'));
  });
}

export async function getMediaRecord(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Cannot read media'));
  });
}

export async function getMediaBlob(id) {
  const record = await getMediaRecord(id);
  return record?.blob || null;
}

export async function deleteMediaBlob(id) {
  if (!id) return false;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = txStore(db, 'readwrite').delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error('Cannot delete media'));
  });
}

export async function mediaBlobUrl(id) {
  const blob = await getMediaBlob(id);
  if (!blob) return '';
  return URL.createObjectURL(blob);
}
