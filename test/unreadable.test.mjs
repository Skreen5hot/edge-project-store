// Unreadable files and folders (EPS v0.2, R-E10): reported with E-UNREADABLE, never a reason to stop the evaluation;
// what depends on them is not evaluable (null), unless something definite already decides it. Also the loader and the
// writer's refusals, and the Node backend's replace() retry. Git cannot store an unreadable file, so these cases have
// no example folder; they are built here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT_IRI, canonicalBytes, evaluate, sha256 } from '../src/contract.mjs';
import { isValid } from '../src/jsonschema.mjs';
import { REPORT_SCHEMA } from '../src/schemas.mjs';
import { loadTree, openProject } from '../src/project.mjs';
import { memoryBackend } from '../src/memory-backend.mjs';
import { nodeBackend } from '../src/node-backend.mjs';
import { exitCode, summary } from '../bin/eps.mjs';
import { treeFromDisk, nodeAt, put } from './helpers.mjs';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = (name) => treeFromDisk(join(examples, name, 'project'));
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-000000000002';
const N1 = 'normalized/normalized-20261101T091000Z-4c173267.json';
const D1 = 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld';
const EIO = (error = 'EIO') => ({ type: 'unreadable', error });
const codes = (r) => r.diagnostics.map((d) => d.code);
const art = (r, path) => r.artifacts.find((a) => a.path === path);
const evaluated = (tree) => {
  const r = evaluate(tree);
  assert.ok(isValid(REPORT_SCHEMA, r), 'the report matches its schema');
  return r;
};
const readdirSync0 = (tree, path) => [...nodeAt(tree, path).entries.keys()].sort();
const revisionPath = (tree, stage) => `${stage}/revisions/${[...nodeAt(tree, `${stage}/revisions`).entries.keys()][0]}`;

test('R-E10: an unreadable project file is reported with its error, and evaluation stops there', () => {
  const tree = example('EX-02-chain-ok');
  tree.entries.set('edge-project.jsonld', EIO('UNKNOWN'));
  const r = evaluated(tree);
  assert.deepEqual([r.valid, r.diagnostics], [false, [{ code: 'E-UNREADABLE', path: 'edge-project.jsonld', error: 'UNKNOWN' }]]);
});

test('R-E10: an unreadable current artifact makes its stage unevaluable, not damaged', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, D1, EIO());
  const r = evaluated(tree);
  assert.deepEqual(r.diagnostics, [{ code: 'E-UNREADABLE', path: D1, error: 'EIO' }]);
  assert.deepEqual([r.stages.sdd.status, r.stages.sdd.heads.length, r.stages.sdd.current], ['unevaluable', 1, []]);
  assert.equal(art(r, D1), undefined, 'an artifact that cannot be read is not registered');
});

test('R-E10: an unreadable record makes its artifact unknown, and what depends on it is not evaluable', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, `${N1}.record.jsonld`, EIO());
  const r = evaluated(tree);
  assert.deepEqual(codes(r), ['E-UNREADABLE']);
  assert.equal(r.stages.normalized.status, 'unevaluable');
  const d1 = art(r, D1);
  assert.deepEqual([d1.upToDate, d1.staleBecause], [null, [{ code: 'INPUT-UNREADABLE', input: N1 }]]);
  assert.equal(r.stages.sdd.status, 'ok', 'unknown freshness alone does not make a stage out of date');
});

test('R-E10: an unreadable revision makes the stage unevaluable; its artifacts are neither current nor uncommitted', () => {
  const tree = example('EX-02-chain-ok');
  const rev = revisionPath(tree, 'normalized');
  put(tree, rev, EIO());
  const r = evaluated(tree);
  assert.deepEqual(r.diagnostics, [{ code: 'E-UNREADABLE', path: rev, error: 'EIO' }], 'no W-UNCOMMITTED');
  assert.deepEqual([r.stages.normalized.status, r.stages.normalized.heads, r.stages.normalized.current], ['unevaluable', [], []]);
  assert.deepEqual([art(r, N1).inStageCurrent, art(r, N1).upToDate], [null, true]);
  assert.deepEqual(art(r, D1).staleBecause, [{ code: 'UPSTREAM-UNEVALUABLE', input: N1 }]);
  assert.equal(art(r, D1).upToDate, null);
});

