// The browser test page (M2-h, and the real-browser half of M2-d and M2-e): runs the browser backend against a real
// folder through the real File System Access API. Bundled into browser/eps-browser-tests.html by tools/gen-pages.mjs,
// with the 25 examples inside it, so it needs no network and nothing installed.
//
// Everything is written inside a new folder, `eps-browser-test-<time>` or `two-page-…`/`race-…`, in the folder the
// person picks; nothing outside it is touched. `?auto=opfs` runs the automatic tests in the browser's private
// storage instead of a picked folder, for checking the page itself.

import { evaluate, canonicalBytes, sha256, artifactName, TEMP_PREFIX } from '../src/contract.mjs';
import { loadTree, createProject, openProject } from '../src/project.mjs';
import { browserBackend } from '../src/browser-backend.mjs';
import { summary } from '../src/summary.mjs';
import { folderAccess, explainFolderError } from './access.mjs';
import { EXAMPLES } from 'virtual:examples';

const $ = (id) => document.getElementById(id);
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const codes = (r) => r.diagnostics.map((d) => d.code);
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-0000000000b1';
const TOOLS = {
  intake: { tool: 'eps-browser-tests', version: '1' },
  normalizer: { tool: 'eps-browser-tests', version: '1', responsibilities: ['normalizer'] },
  sdd: { tool: 'eps-browser-tests', version: '1', responsibilities: ['sdd-author'] },
};
const results = [];
let scratch = null; // the folder the person picked (or the private storage in auto mode)

// ---------------------------------------------------------------------------------------------- helpers

async function newFolder(parent, prefix) {
  const name = `${prefix}-${stamp()}`;
  for await (const n of parent.keys()) if (n === name) throw new Error(`${name} already exists; try again in a second`);
  return parent.getDirectoryHandle(name, { create: true });
}

// Writes a file directly (not through the backend), retrying an interrupted write as the backend does, and keeps
// count: {writes, retries, ms (all writes), slowest}. `raw.once` is the plain write, without retries.
const rawStats = { writes: 0, retries: 0, ms: 0, slowest: 0 };
async function writeRaw(root, path, bytes) {
  const parts = path.split('/');
  let dir = root;
  for (const s of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const w = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
      break;
    } catch (e) {
      if (!['InvalidStateError', 'NoModificationAllowedError'].includes(e?.name) || attempt >= 5) throw e;
      rawStats.retries++;
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
  }
  const ms = performance.now() - t0;
  rawStats.writes++;
  rawStats.ms += ms;
  rawStats.slowest = Math.max(rawStats.slowest, ms);
}
const timing = (st) => `${st.writes} writes, ${st.retries} interrupted write(s) retried, ${Math.round(st.ms / Math.max(1, st.writes))} ms each on average, slowest ${Math.round(st.slowest)} ms`;

// The backend with each create and replace timed, for the same figures.
function timedBackend(dir) {
  const b = browserBackend(dir);
  const st = { writes: 0, ms: 0, slowest: 0 };
  const timed = (fn) => async (...args) => {
    const t0 = performance.now();
    try { return await fn(...args); } finally { const ms = performance.now() - t0; st.writes++; st.ms += ms; st.slowest = Math.max(st.slowest, ms); }
  };
  return Object.assign(b, { create: timed(b.create), replace: timed(b.replace), timing: () => timing({ ...st, retries: b.stats.retries }) });
}

