// The EPS v0.2 contract as pure functions: names, canonical bytes, metadata checks and the evaluation (EPS §7).
// Nothing here touches a file system, a clock or a network. The evaluation reads a **tree**, an in-memory picture
// of a project folder that a backend builds (src/project.mjs):
//
//   { type: 'dir', entries: Map<name, node> } | { type: 'file', bytes: Uint8Array } | { type: 'other' }
//   | { type: 'unreadable', error: string }
//
// `other` is anything that is neither a regular file nor a folder (a symbolic link, junction or shortcut). It is
// never followed or read (R-B6, R-E2). `unreadable` is a file that could not be read or a folder that could not be
// listed, with the error the backend gave (R-E10).

import { sha256 } from './sha256.mjs';
import { isValid } from './jsonschema.mjs';
import { PROJECT_SCHEMA, RECORD_SCHEMA, REVISION_SCHEMA } from './schemas.mjs';

export const CONTEXT_IRI = 'https://skreen5hot.github.io/edge-project-store/context/eps-v2.jsonld';
export const CONTRACT_VERSION = 2;
export const PROJECT_FILE = 'edge-project.jsonld';
export const RECORD_SUFFIX = '.record.jsonld';
export const TEMP_PREFIX = '.eps-tmp-';

/** The stage registry (EPS §3), in report order. */
export const STAGES = [
  { stage: 'source', responsibility: 'intake' },
  { stage: 'normalized', responsibility: 'normalizer' },
  { stage: 'sdd', responsibility: 'sdd-author' },
  { stage: 'rml', responsibility: 'rml-generator' },
  { stage: 'rdf', responsibility: 'rdf-generator' },
  { stage: 'graph', responsibility: 'graph-loader' },
  { stage: 'diagrams', responsibility: 'diagram-exporter' },
];
const RESPONSIBILITY = new Map(STAGES.map((s) => [s.stage, s.responsibility]));
export const PREFIX_LENGTHS = [8, 16, 32, 64];

// ---------------------------------------------------------------------------------------------------------------
// Bytes and names (EPS §4)

/** Sorting by UTF-16 code unit, as JavaScript's default sort (R-E8). */
export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** R-B1: the canonical bytes of a metadata value whose keys are already in schema order. */
export function canonicalBytes(value) {
  return encoder.encode(JSON.stringify(value, null, 2) + '\n');
}

export { sha256 };

