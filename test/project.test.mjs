// Unit tests for the project API (src/project.mjs): the writer rules (EPS §8), the recovery table (§10) and the
// loader. These are independent of the fixtures except where a fixture is the starting folder.
//
// The same tests run twice: on the memory backend, and on the browser backend over a fake of the File System Access
// API (test/fake-fsa.mjs, M2-g), whose test names end in [browser backend]. Inside the loop below, `memoryBackend`
// names whichever backend is under test; the body is left unindented so that it reads as before.

import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluate, canonicalBytes, sha256 } from '../src/contract.mjs';
import { loadTree, createProject, openProject, EpsWriteError } from '../src/project.mjs';
import { memoryBackend as memory } from '../src/memory-backend.mjs';
import { fakeBrowserBackend } from './fake-fsa.mjs';
import { treeFromDisk, cloneTree, nodeAt, put, text, textOf } from './helpers.mjs';

for (const [suffix, memoryBackend] of [['', memory], [' [browser backend]', fakeBrowserBackend]]) {
const test = (name, fn) => nodeTest(name + suffix, fn);

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = (name) => treeFromDisk(join(examples, name, 'project'));
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-000000000002';
const bytesOf = (s) => new TextEncoder().encode(s);
const codes = (r) => r.diagnostics.map((d) => d.code);
const rejects = (promise, code) => assert.rejects(promise, (e) => e instanceof EpsWriteError && e.code === code);

// Every create and replace, so a test can show that nothing is ever overwritten outside work/.
function recordingBackend(options) {
  const backend = memoryBackend(options);
  const log = [];
  return {
    ...backend,
    log,
    async create(path, bytes) { log.push(['create', path]); return backend.create(path, bytes); },
    async replace(path, bytes) { log.push(['replace', path]); return backend.replace(path, bytes); },
  };
}

const tools = {
  normalizer: { tool: 'example-normalizer', version: '0.1.0', responsibilities: ['normalizer'] },
  sdd: { tool: 'sdd', version: '1.1.0', responsibilities: ['sdd-author'] },
  diagrams: { tool: 'diagrams', version: '1', responsibilities: ['diagram-exporter'] },
};

async function freshProject(backend = memoryBackend()) {
  await createProject(backend, { id: PROJECT, name: 'Example 2', createdAt: '2026-11-01T08:00:00Z' });
  return backend;
}

// EX-02's chain, written through the API with the fixture's own contents, tools and times.
async function writeChain(backend) {
  const fixture = example('EX-02-chain-ok');
  const content = (path) => nodeAt(fixture, path).bytes;
  const sourceTool = JSON.parse(textOf(nodeAt(fixture, 'source/schema-20261101T090000Z-67daa493.json.record.jsonld'))).producedBy;
  const intake = await openProject(backend, { tool: sourceTool.tool, version: sourceTool.version });
  const source = await intake.addSource({ kind: 'schema', ext: 'json', bytes: content('source/schema-20261101T090000Z-67daa493.json'), createdAt: '2026-11-01T09:00:00Z' });
  const normalizer = await openProject(backend, tools.normalizer);
  const normalized = await normalizer.commit('normalized', {
    artifacts: [{ role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic',
      bytes: content('normalized/normalized-20261101T091000Z-4c173267.json'), inputs: [{ role: 'sources', collection: 'source' }] }],
    createdAt: '2026-11-01T09:10:00Z',
  });
  return { fixture, content, source, normalized, normalizer, intake };
}

test('the loader reads every example exactly as the folder on disk', async () => {
  for (const name of readdirSync(examples).filter((n) => /^EX-/.test(n))) {
    const disk = example(name);
    const loaded = await loadTree(memoryBackend({ tree: cloneTree(disk) }));
    assert.deepEqual(evaluate(loaded), evaluate(disk), name);
  }
});

test('the loader reads a cited file in a subfolder, and nothing in work/', async () => {
  const tree = example('EX-02-chain-ok');
  put(tree, 'sdd/work/session.json', text('secret'));
  put(tree, 'sdd/archive/x.txt', text('archived'));
  const loaded = await loadTree(memoryBackend({ tree }));
  assert.equal(nodeAt(loaded, 'sdd/work/session.json'), undefined);
  assert.equal(nodeAt(loaded, 'sdd/archive').entries.size, 0, 'an uncited subfolder is not read');
});

test('writing EX-02 through the API reproduces the fixture byte for byte', async () => {
  const backend = await freshProject();
  const { fixture, content } = await writeChain(backend);
  const sdd = await openProject(backend, tools.sdd);
  await sdd.commit('sdd', {
    artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: content('sdd/sdd-20261101T100000Z-fa7eae25.jsonld'),
      inputs: [{ role: 'structure', relation: 'dependency', path: 'normalized/normalized-20261101T091000Z-4c173267.json' }] }],
    createdAt: '2026-11-01T10:00:00Z',
  });
  // The fixture's revisions are one second after their artifacts; with a fixed time the API uses the same second,
  // so compare everything except revision files, then the revisions' content apart from createdAt.
  const strip = (node) => {
    if (node.type !== 'dir') return node;
    return { type: 'dir', entries: new Map([...node.entries].filter(([k]) => k !== 'revisions').map(([k, v]) => [k, strip(v)])) };
  };
  assert.deepEqual(strip(backend.tree), strip(fixture));
  for (const stage of ['normalized', 'sdd']) {
    const [ours] = [...nodeAt(backend.tree, `${stage}/revisions`).entries.values()].map((n) => JSON.parse(textOf(n)));
    const [theirs] = [...nodeAt(fixture, `${stage}/revisions`).entries.values()].map((n) => JSON.parse(textOf(n)));
    assert.deepEqual({ ...ours, parents: [], createdAt: '' }, { ...theirs, parents: [], createdAt: '' }, stage);
  }
  const r = await sdd.evaluate();
  assert.deepEqual(codes(r), []);
  const sddArtifact = r.artifacts.find((a) => a.stage === 'sdd');
  assert.deepEqual([sddArtifact.inStageCurrent, sddArtifact.upToDate], [true, true]);
});

