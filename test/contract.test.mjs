// Unit tests for the pure contract (src/contract.mjs): cases the 25 fixtures do not cover.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONTEXT_IRI, canonicalBytes, parseJson, isSafePath, parseArtifactName, parseRevisionName, checkProjectFile,
  checkRecord, evaluate, sha256, resolveFile,
} from '../src/contract.mjs';
import { treeFromDisk, cloneTree, nodeAt, put, text, textOf } from './helpers.mjs';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = (name) => treeFromDisk(join(examples, name, 'project'));
const report = (tree) => new TextDecoder().decode(canonicalBytes(evaluate(tree)));
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-000000000002';

test('sha256 agrees with node:crypto across block boundaries', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 4096]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
    assert.equal(sha256(bytes), createHash('sha256').update(bytes).digest('hex'), `length ${n}`);
  }
});

test('R-B1: canonical bytes escape as the contract states and end with one LF', () => {
  const s = new TextDecoder().decode(canonicalBytes({ a: '"\\\b\t\n\f\r\u0001\u001f é \ud800', b: [], c: {}, d: [1] }));
  assert.equal(s, '{\n  "a": "\\"\\\\\\b\\t\\n\\f\\r\\u0001\\u001f é \\ud800",\n  "b": [],\n  "c": {},\n  "d": [\n    1\n  ]\n}\n');
});

test('metadata parsing is strict: a byte-order mark or invalid UTF-8 fails', () => {
  assert.equal(parseJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])).ok, false);
  assert.equal(parseJson(new Uint8Array([0x22, 0xff, 0x22])).ok, false);
  assert.deepEqual(parseJson(new TextEncoder().encode('{}')), { ok: true, value: {} });
});