test('R-E10: a parent named by an unreadable revision is present, not missing', () => {
  const tree = example('EX-09-conflict-merged');
  const revisions = nodeAt(tree, 'sdd/revisions');
  const parent = [...revisions.entries.keys()].find((n) => n.startsWith('rev-20261101T120001Z'));
  revisions.entries.set(parent, EIO());
  const r = evaluated(tree);
  assert.ok(!codes(r).includes('E-MISSING-PARENT'));
  assert.equal(r.stages.sdd.status, 'unevaluable');
});

// A source artifact whose record is readable and whose bytes are not.
function unreadableSource(tree, hhmm) {
  const project = JSON.parse(new TextDecoder().decode(nodeAt(tree, 'edge-project.jsonld').bytes))['@id'];
  const bytes = new TextEncoder().encode(`unreadable ${hhmm}`);
  const hash = sha256(bytes);
  const name = `sample-20261101T${hhmm}00Z-${hash.slice(0, 8)}.csv`;
  const record = {
    '@context': CONTEXT_IRI, '@type': 'ArtifactRecord', contractVersion: 2, project, stage: 'source', path: `source/${name}`,
    kind: 'sample', sha256: hash, bytes: bytes.length, generation: 'received',
    producedBy: { responsibility: 'intake', tool: 'test', version: '1' }, inputs: [], createdAt: `2026-11-01T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`,
  };
  put(tree, `source/${name}`, EIO());
  put(tree, `source/${name}.record.jsonld`, { type: 'file', bytes: canonicalBytes(record) });
  return `source/${name}`;
}

test('R-E10: a definite reason still decides: a source change is out of date even with an unreadable source beside it', () => {
  const tree = example('EX-03-source-added');
  const s3 = unreadableSource(tree, '1200');
  const r = evaluated(tree);
  assert.equal(r.stages.source.status, 'unevaluable');
  const n1 = art(r, N1);
  assert.equal(n1.upToDate, false);
  assert.deepEqual(n1.staleBecause.map((x) => `${x.code} ${x.input}`), ['SOURCE-CHANGED source', `INPUT-UNREADABLE ${s3}`]);
  assert.equal(art(r, D1).upToDate, false, 'UPSTREAM-OUT-OF-DATE is definite');
});

test('R-E10: with only an unreadable source, the normalized schema is not evaluable', () => {
  const tree = example('EX-02-chain-ok');
  const s2 = unreadableSource(tree, '1200');
  const r = evaluated(tree);
  assert.deepEqual([art(r, N1).upToDate, art(r, N1).staleBecause], [null, [{ code: 'INPUT-UNREADABLE', input: s2 }]]);
  assert.deepEqual(art(r, D1).staleBecause, [{ code: 'UPSTREAM-UNEVALUABLE', input: N1 }]);
});

test('R-E10: an unreadable history input leaves history not evaluable and freshness alone', () => {
  const tree = example('EX-19-sdd-rerun');
  put(tree, D1, EIO());
  const r = evaluated(tree);
  const d2 = r.artifacts.find((a) => a.stage === 'sdd' && a.path !== D1);
  assert.deepEqual([d2.upToDate, d2.historyVerified, d2.historyBecause], [true, null, [{ code: 'HISTORY-UNREADABLE', input: D1 }]]);
});

test('R-E10: unreadable files the evaluation never reads are not reported as unreadable', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, 'sdd/notes.txt', EIO());
  put(tree, 'sdd/.eps-tmp-x', EIO());
  put(tree, 'sdd/work', EIO());
  const r = evaluated(tree);
  assert.deepEqual(r.diagnostics.map((d) => `${d.code} ${d.path}`), ['W-TEMP-FILE sdd/.eps-tmp-x', 'W-FOREIGN-FILE sdd/notes.txt', 'W-FOREIGN-FILE sdd/work']);
});