test('createProject refuses an existing project; openProject refuses a folder that is not one', async () => {
  const backend = await freshProject();
  await rejects(createProject(backend, { id: PROJECT, name: 'again', createdAt: '2026-11-01T08:00:00Z' }), 'PROJECT-EXISTS');
  await rejects(openProject(memoryBackend(), tools.sdd), 'NOT-A-PROJECT');
});

test('single writer: a tool writes only the stages it hosts; any tool may add sources', async () => {
  const backend = await freshProject();
  const sdd = await openProject(backend, tools.sdd);
  await rejects(sdd.commit('normalized', { artifacts: [] }), 'NOT-RESPONSIBLE');
  await rejects(sdd.work.write('normalized', 'x', bytesOf('x')), 'NOT-RESPONSIBLE');
  await rejects(sdd.commit('source', { artifacts: [] }), 'BAD-ARGUMENT');
  await sdd.addSource({ kind: 'schema', ext: 'json', bytes: bytesOf('{}'), createdAt: '2026-11-01T09:00:00Z' });
});

test('argument errors are found before any file is created', async () => {
  const backend = recordingBackend();
  await freshProject(backend);
  const { normalized } = await writeChain(backend);
  const sdd = await openProject(backend, tools.sdd);
  const good = { role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{}'), inputs: [] };
  const n = backend.log.length;
  await rejects(sdd.commit('sdd', { artifacts: [good, { ...good, kind: 'Bad' }] }), 'BAD-ARGUMENT');
  await rejects(sdd.commit('sdd', { artifacts: [good, { ...good, generation: 'received' }] }), 'BAD-ARGUMENT');
  await rejects(sdd.commit('sdd', { artifacts: [{ ...good, inputs: [{ role: 's', relation: 'dependency', path: 'sdd/work/session.json' }] }] }), 'BAD-ARGUMENT');
  await rejects(sdd.commit('sdd', { artifacts: [{ ...good, inputs: [{ role: 's', relation: 'dependency', path: 'normalized/../x' }] }] }), 'BAD-ARGUMENT');
  await rejects(sdd.commit('sdd', { artifacts: [{ ...good, inputs: [{ role: 's', relation: 'dependency', path: 'normalized/nope-20261101T091000Z-00000000.json' }] }] }), 'INPUT-NOT-REGISTERED');
  await rejects(sdd.commit('sdd', { artifacts: [{ ...good, inputs: [{ role: 's', relation: 'maybe', path: normalized.artifacts[0].path }] }] }), 'BAD-ARGUMENT');
  await rejects(sdd.commit('sdd', { artifacts: [] }), 'BAD-ARGUMENT');
  assert.equal(backend.log.length, n);
});

test('R-W1: the writer never replaces a file outside work/', async () => {
  const backend = recordingBackend();
  await freshProject(backend);
  const { normalizer } = await writeChain(backend);
  await normalizer.work.write('normalized', 'session.json', bytesOf('1'));
  await normalizer.work.write('normalized', 'session.json', bytesOf('2'));
  assert.equal(textOf({ bytes: await normalizer.work.read('normalized', 'session.json') }), '2');
  const created = backend.log.filter(([op]) => op === 'create').map(([, p]) => p);
  assert.equal(new Set(created).size, created.length, 'no name is created twice');
  assert.ok(backend.log.filter(([op]) => op === 'replace').every(([, p]) => p.startsWith('normalized/work/')));
  assert.deepEqual(codes(await normalizer.evaluate()), [], 'work files are never evaluated');
});

test('R-W1: a name holding different bytes extends the prefix (EX-22)', async () => {
  const backend = await freshProject();
  const intake = await openProject(backend, tools.sdd);
  const bytes = bytesOf('real');
  const name8 = `schema-20261101T090000Z-${sha256(bytes).slice(0, 8)}.json`;
  backend.tree.entries.set('source', { type: 'dir', entries: new Map([[name8, { type: 'file', bytes: bytesOf('stray') }]]) });
  const w = await intake.addSource({ kind: 'schema', ext: 'json', bytes, createdAt: '2026-11-01T09:00:00Z' });
  assert.equal(w.path, `source/schema-20261101T090000Z-${sha256(bytes).slice(0, 16)}.json`);
  assert.equal(textOf(nodeAt(backend.tree, `source/${name8}`)), 'stray', 'the stray file is untouched');
  assert.deepEqual(codes(await intake.evaluate()), ['W-UNREGISTERED']);
});

test('R-W1: an orphan record at the name also makes the writer extend the prefix', async () => {
  const backend = await freshProject();
  const intake = await openProject(backend, tools.sdd);
  const bytes = bytesOf('real');
  const name8 = `schema-20261101T090000Z-${sha256(bytes).slice(0, 8)}.json`;
  put(backend.tree, `source/${name8}.record.jsonld`, text('{}'));
  const w = await intake.addSource({ kind: 'schema', ext: 'json', bytes, createdAt: '2026-11-01T09:00:00Z' });
  assert.equal(w.path.split('-').at(-1).length, 16 + '.json'.length);
});

test('R-W1: a retry of a completed write succeeds without creating anything', async () => {
  const backend = recordingBackend();
  await freshProject(backend);
  const intake = await openProject(backend, tools.sdd);
  const args = { kind: 'schema', ext: 'json', bytes: bytesOf('{}'), createdAt: '2026-11-01T09:00:00Z' };
  const first = await intake.addSource(args);
  const n = backend.log.length;
  assert.deepEqual(await intake.addSource(args), first);
  assert.equal(backend.log.length, n, 'the artifact and its record are found; nothing is created');
});

test('R-W1: same bytes with a different record takes a later createdAt and leaves the other record alone', async () => {
  const backend = await freshProject();
  const a = await openProject(backend, { tool: 'tool-a', version: '1' });
  const b = await openProject(backend, { tool: 'tool-b', version: '1', now: () => new Date('2026-11-01T09:00:00Z') });
  const args = { kind: 'schema', ext: 'json', bytes: bytesOf('{}') };
  const first = await a.addSource({ ...args, createdAt: '2026-11-01T09:00:00Z' });
  const recordBefore = textOf(nodeAt(backend.tree, `${first.path}.record.jsonld`));
  await rejects(b.addSource({ ...args, createdAt: '2026-11-01T09:00:00Z' }), 'E-NAME-TAKEN');
  const second = await b.addSource(args);
  assert.equal(second.path, first.path.replace('T090000Z', 'T090001Z'));
  assert.equal(textOf(nodeAt(backend.tree, `${first.path}.record.jsonld`)), recordBefore);
  assert.deepEqual(codes(await b.evaluate()), []);
});

test('R-W1: when all four prefixes are taken, a later createdAt starts again at 8 characters', async () => {
  const backend = await freshProject();
  const bytes = bytesOf('real');
  const hash = sha256(bytes);
  for (const n of [8, 16, 32, 64]) put(backend.tree, `source/schema-20261101T090000Z-${hash.slice(0, n)}.json`, text(`partial ${n}`));
  const fixed = await openProject(backend, tools.sdd);
  await rejects(fixed.addSource({ kind: 'schema', ext: 'json', bytes, createdAt: '2026-11-01T09:00:00Z' }), 'E-NAME-TAKEN');
  const clocked = await openProject(backend, { ...tools.sdd, now: () => new Date('2026-11-01T09:00:00Z') });
  const w = await clocked.addSource({ kind: 'schema', ext: 'json', bytes });
  assert.equal(w.path, `source/schema-20261101T090001Z-${hash.slice(0, 8)}.json`);
});

test('§10: interrupted after the artifact, before its record: W-UNREGISTERED, and a retry completes it', async () => {
  let fail = true;
  const backend = await freshProject(memoryBackend({ hooks: {
    beforeCreate(path) { if (fail && path.endsWith('.record.jsonld') && path.startsWith('source/')) throw new Error('power cut'); },
  } }));
  const intake = await openProject(backend, tools.sdd);
  const args = { kind: 'schema', ext: 'json', bytes: bytesOf('{}'), createdAt: '2026-11-01T09:00:00Z' };
  await assert.rejects(intake.addSource(args), /power cut/);
  assert.deepEqual(codes(await intake.evaluate()), ['W-UNREGISTERED']);
  fail = false;
  await intake.addSource(args);
  assert.deepEqual(codes(await intake.evaluate()), []);
});

test('§10: interrupted before the revision: W-UNCOMMITTED, the stage unchanged, and a retry commits', async () => {
  let fail = true;
  const backend = await freshProject(memoryBackend({ hooks: {
    beforeCreate(path) { if (fail && path.startsWith('sdd/revisions/')) throw new Error('power cut'); },
  } }));
  const { normalized } = await writeChain(backend);
  const sdd = await openProject(backend, tools.sdd);
  const args = { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"sdd":1}'),
    inputs: [{ role: 'structure', relation: 'dependency', path: normalized.artifacts[0].path }] }], createdAt: '2026-11-01T10:00:00Z' };
  await assert.rejects(sdd.commit('sdd', args), /power cut/);
  let r = await sdd.evaluate();
  assert.deepEqual([r.stages.sdd.status, codes(r)], ['empty', ['W-UNCOMMITTED']]);
  fail = false;
  await sdd.commit('sdd', args);
  r = await sdd.evaluate();
  assert.deepEqual([r.stages.sdd.status, codes(r)], ['ok', []]);
});

