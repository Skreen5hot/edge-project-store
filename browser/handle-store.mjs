// Remembers the last folder a page opened, so it can be reopened after the browser restarts (M2-b). Adapted from
// Skreen5hot/mermaid's src/storage/handlesDb.js (CC0): one IndexedDB database holding FileSystemDirectoryHandles.
// Each origin has its own database, so a page opened as a file and the same page on http://localhost remember
// separately.

const DB = 'eps-pages';
const STORE = 'folders';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function request(mode, run) {
  return open().then((db) => new Promise((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => { resolve(r.result); db.close(); };
    r.onerror = () => { reject(r.error); db.close(); };
  }));
}

/** Stores a handle under `key` with the time it was stored. */
export const saveFolder = (key, handle) => request('readwrite', (s) => s.put({ handle, storedAt: new Date().toISOString() }, key));

/** {handle, storedAt} or undefined. */
export const loadFolder = (key) => request('readonly', (s) => s.get(key));
