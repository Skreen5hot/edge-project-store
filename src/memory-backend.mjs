// In-memory backend, for tests and for tools that hold a project only for one session. Guarantee level
// **exclusive** (R-W9): `create` fails when the name exists. Its tree is the contract's tree form (src/contract.mjs).
//
// Backend interface (every method async; paths are `/`-separated and relative to the project folder; '' is the root):
//   level                       'exclusive' | 'checked'
//   list(path)                  [{name, type: 'file' | 'dir' | 'other'}] for a folder, or null
//   read(path)                  Uint8Array for a regular file, or null
//   create(path, bytes)         creates a new file (and missing folders); throws {code: 'EXISTS'} if the name exists
//   replace(path, bytes)        creates or overwrites a file; the project API uses it only inside work/ (R-P6)
//
// `hooks.beforeCreate(path, bytes)` runs before every create and may throw (an interrupted write) or change the
// tree (a racing writer).

export function memoryBackend({ tree = { type: 'dir', entries: new Map() }, hooks = {} } = {}) {
  const segments = (path) => (path === '' ? [] : path.split('/'));
  const nodeAt = (path) => {
    let node = tree;
    for (const s of segments(path)) {
      if (node?.type !== 'dir') return undefined;
      node = node.entries.get(s);
    }
    return node;
  };
  const parentOf = (path) => {
    const parts = segments(path);
    let dir = tree;
    for (const s of parts.slice(0, -1)) {
      if (!dir.entries.has(s)) dir.entries.set(s, { type: 'dir', entries: new Map() });
      dir = dir.entries.get(s);
      if (dir.type !== 'dir') throw Object.assign(new Error(`not a folder on the way to ${path}`), { code: 'NOT-A-FOLDER' });
    }
    return { dir, name: parts.at(-1) };
  };

  return {
    level: 'exclusive',
    tree,
    async list(path) {
      const node = nodeAt(path);
      if (node?.type !== 'dir') return null;
      return [...node.entries].map(([name, n]) => ({ name, type: n.type }));
    },
    async read(path) {
      const node = nodeAt(path);
      return node?.type === 'file' ? new Uint8Array(node.bytes) : null;
    },
    async create(path, bytes) {
      if (hooks.beforeCreate) await hooks.beforeCreate(path, bytes);
      const { dir, name } = parentOf(path);
      if (dir.entries.has(name)) throw Object.assign(new Error(`exists: ${path}`), { code: 'EXISTS' });
      dir.entries.set(name, { type: 'file', bytes: new Uint8Array(bytes) });
    },
    async replace(path, bytes) {
      const { dir, name } = parentOf(path);
      const existing = dir.entries.get(name);
      if (existing && existing.type !== 'file') throw Object.assign(new Error(`not a file: ${path}`), { code: 'NOT-A-FILE' });
      dir.entries.set(name, { type: 'file', bytes: new Uint8Array(bytes) });
    },
  };
}