test('§10: a partial revision under its final name: the retry takes a later createdAt', async () => {
  let fail = true;
  const backend = await freshProject(memoryBackend({ hooks: {
    beforeCreate(path, bytes) {
      if (fail && path.startsWith('normalized/revisions/')) {
        fail = false;
        put(backend.tree, path, { type: 'file', bytes: bytes.slice(0, 50) });
        throw new Error('power cut mid-write');
      }
    },
  } }));
  const clock = () => new Date('2026-11-01T09:10:00Z');
  const intake = await openProject(backend, tools.sdd);
  await intake.addSource({ kind: 'schema', ext: 'json', bytes: bytesOf('{}'), createdAt: '2026-11-01T09:00:00Z' });
  const normalizer = await openProject(backend, { ...tools.normalizer, now: clock });
  const args = { artifacts: [{ role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic', bytes: bytesOf('{"n":1}'),
    inputs: [{ role: 'sources', collection: 'source' }] }] };
  await assert.rejects(normalizer.commit('normalized', args), /mid-write/);
  assert.deepEqual(codes(await normalizer.evaluate()), ['W-UNCOMMITTED', 'W-INTERRUPTED-REVISION']);
  const { revision } = await normalizer.commit('normalized', args);
  assert.match(revision, /rev-20261101T091001Z-/);
  const r = await normalizer.evaluate();
  assert.deepEqual([r.stages.normalized.status, codes(r)], ['ok', ['W-INTERRUPTED-REVISION']]);
});