async function readRaw(root, path) {
  const parts = path.split('/');
  let dir = root;
  for (const s of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(s);
  return new Uint8Array(await (await (await dir.getFileHandle(parts.at(-1))).getFile()).arrayBuffer());
}

async function* walk(dir, prefix = '') {
  for await (const [name, h] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    yield [path, h];
    if (h.kind === 'directory') yield* walk(h, path);
  }
}

// The longest path, in characters below the test folder, at which `write(dir, name)` succeeds: descends through
// 50-character folders while a 200-character name can be written, then searches for the longest name that can.
// {longest, limited}: the longest file path that was written; stops looking at about 800 characters.
async function longestPath(start, startRel, write) {
  let dir = start, rel = startRel, longest = 0;
  const attempt = async (name) => {
    try { await write(dir, name); } catch { return false; }
    longest = Math.max(longest, rel.length + 1 + name.length);
    return true;
  };
  for (let depth = 0; rel.length < 800; depth++) {
    const probe = await attempt(`p${depth}-`.padEnd(200, 'x'));
    if (probe) {
      const sub = `d${depth}-`.padEnd(50, 'x');
      let next = null;
      try { next = await dir.getDirectoryHandle(sub, { create: true }); } catch { /* too deep for a folder */ }
      if (next) { dir = next; rel = `${rel}/${sub}`; continue; }
    }
    // The longest name that works in this folder: between 200 and 255 if the probe worked, else below 200.
    let lo = probe ? 200 : 0, hi = probe ? 255 : 199;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (await attempt(`n${mid}-`.padEnd(mid, 'y').slice(0, mid))) lo = mid; else hi = mid - 1;
    }
    return { longest, limited: true };
  }
  return { longest, limited: false };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const example = (name) => EXAMPLES.find((e) => e.name === name);
const fixtureFile = (ex, path) => fromBase64(ex.files.find(([p]) => p === path)[1]);

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const row = document.createElement('tr');
  row.innerHTML = `<td class="${ok ? 'ok' : 'bad'}">${ok ? 'pass' : 'FAIL'}</td><td></td><td></td>`;
  row.children[1].textContent = name;
  row.children[2].textContent = detail;
  $('rows').append(row);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? '');
  } catch (e) {
    record(name, false, e?.stack ?? String(e));
  }
}

function expect(cond, what) { if (!cond) throw new Error(what); }

// EX-02's chain written through the project API, with the fixture's own contents and times.
async function writeEx02(backend) {
  const ex = example('EX-02-chain-ok');
  const read = (p) => fixtureFile(ex, p);
  const sourceTool = JSON.parse(dec(read('source/schema-20261101T090000Z-67daa493.json.record.jsonld'))).producedBy;
  await createProject(backend, { id: 'urn:uuid:00000000-0000-4000-8000-000000000002', name: 'Example 2', createdAt: '2026-11-01T08:00:00Z' });
  await (await openProject(backend, sourceTool)).addSource({ kind: 'schema', ext: 'json', bytes: read('source/schema-20261101T090000Z-67daa493.json'), createdAt: '2026-11-01T09:00:00Z' });
  await (await openProject(backend, { tool: 'example-normalizer', version: '0.1.0', responsibilities: ['normalizer'] })).commit('normalized', {
    createdAt: '2026-11-01T09:10:00Z', artifacts: [{ role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic',
      bytes: read('normalized/normalized-20261101T091000Z-4c173267.json'), inputs: [{ role: 'sources', collection: 'source' }] }] });
  await (await openProject(backend, { tool: 'sdd', version: '1.1.0', responsibilities: ['sdd-author'] })).commit('sdd', {
    createdAt: '2026-11-01T10:00:00Z', artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted',
      bytes: read('sdd/sdd-20261101T100000Z-fa7eae25.jsonld'),
      inputs: [{ role: 'structure', relation: 'dependency', path: 'normalized/normalized-20261101T091000Z-4c173267.json' }] }] });
  return ex;
}

// ---------------------------------------------------------------------------------------------- automatic tests