test('R-B6: safe paths', () => {
  // One segment is enough (R-B6); `sdd` is safe, though it never names a file.
  const safe = ['sdd', 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld', 'source/a', 'sdd/sub/x_y-z.txt', 'diagrams/a.b.c'];
  const unsafe = [
    '', '/sdd/x', 'sdd//x', 'sdd/./x', 'sdd/../x', '../sdd/x', 'SDD/x', 'Sdd/x', 'other/x', 'C:/sdd/x',
    'sdd\\x', 'sdd/x\\y', 'sdd/x.', 'sdd/.hidden', 'sdd/CON', 'sdd/con.txt', 'sdd/LPT9.log', 'sdd/nul', 'sdd/x y',
    'sdd/é', `sdd/${'a'.repeat(509)}`, 'sdd/x/', '//server/share',
  ];
  for (const p of safe) assert.equal(isSafePath(p), true, p);
  for (const p of unsafe) assert.equal(isSafePath(p), false, p);
  assert.equal(isSafePath(`sdd/${'a'.repeat(508)}`), true, '512 characters is the limit');
  assert.equal(isSafePath('sdd/COM10'), true, 'COM10 is not a device name');
});

test('R-B3, R-B4: name parsing', () => {
  assert.deepEqual(parseArtifactName('rdf-graph-2-20261101T100000Z-0123456789abcdef.nq'),
    { kind: 'rdf-graph-2', time: '20261101T100000Z', prefix: '0123456789abcdef', ext: 'nq' });
  for (const bad of ['sdd-20261101T100000Z-0123456789ab.json', 'SDD-20261101T100000Z-01234567.json',
    'sdd-20261101T100000Z-01234567', 'sdd-20261101T100000Z-01234567.JSON', '-20261101T100000Z-01234567.json',
    'sdd-20261101T100000Z-0123456g.json', 'sdd-20261101T100000Z-01234567.json.record.jsonld']) {
    assert.equal(parseArtifactName(bad), null, bad);
  }
  assert.equal(parseRevisionName(`rev-20261101T100000Z-${'a'.repeat(64)}.jsonld`).sha256, 'a'.repeat(64));
  assert.equal(parseRevisionName(`rev-20261101T100000Z-${'a'.repeat(32)}.jsonld`), null);
});

test('R-E1 / R-P3: project file failures, in order', () => {
  const file = (v) => ({ type: 'file', bytes: typeof v === 'string' ? new TextEncoder().encode(v) : canonicalBytes(v) });
  const good = { '@context': CONTEXT_IRI, '@id': PROJECT, '@type': 'EdgeProject', contractVersion: 2, name: 'x', createdAt: '2026-11-01T08:00:00Z' };
  assert.equal(checkProjectFile(undefined).code, 'E-NOT-A-PROJECT');
  assert.equal(checkProjectFile({ type: 'other' }).code, 'E-NOT-A-PROJECT');
  assert.equal(checkProjectFile(file('{')).code, 'E-PROJECT-INVALID');
  assert.equal(checkProjectFile(file({ ...good, '@context': 'x', contractVersion: 1 })).code, 'E-CTX-EXTERNAL');
  assert.equal(checkProjectFile(file({ ...good, contractVersion: 1 })).code, 'E-UNSUPPORTED-VERSION', 'v0.1 files are not read by v0.2');
  assert.equal(checkProjectFile(file({ ...good, name: '' })).code, 'E-PROJECT-INVALID');
  assert.equal(checkProjectFile(file({ ...good, extra: 1 })).code, 'E-PROJECT-INVALID');
  assert.equal(checkProjectFile(file(good)).ok, true);
  const r = evaluate({ type: 'dir', entries: new Map() });
  assert.deepEqual([r.valid, r.project, r.diagnostics], [false, null, [{ code: 'E-NOT-A-PROJECT', path: 'edge-project.jsonld' }]]);
});

// A valid record of EX-02's SDD, as a mutable object, and a checker for variations of it.
const sddName = 'sdd-20261101T100000Z-fa7eae25.jsonld';
const sddRecord = () => JSON.parse(textOf(nodeAt(example('EX-02-chain-ok'), `sdd/${sddName}.record.jsonld`)));
const check = (r) => checkRecord(canonicalBytes(r), { projectId: PROJECT, stage: 'sdd', name: sddName });

test('R-P4: record checks report the first failure in the contract order', () => {
  assert.equal(check(sddRecord()).ok, true);
  const unsafe = { role: 'x', relation: 'dependency', path: 'sdd/../x', sha256: 'a'.repeat(64) };
  const work = { role: 'y', relation: 'dependency', path: 'sdd/work/x', sha256: 'a'.repeat(64) };
  const cases = [
    ['foreign context beats schema', (r) => { r['@context'] = 'x'; delete r.kind; }, 'E-CTX-EXTERNAL'],
    ['schema: unknown key', (r) => { r.extra = 1; }, 'E-RECORD-INVALID'],
    ['schema: negative bytes', (r) => { r.bytes = -1; }, 'E-RECORD-INVALID'],
    ['schema: contract version', (r) => { r.contractVersion = 1; }, 'E-RECORD-INVALID'],
    ['foreign project beats name mismatch', (r) => { r.project = 'urn:uuid:00000000-0000-4000-8000-00000000000f'; r.kind = 'x'; }, 'E-FOREIGN-PROJECT'],
    ['kind disagrees with name', (r) => { r.kind = 'sdd2'; }, 'E-RECORD-INVALID'],
    ['createdAt disagrees with name', (r) => { r.createdAt = '2026-11-01T10:00:01Z'; }, 'E-RECORD-INVALID'],
    ['sha256 does not begin with the prefix', (r) => { r.sha256 = '0' + r.sha256.slice(1); }, 'E-RECORD-INVALID'],
    ['path disagrees', (r) => { r.path = 'sdd/sdd-20261101T100000Z-fa7eae25.json'; }, 'E-RECORD-INVALID'],
    ['wrong responsibility beats generation', (r) => { r.producedBy.responsibility = 'normalizer'; r.generation = 'received'; }, 'E-WRONG-RESPONSIBILITY'],
    ['received outside source', (r) => { r.generation = 'received'; }, 'E-RECORD-INVALID'],
    ['unsafe beats work', (r) => { r.inputs = [unsafe, work]; }, 'E-PATH-UNSAFE'],
    ['work input', (r) => { r.inputs = [work]; }, 'E-WORK-INPUT'],
    ['work input in another stage', (r) => { r.inputs = [{ ...work, path: 'normalized/work/x' }]; }, 'E-WORK-INPUT'],
    ['inputs not sorted by role', (r) => { r.inputs = [{ ...r.inputs[0], role: 'z' }, { ...r.inputs[0], role: 'a' }]; }, 'E-RECORD-INVALID'],
  ];
  for (const [label, change, code] of cases) {
    const r = sddRecord();
    change(r);
    assert.equal(check(r).code, code, label);
  }
});

test('R-P4.10: member lists are sorted, without duplicates, inside source/', () => {
  const m = (n) => ({ path: `source/s-20261101T090000Z-0000000${n}.json`, sha256: String(n).repeat(64) });
  const withMembers = (members) => { const r = sddRecord(); r.inputs = [{ role: 'sources', relation: 'dependency', collection: 'source', members }]; return r; };
  assert.equal(check(withMembers([m(1), m(2)])).ok, true);
  assert.equal(check(withMembers([m(2), m(1)])).code, 'E-RECORD-INVALID');
  assert.equal(check(withMembers([m(1), m(1)])).code, 'E-RECORD-INVALID');
  assert.equal(check(withMembers([{ ...m(1), path: 'sdd/s-20261101T090000Z-00000001.json' }])).code, 'E-RECORD-INVALID');
  // A collection input sorts as path "source" among inputs of the same role.
  const r = withMembers([m(1)]);
  r.inputs.push({ role: 'sources', relation: 'dependency', path: 'normalized/n-20261101T090000Z-00000001.json', sha256: '1'.repeat(64) });
  assert.equal(check(r).code, 'E-RECORD-INVALID', 'normalized/… sorts before source');
  r.inputs.reverse();
  assert.equal(check(r).ok, true);
});

test('the report does not depend on the order of folder entries', () => {
  const reverse = (node) => node.type === 'dir'
    ? { type: 'dir', entries: new Map([...node.entries].reverse().map(([k, v]) => [k, reverse(v)])) } : node;
  for (const name of ['EX-08-stage-conflict', 'EX-17-two-normalized-inputs', 'EX-24-dependency-cycle', 'EX-25-sync-name-collision']) {
    const tree = example(name);
    assert.equal(report(reverse(tree)), report(tree), name);
  }
});

test('evaluation is pure: the same tree twice, and the tree is not changed', () => {
  const tree = example('EX-10-interrupted-commit');
  const before = cloneTree(tree);
  assert.equal(report(tree), report(tree));
  assert.deepEqual(tree, before);
});

// Builds a record value for an artifact at `path` with the given inputs, as a writer would.
function artifactWithRecord(tree, stage, kind, time, content, inputs, { tool = 'test', responsibility } = {}) {
  const bytes = new TextEncoder().encode(content);
  const hash = sha256(bytes);
  const name = `${kind}-${time.replace(/[-:]/g, '')}-${hash.slice(0, 8)}.txt`;
  const record = {
    '@context': CONTEXT_IRI, '@type': 'ArtifactRecord', contractVersion: 2, project: PROJECT, stage, path: `${stage}/${name}`,
    kind, sha256: hash, bytes: bytes.length, generation: 'deterministic',
    producedBy: { responsibility, tool, version: '1' }, inputs, createdAt: time,
  };
  put(tree, `${stage}/${name}`, { type: 'file', bytes });
  put(tree, `${stage}/${name}.record.jsonld`, { type: 'file', bytes: canonicalBytes(record) });
  return { path: `${stage}/${name}`, sha256: hash };
}

test('R-E6 cycles: an artifact citing itself is on a cycle with itself', () => {
  const tree = example('EX-02-chain-ok');
  const content = 'self';
  const hash = sha256(new TextEncoder().encode(content));
  const path = `diagrams/d-20261101T110000Z-${hash.slice(0, 8)}.txt`;
  artifactWithRecord(tree, 'diagrams', 'd', '2026-11-01T11:00:00Z', content,
    [{ role: 'self', relation: 'dependency', path, sha256: hash }], { responsibility: 'diagram-exporter' });
  const a = evaluate(tree).artifacts.find((x) => x.path === path);
  // diagrams/ has no revision, so the same-stage input is also in an unsettled stage (R-E6).
  assert.deepEqual(a.staleBecause, [{ code: 'CYCLE', input: path }, { code: 'UPSTREAM-UNSETTLED', input: path }]);
  assert.deepEqual([a.upToDate, a.inStageCurrent], [false, false]);
});

test('R-E6: a long dependency chain is evaluated without exhausting the stack', () => {
  const tree = example('EX-02-chain-ok');
  let prev = { path: 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld', sha256: 'fa7eae251194bc3b01c984da8d2e5308b0fb5b00c20080b2f60203190c30576c' };
  const n = 3000;
  for (let i = 0; i < n; i++) {
    prev = artifactWithRecord(tree, 'diagrams', 'd', '2026-11-01T11:00:00Z', `link ${i}`,
      [{ role: 'up', relation: 'dependency', ...prev }], { responsibility: 'diagram-exporter' });
  }
  const r = evaluate(tree);
  assert.equal(r.artifacts.length, n + 3);
  const last = r.artifacts.find((a) => a.path === prev.path);
  assert.deepEqual(last.staleBecause.map((s) => s.code), ['UPSTREAM-OUT-OF-DATE', 'UPSTREAM-UNSETTLED']);
  assert.equal(last.upToDate, false, 'staleness is decided through 3000 links');
});

test('R-E5.1: an unparseable revision that a well-formed revision cites is damage, not an interruption', () => {
  // In EX-09 the merge revision cites both heads of EX-08. Truncate one of them.
  const tree = example('EX-09-conflict-merged');
  const revisions = nodeAt(tree, 'sdd/revisions');
  const [name] = [...revisions.entries.keys()].filter((n) => n.startsWith('rev-20261101T120501Z'));
  revisions.entries.get(name).bytes = revisions.entries.get(name).bytes.slice(0, 40);
  const r = evaluate(tree);
  assert.equal(r.stages.sdd.status, 'damaged');
  assert.ok(r.diagnostics.some((d) => d.code === 'E-REVISION-INVALID' && d.path.endsWith(name)));
  assert.ok(r.diagnostics.some((d) => d.code === 'E-MISSING-PARENT'), 'the citing revision also misses its parent');
});

test('R-E2: orphan records, links, foreign folders and a stage folder that is a link', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, 'sdd/sdd-20261101T110000Z-00000000.jsonld.record.jsonld', text('{}'));
  put(tree, 'sdd/link-to-elsewhere', { type: 'other' });
  put(tree, 'sdd/archive/old.txt', text('x'));
  put(tree, 'sdd/revisions/nested/x', text('x'));
  put(tree, 'sdd/.DS_Store', text('x'));
  put(tree, 'sdd/work/session.json', text('not json at all'));
  put(tree, 'notes', text('root-level notes are ignored'));
  tree.entries.set('rdf', { type: 'other' });
  const codes = evaluate(tree).diagnostics.map((d) => `${d.code} ${d.path}`);
  assert.deepEqual(codes, [
    'W-FOREIGN-FILE rdf',
    'W-FOREIGN-FILE sdd/archive',
    'W-FOREIGN-FILE sdd/link-to-elsewhere',
    'W-FOREIGN-FILE sdd/revisions/nested',
    'W-ORPHAN-RECORD sdd/sdd-20261101T110000Z-00000000.jsonld.record.jsonld',
  ]);
});

