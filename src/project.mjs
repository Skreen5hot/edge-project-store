// The project API: the writer rules (EPS §8) over a backend (src/memory-backend.mjs describes the interface).
// The contract itself stays in src/contract.mjs; this file only reads, decides with the contract, and creates.

import {
  CONTEXT_IRI, CONTRACT_VERSION, PROJECT_FILE, RECORD_SUFFIX, STAGES, PREFIX_LENGTHS, compare, canonicalBytes,
  sha256, parseJson, isSafePath, artifactName, revisionName, parseRevisionName, checkProjectFile, checkRecord,
  checkRevision, evaluate,
} from './contract.mjs';

const RESPONSIBILITY = new Map(STAGES.map((s) => [s.stage, s.responsibility]));
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const ROLE = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_LATER_TIMES = 60;
const PLACE_ATTEMPTS = 4;

/**
 * A writer refusal or failure. `code` is the contract's E-NAME-TAKEN (R-W1) or one of this module's own codes:
 * NOT-A-PROJECT, PROJECT-EXISTS, NOT-RESPONSIBLE, BAD-ARGUMENT, INPUT-NOT-REGISTERED, REFUSED-DAMAGED,
 * REFUSED-INCOMPLETE, REFUSED-UNEVALUABLE, REFUSED-CONFLICTED, NOT-CONFLICTED, STAGE-CHANGED.
 */
export class EpsWriteError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const later = (createdAt) => iso(new Date(Date.parse(createdAt) + 1000));
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const inWork = (path) => path.split('/')[1] === 'work';
const headHash = (headPath) => parseRevisionName(headPath.split('/').at(-1)).sha256;

// ---------------------------------------------------------------------------------------------------------------
// Reading a project into the contract's tree form

/**
 * Reads what the evaluation needs: the project file, each stage folder's files, its revisions/, and any other file
 * a record cites by a safe path outside work/. Folders are listed only when needed; dot-entries and work/ are never
 * read; `other` entries are never listed or read. A file that cannot be read, or a folder that cannot be listed,
 * becomes an `unreadable` entry with the backend's error code, so the evaluation reports it (R-E10) instead of
 * stopping.
 */
export async function loadTree(backend) {
  const tree = { type: 'dir', entries: new Map(), listed: true };
  let rootEntries;
  try {
    rootEntries = (await backend.list('')) ?? [];
  } catch (e) {
    tree.entries.set(PROJECT_FILE, { type: 'unreadable', error: errorCode(e) });
    return tree;
  }
  for (const e of rootEntries) {
    if (e.name === PROJECT_FILE) tree.entries.set(e.name, await entryNode(backend, e.name, e.type, true));
    else if (RESPONSIBILITY.has(e.name)) tree.entries.set(e.name, await entryNode(backend, e.name, e.type, false));
  }
  const readable = (name, type) => type === 'file' && !name.startsWith('.');
  for (const { stage } of STAGES) {
    const folder = tree.entries.get(stage);
    if (folder?.type !== 'dir') continue;
    await fill(backend, stage, folder, readable);
    const revisions = folder.entries?.get('revisions');
    if (stage !== 'source' && revisions?.type === 'dir') await fill(backend, `${stage}/revisions`, revisions, readable);
  }
  for (const { stage } of STAGES) {
    const folder = tree.entries.get(stage);
    if (folder?.type !== 'dir') continue;
    for (const [name, node] of [...folder.entries]) {
      if (node.type !== 'file' || node.bytes === null || !name.endsWith(RECORD_SUFFIX)) continue;
      const parsed = parseJson(node.bytes);
      const inputs = parsed.ok && Array.isArray(parsed.value?.inputs) ? parsed.value.inputs : [];
      for (const input of inputs) {
        if (isSafePath(input?.path) && !inWork(input.path)) await loadPath(backend, tree, input.path);
      }
    }
  }
  return tree;
}

// The error a backend gave, as a short code for E-UNREADABLE: Node's `code` (EIO, EACCES, ...) or a DOMException's
// `name` (NotReadableError, ...).
function errorCode(e) {
  const ok = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  return ok(e?.code) ? e.code : ok(e?.name) ? e.name : 'UNKNOWN';
}