async function runAutomatic(root) {
  results.length = 0;
  $('rows').textContent = '';
  const run = await newFolder(root, 'eps-browser-test');
  $('run').textContent = `Writing inside ${run.name}.`;

  await check('backend interface: create, refuse an existing name, replace a work file, list, read', async () => {
    const b = browserBackend(await run.getDirectoryHandle('interface', { create: true }));
    expect(b.level === 'checked', 'level is checked');
    expect(await b.read('a/b.txt') === null && await b.list('a') === null, 'absent files and folders read as null');
    await b.create('a/b.txt', enc('one'));
    let refused = null;
    try { await b.create('a/b.txt', enc('two')); } catch (e) { refused = e.code; }
    expect(refused === 'EXISTS', `a second create is refused with EXISTS (got ${refused})`);
    expect(dec(await b.read('a/b.txt')) === 'one', 'a refused create changes nothing');
    await b.replace('a/work/w.txt', enc('1'));
    await b.replace('a/work/w.txt', enc('2'));
    expect(dec(await b.read('a/work/w.txt')) === '2', 'replace overwrites a work file');
    const names = (await b.list('a')).map((e) => `${e.name}:${e.type}`).sort().join(', ');
    expect(names === 'b.txt:file, work:dir', `no temporary file is left (${names})`);
    return `move() used ${b.stats.move} time(s), direct writes ${b.stats.direct}`;
  });

  await check('M2-h, measured: the longest path this browser can write in the test folder', async () => {
    // Below the picked folder (the browser does not reveal the folder's own path): files written directly, as a
    // simple tool would, and through the EPS backend (a short temporary file, then move()).
    const dir = await run.getDirectoryHandle('len', { create: true });
    const raw = await longestPath(await dir.getDirectoryHandle('raw', { create: true }), `${run.name}/len/raw`,
      async (d, name) => writeRaw(d, name, enc('x')));
    const eps = await longestPath(await dir.getDirectoryHandle('eps', { create: true }), `${run.name}/len/eps`,
      async (d, name) => browserBackend(d).create(name, enc('x')));
    const show = (x) => (x.limited ? `up to ${x.longest}` : `at least ${x.longest} (no limit found)`);
    return `below the test folder: written directly ${show(raw)} characters; through the EPS backend ${show(eps)} characters `
      + `[raw${raw.limited ? '=' : '>='}${raw.longest}] [eps${eps.limited ? '=' : '>='}${eps.longest}]`;
  });

  await check('M2-h conformance: every example read through the real API equals its expected report', async () => {
    Object.assign(rawStats, { writes: 0, retries: 0, ms: 0, slowest: 0 });
    // The examples are copied to short paths (e/02, e/03, …): this test is about reading, not path length.
    const dir = await run.getDirectoryHandle('e', { create: true });
    const failed = [];
    for (const ex of EXAMPLES) {
      const short = ex.name.slice(3, 5);
      const root = await dir.getDirectoryHandle(short, { create: true });
      for (const [path, b64] of ex.files) {
        try {
          await writeRaw(root, path, fromBase64(b64));
        } catch (e) {
          const rel = `${run.name}/e/${short}/${path}`;
          throw new Error(`copying ${ex.name}/${path} failed (${e?.name}: ${e?.message}); it is ${rel.length} characters below the test folder`);
        }
      }
      const report = evaluate(await loadTree(browserBackend(root)));
      if (dec(canonicalBytes(report)) !== ex.expected) failed.push(ex.name);
    }
    expect(EXAMPLES.length === 25, `25 examples (found ${EXAMPLES.length})`);
    expect(!failed.length, `differs from expected.jsonld: ${failed.join(', ')}`);
    return `${EXAMPLES.length} of ${EXAMPLES.length} equal, byte for byte. Copying them: ${timing(rawStats)}`;
  });

  await check('M2-h writer: EX-02 written through the real API reproduces the fixture', async () => {
    const root = await run.getDirectoryHandle('writer-ex02', { create: true });
    const b = timedBackend(root);
    const ex = await writeEx02(b);
    let n = 0;
    for (const [path] of ex.files.filter(([p]) => /^(source|normalized|sdd)\/[^/]+$/.test(p) || p === 'edge-project.jsonld')) {
      expect(same(await readRaw(root, path), fixtureFile(ex, path)), `${path} equals the fixture`);
      n++;
    }
    const r = evaluate(await loadTree(b));
    expect(codes(r).length === 0 && r.stages.sdd.status === 'ok', `clean (${codes(r).join(', ')})`);
    return `${n} files equal the fixture; the project is clean; move() ${b.stats.move}, direct ${b.stats.direct}. Writing them through the EPS backend: ${b.timing()}`;
  });

  await check('same origin: two writers racing for the same names never overwrite each other (Web Locks)', async () => {
    const dir = await run.getDirectoryHandle('race-same-origin', { create: true });
    const a = browserBackend(dir), b = browserBackend(dir);
    const count = 20;
    const attempt = (w, label, i) => w.create(`race/r-${i}.txt`, enc(`${label} ${i}`)).then(() => label, (e) => { if (e.code !== 'EXISTS') throw e; return null; });
    for (let i = 0; i < count; i++) {
      const won = (await Promise.all([attempt(a, 'A', i), attempt(b, 'B', i)])).filter(Boolean);
      expect(won.length === 1, `r-${i}.txt has exactly one winner (${won.join(', ') || 'none'})`);
      expect(dec(await a.read(`race/r-${i}.txt`)) === `${won[0]} ${i}`, `the winner's bytes survive in r-${i}.txt`);
    }
    return `${count} names, one winner each, its bytes intact`;
  });

  await check('M2-d (3), measured: what move() does onto a name that exists', async () => {
    const dir = await run.getDirectoryHandle('move-probe', { create: true });
    await writeRaw(dir, 'target.txt', enc('first'));
    await writeRaw(dir, 'moving.txt', enc('second'));
    const moving = await dir.getFileHandle('moving.txt');
    if (typeof moving.move !== 'function') return 'this browser has no move(): the backend checks, then writes the final name directly';
    try {
      await moving.move(dir, 'target.txt');
    } catch (e) {
      const kept = dec(await readRaw(dir, 'target.txt'));
      return `REFUSED with ${e?.name}; the existing file kept "${kept}"`;
    }
    return `REPLACED: the existing file now holds "${dec(await readRaw(dir, 'target.txt'))}" (a write in the check-to-move window is lost and must be detected)`;
  });

  await check('M2-e: a file the browser cannot read is reported as E-UNREADABLE with the browser\'s error name', async () => {
    const dir = await run.getDirectoryHandle('unreadable', { create: true });
    const b = browserBackend(dir);
    await writeEx02(b);
    // A File object read after its file changed on disk fails in Chromium; this captures the real error.
    const path = 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld';
    const h = await (await dir.getDirectoryHandle('sdd')).getFileHandle('sdd-20261101T100000Z-fa7eae25.jsonld');
    const stale = await h.getFile();
    const w = await h.createWritable({ keepExistingData: true });
    await w.write(enc(' '));
    await w.close();
    let error;
    try { await stale.arrayBuffer(); } catch (e) { error = e; }
    expect(error, 'reading a File after its file changed failed (if not, this browser cannot produce the error this way)');
    const failing = { ...b, read: (p) => (p === path ? Promise.reject(error) : b.read(p)) };
    const r = evaluate(await loadTree(failing));
    const d = r.diagnostics.find((x) => x.code === 'E-UNREADABLE');
    expect(d?.path === path && d.error === error.name, `E-UNREADABLE ${path} (${error.name}) (got ${JSON.stringify(d)})`);
    expect(r.stages.sdd.status === 'unevaluable', `sdd is unevaluable (got ${r.stages.sdd.status})`);
    return `the browser's error was ${error.name}; reported as E-UNREADABLE ${path} (${d.error}), sdd unevaluable`;
  });

  await check('R-W8: the backend left no temporary file in the run folder', async () => {
    const left = [];
    for await (const [path] of walk(run)) {
      // e/ holds copies of the fixtures, and EX-10 has a temporary file on purpose (an interrupted commit).
      if (!path.startsWith('e/') && path.split('/').at(-1).startsWith(TEMP_PREFIX)) left.push(path);
    }
    expect(!left.length, `left behind: ${left.join(', ')}`);
    return 'none';
  });

  const passed = results.filter((r) => r.ok).length;
  $('summary').textContent = `${passed} of ${results.length} automatic tests passed.`;
  $('summary').className = passed === results.length ? 'ok' : 'bad';
  return results;
}