test('R-W5: a revision that appears while writing stops the commit', async () => {
  const backend = await freshProject();
  const { content } = await writeChain(backend);
  let other;
  const sdd = await openProject({ ...backend, async create(path, bytes) {
    // Just after our artifact's record, another instance commits to the same stage.
    await backend.create(path, bytes);
    if (path.endsWith('.record.jsonld') && path.includes('T100000Z') && !other) {
      other = await openProject(backend, tools.sdd);
      await other.commit('sdd', { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"other":1}') }],
        createdAt: '2026-11-01T10:00:30Z' });
    }
  } }, tools.sdd);
  await rejects(sdd.commit('sdd', { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: content('sdd/sdd-20261101T100000Z-fa7eae25.jsonld') }],
    createdAt: '2026-11-01T10:00:00Z' }), 'STAGE-CHANGED');
  const r = await sdd.evaluate();
  assert.deepEqual([r.stages.sdd.status, codes(r)], ['ok', ['W-UNCOMMITTED']]);
});

test('§9, R-W3: a fork across machines conflicts; commits are refused until a person merges', async () => {
  const base = await freshProject();
  await writeChain(base);
  const pcA = memoryBackend({ tree: cloneTree(base.tree) });
  const pcB = memoryBackend({ tree: cloneTree(base.tree) });
  const sddArtifact = (s) => ({ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf(s) });
  const a = await (await openProject(pcA, tools.sdd)).commit('sdd', { artifacts: [sddArtifact('{"a":1}')], createdAt: '2026-11-01T10:00:00Z' });
  await (await openProject(pcB, tools.sdd)).commit('sdd', { artifacts: [sddArtifact('{"b":1}')], createdAt: '2026-11-01T10:05:00Z' });
  // Synchronization: both folders' files end up in one.
  const synced = memoryBackend({ tree: cloneTree(pcA.tree) });
  for (const [name, node] of nodeAt(pcB.tree, 'sdd').entries) if (name !== 'revisions') put(synced.tree, `sdd/${name}`, node);
  for (const [name, node] of nodeAt(pcB.tree, 'sdd/revisions').entries) put(synced.tree, `sdd/revisions/${name}`, node);
  const sdd = await openProject(synced, tools.sdd);
  assert.equal((await sdd.evaluate()).stages.sdd.status, 'conflicted');
  await rejects(sdd.commit('sdd', { artifacts: [sddArtifact('{"c":1}')] }), 'REFUSED-CONFLICTED');
  const { revision } = await sdd.merge('sdd', { current: [{ role: 'sdd', path: a.artifacts[0].path }], createdAt: '2026-11-01T11:00:00Z' });
  const r = await sdd.evaluate();
  assert.deepEqual([r.stages.sdd.status, r.stages.sdd.heads, r.stages.sdd.current, codes(r)], ['ok', [revision], [a.artifacts[0].path], []]);
  await rejects(sdd.merge('sdd', { current: [{ path: a.artifacts[0].path }] }), 'NOT-CONFLICTED');
});

