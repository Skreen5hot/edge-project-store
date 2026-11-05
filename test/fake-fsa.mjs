// An in-memory fake of the File System Access API (FileSystemDirectoryHandle and FileSystemFileHandle), over the
// contract's tree form, so the browser backend can run the same tests as the memory and Node backends in Node (M2-g).
//
// It follows Chromium where the API leaves room: a writable's data is applied on close() (Chromium stages writes in
// a swap file), errors are DOMExceptions with the browser's names, and file handles refer to a name in a folder.
// What it cannot reproduce is measured in a real browser instead (browser/eps-browser-tests.html, M2-h).
//
// Options: `move` 'replace' (move() onto an existing name replaces it), 'refuse' (it fails) or 'absent' (no move());
// `faults.read(path)` / `faults.list(path)` return a DOMException name to throw, for unreadable files (M2-e);
// `faults.open(path)` makes opening a listed entry fail, as Chrome does on Windows for a path that is too long.

import { browserBackend } from '../src/browser-backend.mjs';

const domError = (name, message) => new DOMException(message, name);

// Last-modified times, kept beside the tree (so it stays the contract's form) and shared by every fake over it, as a
// file's time is on a disk. A file first seen without one (a fixture) counts as modified then.
const MTIMES = new WeakMap();
const modified = (node, ctx) => { if (!MTIMES.has(node)) MTIMES.set(node, ctx.now()); return MTIMES.get(node); };

function checkName(name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Name is not allowed: ${JSON.stringify(name)}`);
  }
}

class FakeDirectory {
  constructor(node, name, path, ctx) {
    Object.assign(this, { node, name, path, ctx, kind: 'directory' });
  }

  child(name) { return this.path ? `${this.path}/${name}` : name; }

  openFault(name) {
    const fault = this.ctx.faults.open?.(this.child(name));
    if (fault) throw domError(fault, `cannot open ${this.child(name)}`);
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    checkName(name);
    this.openFault(name);
    let c = this.node.entries.get(name);
    if (!c) {
      if (!create) throw domError('NotFoundError', `no folder ${this.child(name)}`);
      c = { type: 'dir', entries: new Map() };
      this.node.entries.set(name, c);
    }
    if (c.type !== 'dir') throw domError('TypeMismatchError', `${this.child(name)} is not a folder`);
    return new FakeDirectory(c, name, this.child(name), this.ctx);
  }

  async getFileHandle(name, { create = false } = {}) {
    checkName(name);
    this.openFault(name);
    let c = this.node.entries.get(name);
    if (!c) {
      if (!create) throw domError('NotFoundError', `no file ${this.child(name)}`);
      c = { type: 'file', bytes: new Uint8Array(0) };
      MTIMES.set(c, this.ctx.now());
      this.node.entries.set(name, c);
    }
    if (c.type !== 'file') throw domError('TypeMismatchError', `${this.child(name)} is not a file`);
    return new FakeFile(this, name, this.ctx);
  }

  async removeEntry(name, { recursive = false } = {}) {
    checkName(name);
    const c = this.node.entries.get(name);
    if (!c) throw domError('NotFoundError', `no entry ${this.child(name)}`);
    if (c.type === 'dir' && c.entries.size && !recursive) throw domError('InvalidModificationError', `${this.child(name)} is not empty`);
    this.node.entries.delete(name);
  }

  async* entries() {
    const fault = this.ctx.faults.list?.(this.path);
    if (fault) throw domError(fault, `cannot list ${this.path}`);
    // The API shows only files and folders: links and other special entries of the tree form are not visible.
    for (const [name, c] of [...this.node.entries]) {
      if (c.type === 'dir') yield [name, new FakeDirectory(c, name, this.child(name), this.ctx)];
      else if (c.type === 'file') yield [name, new FakeFile(this, name, this.ctx)];
    }
  }

  async* values() { for await (const [, h] of this.entries()) yield h; }
  async* keys() { for await (const [n] of this.entries()) yield n; }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
}

class FakeFile {
  constructor(parent, name, ctx) {
    Object.assign(this, { parent, name, ctx, kind: 'file' });
    if (ctx.move !== 'absent') this.move = this.#move;
  }

  get path() { return this.parent.child(this.name); }

  node() {
    const c = this.parent.node.entries.get(this.name);
    if (c?.type !== 'file') throw domError('NotFoundError', `no file ${this.path}`);
    return c;
  }

  async getFile() {
    const c = this.node();
    const fault = this.ctx.faults.read?.(this.path);
    if (fault) throw domError(fault, `cannot read ${this.path}`);
    const bytes = new Uint8Array(c.bytes);
    return {
      name: this.name, size: bytes.length, lastModified: modified(c, this.ctx), type: '',
      async arrayBuffer() { return bytes.slice().buffer; },
      async text() { return new TextDecoder().decode(bytes); },
    };
  }

  async createWritable({ keepExistingData = false } = {}) {
    let data = keepExistingData ? new Uint8Array(this.node().bytes) : new Uint8Array(0);
    let open = true;
    return {
      write: async (chunk) => {
        if (!open) throw new TypeError('the writable is closed');
        const add = chunk instanceof Uint8Array ? chunk : typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        const next = new Uint8Array(data.length + add.length);
        next.set(data);
        next.set(add, data.length);
        data = next;
      },
      close: async () => {
        if (!open) throw new TypeError('the writable is closed');
        open = false;
        let c = this.parent.node.entries.get(this.name);
        if (c?.type === 'file') c.bytes = data;
        else this.parent.node.entries.set(this.name, c = { type: 'file', bytes: data });
        MTIMES.set(c, this.ctx.now());
      },
      abort: async () => { open = false; },
    };
  }

  async #move(dir, name) {
    checkName(name);
    const c = this.node();
    const existing = dir.node.entries.get(name);
    if (existing) {
      if (this.ctx.move === 'refuse' || existing.type !== 'file') throw domError('InvalidModificationError', `${dir.child(name)} exists`);
    }
    this.parent.node.entries.delete(this.name);
    dir.node.entries.set(name, c);
    this.parent = dir;
    this.name = name;
  }
}

/** A FileSystemDirectoryHandle over `tree` (the contract's tree form). */
export function fakeDirectory(tree = { type: 'dir', entries: new Map() }, { move = 'replace', faults = {}, now = () => Date.now() } = {}) {
  return new FakeDirectory(tree, '', '', { move, faults, now });
}

/**
 * The browser backend over a fake folder, with the memory backend's options ({tree, hooks}) so the same tests run
 * on it, plus `move`, `faults`, `locks` and `now`. Exposes `tree` like the memory backend.
 */
export function fakeBrowserBackend({ tree = { type: 'dir', entries: new Map() }, hooks, move, faults, locks, now } = {}) {
  const backend = browserBackend(fakeDirectory(tree, { move, faults, now }), { hooks, ...(locks ? { locks } : {}), ...(now ? { now } : {}) });
  return Object.assign(backend, { tree });
}
