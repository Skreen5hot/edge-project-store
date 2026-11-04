// Probes what EPS §11 depends on in one folder: hard links, exclusive create ('wx'), how junctions and symbolic
// links are listed, and paths longer than 260 characters. Works in a new subfolder, which it removes afterwards.
//
//   node tools/probe-fs.mjs <folder, for example inside OneDrive>

import { promises as fsp } from 'node:fs';
import { join, resolve } from 'node:path';

const parent = resolve(process.argv[2] ?? '.');
const dir = join(parent, `eps-probe-${process.pid}`);
await fsp.mkdir(dir, { recursive: true });
const result = { folder: parent, platform: `${process.platform} ${process.arch}`, node: process.version };
const attempt = async (key, fn) => { try { result[key] = (await fn()) ?? 'ok'; } catch (e) { result[key] = e.code ?? String(e); } };
try {
  const a = join(dir, 'a.txt'), b = join(dir, 'b.txt');
  await fsp.writeFile(a, 'a');
  await attempt('link to a new name', () => fsp.link(a, b));
  await attempt('link onto an existing name (must fail with EEXIST)', async () => { await fsp.link(a, b); return 'SUCCEEDED: not exclusive'; });
  await attempt('wx onto an existing name (must fail with EEXIST)', async () => { await (await fsp.open(b, 'wx')).close(); return 'SUCCEEDED: not exclusive'; });
  await attempt('wx to a new name', async () => { const h = await fsp.open(join(dir, 'c.txt'), 'wx'); await h.sync(); await h.close(); });
  await attempt('junction or folder link is listed as a link', async () => {
    await fsp.symlink(dir, join(dir, 'j'), process.platform === 'win32' ? 'junction' : 'dir');
    const d = (await fsp.readdir(dir, { withFileTypes: true })).find((x) => x.name === 'j');
    return d.isSymbolicLink() ? 'yes' : 'NO: it would be followed';
  });
  await attempt('file symbolic link can be created', () => fsp.symlink(a, join(dir, 's.txt'), 'file'));
  let deep = dir;
  while (deep.length < 280) deep = join(deep, 'a-long-folder-name-0123456789');
  await attempt('path over 260 characters', async () => {
    await fsp.mkdir(deep, { recursive: true });
    const f = join(deep, `rev-20261101T100001Z-${'a'.repeat(64)}.jsonld`);
    await fsp.writeFile(f, 'x');
    await fsp.link(f, `${f}.link`);
    return `ok (${f.length + 5} characters, with a hard link)`;
  });
} finally {
  await fsp.rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
