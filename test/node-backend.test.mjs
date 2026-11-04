// M1 tests: the Node backend (src/node-backend.mjs) and the eps tool (bin/eps.mjs) on a real file system.
// Folders are created under the system temporary folder, or under EPS_TEST_DIR when set (for example a OneDrive
// folder), and removed afterwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp, readdirSync, readFileSync, writeFileSync, cpSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { evaluate, canonicalBytes, sha256, TEMP_PREFIX } from '../src/contract.mjs';
import { loadTree, createProject, openProject, EpsWriteError } from '../src/project.mjs';
import { nodeBackend } from '../src/node-backend.mjs';
import { memoryBackend } from '../src/memory-backend.mjs';
import { treeFromDisk } from './helpers.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '..', 'examples');
const eps = join(here, '..', 'bin', 'eps.mjs');
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-000000000002';
const bytesOf = (s) => new TextEncoder().encode(s);
const codes = (r) => r.diagnostics.map((d) => d.code);
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);

async function scratch(t) {
  const base = process.env.EPS_TEST_DIR ?? tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = await fsp.mkdtemp(join(base, 'eps-test-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

const junction = (target, at) => fsp.symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const tools = {
  normalizer: { tool: 'example-normalizer', version: '0.1.0', responsibilities: ['normalizer'] },
  sdd: { tool: 'sdd', version: '1.1.0', responsibilities: ['sdd-author'] },
};

// ---------------------------------------------------------------------------------------------------------------
// The backend interface, the same on both backends

for (const [label, make] of [
  ['memory', async () => memoryBackend()],
  ['node (link)', async (t) => nodeBackend(await scratch(t), { mode: 'link' })],
  ['node (wx)', async (t) => nodeBackend(await scratch(t), { mode: 'wx' })],
]) {
  test(`backend interface: ${label}`, async (t) => {
    const b = await make(t);
    assert.equal(b.level, 'exclusive');
    assert.equal(await b.read('a/b.txt'), null);
    assert.equal(await b.list('a'), null);
    await b.create('a/b.txt', bytesOf('one'));
    await rejects(b.create('a/b.txt', bytesOf('two')), 'EXISTS');
    assert.deepEqual(await b.read('a/b.txt'), bytesOf('one'), 'a refused create changes nothing');
    await b.replace('a/work/w.txt', bytesOf('1'));
    await b.replace('a/work/w.txt', bytesOf('2'));
    assert.deepEqual(await b.read('a/work/w.txt'), bytesOf('2'));
    const listing = (await b.list('a')).sort((x, y) => (x.name < y.name ? -1 : 1));
    assert.deepEqual(listing, [{ name: 'b.txt', type: 'file' }, { name: 'work', type: 'dir' }], 'no temporary file is left');
    assert.deepEqual((await b.list('')).map((e) => e.name), ['a']);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// M1-1, M1-2: exclusive creates, in both write modes, and against another process

for (const mode of ['link', 'wx']) {
  test(`M1-1: two processes racing for the same names never overwrite each other (${mode})`, async (t) => {
    const root = await scratch(t);
    const count = 40, startAt = Date.now() + 1500;
    const child = (label) => run(process.execPath, [join(here, 'children', 'race-create.mjs'), root, label, String(count), String(startAt), mode]);
    const [a, b] = await Promise.all([child('A'), child('B')]);
    const wonA = JSON.parse(a.stdout), wonB = JSON.parse(b.stdout);
    for (let i = 0; i < count; i++) {
      const winners = [wonA.includes(i) && 'A', wonB.includes(i) && 'B'].filter(Boolean);
      assert.equal(winners.length, 1, `race-${i}.txt has exactly one winner`);
      assert.equal(readFileSync(join(root, 'race', `race-${i}.txt`), 'utf8'), `${winners[0]} ${i}`, 'the winner\'s bytes survive');
    }
    assert.deepEqual(readdirSync(join(root, 'race')).filter((n) => n.startsWith(TEMP_PREFIX)), [], 'no temporary files are left');
  });
}

test('M1-2: auto mode uses hard links where the file system has them; the code never renames onto a final name', async (t) => {
  const b = nodeBackend(await scratch(t));
  await b.create('x/1.txt', bytesOf('1'));
  assert.deepEqual(b.stats, { link: 1, wx: 0 });
  const source = readFileSync(join(here, '..', 'src', 'node-backend.mjs'), 'utf8');
  const renames = source.split('\n').filter((l) => /fsp\.rename\(/.test(l));
  assert.equal(renames.length, 1, 'one rename, in replace()');
  assert.match(source.slice(source.indexOf('async replace('), source.indexOf('async replace(') + 1500), /fsp\.rename\(temp, full\(path\)\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// M1-3, M1-4: the writer and the reader on disk

for (const mode of ['link', 'wx']) {
  test(`M1-3: writing EX-02 to disk reproduces the fixture's artifacts and records (${mode})`, async (t) => {
    const root = await scratch(t);
    const fixture = join(examples, 'EX-02-chain-ok', 'project');
    const backend = nodeBackend(root, { mode });
    await createProject(backend, { id: PROJECT, name: 'Example 2', createdAt: '2026-11-01T08:00:00Z' });
    const read = (p) => new Uint8Array(readFileSync(join(fixture, ...p.split('/'))));
    const sourceTool = JSON.parse(readFileSync(join(fixture, 'source', 'schema-20261101T090000Z-67daa493.json.record.jsonld'), 'utf8')).producedBy;
    await (await openProject(backend, sourceTool)).addSource({ kind: 'schema', ext: 'json', bytes: read('source/schema-20261101T090000Z-67daa493.json'), createdAt: '2026-11-01T09:00:00Z' });
    await (await openProject(backend, tools.normalizer)).commit('normalized', { createdAt: '2026-11-01T09:10:00Z', artifacts: [{
      role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic', bytes: read('normalized/normalized-20261101T091000Z-4c173267.json'),
      inputs: [{ role: 'sources', collection: 'source' }] }] });
    await (await openProject(backend, tools.sdd)).commit('sdd', { createdAt: '2026-11-01T10:00:00Z', artifacts: [{
      role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: read('sdd/sdd-20261101T100000Z-fa7eae25.jsonld'),
      inputs: [{ role: 'structure', relation: 'dependency', path: 'normalized/normalized-20261101T091000Z-4c173267.json' }] }] });
    for (const stage of ['source', 'normalized', 'sdd']) {
      for (const name of readdirSync(join(fixture, stage)).filter((n) => n !== 'revisions')) {
        assert.deepEqual(read(`${stage}/${name}`), new Uint8Array(readFileSync(join(root, stage, name))), `${stage}/${name}`);
      }
    }
    assert.deepEqual(readFileSync(join(root, 'edge-project.jsonld')), readFileSync(join(fixture, 'edge-project.jsonld')));
    const r = evaluate(await loadTree(backend));
    assert.deepEqual(codes(r), []);
    assert.equal(r.stages.sdd.status, 'ok');
    assert.equal(backend.stats[mode], 9, `all nine files (project, 3 artifacts, 3 records, 2 revisions) were created by ${mode}`);
  });
}

test('M1-4: every example read from disk through the Node backend equals its expected report', async () => {
  const names = readdirSync(examples).filter((n) => /^EX-\d\d-/.test(n));
  assert.equal(names.length, 25);
  for (const name of names) {
    const r = evaluate(await loadTree(nodeBackend(join(examples, name, 'project'))));
    assert.equal(new TextDecoder().decode(canonicalBytes(r)), readFileSync(join(examples, name, 'expected.jsonld'), 'utf8'), name);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// M1-5: links are never followed

test('M1-5: a junction in a project is foreign, an input through it is missing, and the backend refuses it', async (t) => {
  const root = await scratch(t);
  cpSync(join(examples, 'EX-02-chain-ok', 'project'), root, { recursive: true });
  const outside = await scratch(t);
  cpSync(join(examples, 'EX-02-chain-ok', 'project', 'normalized'), join(outside, 'normalized-copy'), { recursive: true });
  await junction(join(outside, 'normalized-copy'), join(root, 'sdd', 'linked'));
  const backend = nodeBackend(root);
  const normalizedName = 'normalized-20261101T091000Z-4c173267.json';
  assert.equal(await backend.read(`sdd/linked/${normalizedName}`), null, 'reading through the junction finds nothing');
  assert.equal(await backend.list('sdd/linked'), null);
  await rejects(backend.create('sdd/linked/new.txt', bytesOf('x')), 'NOT-A-FOLDER');
  assert.deepEqual(readdirSync(join(outside, 'normalized-copy')).filter((n) => n === 'new.txt'), [], 'nothing was written outside');

  // A diagram citing a file through the junction: the evaluation never follows it.
  const target = new Uint8Array(readFileSync(join(outside, 'normalized-copy', normalizedName)));
  const diagram = bytesOf('graph TD');
  const hash = sha256(diagram);
  const name = `diagram-20261101T110000Z-${hash.slice(0, 8)}.mmd`;
  const record = {
    '@context': 'https://skreen5hot.github.io/edge-project-store/context/eps-v2.jsonld', '@type': 'ArtifactRecord', contractVersion: 2,
    project: PROJECT, stage: 'diagrams', path: `diagrams/${name}`, kind: 'diagram', sha256: hash, bytes: diagram.length,
    generation: 'deterministic', producedBy: { responsibility: 'diagram-exporter', tool: 'test', version: '1' },
    inputs: [{ role: 'model', relation: 'dependency', path: `sdd/linked/${normalizedName}`, sha256: sha256(target) }], createdAt: '2026-11-01T11:00:00Z',
  };
  mkdirSync(join(root, 'diagrams'));
  writeFileSync(join(root, 'diagrams', name), diagram);
  writeFileSync(join(root, 'diagrams', `${name}.record.jsonld`), canonicalBytes(record));
  const r = evaluate(await loadTree(backend));
  assert.ok(r.diagnostics.some((d) => d.code === 'W-FOREIGN-FILE' && d.path === 'sdd/linked'));
  assert.deepEqual(r.artifacts.find((a) => a.stage === 'diagrams').staleBecause, [{ code: 'INPUT-MISSING', input: `sdd/linked/${normalizedName}` }]);
});

test('M1-5: a stage folder that is itself a junction is treated as absent and reported', async (t) => {
  const root = await scratch(t);
  cpSync(join(examples, 'EX-02-chain-ok', 'project'), root, { recursive: true });
  const outside = await scratch(t);
  await fsp.rename(join(root, 'sdd'), join(outside, 'sdd'));
  await junction(join(outside, 'sdd'), join(root, 'sdd'));
  const r = evaluate(await loadTree(nodeBackend(root)));
  assert.equal(r.stages.sdd.status, 'empty');
  assert.ok(r.diagnostics.some((d) => d.code === 'W-FOREIGN-FILE' && d.path === 'sdd'));
  const sdd = await openProject(nodeBackend(root), tools.sdd);
  await rejects(sdd.commit('sdd', { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{}') }] }), 'NOT-A-FOLDER');
});

// ---------------------------------------------------------------------------------------------------------------
// M1-6: a process killed mid-commit

for (const [label, crashAt, expected] of [
  ['before the record', String.raw`^sdd/sdd-.*\.record\.jsonld$`, ['W-UNREGISTERED']],
  ['before the revision', '^sdd/revisions/', ['W-UNCOMMITTED']],
]) {
  test(`M1-6: killed ${label}: only a §10 state remains, and rerunning completes the commit`, async (t) => {
    const root = await scratch(t);
    cpSync(join(examples, 'EX-02-chain-ok', 'project'), root, { recursive: true });
    await fsp.rm(join(root, 'sdd'), { recursive: true });
    const child = (at) => run(process.execPath, [join(here, 'children', 'crash-commit.mjs'), root, at, 'normalized/normalized-20261101T091000Z-4c173267.json'])
      .then(() => 0, (e) => e.code);
    assert.equal(await child(crashAt), 9, 'the child died');
    let r = evaluate(await loadTree(nodeBackend(root)));
    assert.deepEqual([r.stages.sdd.status, codes(r)], ['empty', expected]);
    assert.equal(await child('never'), 0);
    r = evaluate(await loadTree(nodeBackend(root)));
    assert.deepEqual([r.stages.sdd.status, codes(r)], ['ok', []]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// M1-7: temporary files

test('M1-7: a stale temporary file is removed by the next write in its folder; a fresh one is left alone', async (t) => {
  const root = await scratch(t);
  const b = nodeBackend(root);
  await b.create('sdd/first.txt', bytesOf('1'));
  writeFileSync(join(root, 'sdd', `${TEMP_PREFIX}stale`), 'left by a crash');
  writeFileSync(join(root, 'sdd', `${TEMP_PREFIX}fresh`), 'another writer, still writing');
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(join(root, 'sdd', `${TEMP_PREFIX}stale`), twoHoursAgo, twoHoursAgo);
  await b.create('sdd/second.txt', bytesOf('2'));
  assert.deepEqual(readdirSync(join(root, 'sdd')).sort(), [`${TEMP_PREFIX}fresh`, 'first.txt', 'second.txt']);
});

// ---------------------------------------------------------------------------------------------------------------
// M1-8: the eps tool

const cli = (...args) => run(process.execPath, [eps, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

test('M1-8: eps report is byte-identical to the library evaluation, and status exit codes follow the report', async () => {
  for (const [name, exit] of [['EX-02-chain-ok', 0], ['EX-03-source-added', 0], ['EX-08-stage-conflict', 1], ['EX-11-damaged-head', 1],
    ['EX-12-missing-parent', 1], ['EX-13-foreign-context', 2], ['EX-14-foreign-files', 0]]) {
    const folder = join(examples, name, 'project');
    const report = await cli('report', folder);
    assert.equal(report.stdout, readFileSync(join(examples, name, 'expected.jsonld'), 'utf8'), name);
    assert.equal((await cli('status', folder)).code, exit, name);
  }
});

test('M1-8: eps init, add-source, commit, a fork, a refused commit, and merge', async (t) => {
  const base = await scratch(t);
  const pc1 = join(base, 'project');
  const file = (name, text) => { writeFileSync(join(base, name), text); return join(base, name); };
  assert.equal((await cli('init', pc1, '--name', 'Demo')).code, 0);
  assert.equal((await cli('init', pc1, '--name', 'Demo')).code, 2, 'init refuses an existing project');
  assert.equal((await cli('add-source', pc1, file('schema.json', '{"a":1}\n'), '--kind', 'schema')).code, 0);
  assert.equal((await cli('commit', pc1, 'normalized', file('n.json', '{"n":1}\n'), '--kind', 'normalized', '--sources', 'sources')).code, 0);
  const normalized = readdirSync(join(pc1, 'normalized')).find((n) => n.endsWith('.json'));
  const sdd = (n) => cli('commit', pc1, 'sdd', file(`s${n}.jsonld`, `{"sdd":${n}}\n`), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=normalized/${normalized}`);
  assert.equal((await sdd(1)).code, 0);
  // A second PC: a copy of the folder, each commits, then the copies are combined as a sync client would.
  const pc2 = join(base, 'project-pc2');
  cpSync(pc1, pc2, { recursive: true });
  assert.equal((await sdd(2)).code, 0);
  assert.equal((await cli('commit', pc2, 'sdd', file('s3.jsonld', '{"sdd":3}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=normalized/${normalized}`)).code, 0);
  for (const sub of ['sdd', 'sdd/revisions']) {
    for (const name of readdirSync(join(pc2, sub))) {
      if (name !== 'revisions') cpSync(join(pc2, sub, name), join(pc1, sub, name), { force: false, errorOnExist: false });
    }
  }
  const status = await cli('status', pc1);
  assert.equal(status.code, 1);
  assert.match(status.stdout, /sdd\s+conflicted, 2 heads/);
  const refused = await sdd(4);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /REFUSED-CONFLICTED/);
  const chosen = readdirSync(join(pc1, 'sdd')).find((n) => n.endsWith('.jsonld') && !n.includes('.record.') && readFileSync(join(pc1, 'sdd', n), 'utf8').includes('"sdd":3'));
  assert.equal((await cli('merge', pc1, 'sdd', '--choose', `sdd=sdd/${chosen}`)).code, 0);
  const after = await cli('status', pc1);
  assert.equal(after.code, 0, after.stdout);
  assert.match(after.stdout, new RegExp(`sdd/${chosen}\\s+\\[up to date\\]`));
});

test('M1-8: usage errors exit 2 with a message', async () => {
  for (const args of [[], ['status'], ['bogus', '.'], ['add-source', '.'], ['commit', '.', 'source', 'x']]) {
    const r = await cli(...args);
    if (args.length === 0) { assert.equal(r.code, 0, 'no arguments prints help'); continue; }
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, /^eps: /);
  }
});