test('R-B6 / R-E6: inputs resolve by exact name and never through a link', () => {
  const tree = example('EX-02-chain-ok');
  const target = nodeAt(tree, 'normalized/normalized-20261101T091000Z-4c173267.json');
  put(tree, 'diagrams/cased/Normalized.json', target);
  const sha = sha256(target.bytes);
  assert.equal(resolveFile(tree, 'diagrams/cased/Normalized.json'), target);
  assert.equal(resolveFile(tree, 'diagrams/cased/normalized.json'), null);
  put(tree, 'diagrams/via', { type: 'other' });
  assert.equal(resolveFile(tree, 'diagrams/via/x'), null);
  const a = artifactWithRecord(tree, 'diagrams', 'd', '2026-11-01T11:00:00Z', 'x', [
    { role: 'a', relation: 'dependency', path: 'diagrams/cased/Normalized.json', sha256: sha },
    { role: 'b', relation: 'dependency', path: 'diagrams/cased/normalized.json', sha256: sha },
    { role: 'c', relation: 'dependency', path: 'diagrams/cased/Normalized.json', sha256: 'f'.repeat(64) },
  ], { responsibility: 'diagram-exporter' });
  const r = evaluate(tree).artifacts.find((x) => x.path === a.path);
  // A file that exists with the cited hash but is not a registered artifact is still missing.
  assert.deepEqual(r.staleBecause, [
    { code: 'INPUT-ALTERED', input: 'diagrams/cased/Normalized.json' },
    { code: 'INPUT-MISSING', input: 'diagrams/cased/Normalized.json' },
    { code: 'INPUT-MISSING', input: 'diagrams/cased/normalized.json' },
  ]);
});