test('R-E10: an unreadable stage folder is reported and the stage is unevaluable', () => {
  const tree = example('EX-02-chain-ok');
  tree.entries.set('normalized', EIO('EACCES'));
  const r = evaluated(tree);
  assert.deepEqual(r.diagnostics, [{ code: 'E-UNREADABLE', path: 'normalized', error: 'EACCES' }]);
  assert.equal(r.stages.normalized.status, 'unevaluable');
  assert.deepEqual(art(r, D1).staleBecause, [{ code: 'INPUT-UNREADABLE', input: N1 }]);
});

// A backend over a tree whose reads or listings fail for chosen paths, as an offline cloud file would.
function failing(tree, { reads = {}, lists = {} }) {
  const inner = memoryBackend({ tree });
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  return {
    ...inner,
    async read(p) { if (reads[p]) fail(reads[p]); return inner.read(p); },
    async list(p) { if (lists[p] !== undefined) fail(lists[p]); return inner.list(p); },
  };
}

test('the loader turns read and list errors into unreadable entries, so the evaluation finishes', async () => {
  const tree = example('EX-02-chain-ok');
  const r = evaluate(await loadTree(failing(tree, { reads: { [D1]: 'UNKNOWN' }, lists: { 'normalized/revisions': 'EACCES' } })));
  assert.deepEqual(r.diagnostics.map((d) => `${d.code} ${d.path} ${d.error}`), ['E-UNREADABLE normalized/revisions EACCES', `E-UNREADABLE ${D1} UNKNOWN`]);
  const root = evaluate(await loadTree(failing(tree, { lists: { '': 'EIO' } })));
  assert.deepEqual(root.diagnostics, [{ code: 'E-UNREADABLE', path: 'edge-project.jsonld', error: 'EIO' }]);
  const named = evaluate(await loadTree(failing(tree, { reads: { [D1]: undefined } })));
  assert.deepEqual(codes(named), []);
});

test('R-W4: a writer refuses an unevaluable stage, and a source collection while source/ is unevaluable', async () => {
  const sdd = { tool: 'sdd', version: '1.2.0', responsibilities: ['sdd-author'] };
  const art1 = { role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: new TextEncoder().encode('{}') };
  const tree = example('EX-02-chain-ok');
  const p = await openProject(failing(tree, { reads: { [D1]: 'EIO' } }), sdd);
  await assert.rejects(p.commit('sdd', { artifacts: [art1] }), (e) => e.code === 'REFUSED-UNEVALUABLE');
  const tree2 = example('EX-02-chain-ok');
  const s2 = unreadableSource(tree2, '1200');
  put(tree2, s2, { type: 'file', bytes: new TextEncoder().encode('present, but every read fails') });
  const backend = failing(tree2, { reads: { [s2]: 'EIO' } });
  const normalizer = await openProject(backend, { tool: 'n', version: '1', responsibilities: ['normalizer'] });
  await assert.rejects(normalizer.commit('normalized', { artifacts: [{ ...art1, role: 'normalized', kind: 'normalized', generation: 'deterministic',
    inputs: [{ role: 'sources', collection: 'source' }] }] }), (e) => e.code === 'REFUSED-UNEVALUABLE');
  assert.deepEqual(readdirSync0(tree2, 'normalized'), ['normalized-20261101T091000Z-4c173267.json', 'normalized-20261101T091000Z-4c173267.json.record.jsonld', 'revisions'], 'nothing was written');
});

test('eps: an unreadable file exits 1 with the error shown, instead of a stack trace', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, D1, EIO('UNKNOWN'));
  const r = evaluate(tree);
  assert.equal(exitCode(r), 1);
  assert.match(summary(r), /E-UNREADABLE\s+sdd\/sdd-20261101T100000Z-fa7eae25\.jsonld {2}\(UNKNOWN\)/);
  assert.match(summary(r), /sdd\s+unevaluable, 1 head/);
});