// ---------------------------------------------------------------------------------------------- two pages, two origins (M2-d)

let paused = null; // {resume, label}
const pauseHere = (label) => new Promise((resume) => {
  paused = { resume, label };
  twoPage(`Paused: ${label}. Now do the next step on the OTHER page, then press "Continue" here.`);
  $('continue').disabled = false;
});
function twoPage(text, kind = '') { $('two-message').textContent = text; $('two-message').className = kind; }

async function newestFolder(prefix) {
  const names = [];
  for await (const [n, h] of scratch.entries()) if (h.kind === 'directory' && n.startsWith(`${prefix}-`)) names.push(n);
  names.sort();
  if (!names.length) throw new Error(`no ${prefix}-… folder in ${scratch.name}: do the first step on the other page, and pick the same folder on both pages`);
  return scratch.getDirectoryHandle(names.at(-1));
}

async function startProject(prefix) {
  const dir = await newFolder(scratch, prefix);
  const b = browserBackend(dir);
  await createProject(b, { id: PROJECT, name: `M2-d ${prefix}`, createdAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
  await (await openProject(b, TOOLS.intake)).addSource({ kind: 'schema', ext: 'json', bytes: enc('{"synthetic": true}\n') });
  const { artifacts } = await (await openProject(b, TOOLS.normalizer)).commit('normalized', { artifacts: [{
    role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic', bytes: enc('{"fields": ["id"]}\n'),
    inputs: [{ role: 'sources', collection: 'source' }] }] });
  return { dir, normalized: artifacts[0].path };
}

const sddArgs = (normalized, text, createdAt) => ({ createdAt, artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted',
  bytes: enc(text), inputs: [{ role: 'structure', relation: 'dependency', path: normalized }] }] });
