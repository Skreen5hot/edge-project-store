// Node backend (node:fs), guarantee level **exclusive** (R-W9, EPS §11). Implements the interface described in
// src/memory-backend.mjs over a project folder on disk.
//
// A create writes `.eps-tmp-…` in the final folder, fsyncs it, then hard-links it to the final name, which fails if
// the name exists: no overwrite, and the final name never shows half-written content. Where hard links are not
// supported, it opens the final name with exclusive create ('wx') instead: still no overwrite, but content is not
// atomic. It never renames onto a final name. Only `replace` (used for work/ files) renames, onto its own name.
//
// Paths never pass through a symbolic link or junction: every folder on the way is checked with lstat, and a path
// through a link reads as absent and is refused for writing (R-B6).

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TEMP_PREFIX } from './contract.mjs';

const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EINVAL', 'EMLINK']);
const STALE_TEMP_MS = 60 * 60 * 1000;
const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * `root` is the project folder. Options: `mode` 'auto' (link, else wx), 'link' or 'wx', for tests;
 * `hooks.beforeCreate(path, bytes)` as in the memory backend.
 */
export function nodeBackend(root, { mode = 'auto', hooks = {} } = {}) {
  const segments = (path) => (path === '' ? [] : path.split('/'));
  const full = (path) => join(root, ...segments(path));
  const stats = { link: 0, wx: 0 };

  // lstat of a path, or null. Every folder on the way must be a real folder, never a link.
  async function lstatThrough(path) {
    const parts = segments(path);
    for (let i = 1; i <= parts.length; i++) {
      let st;
      try { st = await fsp.lstat(join(root, ...parts.slice(0, i))); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
      if (i === parts.length) return st;
      if (!st.isDirectory()) return null;
    }
    return fsp.stat(root).catch(() => null);
  }

  // Creates the folders of `path`'s parent, one at a time, refusing to pass through anything but a real folder.
  async function ensureParent(path) {
    const parts = segments(path).slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const dir = join(root, ...parts.slice(0, i));
      try { await fsp.mkdir(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const st = await fsp.lstat(dir);
      if (!st.isDirectory()) throw fail('NOT-A-FOLDER', `not a real folder on the way to ${path}`);
    }
    return join(root, ...parts);
  }

  async function writeAndSync(file, bytes, flag) {
    const handle = await fsp.open(file, flag);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function syncFolder(dir) {
    if (process.platform === 'win32') return; // Windows cannot fsync a folder (§11)
    const handle = await fsp.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  // R-W8: removes stale temporary files left in a folder by a crash. A temporary file under an hour old may belong to
  // a write in progress elsewhere, so it is left alone.
  async function removeStaleTemps(dir) {
    for (const name of await fsp.readdir(dir)) {
      if (!name.startsWith(TEMP_PREFIX)) continue;
      const file = join(dir, name);
      try {
        const st = await fsp.lstat(file);
        if (st.isFile() && Date.now() - st.mtimeMs > STALE_TEMP_MS) await fsp.unlink(file);
      } catch { /* gone already, or not ours to touch */ }
    }
  }

  const tempName = () => `${TEMP_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`;

  return {
    level: 'exclusive',
    root,
    stats,
    async list(path) {
      const st = await lstatThrough(path);
      if (!st?.isDirectory()) return null;
      const entries = await fsp.readdir(full(path), { withFileTypes: true });
      return entries.map((d) => ({ name: d.name, type: d.isSymbolicLink() ? 'other' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other' }));
    },
    async read(path) {
      const st = await lstatThrough(path);
      if (!st?.isFile()) return null;
      try { return new Uint8Array(await fsp.readFile(full(path))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async create(path, bytes) {
      if (hooks.beforeCreate) await hooks.beforeCreate(path, bytes);
      const dir = await ensureParent(path);
      const target = full(path);
      if (mode !== 'wx') {
        const temp = join(dir, tempName());
        await writeAndSync(temp, bytes, 'wx');
        try {
          await fsp.link(temp, target);
          stats.link++;
          return;
        } catch (e) {
          if (e.code === 'EEXIST') throw fail('EXISTS', `exists: ${path}`);
          if (mode === 'link' || !LINK_UNSUPPORTED.has(e.code)) throw e;
        } finally {
          await fsp.unlink(temp).catch(() => {});
          await syncFolder(dir).catch(() => {});
          await removeStaleTemps(dir).catch(() => {});
        }
      }
      try {
        await writeAndSync(target, bytes, 'wx');
        stats.wx++;
      } catch (e) {
        if (e.code === 'EEXIST') throw fail('EXISTS', `exists: ${path}`);
        throw e;
      }
      await syncFolder(dir).catch(() => {});
      await removeStaleTemps(dir).catch(() => {});
    },
    async replace(path, bytes) {
      const dir = await ensureParent(path);
      const existing = await lstatThrough(path);
      if (existing && !existing.isFile()) throw fail('NOT-A-FILE', `not a file: ${path}`);
      const temp = join(dir, tempName());
      await writeAndSync(temp, bytes, 'wx');
      try {
        await fsp.rename(temp, full(path));
      } catch (e) {
        await fsp.unlink(temp).catch(() => {});
        throw e;
      }
    },
  };
}