/** Parses metadata bytes as strict UTF-8 JSON. A byte-order mark or invalid UTF-8 is a parse failure. */
export function parseJson(bytes) {
  try {
    return { ok: true, value: JSON.parse(decoder.decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

const ARTIFACT_NAME = /^([a-z0-9][a-z0-9-]{0,39})-([0-9]{8}T[0-9]{6}Z)-([0-9a-f]{8}|[0-9a-f]{16}|[0-9a-f]{32}|[0-9a-f]{64})\.([a-z0-9]{1,10})$/;
const REVISION_NAME = /^rev-([0-9]{8}T[0-9]{6}Z)-([0-9a-f]{64})\.jsonld$/;

/** R-B3: {kind, time, prefix, ext} for an artifact file name, else null. */
export function parseArtifactName(name) {
  const m = ARTIFACT_NAME.exec(name);
  return m && { kind: m[1], time: m[2], prefix: m[3], ext: m[4] };
}

/** R-B4: {time, sha256} for a revision file name, else null. */
export function parseRevisionName(name) {
  const m = REVISION_NAME.exec(name);
  return m && { time: m[1], sha256: m[2] };
}

/** `2026-11-01T10:00:00Z` → `20261101T100000Z`. */
export const timeToken = (createdAt) => createdAt.replace(/[-:]/g, '');

export const artifactName = (kind, createdAt, hash, prefixLength, ext) =>
  `${kind}-${timeToken(createdAt)}-${hash.slice(0, prefixLength)}.${ext}`;

export const revisionName = (createdAt, hash) => `rev-${timeToken(createdAt)}-${hash}.jsonld`;

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** R-B6: whether a path in metadata is safe. */
export function isSafePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return false;
  const segments = path.split('/');
  if (!RESPONSIBILITY.has(segments[0])) return false;
  return segments.every((s) => SEGMENT.test(s) && !s.endsWith('.') && !DEVICE.test(s));
}

/**
 * Resolves a safe path one exact segment at a time, never through `other` entries. Returns the file node, an
 * `unreadable` node when the file or a folder on the way could not be read, or null.
 */
export function resolvePath(tree, path) {
  return locate(tree, path).node;
}

// The node at a path and where resolution stopped (`at`: the unreadable file or folder, if any).
function locate(tree, path) {
  let node = tree, at = '';
  for (const segment of path.split('/')) {
    if (node?.type === 'unreadable') return { node, at };
    if (node?.type !== 'dir') return { node: null, at };
    node = node.entries.get(segment);
    at = at ? `${at}/${segment}` : segment;
  }
  return { node: node?.type === 'file' || node?.type === 'unreadable' ? node : null, at };
}

/** The file node at a safe path, or null (unreadable counts as absent). */
export function resolveFile(tree, path) {
  const node = resolvePath(tree, path);
  return node?.type === 'file' ? node : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Metadata checks (EPS §5)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const foreignContext = (v) => isObject(v) && Object.hasOwn(v, '@context') && v['@context'] !== CONTEXT_IRI;
const isSorted = (list, key, strict) =>
  list.every((x, i) => i === 0 || (strict ? compare(key(list[i - 1]), key(x)) < 0 : compare(key(list[i - 1]), key(x)) <= 0));

/** R-E1 / R-P2 / R-P3: {ok: true, project} or {ok: false, code}. */
export function checkProjectFile(node) {
  if (node?.type === 'unreadable') return { ok: false, code: 'E-UNREADABLE', error: node.error };
  if (node?.type !== 'file') return { ok: false, code: 'E-NOT-A-PROJECT' };
  const parsed = parseJson(node.bytes);
  if (!parsed.ok) return { ok: false, code: 'E-PROJECT-INVALID' };
  const v = parsed.value;
  if (foreignContext(v)) return { ok: false, code: 'E-CTX-EXTERNAL' };
  if (isObject(v) && Object.hasOwn(v, 'contractVersion') && v.contractVersion !== CONTRACT_VERSION) {
    return { ok: false, code: 'E-UNSUPPORTED-VERSION' };
  }
  if (!isValid(PROJECT_SCHEMA, v)) return { ok: false, code: 'E-PROJECT-INVALID' };
  return { ok: true, project: v };
}

const inWork = (path) => path.split('/')[1] === 'work';

/**
 * R-P4: checks a record, in the contract's order. `stage` is the folder it lies in and `name` its artifact's file
 * name. Returns {ok: true, record} or {ok: false, code}.
 */
export function checkRecord(bytes, { projectId, stage, name }) {
  const parsed = parseJson(bytes);
  if (!parsed.ok) return { ok: false, code: 'E-RECORD-INVALID' };
  const r = parsed.value;
  if (foreignContext(r)) return { ok: false, code: 'E-CTX-EXTERNAL' };
  if (!isValid(RECORD_SCHEMA, r)) return { ok: false, code: 'E-RECORD-INVALID' };
  if (r.project !== projectId) return { ok: false, code: 'E-FOREIGN-PROJECT' };
  const n = parseArtifactName(name);
  if (r.stage !== stage || r.path !== `${stage}/${name}` || r.kind !== n.kind || timeToken(r.createdAt) !== n.time ||
      !r.sha256.startsWith(n.prefix)) {
    return { ok: false, code: 'E-RECORD-INVALID' };
  }
  if (r.producedBy.responsibility !== RESPONSIBILITY.get(stage)) return { ok: false, code: 'E-WRONG-RESPONSIBILITY' };
  const isSource = stage === 'source';
  if (isSource ? r.generation !== 'received' || r.inputs.length > 0 : r.generation === 'received') {
    return { ok: false, code: 'E-RECORD-INVALID' };
  }
  const artifactInputs = r.inputs.filter((i) => !Object.hasOwn(i, 'collection'));
  if (!artifactInputs.every((i) => isSafePath(i.path))) return { ok: false, code: 'E-PATH-UNSAFE' };
  if (artifactInputs.some((i) => inWork(i.path))) return { ok: false, code: 'E-WORK-INPUT' };
  const inputKey = (i) => [i.role, Object.hasOwn(i, 'collection') ? 'source' : i.path];
  const sortedInputs = r.inputs.every((x, i) => {
    if (i === 0) return true;
    const [ra, pa] = inputKey(r.inputs[i - 1]), [rb, pb] = inputKey(x);
    return compare(ra, rb) < 0 || (ra === rb && compare(pa, pb) <= 0);
  });
  const membersOk = r.inputs.every((i) => !Object.hasOwn(i, 'collection') ||
    (isSorted(i.members, (m) => m.path, true) && i.members.every((m) => m.path.startsWith('source/'))));
  if (!sortedInputs || !membersOk) return { ok: false, code: 'E-RECORD-INVALID' };
  return { ok: true, record: r };
}

/**
 * R-P5: checks a revision file in `stage`'s revisions folder. Returns {ok: true, revision}, {ok: false, code}, or
 * {ok: false, unparsed: true} when the bytes are not JSON (R-E5.1 decides what that means).
 */
export function checkRevision(bytes, { projectId, stage, name }) {
  const parsed = parseJson(bytes);
  if (!parsed.ok) return { ok: false, unparsed: true, code: 'E-REVISION-INVALID' };
  const v = parsed.value;
  if (foreignContext(v)) return { ok: false, code: 'E-CTX-EXTERNAL' };
  if (!isValid(REVISION_SCHEMA, v)) return { ok: false, code: 'E-REVISION-INVALID' };
  if (v.project !== projectId) return { ok: false, code: 'E-FOREIGN-PROJECT' };
  const n = parseRevisionName(name);
  if (v.stage !== stage || timeToken(v.createdAt) !== n.time || sha256(bytes) !== n.sha256 ||
      !isSorted(v.parents, (p) => p, true) ||
      !v.current.every((c) => c.path.startsWith(`${stage}/`)) || !isSorted(v.current, (c) => c.path, false)) {
    return { ok: false, code: 'E-REVISION-INVALID' };
  }
  if (v.producedBy.responsibility !== RESPONSIBILITY.get(stage)) return { ok: false, code: 'E-WRONG-RESPONSIBILITY' };
  return { ok: true, revision: v };
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation (EPS §7)

const UNSETTLED = new Set(['damaged', 'incomplete', 'conflicted', 'empty']);
// Reasons that say a value could not be evaluated, rather than that it is wrong (R-E10).
const INDEFINITE = new Set(['INPUT-UNREADABLE', 'UPSTREAM-UNEVALUABLE', 'HISTORY-UNREADABLE']);

// Three-valued verdict: false on any definite reason, null when only indefinite ones remain, true otherwise.
const verdict = (reasons) => (reasons.some((r) => !INDEFINITE.has(r.code)) ? false : reasons.length ? null : true);
const byInputThenCode = (x, y) => compare(x.input, y.input) || compare(x.code, y.code);
const unique = (reasons) => reasons.filter((r, i) => reasons.findIndex((q) => q.code === r.code && q.input === r.input) === i);

function reportHead(project, valid) {
  return { '@context': CONTEXT_IRI, '@type': 'ProjectReport', contractVersion: CONTRACT_VERSION, project, valid };
}

/** Evaluates a project tree and returns its ProjectReport (EPS §7), with keys in canonical order. */
export function evaluate(tree) {
  const projectNode = tree?.type === 'dir' ? tree.entries.get(PROJECT_FILE) : undefined;
  const projectCheck = checkProjectFile(projectNode);
  if (!projectCheck.ok) {
    const d = { code: projectCheck.code, path: PROJECT_FILE };
    if (projectCheck.error) d.error = projectCheck.error;
    return { ...reportHead(null, false), stages: {}, artifacts: [], diagnostics: [d] };
  }
  const projectId = projectCheck.project['@id'];
  const diagnostics = [];
  const diag = (code, path) => diagnostics.push({ code, path });
  const unreadable = (path, node) => diagnostics.push({ code: 'E-UNREADABLE', path, error: node.error });

  // R-E2, R-E3, R-E10: classify each stage folder; register artifacts.
  const registered = new Map(); // path → {stage, record}
  const unknown = new Map(); // artifact path → its record's sha256, or null: present but not evaluable (R-E10)
  const revisionFiles = new Map(); // stage → [{name, path, node}]
  const folderUnreadable = new Set(); // stages whose folder or revisions/ could not be listed
  for (const { stage } of STAGES) {
    revisionFiles.set(stage, []);
    const folder = tree.entries.get(stage);
    if (folder === undefined || folder.type === 'file') continue;
    if (folder.type === 'unreadable') { unreadable(stage, folder); folderUnreadable.add(stage); continue; }
    if (folder.type !== 'dir') { diag('W-FOREIGN-FILE', stage); continue; }
    const records = new Map();
    const artifacts = [];
    const isContent = (node) => node.type === 'file' || node.type === 'unreadable';
    for (const [name, node] of folder.entries) {
      const path = `${stage}/${name}`;
      if (name.startsWith(TEMP_PREFIX)) diag('W-TEMP-FILE', path);
      else if (name.startsWith('.')) continue;
      else if (name === 'work' && node.type === 'dir') continue;
      else if (node.type === 'other') diag('W-FOREIGN-FILE', path);
      else if (name === 'revisions' && stage !== 'source' && node.type === 'dir') classifyRevisions(stage, node);
      else if (name === 'revisions' && stage !== 'source' && node.type === 'unreadable') { unreadable(path, node); folderUnreadable.add(stage); }
      else if (isContent(node) && parseArtifactName(name)) artifacts.push(name);
      else if (isContent(node) && name.endsWith(RECORD_SUFFIX) && parseArtifactName(name.slice(0, -RECORD_SUFFIX.length))) {
        records.set(name.slice(0, -RECORD_SUFFIX.length), node);
      } else diag('W-FOREIGN-FILE', path);
    }
    for (const [artifact] of records) {
      if (!artifacts.includes(artifact)) diag('W-ORPHAN-RECORD', `${stage}/${artifact}${RECORD_SUFFIX}`);
    }
    for (const name of artifacts) {
      const path = `${stage}/${name}`;
      const recordNode = records.get(name);
      if (!recordNode) { diag('W-UNREGISTERED', path); continue; }
      if (recordNode.type === 'unreadable') { unreadable(path + RECORD_SUFFIX, recordNode); unknown.set(path, null); continue; }
      const check = checkRecord(recordNode.bytes, { projectId, stage, name });
      if (!check.ok) { diag(check.code, path + RECORD_SUFFIX); continue; }
      const node = folder.entries.get(name);
      if (node.type === 'unreadable') { unreadable(path, node); unknown.set(path, check.record.sha256); continue; }
      if (sha256(node.bytes) !== check.record.sha256 || node.bytes.length !== check.record.bytes) { diag('E-INTEGRITY', path); continue; }
      registered.set(path, { stage, record: check.record });
    }
  }

  function classifyRevisions(stage, dir) {
    for (const [name, node] of dir.entries) {
      const path = `${stage}/revisions/${name}`;
      if (name.startsWith(TEMP_PREFIX)) diag('W-TEMP-FILE', path);
      else if (name.startsWith('.')) continue;
      else if ((node.type === 'file' || node.type === 'unreadable') && parseRevisionName(name)) revisionFiles.get(stage).push({ name, path, node });
      else diag('W-FOREIGN-FILE', path);
    }
  }

  // R-E4: source membership. An unknown source file is neither a member nor a non-member.
  const sourceMembers = [...registered].filter(([, a]) => a.stage === 'source')
    .map(([path, a]) => ({ path, sha256: a.record.sha256 })).sort((a, b) => compare(a.path, b.path));
  const sourceUnknown = [...unknown.keys()].filter((p) => p.startsWith('source/')).sort(compare);
  const sourceEvaluable = !folderUnreadable.has('source') && sourceUnknown.length === 0;

  // R-E5: revision graph, heads and the settled part of each stage's status.
  const stageState = new Map(); // stage → {status, heads, current: Set, headCurrent, known}
  stageState.set('source', {
    status: !sourceEvaluable ? 'unevaluable' : sourceMembers.length ? 'ok' : 'empty',
    heads: [], current: new Set(sourceMembers.map((m) => m.path)), headCurrent: [], known: true,
  });
  const committed = new Set(); // `${path} ${sha256}` listed by any well-formed revision
  for (const { stage } of STAGES.slice(1)) {
    const wellFormed = new Map(); // revision sha256 → {path, revision}
    const unreadableIds = new Set(); // identities named by revision files that could not be read
    const unparsed = [];
    let damaged = false;
    let graphKnown = !folderUnreadable.has(stage);
    for (const f of revisionFiles.get(stage)) {
      const identity = parseRevisionName(f.name).sha256;
      if (f.node.type === 'unreadable') { unreadable(f.path, f.node); unreadableIds.add(identity); graphKnown = false; continue; }
      const check = checkRevision(f.node.bytes, { projectId, stage, name: f.name });
      if (check.ok) wellFormed.set(identity, { path: f.path, revision: check.revision });
      else if (check.unparsed) unparsed.push(f);
      else { diag(check.code, f.path); damaged = true; }
    }
    const cited = new Set();
    for (const { revision } of wellFormed.values()) for (const p of revision.parents) cited.add(p);
    for (const f of unparsed) {
      // R-E5.1: identity is the hash the revision's name carries (R-B4), which is what parents cite.
      if (cited.has(parseRevisionName(f.name).sha256)) { diag('E-REVISION-INVALID', f.path); damaged = true; }
      else diag('W-INTERRUPTED-REVISION', f.path);
    }
    let incomplete = false;
    for (const { path, revision } of wellFormed.values()) {
      for (const c of revision.current) committed.add(`${c.path} ${c.sha256}`);
      // A parent named by an unreadable file is present, only not readable (R-E10).
      if (revision.parents.some((p) => !wellFormed.has(p) && !unreadableIds.has(p))) { diag('E-MISSING-PARENT', path); incomplete = true; }
    }
    const heads = [...wellFormed].filter(([sha]) => !cited.has(sha)).map(([, r]) => r).sort((a, b) => compare(a.path, b.path));
    let currentKnown = graphKnown;
    if (graphKnown && heads.length === 1) {
      const states = heads[0].revision.current.map((c) => {
        if (registered.get(c.path)?.record.sha256 === c.sha256) return 'resolved';
        if (unknown.has(c.path) && (unknown.get(c.path) === null || unknown.get(c.path) === c.sha256)) return 'unknown';
        return 'unresolved';
      });
      if (states.includes('unresolved')) { diag('E-CURRENT-UNRESOLVED', heads[0].path); damaged = true; }
      else if (states.includes('unknown')) currentKnown = false;
    } else if (graphKnown && heads.length > 1) diag('E-STAGE-CONFLICT', stage);
    const status = damaged ? 'damaged' : incomplete ? 'incomplete' : !currentKnown ? 'unevaluable'
      : heads.length > 1 ? 'conflicted' : wellFormed.size === 0 ? 'empty' : 'settled';
    stageState.set(stage, {
      status,
      heads: graphKnown ? heads.map((h) => h.path) : [],
      current: status === 'settled' ? new Set(heads[0].revision.current.map((c) => c.path)) : new Set(),
      headCurrent: status === 'settled' ? heads[0].revision.current.map((c) => c.path) : [],
      known: graphKnown,
    });
  }
  for (const [path, a] of registered) {
    // R-E5.9, only where every revision file of the stage could be read.
    if (a.stage !== 'source' && stageState.get(a.stage).known && !committed.has(`${path} ${a.record.sha256}`)) diag('W-UNCOMMITTED', path);
  }

  // R-E6: resolve inputs; the dependency inputs that resolve are the edges of the dependency graph.
  const reportedUnreadable = new Set(diagnostics.filter((d) => d.code === 'E-UNREADABLE').map((d) => d.path));
  const resolution = (input) => {
    const { node, at } = locate(tree, input.path);
    if (node?.type === 'unreadable') {
      // R-E10: a cited file (or a folder on the way) that cannot be read is reported once, where it failed.
      if (!reportedUnreadable.has(at)) { reportedUnreadable.add(at); unreadable(at, node); }
      return 'UNREADABLE';
    }
    if (node && sha256(node.bytes) !== input.sha256) return 'ALTERED';
    if (registered.get(input.path)?.record.sha256 === input.sha256) return 'OK';
    if (unknown.has(input.path) && (unknown.get(input.path) === null || unknown.get(input.path) === input.sha256)) return 'UNREADABLE';
    return 'MISSING';
  };
  const deps = new Map(); // path → [{input, state}]
  for (const [path, a] of registered) {
    deps.set(path, a.record.inputs.filter((i) => !Object.hasOwn(i, 'collection') && i.relation === 'dependency')
      .map((input) => ({ input, state: resolution(input) })));
  }
  const edges = (path) => deps.get(path).filter((d) => d.state === 'OK').map((d) => d.input.path);
  const scc = stronglyConnected([...registered.keys()].sort(compare), edges);

  // Components sinks first (Tarjan's emission order), so every non-cyclic input is decided before it is used.
  const stale = new Map();
  const upToDate = new Map();
  for (const component of scc.components) {
    for (const path of component) {
      const a = registered.get(path);
      const reasons = [];
      for (const { input, state } of deps.get(path)) {
        if (state !== 'OK') { reasons.push({ code: `INPUT-${state}`, input: input.path }); continue; }
        const inputStage = registered.get(input.path).stage;
        if (inputStage !== 'source') {
          const s = stageState.get(inputStage);
          if (UNSETTLED.has(s.status)) reasons.push({ code: 'UPSTREAM-UNSETTLED', input: input.path });
          else if (s.status === 'unevaluable') reasons.push({ code: 'UPSTREAM-UNEVALUABLE', input: input.path });
          else if (!s.current.has(input.path) && inputStage !== a.stage) reasons.push({ code: 'INPUT-SUPERSEDED', input: input.path });
        }
        if (scc.index.get(input.path) === scc.index.get(path)) reasons.push({ code: 'CYCLE', input: input.path });
        else if (upToDate.get(input.path) === false) reasons.push({ code: 'UPSTREAM-OUT-OF-DATE', input: input.path });
        else if (upToDate.get(input.path) === null) reasons.push({ code: 'UPSTREAM-UNEVALUABLE', input: input.path });
      }
      for (const input of a.record.inputs.filter((i) => Object.hasOwn(i, 'collection'))) {
        const key = (m) => `${m.path} ${m.sha256}`;
        const known = (m) => !sourceUnknown.includes(m.path);
        const cited = new Set(input.members.filter(known).map(key));
        const current = new Set(sourceMembers.map(key));
        const added = sourceMembers.filter((m) => !cited.has(key(m)));
        const removed = input.members.filter((m) => known(m) && !current.has(key(m))).map((m) => ({ path: m.path, sha256: m.sha256 }));
        if (added.length || removed.length) reasons.push({ code: 'SOURCE-CHANGED', input: 'source', added, removed });
        if (folderUnreadable.has('source')) reasons.push({ code: 'INPUT-UNREADABLE', input: 'source' });
        for (const p of sourceUnknown) reasons.push({ code: 'INPUT-UNREADABLE', input: p });
      }
      const sorted = unique(reasons).sort(byInputThenCode);
      stale.set(path, sorted);
      upToDate.set(path, verdict(sorted));
    }
  }

  // R-E5.7: out-of-date or ok, now that freshness is known. Unknown freshness alone does not make a stage out of date.
  for (const [stage, s] of stageState) {
    if (stage !== 'source' && s.status === 'settled') s.status = s.headCurrent.some((p) => upToDate.get(p) === false) ? 'out-of-date' : 'ok';
  }

  // R-E9 and the report entry, per registered artifact.
  const artifacts = [...registered.keys()].sort(compare).map((path) => {
    const a = registered.get(path);
    const s = stageState.get(a.stage);
    const historyBecause = [];
    for (const input of a.record.inputs.filter((i) => i.relation === 'history')) {
      const state = resolution(input);
      if (state !== 'OK') historyBecause.push({ code: `HISTORY-${state}`, input: input.path });
    }
    const history = unique(historyBecause).sort(byInputThenCode);
    return {
      path, sha256: a.record.sha256, stage: a.stage,
      inStageCurrent: a.stage === 'source' ? true : s.status === 'unevaluable' ? null : s.current.has(path),
      upToDate: upToDate.get(path), staleBecause: stale.get(path),
      historyVerified: verdict(history), historyBecause: history,
    };
  });

  const stages = {};
  for (const { stage } of STAGES) {
    const s = stageState.get(stage);
    const current = stage === 'source' ? sourceMembers.map((m) => m.path) : s.status === 'ok' || s.status === 'out-of-date' ? s.headCurrent : [];
    stages[stage] = { status: s.status, heads: s.heads, current };
  }
  diagnostics.sort((x, y) => compare(x.path, y.path) || compare(x.code, y.code));
  return { ...reportHead(projectId, true), stages, artifacts, diagnostics };
}

/** Tarjan's algorithm, iterative. Components come out sinks first; `index` maps each node to its component. */
function stronglyConnected(nodes, edges) {
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [], components = [], componentOf = new Map();
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [{ node: root, next: 0, targets: null }];
    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.targets === null) {
        frame.targets = edges(frame.node);
        index.set(frame.node, counter); low.set(frame.node, counter); counter++;
        stack.push(frame.node); onStack.add(frame.node);
      }
      if (frame.next < frame.targets.length) {
        const t = frame.targets[frame.next++];
        if (!index.has(t)) work.push({ node: t, next: 0, targets: null });
        else if (onStack.has(t)) low.set(frame.node, Math.min(low.get(frame.node), index.get(t)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        let n;
        do { n = stack.pop(); onStack.delete(n); component.push(n); componentOf.set(n, components.length); } while (n !== frame.node);
        components.push(component);
      }
    }
  }
  return { components, index: componentOf };
}
