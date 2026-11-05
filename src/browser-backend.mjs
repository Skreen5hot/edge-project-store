// Browser backend (File System Access API), guarantee level **checked** (R-W9, EPS §11). Implements the interface
// described in src/memory-backend.mjs over a FileSystemDirectoryHandle: a folder the person picked, or any other
// handle with the same API (the origin-private file system, or the fake in test/fake-fsa.mjs).
//
// Adapted from the storage module of Skreen5hot/mermaid (src/storage/storage.js and sanitize.js, CC0): writes go to
// a temporary file with createWritable(), which is closed and then move()d to the final name; Web Locks serialize
// writes to one path; path segments are checked before anything is written.
//
// What "checked" means here. The API has no exclusive create: a backend can only check that a name is free and then
// create it. The check is made inside a Web Lock, so pages of the same origin (tabs of one tool) never race. Another
// origin, another program or a synchronizing client takes no lock and can create the same name between the check
// and the move(); whether move() then replaces that file or refuses depends on the browser (M2-d measures it). A
// replaced artifact is detected by its hash; a replaced record with identical bytes is not detectable (R-W9).
//
// Unlike the Node backend there are no links to guard against: the API exposes only files and folders.

import { TEMP_PREFIX } from './contract.mjs';

const STALE_TEMP_MS = 60 * 60 * 1000;
const fail = (code, message) => Object.assign(new Error(message), { code });
const absent = (e) => e?.name === 'NotFoundError' || e?.name === 'TypeMismatchError';
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// A path the backend will write to: `/`-separated segments a Windows or macOS folder can hold. Never altered, only
// refused, because a changed name would be a different artifact (mermaid's sanitizeName trims; this refuses).
function writableSegments(path) {
  const parts = typeof path === 'string' && path !== '' ? path.split('/') : [];
  const bad = (s) => s === '' || s === '.' || s === '..' || s.length > 255 || /[\x00-\x1f\x7f<>:"\\|?*]/.test(s)
    || /[. ]$/.test(s) || WINDOWS_RESERVED.test(s);
  if (!parts.length || parts.some(bad)) throw fail('BAD-PATH', `not a path this backend writes: ${JSON.stringify(path)}`);
  return parts;
}

// A path the backend will read: any segments except empty, '.' and '..' (the evaluation only asks for safe paths).
function readableSegments(path) {
  const parts = path === '' ? [] : String(path).split('/');
  return parts.some((s) => s === '' || s === '.' || s === '..') ? null : parts;
}

/** Locks for one process (one origin), used where navigator.locks is missing. */
export function localLocks() {
  const queue = new Map();
  return {
    request(name, fn) {
      const run = (queue.get(name) ?? Promise.resolve()).then(() => fn(), () => fn());
      queue.set(name, run.catch(() => {}));
      return run;
    },
  };
}
const processLocks = localLocks();

function randomHex(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `root` is a FileSystemDirectoryHandle with read and write permission. Options:
 * `locks` (default navigator.locks, else one lock queue per page); `lockScope`, the prefix of every lock name;
 * `hooks.beforeCreate(path, bytes)` as in the memory backend; `hooks.beforeMove(path)` runs after the check and
 * before the move, so a test can play another origin writing in that window; `now`, the clock for R-W8 (tests).
 */
export function browserBackend(root, { locks = globalThis.navigator?.locks ?? processLocks, lockScope = 'eps', hooks = {}, now = () => Date.now() } = {}) {
  const stats = { move: 0, direct: 0 };

  // Whether `dir` lists an entry `name` of `kind` ('file' or 'directory'). A listed entry that cannot be opened is not
  // absent: on Windows, Chrome lists files whose full path is too long to open, and answers NotFoundError for them.
  // Such a file is reported as unreadable (R-E10), never treated as missing.
  async function listed(dir, name, kind) {
    try {
      for await (const [n, h] of dir.entries()) if (n === name && h.kind === kind) return true;
    } catch { /* the folder itself cannot be listed: the caller's error stands */ }
    return false;
  }

  async function folder(parts, create) {
    let dir = root;
    for (const s of parts) {
      try {
        dir = await dir.getDirectoryHandle(s, { create });
      } catch (e) {
        if (create && e?.name === 'TypeMismatchError') throw fail('NOT-A-FOLDER', `not a folder on the way: ${parts.join('/')}`);
        if (!create && absent(e) && !(e?.name === 'NotFoundError' && await listed(dir, s, 'directory'))) return null;
        throw e;
      }
    }
    return dir;
  }

  async function kindOf(dir, name) {
    try {
      await dir.getFileHandle(name);
      return 'file';
    } catch (e) {
      if (e?.name === 'TypeMismatchError') return 'dir';
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async function writeAll(handle, bytes) {
    const w = await handle.createWritable({ keepExistingData: false });
    try {
      await w.write(bytes);
      await w.close();
    } catch (e) {
      try { await w.abort(); } catch { /* already closed */ }
      throw e;
    }
  }

  // R-W8: removes temporary files over an hour old from a folder; a younger one may be a write in progress elsewhere.
  async function removeStaleTemps(dir) {
    for await (const [name, handle] of dir.entries()) {
      if (!name.startsWith(TEMP_PREFIX) || handle.kind !== 'file') continue;
      try {
        if (now() - (await handle.getFile()).lastModified > STALE_TEMP_MS) await dir.removeEntry(name);
      } catch { /* gone already, or not ours to touch */ }
    }
  }

  return {
    level: 'checked',
    root,
    stats,
    async list(path) {
      const parts = readableSegments(path);
      const dir = parts && await folder(parts, false);
      if (!dir) return null;
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        out.push({ name, type: handle.kind === 'directory' ? 'dir' : handle.kind === 'file' ? 'file' : 'other' });
      }
      return out;
    },
    async read(path) {
      const parts = readableSegments(path);
      if (!parts?.length) return null;
      const dir = await folder(parts.slice(0, -1), false);
      if (!dir) return null;
      try {
        const file = await (await dir.getFileHandle(parts.at(-1))).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        if (absent(e) && !(e?.name === 'NotFoundError' && await listed(dir, parts.at(-1), 'file'))) return null;
        throw e; // NotReadableError, or NotFoundError for a listed file: the loader reports E-UNREADABLE (R-E10)
      }
    },
    async create(path, bytes) {
      const parts = writableSegments(path);
      const name = parts.at(-1);
      return locks.request(`${lockScope}:${parts.join('/')}`, async () => {
        if (hooks.beforeCreate) await hooks.beforeCreate(path, bytes);
        const dir = await folder(parts.slice(0, -1), true);
        if (await kindOf(dir, name)) throw fail('EXISTS', `exists: ${path}`);
        const tempName = `${TEMP_PREFIX}${randomHex(6)}`;
        const temp = await dir.getFileHandle(tempName, { create: true });
        let moved = false;
        try {
          if (typeof temp.move === 'function') {
            await writeAll(temp, bytes);
            // The check (R-W9, checked): as close to the move as the API allows.
            if (await kindOf(dir, name)) throw fail('EXISTS', `exists: ${path}`);
            if (hooks.beforeMove) await hooks.beforeMove(path);
            try {
              await temp.move(dir, name);
            } catch (e) {
              if (await kindOf(dir, name)) throw fail('EXISTS', `exists: ${path} (the move was refused: ${e?.name})`);
              throw e;
            }
            moved = true;
            stats.move++;
          } else {
            // Without move(): check, then write the final name directly. Chromium applies a write on close(), which in
            // practice avoids partial files, but that is browser behaviour, not a guarantee (§11).
            if (await kindOf(dir, name)) throw fail('EXISTS', `exists: ${path}`);
            if (hooks.beforeMove) await hooks.beforeMove(path);
            await writeAll(await dir.getFileHandle(name, { create: true }), bytes);
            stats.direct++;
          }
        } finally {
          if (!moved) { try { await dir.removeEntry(tempName); } catch { /* not there */ } }
          await removeStaleTemps(dir).catch(() => {});
        }
      });
    },
    async replace(path, bytes) {
      const parts = writableSegments(path);
      const name = parts.at(-1);
      return locks.request(`${lockScope}:${parts.join('/')}`, async () => {
        const dir = await folder(parts.slice(0, -1), true);
        if ((await kindOf(dir, name)) === 'dir') throw fail('NOT-A-FILE', `not a file: ${path}`);
        await writeAll(await dir.getFileHandle(name, { create: true }), bytes);
      });
    },
  };
}
