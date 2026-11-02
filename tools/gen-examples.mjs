// Reference generator for the contract examples (EPS §13).
//
// Builds each example project folder by construction and writes the report a conforming reader must produce.
// Every expected report below is stated by hand from spec/edge-project-contract.md; this file never evaluates a
// folder, so it is not an implementation of EPS §7. Paths and hashes in the expected reports are filled in from the
// files this generator wrote.
//
//   node tools/gen-examples.mjs           write examples/
//   node tools/gen-examples.mjs --check   regenerate in memory and compare with examples/ (exit 1 on any difference)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples');
const CTX = 'https://skreen5hot.github.io/edge-project-store/context/eps-v1.jsonld';
const STAGES = ['source', 'normalized', 'sdd', 'rml', 'rdf', 'graph', 'diagrams'];

const enc = new TextEncoder();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => enc.encode(JSON.stringify(value, null, 2) + '\n'); // R-B1

const BY = {
  intake: { responsibility: 'intake', tool: 'example-intake', version: '0.1.0' },
  normalizer: { responsibility: 'normalizer', tool: 'example-normalizer', version: '0.1.0' },
  sdd: { responsibility: 'sdd-author', tool: 'sdd', version: '1.1.0' },
  diagrams: { responsibility: 'diagram-exporter', tool: 'example-diagrams', version: '0.1.0' },
};
const STAGE_OF = { intake: 'source', normalizer: 'normalized', sdd: 'sdd', diagrams: 'diagrams' };

/** hhmmss on 2026-11-01 → { name: '20261101T090000Z', at: '2026-11-01T09:00:00Z' }. */
function time(hhmmss) {
  const [h, m, s] = [hhmmss.slice(0, 2), hhmmss.slice(2, 4), hhmmss.slice(4, 6)];
  return { name: `20261101T${h}${m}${s}Z`, at: `2026-11-01T${h}:${m}:${s}Z` };
}