test('item 4: replace() retries a briefly locked work file, and gives up after about 1.5 seconds', async (t) => {
  const root = await fsp.mkdtemp(join(process.env.EPS_TEST_DIR ?? tmpdir(), 'eps-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let locked = 2;
  const attempts = [];
  const b = nodeBackend(root, { hooks: { beforeRename(path, attempt) {
    attempts.push(attempt);
    if (locked-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  } } });
  await b.replace('sdd/work/session.json', new TextEncoder().encode('1'));
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(await b.read('sdd/work/session.json'), new TextEncoder().encode('1'));

  const stuck = nodeBackend(root, { hooks: { beforeRename() { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } } });
  const started = Date.now();
  await assert.rejects(stuck.replace('sdd/work/session.json', new TextEncoder().encode('2')), (e) => e.code === 'EPERM');
  assert.ok(Date.now() - started >= 1400 && Date.now() - started < 5000, 'about 1.5 seconds of retries');
  assert.deepEqual(await b.read('sdd/work/session.json'), new TextEncoder().encode('1'), 'the old work file is intact');
  assert.deepEqual(readdirSync(join(root, 'sdd', 'work')), ['session.json'], 'no temporary file is left');

  const other = nodeBackend(root, { hooks: { beforeRename() { throw Object.assign(new Error('no'), { code: 'ENOSPC' }); } } });
  const t0 = Date.now();
  await assert.rejects(other.replace('sdd/work/session.json', new TextEncoder().encode('3')), (e) => e.code === 'ENOSPC');
  assert.ok(Date.now() - t0 < 500, 'other errors are not retried');
});

test('R-E10: a cited file in a subfolder that cannot be read is reported once, where it failed', () => {
  const tree = example('EX-02-chain-ok');
  const target = nodeAt(tree, N1);
  put(tree, 'normalized/archive/copy.json', target);
  put(tree, 'normalized/locked/copy.json', target);
  nodeAt(tree, 'normalized').entries.set('locked', EIO('EACCES'));
  put(tree, 'normalized/archive/copy.json', EIO());
  const hash = sha256(target.bytes);
  const bytes = new TextEncoder().encode('graph TD');
  const dHash = sha256(bytes);
  const dName = `diagram-20261101T110000Z-${dHash.slice(0, 8)}.mmd`;
  const record = {
    '@context': CONTEXT_IRI, '@type': 'ArtifactRecord', contractVersion: 2, project: PROJECT, stage: 'diagrams', path: `diagrams/${dName}`,
    kind: 'diagram', sha256: dHash, bytes: bytes.length, generation: 'deterministic',
    producedBy: { responsibility: 'diagram-exporter', tool: 'test', version: '1' },
    inputs: [
      { role: 'a', relation: 'dependency', path: 'normalized/archive/copy.json', sha256: hash },
      { role: 'b', relation: 'dependency', path: 'normalized/locked/copy.json', sha256: hash },
      { role: 'c', relation: 'history', path: 'normalized/archive/copy.json', sha256: hash },
    ],
    createdAt: '2026-11-01T11:00:00Z',
  };
  put(tree, `diagrams/${dName}`, { type: 'file', bytes });
  put(tree, `diagrams/${dName}.record.jsonld`, { type: 'file', bytes: canonicalBytes(record) });
  const r = evaluated(tree);
  assert.deepEqual(r.diagnostics.filter((d) => d.code === 'E-UNREADABLE'),
    [{ code: 'E-UNREADABLE', path: 'normalized/archive/copy.json', error: 'EIO' }, { code: 'E-UNREADABLE', path: 'normalized/locked', error: 'EACCES' }]);
  const d = art(r, `diagrams/${dName}`);
  assert.deepEqual([d.upToDate, d.historyVerified], [null, null]);
});
