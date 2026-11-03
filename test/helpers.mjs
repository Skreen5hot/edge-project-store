// Test helpers: read a folder on disk into the contract's tree form, and build trees by hand.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The whole folder as a tree. Links and other special entries become `other` and are never followed. */
export function treeFromDisk(dir) {
  const entries = new Map();
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isDirectory()) entries.set(name, treeFromDisk(full));
    else if (st.isFile()) entries.set(name, { type: 'file', bytes: new Uint8Array(readFileSync(full)) });
    else entries.set(name, { type: 'other' });
  }
  return { type: 'dir', entries };
}

/** A deep copy of a tree, so a test can change one without touching another. */
export function cloneTree(node) {
  if (node.type === 'dir') return { type: 'dir', entries: new Map([...node.entries].map(([k, v]) => [k, cloneTree(v)])) };
  if (node.type === 'file') return { type: 'file', bytes: new Uint8Array(node.bytes) };
  return { ...node };
}

/** The node at a `/`-separated path, or undefined. */
export function nodeAt(tree, path) {
  let node = tree;
  for (const s of path.split('/')) node = node?.entries?.get(s);
  return node;
}

/** Puts a node at a path, creating folders on the way. */
export function put(tree, path, node) {
  const segments = path.split('/');
  let dir = tree;
  for (const s of segments.slice(0, -1)) {
    if (!dir.entries.has(s)) dir.entries.set(s, { type: 'dir', entries: new Map() });
    dir = dir.entries.get(s);
  }
  dir.entries.set(segments.at(-1), node);
}

export const text = (s) => ({ type: 'file', bytes: new TextEncoder().encode(s) });
export const textOf = (node) => new TextDecoder().decode(node.bytes);