// The normalized schema of a two-page or race project, or a plain explanation if the other page has not finished
// creating it (creating takes several seconds per file in a synchronized folder).
// Checked before anything opens the project: a project caught while the other page creates it may have no project
// file yet, an incomplete one, or no normalized schema.
async function normalizedOf(dir, created) {
  const r = evaluate(await loadTree(browserBackend(dir)));
  const n = r.valid ? r.stages.normalized.current[0] : undefined;
  if (!n) throw new Error(`The project from step ${created} (${dir.name}) is not finished yet. Wait until the other page says "Step ${created} done", then press this step again.`);
  return n;
}

const twoPageSteps = {
  // Fork: two pages commit from the same head.
  async 'fork-1'() {
    const { dir } = await startProject('two-page');
    twoPage(`Step 1 done: created ${dir.name}. Now press step 2 on the other page.`, 'ok');
  },
  async 'fork-2'() {
    const dir = await newestFolder('two-page');
    const normalized = await normalizedOf(dir, 1);
    const b = browserBackend(dir, { hooks: { beforeCreate: (path) => (path.startsWith('sdd/revisions/') ? pauseHere(`${dir.name}: this page's SDD is written, its revision is not`) : undefined) } });
    await (await openProject(b, TOOLS.sdd)).commit('sdd', sddArgs(normalized, '{"written": "page 2, step 2"}\n'));
    twoPage(`Step 4 done: this page's revision is written in ${dir.name}. Press step 5 on either page.`, 'ok');
  },
  async 'fork-3'() {
    const dir = await newestFolder('two-page');
    const normalized = await normalizedOf(dir, 1);
    await (await openProject(browserBackend(dir), TOOLS.sdd)).commit('sdd', sddArgs(normalized, '{"written": "page 1, step 3"}\n'));
    twoPage(`Step 3 done: committed an SDD in ${dir.name}. Now press "Continue" on the other page.`, 'ok');
  },
  async 'fork-check'() {
    const dir = await newestFolder('two-page');
    const r = evaluate(await loadTree(browserBackend(dir)));
    const s = r.stages.sdd;
    const ok = s.status === 'conflicted' && s.heads.length === 2 && codes(r).includes('E-STAGE-CONFLICT') && !codes(r).includes('E-INTEGRITY');
    record(`M2-d (1), two origins: two pages committing from the same head leave sdd conflicted with 2 heads (${dir.name})`, ok,
      `sdd ${s.status}, ${s.heads.length} heads; ${codes(r).join(', ') || 'no diagnostics'}`);
    twoPage(summary(r), ok ? 'ok' : 'bad');
  },
  // Forced race on an artifact name: page 2 checks the name is free, pauses before move(); page 1 commits that name.
  async 'race-1'() {
    const { dir } = await startProject('race');
    twoPage(`Step 6 done: created ${dir.name}. Now press step 7 on the other page.`, 'ok');
  },
  async 'race-2'() {
    const dir = await newestFolder('race');
    const name = artifactName('sdd', RACE_TIME, sha256(enc(RACE_TEXT)), 8, 'jsonld');
    await normalizedOf(dir, 6);
    const b = browserBackend(dir, { hooks: { beforeMove: () => pauseHere(`${dir.name}: this page checked that sdd/${name} is free and is about to move its file there`) } });
    try {
      await b.create(`sdd/${name}`, enc('{"written": "page 2, other bytes under the same name"}\n'));
      twoPage(`Step 9 done: this page's move() onto sdd/${name} succeeded. Press step 10 on either page.`, 'ok');
    } catch (e) {
      twoPage(`Step 9 done: this page's create was refused (${e.code ?? e.name}): ${e.message}. Press step 10 on either page.`, 'ok');
    }
  },
  async 'race-3'() {
    const dir = await newestFolder('race');
    const normalized = await normalizedOf(dir, 6);
    const { artifacts } = await (await openProject(browserBackend(dir), TOOLS.sdd)).commit('sdd', sddArgs(normalized, RACE_TEXT, RACE_TIME));
    twoPage(`Step 8 done: committed ${artifacts[0].path} in ${dir.name}. Now press "Continue" on the other page.`, 'ok');
  },
  async 'race-check'() {
    const dir = await newestFolder('race');
    const name = `sdd/${artifactName('sdd', RACE_TIME, sha256(enc(RACE_TEXT)), 8, 'jsonld')}`;
    const r = evaluate(await loadTree(browserBackend(dir)));
    const readText = async (p) => { try { return dec(await readRaw(dir, p)); } catch { return null; } };
    // Page 1's SDD is the stage's current artifact: under the name page 2 aimed at, or under a longer prefix if page 1
    // found that name taken (R-W1). Either it is intact, or its loss must be reported.
    const current = r.stages.sdd.current[0];
    const intact = current !== undefined && await readText(current) === RACE_TEXT && !codes(r).some((c) => c.startsWith('E-'));
    const detected = codes(r).some((c) => c === 'E-INTEGRITY' || c === 'E-CURRENT-UNRESOLVED');
    const atName = await readText(name);
    const how = !intact ? `page 1's SDD was replaced at ${name}; reported: ${codes(r).join(', ') || 'NOTHING (a silent loss)'}`
      : current === name ? `page 1's SDD is intact at ${name}: page 2's move was refused`
        : `page 1's SDD is intact under ${current}; page 2's file holds ${name}${atName === null ? '' : ' (W-UNREGISTERED)'}`;
    record(`M2-d (2), two origins: a write in the check-to-move window loses nothing, or the loss is reported (${dir.name})`, intact || detected,
      `${intact ? 'nothing lost' : detected ? 'loss detected' : 'SILENT LOSS'}: ${how}`);
    twoPage(summary(r), intact || detected ? 'ok' : 'bad');
  },
};
const RACE_TIME = '2026-01-01T00:00:00Z';
const RACE_TEXT = '{"written": "page 1, step 8"}\n';