const makeUnreadable = (node, e) => {
  for (const k of Object.keys(node)) delete node[k];
  return Object.assign(node, { type: 'unreadable', error: errorCode(e) });
};

// Lists a folder into `dir`, reading the files `read(name, type)` selects; the rest stay unread placeholders.
async function fill(backend, path, dir, read) {
  let listing;
  try {
    listing = (await backend.list(path)) ?? [];
  } catch (e) {
    makeUnreadable(dir, e);
    return;
  }
  for (const e of listing) dir.entries.set(e.name, await entryNode(backend, `${path}/${e.name}`, e.type, read(e.name, e.type)));
  dir.listed = true;
}

async function entryNode(backend, path, type, read) {
  if (type === 'dir') return { type: 'dir', entries: new Map(), listed: false };
  if (type !== 'file') return { type: 'other' };
  if (!read) return { type: 'file', bytes: null };
  try {
    const bytes = await backend.read(path);
    return bytes ? { type: 'file', bytes } : { type: 'other' };
  } catch (e) {
    return makeUnreadable({}, e);
  }
}

// Makes one cited path present in the tree, listing folders and reading the file on the way, never through `other`.
async function loadPath(backend, tree, path) {
  let node = tree, at = '';
  for (const s of path.split('/')) {
    if (node.type !== 'dir') return;
    if (!node.listed) await fill(backend, at, node, () => false);
    if (node.type !== 'dir') return;
    at = at ? `${at}/${s}` : s;
    node = node.entries.get(s);
    if (!node) return;
  }
  if (node.type === 'file' && node.bytes === null) {
    try {
      node.bytes = (await backend.read(at)) ?? new Uint8Array();
    } catch (e) {
      makeUnreadable(node, e);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Writing

/** Creates `edge-project.jsonld` (R-P2). Refuses if one exists. */
export async function createProject(backend, { id, name, createdAt }) {
  const value = { '@context': CONTEXT_IRI, '@id': id, '@type': 'EdgeProject', contractVersion: CONTRACT_VERSION, name, createdAt };
  const bytes = canonicalBytes(value);
  if (!checkProjectFile({ type: 'file', bytes }).ok) throw new EpsWriteError('BAD-ARGUMENT', 'the project file would be invalid');
  try {
    await backend.create(PROJECT_FILE, bytes);
  } catch (e) {
    if (e.code === 'EXISTS') throw new EpsWriteError('PROJECT-EXISTS', `${PROJECT_FILE} already exists`);
    throw e;
  }
}

/**
 * Opens a project for one tool. `responsibilities` are the ones it hosts (§3); any tool may add sources (R-W7).
 * `now` is the clock, read only when a call does not fix `createdAt`.
 */
export async function openProject(backend, { tool, version, responsibilities = [], now = () => new Date() }) {
  const projectBytes = await backend.read(PROJECT_FILE);
  const check = checkProjectFile(projectBytes ? { type: 'file', bytes: projectBytes } : undefined);
  if (!check.ok) throw new EpsWriteError('NOT-A-PROJECT', check.code);
  const projectId = check.project['@id'];
  const hosts = new Set(responsibilities);
  const producedBy = (stage) => ({ responsibility: RESPONSIBILITY.get(stage), tool, version });
  const timing = (createdAt) => (createdAt ? { createdAt, fixed: true } : { createdAt: iso(now()), fixed: false });
  const evaluateNow = async () => evaluate(await loadTree(backend));

  function requireStage(stage) {
    if (!RESPONSIBILITY.has(stage) || stage === 'source') throw new EpsWriteError('BAD-ARGUMENT', `stage ${stage}`);
    if (!hosts.has(RESPONSIBILITY.get(stage))) {
      throw new EpsWriteError('NOT-RESPONSIBLE', `this tool does not host ${RESPONSIBILITY.get(stage)} (§3)`);
    }
  }

  function requireSpec(a) {
    if (!(a.bytes instanceof Uint8Array)) throw new EpsWriteError('BAD-ARGUMENT', 'artifact bytes must be a Uint8Array');
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.kind ?? '') || !/^[a-z0-9]{1,10}$/.test(a.ext ?? '')) {
      throw new EpsWriteError('BAD-ARGUMENT', `kind ${a.kind} or ext ${a.ext} (R-B3)`);
    }
  }

  // The caller names inputs; their hashes always come from the evaluation (R-W6), never from the caller.
  function recordInputs(report, inputs) {
    const registered = new Map(report.artifacts.map((a) => [a.path, a]));
    const out = inputs.map((i) => {
      if (!ROLE.test(i.role ?? '')) throw new EpsWriteError('BAD-ARGUMENT', `input role ${i.role}`);
      if (i.collection === 'source') {
        if (report.stages.source.status === 'unevaluable') {
          throw new EpsWriteError('REFUSED-UNEVALUABLE', 'source/ has files that cannot be read, so its members are unknown (R-W4)');
        }
        const members = report.stages.source.current.map((path) => ({ path, sha256: registered.get(path).sha256 }));
        return { role: i.role, relation: 'dependency', collection: 'source', members };
      }
      if (i.relation !== 'dependency' && i.relation !== 'history') throw new EpsWriteError('BAD-ARGUMENT', `relation of ${i.path}`);
      if (!isSafePath(i.path) || inWork(i.path)) throw new EpsWriteError('BAD-ARGUMENT', `input path ${i.path} (R-B6, R-P4.9)`);
      const a = registered.get(i.path);
      if (!a) throw new EpsWriteError('INPUT-NOT-REGISTERED', `${i.path} is not a registered artifact`);
      return { role: i.role, relation: i.relation, path: i.path, sha256: a.sha256 };
    });
    const key = (i) => (i.collection ? 'source' : i.path);
    return out.sort((x, y) => compare(x.role, y.role) || compare(key(x), key(y)));
  }

  async function tryCreate(path, bytes) {
    try {
      await backend.create(path, bytes);
      return true;
    } catch (e) {
      if (e.code === 'EXISTS') return false;
      throw e;
    }
  }

  // R-W1 for one candidate artifact name: 'done', 'next' (try a longer prefix) or 'later' (try a later createdAt).
  // Looks again only after losing a race to another writer, and at most PLACE_ATTEMPTS times.
  async function place(stage, name, bytes, recordBytes) {
    const path = `${stage}/${name}`, recordPath = path + RECORD_SUFFIX;
    for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
      const existing = await backend.read(path);
      const taken = new Map(((await backend.list(stage)) ?? []).map((e) => [e.name, e.type]));
      if (existing === null) {
        if (taken.has(name) || taken.has(name + RECORD_SUFFIX)) return 'next'; // a non-file, or an orphan record
        if (!(await tryCreate(path, bytes))) continue; // created in between: look again
        return (await tryCreate(recordPath, recordBytes)) ? 'done' : 'later';
      }
      if (!sameBytes(existing, bytes)) return 'next';
      const existingRecord = await backend.read(recordPath);
      if (existingRecord === null) {
        // The record's name holds a folder or another non-file: it can never hold this record, and a new record
        // needs a new artifact name (R-W1, same bytes with a different record).
        if (taken.has(name + RECORD_SUFFIX)) return 'later';
        if (await tryCreate(recordPath, recordBytes)) return 'done'; // completes an interrupted write
        continue;
      }
      return sameBytes(existingRecord, recordBytes) ? 'done' : 'later';
    }
    return 'later';
  }

  /** R-W1, R-W2 steps 1–2: an artifact and its record under a free name. Returns {path, sha256}. */
  async function writeArtifact(stage, { kind, ext, bytes, generation, inputs }, { createdAt, fixed }) {
    const hash = sha256(bytes);
    let t = createdAt;
    for (let attempt = 0; attempt < MAX_LATER_TIMES; attempt++) {
      let outcome = 'next';
      for (const length of PREFIX_LENGTHS) {
        const name = artifactName(kind, t, hash, length, ext);
        const record = {
          '@context': CONTEXT_IRI, '@type': 'ArtifactRecord', contractVersion: CONTRACT_VERSION, project: projectId,
          stage, path: `${stage}/${name}`, kind, sha256: hash, bytes: bytes.length, generation,
          producedBy: producedBy(stage), inputs, createdAt: t,
        };
        const recordBytes = canonicalBytes(record);
        const own = checkRecord(recordBytes, { projectId, stage, name });
        if (!own.ok) throw new EpsWriteError('BAD-ARGUMENT', `the record would be invalid (${own.code})`);
        outcome = await place(stage, name, bytes, recordBytes);
        if (outcome === 'done') return { path: record.path, sha256: hash };
        if (outcome === 'later') break;
      }
      if (fixed) break;
      t = later(t);
    }
    throw new EpsWriteError('E-NAME-TAKEN', `no usable name for a ${kind} artifact in ${stage} (R-W1)`);
  }

  /** R-W1 for revisions: full-hash names, so a name holding different bytes needs a later time. */
  async function writeRevision(stage, { parents, current }, { createdAt, fixed }) {
    let t = createdAt;
    for (let attempt = 0; attempt < MAX_LATER_TIMES; attempt++) {
      const value = {
        '@context': CONTEXT_IRI, '@type': 'StageRevision', contractVersion: CONTRACT_VERSION, project: projectId, stage,
        parents, current, producedBy: producedBy(stage), createdAt: t,
      };
      const bytes = canonicalBytes(value);
      const hash = sha256(bytes);
      const name = revisionName(t, hash);
      const own = checkRevision(bytes, { projectId, stage, name });
      if (!own.ok) throw new EpsWriteError('BAD-ARGUMENT', `the revision would be invalid (${own.code})`);
      const path = `${stage}/revisions/${name}`;
      if (await tryCreate(path, bytes)) return path;
      const existing = await backend.read(path);
      if (existing && sameBytes(existing, bytes)) return path;
      if (fixed) break;
      t = later(t);
    }
    throw new EpsWriteError('E-NAME-TAKEN', `no usable revision name in ${stage} (R-W1)`);
  }

  // R-W3, R-W4: whether the stage accepts a revision of this kind.
  function requireWritable(report, stage, { merging }) {
    const s = report.stages[stage];
    if (s.status === 'incomplete') throw new EpsWriteError('REFUSED-INCOMPLETE', `${stage} is incomplete (R-W4)`);
    if (s.status === 'unevaluable') throw new EpsWriteError('REFUSED-UNEVALUABLE', `${stage} has files that cannot be read, so its heads are unknown (R-W4)`);
    if (s.status === 'damaged') {
      const repairable = report.diagnostics
        .filter((d) => d.path.startsWith(`${stage}/revisions/`) && d.code.startsWith('E-'))
        .every((d) => d.code === 'E-CURRENT-UNRESOLVED');
      if (!repairable) throw new EpsWriteError('REFUSED-DAMAGED', `${stage} has an invalid revision (R-W4)`);
    }
    if (s.status === 'conflicted' && !merging) {
      throw new EpsWriteError('REFUSED-CONFLICTED', `${stage} has ${s.heads.length} heads; a person must choose (R-W3)`);
    }
    if (s.status !== 'conflicted' && merging) throw new EpsWriteError('NOT-CONFLICTED', `${stage} has no conflict to merge`);
  }

  const revisionNames = async (stage) =>
    ((await backend.list(`${stage}/revisions`)) ?? []).map((e) => e.name).sort(compare).join('\n');

  // `current` of a new revision: entries [{role, path, sha256}] for registered artifacts of the stage.
  function currentEntries(report, stage, entries) {
    const byPath = new Map(report.artifacts.map((a) => [a.path, a.sha256]));
    const out = new Map();
    for (const { role = 'artifact', path, sha256: given } of entries) {
      const hash = given ?? byPath.get(path);
      if (!ROLE.test(role)) throw new EpsWriteError('BAD-ARGUMENT', `role ${role}`);
      if (!hash || !path.startsWith(`${stage}/`) || byPath.get(path) !== hash) {
        throw new EpsWriteError('INPUT-NOT-REGISTERED', `${path} is not a registered ${stage} artifact`);
      }
      out.set(path, { role, path, sha256: hash });
    }
    if (out.size === 0) throw new EpsWriteError('BAD-ARGUMENT', 'a revision makes at least one artifact current');
    return [...out.values()].sort((a, b) => compare(a.path, b.path));
  }

  // R-W2 step 3 with R-W5: write the revision only if no revision appeared since `before`.
  async function publish(stage, report, before, entries, time) {
    const current = currentEntries(await evaluateNow(), stage, entries);
    const parents = report.stages[stage].heads.map(headHash).sort(compare);
    if ((await revisionNames(stage)) !== before) {
      throw new EpsWriteError('STAGE-CHANGED', `${stage} gained a revision while writing (R-W5); evaluate again`);
    }
    return writeRevision(stage, { parents, current }, time);
  }

  return {
    projectId,
    level: backend.level,
    evaluate: evaluateNow,

    /** R-W7: adds a file to source/; no revision. Returns {path, sha256}. */
    async addSource({ kind, ext, bytes, createdAt }) {
      requireSpec({ kind, ext, bytes });
      return writeArtifact('source', { kind, ext, bytes, generation: 'received', inputs: [] }, timing(createdAt));
    },

    /**
     * R-W1–R-W2 steps 1–2 only: an artifact and its record, uncommitted until a revision lists it (for example the
     * EX-25 recovery). a: {kind, ext, bytes, generation, inputs: [{role, relation, path} | {role, collection: 'source'}]}.
     */
    async writeArtifact(stage, a, { createdAt } = {}) {
      requireStage(stage);
      requireSpec(a);
      if (a.generation !== 'deterministic' && a.generation !== 'assisted') throw new EpsWriteError('BAD-ARGUMENT', `generation ${a.generation}`);
      const report = await evaluateNow();
      return writeArtifact(stage, { ...a, inputs: recordInputs(report, a.inputs ?? []) }, timing(createdAt));
    },

    /**
     * R-W2: artifacts and their records, then one revision making them current, with `keep` ([{role, path}]) for
     * existing artifacts that stay current. artifacts: as writeArtifact, plus `role`. Returns {revision, artifacts}.
     */
    async commit(stage, { artifacts = [], keep = [], createdAt }) {
      requireStage(stage);
      // R-W5: the names are taken before the evaluation, so a revision that appears at any point after it is caught.
      const before = await revisionNames(stage);
      const report = await evaluateNow();
      requireWritable(report, stage, { merging: false });
      const time = timing(createdAt);
      // Every argument is checked before the first file is created.
      const prepared = artifacts.map((a) => {
        requireSpec(a);
        if (a.generation !== 'deterministic' && a.generation !== 'assisted') throw new EpsWriteError('BAD-ARGUMENT', `generation ${a.generation}`);
        if (!ROLE.test(a.role ?? 'artifact')) throw new EpsWriteError('BAD-ARGUMENT', `role ${a.role}`);
        return { role: a.role ?? 'artifact', spec: { ...a, inputs: recordInputs(report, a.inputs ?? []) } };
      });
      if (prepared.length + keep.length === 0) throw new EpsWriteError('BAD-ARGUMENT', 'a revision makes at least one artifact current');
      const written = [];
      for (const { role, spec } of prepared) written.push({ role, ...(await writeArtifact(stage, spec, time)) });
      const revision = await publish(stage, report, before, [...written, ...keep], time);
      return { revision, artifacts: written.map(({ path, sha256: s }) => ({ path, sha256: s })) };
    },

    /** R-W3: once a person has chosen, a merge revision whose parents are all the heads. current: [{role, path}]. */
    async merge(stage, { current, createdAt }) {
      requireStage(stage);
      const before = await revisionNames(stage); // R-W5, as in commit()
      const report = await evaluateNow();
      requireWritable(report, stage, { merging: true });
      return { revision: await publish(stage, report, before, current, timing(createdAt)) };
    },

    /** R-P6: the owning tool's work in progress. Mutable, never an input, never evaluated. */
    work: {
      async read(stage, name) {
        requireStage(stage);
        if (!SEGMENT.test(name)) throw new EpsWriteError('BAD-ARGUMENT', `work file name ${name}`);
        return backend.read(`${stage}/work/${name}`);
      },
      async write(stage, name, bytes) {
        requireStage(stage);
        if (!SEGMENT.test(name)) throw new EpsWriteError('BAD-ARGUMENT', `work file name ${name}`);
        await backend.replace(`${stage}/work/${name}`, bytes);
      },
    },
  };
}