test('R-W4: refused in an incomplete stage and on an invalid revision; a repair is allowed for an unresolved head', async () => {
  const sddArtifact = { role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"new":1}') };
  const incomplete = memoryBackend({ tree: example('EX-12-missing-parent') });
  await rejects((await openProject(incomplete, tools.sdd)).commit('sdd', { artifacts: [sddArtifact] }), 'REFUSED-INCOMPLETE');
  const invalid = memoryBackend({ tree: example('EX-15-wrong-responsibility') });
  await rejects((await openProject(invalid, tools.sdd)).commit('sdd', { artifacts: [sddArtifact] }), 'REFUSED-DAMAGED');

  const damaged = memoryBackend({ tree: example('EX-11-damaged-head') });
  const sdd = await openProject(damaged, tools.sdd);
  const before = await sdd.evaluate();
  const { revision } = await sdd.commit('sdd', { artifacts: [sddArtifact], createdAt: '2026-11-01T13:00:00Z' });
  const r = await sdd.evaluate();
  assert.equal(r.stages.sdd.status, 'ok');
  assert.deepEqual(r.stages.sdd.heads, [revision]);
  assert.deepEqual(JSON.parse(textOf(nodeAt(damaged.tree, revision))).parents, [before.stages.sdd.heads[0].split('-').at(-1).slice(0, 64)]);
  assert.deepEqual(codes(r), ['E-INTEGRITY'], 'the damaged artifact stays as it was');
});