// ---------------------------------------------------------------------------------------------- the page

function saveResults() {
  const body = JSON.stringify({ page: 'eps-browser-tests', origin: location.protocol === 'file:' ? 'file:' : location.origin,
    userAgent: navigator.userAgent, savedAt: new Date().toISOString(), folder: scratch?.name ?? null, results }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `eps-browser-tests-${stamp()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function pick() {
  try {
    scratch = await window.showDirectoryPicker({ id: 'eps-browser-tests', mode: 'readwrite' });
    $('folder').textContent = `Test folder: ${scratch.name}`;
    for (const b of document.querySelectorAll('button.needs-folder')) b.disabled = false;
  } catch (e) {
    const x = explainFolderError(e);
    $('folder').textContent = x.message;
    $('folder').className = x.kind === 'cancelled' ? '' : 'bad';
  }
}

function setup() {
  $('origin').textContent = location.protocol === 'file:' ? 'opened as a file (file:)' : location.origin;
  const access = folderAccess(window);
  if (!access.available) { $('folder').textContent = access.message; $('folder').className = 'bad'; $('pick').disabled = true; }
  $('pick').onclick = pick;
  $('auto').onclick = async () => { $('auto').disabled = true; try { await runAutomatic(scratch); } finally { $('auto').disabled = false; } };
  $('save').onclick = saveResults;
  $('continue').onclick = () => { $('continue').disabled = true; const p = paused; paused = null; p?.resume(); };
  for (const [id, step] of Object.entries(twoPageSteps)) {
    $(id).onclick = async () => {
      // One step at a time: the buttons wait while a step works (a step can take a minute in a synchronized folder).
      const buttons = Object.keys(twoPageSteps).map((k) => $(k));
      for (const b of buttons) b.disabled = true;
      twoPage(`Working on step "${$(id).textContent}"… This can take up to a minute in a OneDrive folder: wait for its "done" message.`);
      try { await step(); } catch (e) { twoPage(`${e?.message ?? e}`, 'bad'); } finally { for (const b of buttons) b.disabled = !scratch; }
    };
  }
}

setup();

// Self-check of the page in the browser's private storage, without a picked folder: `?auto=opfs`.
if (new URLSearchParams(location.search).get('auto') === 'opfs') {
  window.__epsDone = (async () => {
    scratch = await navigator.storage.getDirectory();
    $('folder').textContent = 'Test folder: the browser\'s private storage (automatic self-check)';
    return runAutomatic(scratch);
  })().catch((e) => [{ name: 'self-check', ok: false, detail: e?.stack ?? String(e) }]);
}