test('R-E9: a history input never affects freshness', () => {
  const tree = example('EX-02-chain-ok');
  const norm = { path: 'normalized/normalized-20261101T091000Z-4c173267.json', sha256: '4c173267a5cb85aa5b8b4aa74123b78b7d874cea12df85c936a506a500b8b206' };
  const a = artifactWithRecord(tree, 'diagrams', 'd', '2026-11-01T11:00:00Z', 'h', [{ role: 'was', relation: 'history', ...norm }],
    { responsibility: 'diagram-exporter' });
  const r = evaluate(tree).artifacts.find((x) => x.path === a.path);
  assert.deepEqual([r.historyVerified, r.upToDate, r.staleBecause], [true, true, []]);
});

test('reading S2: a missing @context or contractVersion is a schema failure', () => {
  const r = sddRecord();
  delete r['@context'];
  assert.equal(check(r).code, 'E-RECORD-INVALID');
  const p = { '@context': CONTEXT_IRI, '@id': PROJECT, '@type': 'EdgeProject', name: 'x', createdAt: '2026-11-01T08:00:00Z' };
  assert.equal(checkProjectFile({ type: 'file', bytes: canonicalBytes(p) }).code, 'E-PROJECT-INVALID');
});

test('reading S4: inputs may repeat a role and path; members may not', () => {
  const r = sddRecord();
  r.inputs = [r.inputs[0], { ...r.inputs[0] }];
  assert.equal(check(r).ok, true);
});

test('reading S6: a root file named like a stage is ignored; a work file is foreign', () => {
  const tree = example('EX-02-chain-ok');
  put(tree, 'rml', text('not a folder'));
  put(tree, 'diagrams/work', text('not a folder'));
  const r = evaluate(tree);
  assert.equal(r.stages.rml.status, 'empty');
  assert.deepEqual(r.diagnostics, [{ code: 'W-FOREIGN-FILE', path: 'diagrams/work' }]);
});

test('reading S7: an unresolved single head is reported in an incomplete stage too', () => {
  const tree = example('EX-12-missing-parent');
  const revisions = nodeAt(tree, 'sdd/revisions');
  const [head] = [...revisions.entries.values()].map((n) => JSON.parse(textOf(n)));
  nodeAt(tree, head.current[0].path).bytes = new TextEncoder().encode('edited');
  const r = evaluate(tree);
  assert.equal(r.stages.sdd.status, 'damaged', 'damaged comes before incomplete (R-E5.7)');
  assert.deepEqual(r.diagnostics.map((d) => d.code).sort(), ['E-CURRENT-UNRESOLVED', 'E-INTEGRITY', 'E-MISSING-PARENT', 'W-UNCOMMITTED']);
});