class Project {
  constructor(n, { name = `Example ${n}` } = {}) {
    this.files = new Map(); // project-relative path -> Uint8Array
    this.id = `urn:uuid:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    this.put('edge-project.jsonld', canonical({
      '@context': CTX, '@id': this.id, '@type': 'EdgeProject', contractVersion: 1, name,
      createdAt: '2026-11-01T08:00:00Z',
    }));
  }
  put(path, bytes) { this.files.set(path, typeof bytes === 'string' ? enc.encode(bytes) : bytes); }
  remove(path) { if (!this.files.delete(path)) throw new Error(`no such file: ${path}`); }

  /** An artifact and its record (R-B3, R-P4). `by` names a producer in BY; `stage` defaults to its own. */
  artifact(by, kind, ext, hhmmss, content, { inputs = [], stage = STAGE_OF[by], generation } = {}) {
    const t = time(hhmmss);
    const bytes = enc.encode(content);
    const hash = sha256(bytes);
    const path = `${stage}/${kind}-${t.name}-${hash.slice(0, 8)}.${ext}`;
    this.put(path, bytes);
    this.put(`${path}.record.jsonld`, canonical({
      '@context': CTX, '@type': 'ArtifactRecord', contractVersion: 1, project: this.id, stage, path, kind,
      sha256: hash, bytes: bytes.length,
      generation: generation ?? (stage === 'source' ? 'received' : by === 'sdd' ? 'assisted' : 'deterministic'),
      producedBy: BY[by], inputs, createdAt: t.at,
    }));
    return { path, sha256: hash, record: `${path}.record.jsonld` };
  }

  /** A stage revision (R-B4, R-P5). */
  revision(by, hhmmss, parents, current, { stage = STAGE_OF[by] } = {}) {
    const t = time(hhmmss);
    const bytes = canonical({
      '@context': CTX, '@type': 'StageRevision', contractVersion: 1, project: this.id, stage,
      parents: parents.map((r) => r.sha256).sort(),
      current: current.map(([role, a]) => ({ role, path: a.path, sha256: a.sha256 }))
        .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
      producedBy: BY[by], createdAt: t.at,
    });
    const hash = sha256(bytes);
    const path = `${stage}/revisions/rev-${t.name}-${hash.slice(0, 8)}.jsonld`;
    this.put(path, bytes);
    return { path, sha256: hash };
  }
}

// Input references for records.
const use = (role, a) => ({ role, path: a.path, sha256: a.sha256 });
const sources = (...members) => ({ role: 'sources', collection: 'source', members: members.map((m) => m.sha256).sort() });

// Report builders: formatting only. Every verdict is passed in literally.
function report(p, { stages = {}, artifacts = [], diagnostics = [] } = {}) {
  const st = {};
  for (const s of STAGES) st[s] = stages[s] ?? { status: 'empty', heads: [], current: [] };
  return {
    '@context': CTX, '@type': 'ProjectReport', contractVersion: 1, project: p.id, valid: true, stages: st,
    artifacts: [...artifacts].sort((a, b) => (a.path < b.path ? -1 : 1)),
    diagnostics: [...diagnostics].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : 1)),
  };
}
const stage = (status, heads = [], current = []) => ({
  status, heads: heads.map((r) => r.path).sort(), current: current.map((a) => a.path).sort(),
});
function art(a, { cur, up = true, stale = [], ready, notReady = [] }) {
  return {
    path: a.path, sha256: a.sha256, stage: a.path.split('/')[0], inStageCurrent: cur, upToDate: up,
    staleBecause: stale, pipelineReady: ready, notReadyBecause: notReady,
  };
}
const src = (a) => art(a, { cur: true, ready: null });
const why = (code, input, extra = {}) => ({ code, input: typeof input === 'string' ? input : input.path, ...extra });
const diag = (code, path) => ({ code, path: typeof path === 'string' ? path : path.path });

/** The base chain: one source schema → normalized → SDD, all committed. */
function chain(p) {
  const s1 = p.artifact('intake', 'schema', 'json', '090000', '{"objectTypes":["Organization","Site"]}\n');
  const n1 = p.artifact('normalizer', 'normalized', 'json', '091000',
    '{"normalized":1,"types":["Organization","Site"]}\n', { inputs: [sources(s1)] });
  const rN1 = p.revision('normalizer', '091001', [], [['normalized', n1]]);
  const d1 = p.artifact('sdd', 'sdd', 'jsonld', '100000', '{"sdd":1,"structure":"normalized-1"}\n',
    { inputs: [use('structure', n1)] });
  const rD1 = p.revision('sdd', '100001', [], [['sdd', d1]]);
  return { s1, n1, rN1, d1, rD1 };
}

const EXAMPLES = [
  ['01-empty-project', 'A project with no stages yet.', 'R-P2, R-E4, R-E5.7', (p) => report(p)],

  ['02-chain-ok', 'Source → normalized → SDD, all current; the SDD is pipeline-ready.', 'R-E3–R-E8', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('ok', [rD1], [d1]) },
      artifacts: [src(s1), art(n1, { cur: true, ready: true }), art(d1, { cur: true, ready: true })],
    });
  }],

  ['03-source-added', 'A source file added after normalization: the normalized schema and the SDD are out of date, recursively.', 'R-E4, R-E6 (SOURCE-CHANGED, UPSTREAM-OUT-OF-DATE)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const s2 = p.artifact('intake', 'schema', 'json', '110000', '{"objectTypes":["Organization","Site","Asset"]}\n');
    return report(p, {
      stages: { source: stage('ok', [], [s1, s2]), normalized: stage('out-of-date', [rN1], [n1]), sdd: stage('out-of-date', [rD1], [d1]) },
      artifacts: [
        src(s1), src(s2),
        art(n1, { cur: true, up: false, stale: [why('SOURCE-CHANGED', 'source', { added: [s2.sha256], removed: [] })], ready: false, notReady: ['OUT-OF-DATE'] }),
        art(d1, { cur: true, up: false, stale: [why('UPSTREAM-OUT-OF-DATE', n1)], ready: false, notReady: ['OUT-OF-DATE'] }),
      ],
    });
  }],

  ['04-source-removed', 'A source file (and its record) deleted after normalization.', 'R-W7, R-E6 (SOURCE-CHANGED)', (p) => {
    const s1 = p.artifact('intake', 'schema', 'json', '090000', '{"objectTypes":["Organization","Site"]}\n');
    const s2 = p.artifact('intake', 'sample', 'csv', '090500', 'Name,Site\nAcme,North\n');
    const n1 = p.artifact('normalizer', 'normalized', 'json', '091000', '{"normalized":1,"types":["Organization","Site"],"samples":1}\n', { inputs: [sources(s1, s2)] });
    const rN1 = p.revision('normalizer', '091001', [], [['normalized', n1]]);
    const d1 = p.artifact('sdd', 'sdd', 'jsonld', '100000', '{"sdd":1,"structure":"normalized-1"}\n', { inputs: [use('structure', n1)] });
    const rD1 = p.revision('sdd', '100001', [], [['sdd', d1]]);
    p.remove(s2.path); p.remove(s2.record);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('out-of-date', [rN1], [n1]), sdd: stage('out-of-date', [rD1], [d1]) },
      artifacts: [
        src(s1),
        art(n1, { cur: true, up: false, stale: [why('SOURCE-CHANGED', 'source', { added: [], removed: [s2.sha256] })], ready: false, notReady: ['OUT-OF-DATE'] }),
        art(d1, { cur: true, up: false, stale: [why('UPSTREAM-OUT-OF-DATE', n1)], ready: false, notReady: ['OUT-OF-DATE'] }),
      ],
    });
  }],

  ['05-source-altered', 'A source file edited in place: an integrity error, and it is no longer a member.', 'R-E3 (E-INTEGRITY), R-E4, R-E6', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    p.put(s1.path, '{"objectTypes":["Organization","Site","Edited"]}\n');
    return report(p, {
      stages: { source: stage('empty'), normalized: stage('out-of-date', [rN1], [n1]), sdd: stage('out-of-date', [rD1], [d1]) },
      artifacts: [
        art(n1, { cur: true, up: false, stale: [why('SOURCE-CHANGED', 'source', { added: [], removed: [s1.sha256] })], ready: false, notReady: ['OUT-OF-DATE'] }),
        art(d1, { cur: true, up: false, stale: [why('UPSTREAM-OUT-OF-DATE', n1)], ready: false, notReady: ['OUT-OF-DATE'] }),
      ],
      diagnostics: [diag('E-INTEGRITY', s1)],
    });
  }],

  ['06-normalized-superseded', 'A new normalized schema is committed; the SDD built on the old one is out of date.', 'R-E5.8, R-E6 (INPUT-SUPERSEDED), R-E7 (NOT-CURRENT)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const n2 = p.artifact('normalizer', 'normalized', 'json', '120000', '{"normalized":2,"types":["Organization","Site"]}\n', { inputs: [sources(s1)] });
    const rN2 = p.revision('normalizer', '120001', [rN1], [['normalized', n2]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN2], [n2]), sdd: stage('out-of-date', [rD1], [d1]) },
      artifacts: [
        src(s1),
        art(n1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(n2, { cur: true, ready: true }),
        art(d1, { cur: true, up: false, stale: [why('INPUT-SUPERSEDED', n1)], ready: false, notReady: ['OUT-OF-DATE'] }),
      ],
    });
  }],

  ['07-sdd-provisional', 'An SDD built straight from a source schema: up to date, but not pipeline-ready.', 'R-E7 (NO-STRUCTURAL-ROOT)', (p) => {
    const s1 = p.artifact('intake', 'schema', 'json', '090000', '{"objectTypes":["Organization","Site"]}\n');
    const d1 = p.artifact('sdd', 'sdd', 'jsonld', '100000', '{"sdd":1,"structure":"source"}\n', { inputs: [use('structure', s1)] });
    const rD1 = p.revision('sdd', '100001', [], [['sdd', d1]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), sdd: stage('ok', [rD1], [d1]) },
      artifacts: [src(s1), art(d1, { cur: true, ready: false, notReady: ['NO-STRUCTURAL-ROOT'] })],
    });
  }],

  ['08-stage-conflict', 'Two revisions written from the same head (for example on two synchronized PCs).', 'R-E5.4, R-E5.6 (E-STAGE-CONFLICT), §9', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const d2 = p.artifact('sdd', 'sdd', 'jsonld', '120000', '{"sdd":2,"by":"pc-a"}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    const rA = p.revision('sdd', '120001', [rD1], [['sdd', d2]]);
    const d3 = p.artifact('sdd', 'sdd', 'jsonld', '120500', '{"sdd":2,"by":"pc-b"}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    const rB = p.revision('sdd', '120501', [rD1], [['sdd', d3]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('conflicted', [rA, rB]) },
      artifacts: [
        src(s1), art(n1, { cur: true, ready: true }),
        art(d1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d2, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d3, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
      ],
      diagnostics: [diag('E-STAGE-CONFLICT', 'sdd')],
    });
  }],

  ['09-conflict-merged', 'The conflict of EX-08 resolved by a merge revision naming both heads.', 'R-W3', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const d2 = p.artifact('sdd', 'sdd', 'jsonld', '120000', '{"sdd":2,"by":"pc-a"}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    const rA = p.revision('sdd', '120001', [rD1], [['sdd', d2]]);
    const d3 = p.artifact('sdd', 'sdd', 'jsonld', '120500', '{"sdd":2,"by":"pc-b"}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    const rB = p.revision('sdd', '120501', [rD1], [['sdd', d3]]);
    const rM = p.revision('sdd', '130000', [rA, rB], [['sdd', d3]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('ok', [rM], [d3]) },
      artifacts: [
        src(s1), art(n1, { cur: true, ready: true }),
        art(d1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d2, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d3, { cur: true, ready: true }),
      ],
    });
  }],

  ['10-interrupted-commit', 'Leftovers of interrupted writes: a temporary file, an uncommitted artifact and a truncated revision. What is current does not change.', '§10, R-E2 (W-TEMP-FILE), R-E5.1 (W-INTERRUPTED-REVISION), R-E5.9 (W-UNCOMMITTED)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const d2 = p.artifact('sdd', 'sdd', 'jsonld', '120000', '{"sdd":2}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    p.put('sdd/.eps-tmp-7d3f0a', '{"sdd":3');
    // The revision the writer meant to create, cut off mid-write. Its name carries the intended file's hash.
    const intended = p.revision('sdd', '120001', [rD1], [['sdd', d2]]);
    const full = p.files.get(intended.path);
    p.put(intended.path, full.slice(0, 60));
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('ok', [rD1], [d1]) },
      artifacts: [
        src(s1), art(n1, { cur: true, ready: true }), art(d1, { cur: true, ready: true }),
        art(d2, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
      ],
      diagnostics: [diag('W-TEMP-FILE', 'sdd/.eps-tmp-7d3f0a'), diag('W-INTERRUPTED-REVISION', intended), diag('W-UNCOMMITTED', d2)],
    });
  }],

  ['11-damaged-head', 'The current SDD edited in place: integrity error, and the stage is damaged.', 'R-E3 (E-INTEGRITY), R-E5.5 (E-CURRENT-UNRESOLVED)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    p.put(d1.path, '{"sdd":1,"structure":"normalized-1","edited":true}\n');
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('damaged', [rD1]) },
      artifacts: [src(s1), art(n1, { cur: true, ready: true })],
      diagnostics: [diag('E-CURRENT-UNRESOLVED', rD1), diag('E-INTEGRITY', d1)],
    });
  }],

  ['12-missing-parent', 'A revision whose parent has not arrived (sync lag) or was deleted: the stage is incomplete.', 'R-E5.3 (E-MISSING-PARENT), R-E5.9', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const d2 = p.artifact('sdd', 'sdd', 'jsonld', '120000', '{"sdd":2}\n', { inputs: [use('previous', d1), use('structure', n1)] });
    const rD2 = p.revision('sdd', '120001', [rD1], [['sdd', d2]]);
    p.remove(rD1.path);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('incomplete', [rD2]) },
      artifacts: [
        src(s1), art(n1, { cur: true, ready: true }),
        art(d1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d2, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
      ],
      diagnostics: [diag('E-MISSING-PARENT', rD2), diag('W-UNCOMMITTED', d1)],
    });
  }],

  ['13-foreign-context', 'edge-project.jsonld names a context other than the bundled one; evaluation stops.', 'R-P1 (E-CTX-EXTERNAL), R-E1', (p) => {
    chain(p);
    const doc = JSON.parse(new TextDecoder().decode(p.files.get('edge-project.jsonld')));
    doc['@context'] = 'https://example.org/ctx.jsonld';
    p.put('edge-project.jsonld', canonical(doc));
    return {
      '@context': CTX, '@type': 'ProjectReport', contractVersion: 1, project: null, valid: false, stages: {},
      artifacts: [], diagnostics: [diag('E-CTX-EXTERNAL', 'edge-project.jsonld')],
    };
  }],

  ['14-foreign-files', 'A sync-conflict copy, a user note and an unregistered file: reported and never used.', '§9, R-E2 (W-FOREIGN-FILE), R-E3 (W-UNREGISTERED)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const copy = rD1.path.replace(/\.jsonld$/, '-DESKTOP-1.jsonld');
    p.put(copy, p.files.get(rD1.path));
    p.put('source/notes.txt', 'Exported from the test system.\n');
    const loose = enc.encode('{"objectTypes":["Loose"]}\n');
    const loosePath = `source/schema-20261101T150000Z-${sha256(loose).slice(0, 8)}.json`;
    p.put(loosePath, loose);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('ok', [rD1], [d1]) },
      artifacts: [src(s1), art(n1, { cur: true, ready: true }), art(d1, { cur: true, ready: true })],
      diagnostics: [diag('W-FOREIGN-FILE', copy), diag('W-FOREIGN-FILE', 'source/notes.txt'), diag('W-UNREGISTERED', loosePath)],
    });
  }],

  ['15-wrong-responsibility', 'A revision in sdd/ written under another stage\'s responsibility: the stage is damaged.', 'R-P5, R-E5.2 (E-WRONG-RESPONSIBILITY)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const bad = p.revision('normalizer', '120001', [rD1], [['sdd', d1]], { stage: 'sdd' });
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('damaged', [rD1]) },
      artifacts: [src(s1), art(n1, { cur: true, ready: true }), art(d1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] })],
      diagnostics: [diag('E-WRONG-RESPONSIBILITY', bad)],
    });
  }],

  ['16-work-input', 'A diagram whose record cites a work-in-progress file: the record is invalid.', 'R-P4.8 (E-WORK-INPUT), R-P6', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    p.put('sdd/work/session.json', '{"open":["Site"]}\n');
    const g1 = p.artifact('diagrams', 'diagram', 'mmd', '110000', 'classDiagram\n  Organization --> Site\n',
      { inputs: [use('model', d1), { role: 'notes', path: 'sdd/work/session.json', sha256: sha256(p.files.get('sdd/work/session.json')) }] });
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN1], [n1]), sdd: stage('ok', [rD1], [d1]) },
      artifacts: [src(s1), art(n1, { cur: true, ready: true }), art(d1, { cur: true, ready: true })],
      diagnostics: [diag('E-WORK-INPUT', g1.record)],
    });
  }],

  ['17-structural-root-mismatch', 'A diagram combining an SDD and a different normalized schema.', 'R-E7 (STRUCTURAL-ROOT-MISMATCH)', (p) => {
    const s1 = p.artifact('intake', 'schema', 'json', '090000', '{"objectTypes":["Organization","Site"]}\n');
    const s2 = p.artifact('intake', 'schema', 'json', '090500', '{"objectTypes":["Asset"]}\n');
    const n1 = p.artifact('normalizer', 'normalized', 'json', '091000', '{"normalized":1,"types":["Organization","Site"]}\n', { inputs: [use('source', s1)] });
    const n2 = p.artifact('normalizer', 'normalized', 'json', '091500', '{"normalized":1,"types":["Asset"]}\n', { inputs: [use('source', s2)] });
    const rN1 = p.revision('normalizer', '092000', [], [['normalized', n1], ['normalized', n2]]);
    const d1 = p.artifact('sdd', 'sdd', 'jsonld', '100000', '{"sdd":1,"structure":"normalized-1"}\n', { inputs: [use('structure', n1)] });
    const rD1 = p.revision('sdd', '100001', [], [['sdd', d1]]);
    const g1 = p.artifact('diagrams', 'diagram', 'mmd', '110000', 'classDiagram\n  Organization --> Asset\n', { inputs: [use('model', d1), use('structure', n2)] });
    const rG1 = p.revision('diagrams', '110001', [], [['diagram', g1]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1, s2]), normalized: stage('ok', [rN1], [n1, n2]), sdd: stage('ok', [rD1], [d1]), diagrams: stage('ok', [rG1], [g1]) },
      artifacts: [
        src(s1), src(s2), art(n1, { cur: true, ready: true }), art(n2, { cur: true, ready: true }),
        art(d1, { cur: true, ready: true }),
        art(g1, { cur: true, ready: false, notReady: ['STRUCTURAL-ROOT-MISMATCH'] }),
      ],
    });
  }],

  ['18-upstream-conflicted', 'The normalized stage is in conflict; the SDD that depends on it cannot be up to date.', 'R-E6 (UPSTREAM-UNSETTLED)', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const n2 = p.artifact('normalizer', 'normalized', 'json', '120000', '{"normalized":2,"by":"pc-a"}\n', { inputs: [sources(s1)] });
    const rA = p.revision('normalizer', '120001', [rN1], [['normalized', n2]]);
    const n3 = p.artifact('normalizer', 'normalized', 'json', '120500', '{"normalized":2,"by":"pc-b"}\n', { inputs: [sources(s1)] });
    const rB = p.revision('normalizer', '120501', [rN1], [['normalized', n3]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('conflicted', [rA, rB]), sdd: stage('out-of-date', [rD1], [d1]) },
      artifacts: [
        src(s1),
        art(n1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(n2, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(n3, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(d1, { cur: true, up: false, stale: [why('UPSTREAM-UNSETTLED', n1)], ready: false, notReady: ['OUT-OF-DATE'] }),
      ],
      diagnostics: [diag('E-STAGE-CONFLICT', 'normalized')],
    });
  }],

  ['19-sdd-rerun', 'An SDD rerun on a new normalized schema, citing the previous SDD as history: the new SDD is ready.', 'R-E6 (same-stage input), R-E7', (p) => {
    const { s1, n1, rN1, d1, rD1 } = chain(p);
    const n2 = p.artifact('normalizer', 'normalized', 'json', '120000', '{"normalized":2,"types":["Organization","Site"]}\n', { inputs: [sources(s1)] });
    const rN2 = p.revision('normalizer', '120001', [rN1], [['normalized', n2]]);
    const d2 = p.artifact('sdd', 'sdd', 'jsonld', '130000', '{"sdd":2,"structure":"normalized-2"}\n', { inputs: [use('previous', d1), use('structure', n2)] });
    const rD2 = p.revision('sdd', '130001', [rD1], [['sdd', d2]]);
    return report(p, {
      stages: { source: stage('ok', [], [s1]), normalized: stage('ok', [rN2], [n2]), sdd: stage('ok', [rD2], [d2]) },
      artifacts: [
        src(s1),
        art(n1, { cur: false, ready: false, notReady: ['NOT-CURRENT'] }),
        art(n2, { cur: true, ready: true }),
        art(d1, { cur: false, up: false, stale: [why('INPUT-SUPERSEDED', n1)], ready: false, notReady: ['OUT-OF-DATE', 'NOT-CURRENT'] }),
        art(d2, { cur: true, ready: true }),
      ],
    });
  }],
];

// ---------------------------------------------------------------------------------------------------------------

function build() {
  const out = new Map(); // examples-relative path -> bytes
  const index = ['# Contract examples', '',
    'Synthetic project folders for [`../spec/edge-project-contract.md`](../spec/edge-project-contract.md). Each `EX-nn`',
    'folder holds `project/` (the folder to evaluate) and `expected.jsonld` (the ProjectReport a conforming reader must',
    'produce, byte for byte). Generated by [`../tools/gen-examples.mjs`](../tools/gen-examples.mjs); do not edit by hand.', '',
    '| Example | What it shows | Rules |', '|---|---|---|'];
  for (const [slug, what, rules, make] of EXAMPLES) {
    const n = Number(slug.slice(0, 2));
    const p = new Project(n);
    const expected = make(p);
    const dir = `EX-${slug}`;
    for (const [path, bytes] of p.files) out.set(`${dir}/project/${path}`, bytes);
    out.set(`${dir}/expected.jsonld`, canonical(expected));
    index.push(`| [EX-${slug.slice(0, 2)}](EX-${slug}/) ${slug.slice(3)} | ${what} | ${rules} |`);
  }
  out.set('README.md', enc.encode(index.join('\n') + '\n'));
  return out;
}

function listFiles(dir, base = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
  });
}

const files = build();
if (process.argv.includes('--check')) {
  const onDisk = new Set(listFiles(OUT));
  const problems = [];
  for (const [rel, bytes] of files) {
    if (!onDisk.has(rel)) { problems.push(`missing: ${rel}`); continue; }
    if (sha256(readFileSync(join(OUT, rel))) !== sha256(bytes)) problems.push(`differs: ${rel}`);
    onDisk.delete(rel);
  }
  for (const rel of onDisk) problems.push(`unexpected: ${rel}`);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`ok: ${EXAMPLES.length} examples, ${files.size} files match`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [rel, bytes] of files) {
    mkdirSync(dirname(join(OUT, rel)), { recursive: true });
    writeFileSync(join(OUT, rel), bytes);
  }
  console.log(`wrote ${EXAMPLES.length} examples, ${files.size} files`);
}