test('EX-25 recovery: the artifact that lost its name is written again under a longer prefix, then merged', async () => {
  const tree = example('EX-25-sync-name-collision');
  const backend = memoryBackend({ tree });
  const sdd = await openProject(backend, tools.sdd);
  const lost = nodeAt(tree, 'sdd/sdd-20261101T120000Z-47619140-DESKTOP-B.jsonld').bytes;
  const lostRecord = JSON.parse(textOf(nodeAt(tree, 'sdd/sdd-20261101T120000Z-47619140.jsonld.record-DESKTOP-B.jsonld')));
  const w = await sdd.writeArtifact('sdd', { kind: 'sdd', ext: 'jsonld', generation: lostRecord.generation, bytes: lost,
    inputs: lostRecord.inputs.map(({ role, relation, path }) => ({ role, relation, path })) }, { createdAt: lostRecord.createdAt });
  assert.equal(w.path, `sdd/sdd-20261101T120000Z-${sha256(lost).slice(0, 16)}.jsonld`);
  await sdd.merge('sdd', { current: [{ role: 'sdd', path: w.path }], createdAt: '2026-11-01T13:00:00Z' });
  const r = await sdd.evaluate();
  assert.equal(r.stages.sdd.status, 'ok');
  assert.deepEqual(r.stages.sdd.current, [w.path]);
});

test('a history input is recorded with its hash and does not affect freshness', async () => {
  const backend = await freshProject();
  const { normalized } = await writeChain(backend);
  const sdd = await openProject(backend, tools.sdd);
  const structure = { role: 'structure', relation: 'dependency', path: normalized.artifacts[0].path };
  const first = await sdd.commit('sdd', { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"v":1}'), inputs: [structure] }],
    createdAt: '2026-11-01T10:00:00Z' });
  await sdd.commit('sdd', { artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"v":2}'),
    inputs: [structure, { role: 'previous', relation: 'history', path: first.artifacts[0].path }] }], createdAt: '2026-11-01T11:00:00Z' });
  const r = await sdd.evaluate();
  const current = r.artifacts.find((a) => a.path === r.stages.sdd.current[0]);
  assert.deepEqual([current.upToDate, current.historyVerified, current.inStageCurrent], [true, true, true]);
  const old = r.artifacts.find((a) => a.path === first.artifacts[0].path);
  assert.deepEqual([old.inStageCurrent, old.upToDate], [false, true]);
});

// A backend on which another writer commits to `stage` right after the first listing of its revisions/ returns:
// the gap between taking the revision names and evaluating, in either order (R-W5 regression).
function racingBackend(inner, stage, otherCommit) {
  let done = false;
  return {
    ...inner,
    async list(path) {
      const out = await inner.list(path);
      if (path === `${stage}/revisions` && !done) { done = true; await otherCommit(); }
      return out;
    },
  };
}

test('R-W5 regression: commit() catches a revision that appears between taking the names and evaluating', async () => {
  const backend = await freshProject();
  await writeChain(backend);
  const sddArtifact = (s) => ({ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf(s) });
  await (await openProject(backend, tools.sdd)).commit('sdd', { artifacts: [sddArtifact('{"v":1}')], createdAt: '2026-11-01T10:00:00Z' });
  const other = await openProject(backend, tools.sdd);
  const racing = racingBackend(backend, 'sdd', () =>
    other.commit('sdd', { artifacts: [sddArtifact('{"other":1}')], createdAt: '2026-11-01T10:30:00Z' }));
  const sdd = await openProject(racing, tools.sdd);
  await rejects(sdd.commit('sdd', { artifacts: [sddArtifact('{"v":2}')], createdAt: '2026-11-01T11:00:00Z' }), 'STAGE-CHANGED');
  const r = await sdd.evaluate();
  assert.equal(r.stages.sdd.status, 'ok', 'no fork: only the other writer\'s revision was added');
  assert.equal(r.stages.sdd.heads.length, 1);
  assert.equal(nodeAt(backend.tree, 'sdd/revisions').entries.size, 2);
});

test('R-W5 regression: merge() catches a revision that appears between taking the names and evaluating', async () => {
  const backend = memoryBackend({ tree: example('EX-08-stage-conflict') });
  const before = await (await openProject(backend, tools.sdd)).evaluate();
  const chosen = before.artifacts.find((a) => a.stage === 'sdd').path;
  // A third machine that saw only the base revision commits; its files arrive by synchronization mid-merge, so the
  // stage stays conflicted (now with three heads).
  const pcC = memoryBackend({ tree: example('EX-08-stage-conflict') });
  for (const head of before.stages.sdd.heads) nodeAt(pcC.tree, 'sdd/revisions').entries.delete(head.split('/').at(-1));
  await (await openProject(pcC, tools.sdd)).commit('sdd', {
    artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: bytesOf('{"c":1}') }], createdAt: '2026-11-01T12:30:00Z' });
  const arrive = async () => {
    for (const [name, node] of nodeAt(pcC.tree, 'sdd').entries) if (!nodeAt(backend.tree, `sdd/${name}`)) put(backend.tree, `sdd/${name}`, node);
    for (const [name, node] of nodeAt(pcC.tree, 'sdd/revisions').entries) put(backend.tree, `sdd/revisions/${name}`, node);
  };
  const sdd = await openProject(racingBackend(backend, 'sdd', arrive), tools.sdd);
  await rejects(sdd.merge('sdd', { current: [{ role: 'sdd', path: chosen }], createdAt: '2026-11-01T13:00:00Z' }), 'STAGE-CHANGED');
  const r = await sdd.evaluate();
  assert.deepEqual([r.stages.sdd.status, r.stages.sdd.heads.length], ['conflicted', 3], 'no merge was written');
});

for (const [label, occupant] of [['a folder', { type: 'dir', entries: new Map() }], ['a link', { type: 'other' }]]) {
  test(`R-W1 regression: a record name held by ${label} is recovered from in bounded steps, without overwriting`, { timeout: 5000 }, async () => {
    // A loop here would never yield to the timer, so a budget of backend calls makes it fail instead of hang.
    let calls = 0;
    const spend = () => { if (++calls > 500) throw new Error('more than 500 backend calls: the writer is looping'); };
    const inner = recordingBackend();
    const backend = { ...inner, async read(p) { spend(); return inner.read(p); }, async list(p) { spend(); return inner.list(p); } };
    await freshProject(backend);
    const bytes = bytesOf('{}');
    const name = `schema-20261101T090000Z-${sha256(bytes).slice(0, 8)}.json`;
    put(inner.tree, `source/${name}`, { type: 'file', bytes });
    put(inner.tree, `source/${name}.record.jsonld`, occupant);
    const n = inner.log.length;
    const fixed = await openProject(backend, tools.sdd);
    await rejects(fixed.addSource({ kind: 'schema', ext: 'json', bytes, createdAt: '2026-11-01T09:00:00Z' }), 'E-NAME-TAKEN');
    assert.equal(inner.log.length, n, 'a fixed time leaves nothing created');
    const clocked = await openProject(backend, { ...tools.sdd, now: () => new Date('2026-11-01T09:00:00Z') });
    const w = await clocked.addSource({ kind: 'schema', ext: 'json', bytes });
    assert.equal(w.path, `source/${name.replace('T090000Z', 'T090001Z')}`);
    assert.equal(nodeAt(inner.tree, `source/${name}.record.jsonld`), occupant, 'the occupant is untouched');
    assert.deepEqual(nodeAt(inner.tree, `source/${name}`).bytes, bytes, 'the artifact is untouched');
    assert.ok(inner.log.slice(n).every(([op, p]) => op === 'create' && p.includes('T090001Z')), 'only new names were created');
  });
}
} // the backends
