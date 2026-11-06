// M2 tests: the browser backend (src/browser-backend.mjs) over a fake of the File System Access API
// (test/fake-fsa.mjs), the browser pages' code (browser/), and the page generator (tools/gen-pages.mjs). The writer
// tests in test/project.test.mjs also run on this backend (their names end in [browser backend]). What the fake cannot
// show is checked in a real browser by browser/eps-browser-tests.html (M2-h).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { evaluate, canonicalBytes, sha256, artifactName, TEMP_PREFIX } from '../src/contract.mjs';
import { loadTree, createProject, openProject } from '../src/project.mjs';
import { localLocks } from '../src/browser-backend.mjs';
import { fakeDirectory, fakeBrowserBackend } from './fake-fsa.mjs';
import { treeFromDisk, cloneTree, nodeAt, text } from './helpers.mjs';
import { folderAccess, explainFolderError } from '../browser/access.mjs';
import { projectState, hints } from '../browser/view.mjs';
import { bundle } from '../tools/gen-pages.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '..', 'examples');
const exampleNames = readdirSync(examples).filter((n) => /^EX-\d\d-/.test(n)).sort();
const example = (name) => treeFromDisk(join(examples, name, 'project'));
const bytesOf = (s) => new TextEncoder().encode(s);
const textOf = (b) => new TextDecoder().decode(b);
const codes = (r) => r.diagnostics.map((d) => d.code);
const rejects = (promise, code) => assert.rejects(promise, (e) => e.code === code);
const PROJECT = 'urn:uuid:00000000-0000-4000-8000-000000000002';
const tools = {
  normalizer: { tool: 'example-normalizer', version: '0.1.0', responsibilities: ['normalizer'] },
  sdd: { tool: 'sdd', version: '1.1.0', responsibilities: ['sdd-author'] },
};
const MOVES = ['replace', 'refuse', 'absent'];

// A project with a source and a normalized schema, ready for SDD commits.
async function chain(backend) {
  await createProject(backend, { id: PROJECT, name: 'M2', createdAt: '2026-11-01T08:00:00Z' });
  await (await openProject(backend, tools.sdd)).addSource({ kind: 'schema', ext: 'json', bytes: bytesOf('{}'), createdAt: '2026-11-01T09:00:00Z' });
  const { artifacts } = await (await openProject(backend, tools.normalizer)).commit('normalized', { createdAt: '2026-11-01T09:10:00Z',
    artifacts: [{ role: 'normalized', kind: 'normalized', ext: 'json', generation: 'deterministic', bytes: bytesOf('{"n":1}'), inputs: [{ role: 'sources', collection: 'source' }] }] });
  return artifacts[0].path;
}
const sdd = (normalized, s, createdAt) => ({ createdAt, artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted',
  bytes: bytesOf(s), inputs: [{ role: 'structure', relation: 'dependency', path: normalized }] }] });

// ---------------------------------------------------------------------------------------------------------------
// M2-f: the backend

for (const move of MOVES) {
  test(`backend interface: browser (move() ${move})`, async () => {
    const b = fakeBrowserBackend({ move });
    assert.equal(b.level, 'checked');
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
    await rejects(b.replace('a', bytesOf('x')), 'NOT-A-FILE');
    await rejects(b.create('a/b.txt/c', bytesOf('x')), 'NOT-A-FOLDER');
    assert.deepEqual(b.stats, move === 'absent' ? { move: 0, direct: 1, retries: 0 } : { move: 1, direct: 0, retries: 0 });
  });
}

test('M2-f: a path a folder cannot hold is refused, never altered, and nothing is written', async () => {
  const b = fakeBrowserBackend();
  for (const bad of ['', 'a//b', 'a/./b', 'a/../b', 'a/b.', 'a/b ', 'a/CON', 'a/con.txt', 'a/b:c', 'a/b?c', 'a\\b', `a/${'x'.repeat(256)}`]) {
    await rejects(b.create(bad, bytesOf('x')), 'BAD-PATH');
    await rejects(b.replace(bad, bytesOf('x')), 'BAD-PATH');
  }
  assert.equal(b.tree.entries.size, 0);
  assert.equal(await b.read('a/../b'), null, 'reads never resolve . or ..');
});

test('M2-f, R-W8: a create removes temporary files over an hour old from its folder, and leaves younger ones', async () => {
  let clock = Date.parse('2026-11-05T08:00:00Z');
  const b = fakeBrowserBackend({ now: () => clock });
  const dir = b.root;
  const writeTemp = async (name) => {
    const w = await (await (await dir.getDirectoryHandle('s', { create: true })).getFileHandle(name, { create: true })).createWritable();
    await w.write(bytesOf('partial'));
    await w.close();
  };
  await writeTemp(`${TEMP_PREFIX}old`);
  clock += 50 * 60 * 1000;
  await writeTemp(`${TEMP_PREFIX}young`);
  clock += 15 * 60 * 1000; // the old one is now 65 minutes old, the young one 15
  await b.create('s/new.txt', bytesOf('new'));
  assert.deepEqual((await b.list('s')).map((e) => e.name).sort(), [`${TEMP_PREFIX}young`, 'new.txt']);
});

// A close() fault for the first `n` writes into `folder` (as OneDrive interrupting Chrome), counting every attempt.
function interrupted(folder, n, name = 'InvalidStateError') {
  const seen = { attempts: 0 };
  return { seen, faults: { close: (p) => (p.startsWith(`${folder}/`) && seen.attempts++ < n ? name : null) } };
}
const listNames = async (b, folder) => (await b.list(folder)).map((e) => e.name).sort();

for (const move of MOVES) {
  test(`M2-f: an interrupted write (InvalidStateError) is retried with a fresh temporary file and succeeds (move() ${move})`, async () => {
    const { seen, faults } = interrupted('s', 2);
    const b = fakeBrowserBackend({ move, faults });
    await b.create('s/a.txt', bytesOf('content'));
    assert.equal(textOf(await b.read('s/a.txt')), 'content');
    assert.equal(b.stats.retries, 2);
    assert.equal(seen.attempts, 3);
    assert.deepEqual(await listNames(b, 's'), ['a.txt'], 'the interrupted temporary files are gone');
  });
}

test('M2-f: a write still interrupted after about 1.5 s fails cleanly; another error fails at once; neither leaves a file', async () => {
  const always = fakeBrowserBackend({ faults: { close: (p) => (p.startsWith('s/') ? 'InvalidStateError' : null) } });
  const t0 = Date.now();
  await assert.rejects(always.create('s/a.txt', bytesOf('x')), (e) => e.name === 'InvalidStateError');
  const ms = Date.now() - t0;
  assert.ok(ms >= 1400 && ms < 5000, `gave up after ${ms} ms`);
  assert.equal(always.stats.retries, 5);
  assert.deepEqual(await listNames(always, 's'), [], 'no temporary file and no final name are left');
  const quota = fakeBrowserBackend({ faults: { close: (p) => (p.startsWith('s/') ? 'QuotaExceededError' : null) } });
  await assert.rejects(quota.create('s/a.txt', bytesOf('x')), (e) => e.name === 'QuotaExceededError');
  assert.equal(quota.stats.retries, 0, 'only interrupted writes are retried');
  assert.deepEqual(await listNames(quota, 's'), []);
});

test('M2-f: replace() of a work file retries an interrupted write too', async () => {
  const { faults } = interrupted('w', 1);
  const b = fakeBrowserBackend({ faults });
  await b.replace('w/work.json', bytesOf('1'));
  assert.equal(textOf(await b.read('w/work.json')), '1');
  assert.equal(b.stats.retries, 1);
});

test('M2-g: every example read through the browser backend equals its expected report', async () => {
  assert.equal(exampleNames.length, 25);
  for (const name of exampleNames) {
    const report = evaluate(await loadTree(fakeBrowserBackend({ tree: example(name) })));
    assert.equal(textOf(canonicalBytes(report)), readFileSync(join(examples, name, 'expected.jsonld'), 'utf8'), name);
  }
});

for (const move of ['refuse', 'absent']) {
  test(`M2-g: writing EX-02 through the browser backend reproduces the fixture (move() ${move})`, async () => {
    const fixture = example('EX-02-chain-ok');
    const b = fakeBrowserBackend({ move });
    const content = (p) => nodeAt(fixture, p).bytes;
    await createProject(b, { id: PROJECT, name: 'Example 2', createdAt: '2026-11-01T08:00:00Z' });
    const sourceTool = JSON.parse(textOf(content('source/schema-20261101T090000Z-67daa493.json.record.jsonld'))).producedBy;
    await (await openProject(b, sourceTool)).addSource({ kind: 'schema', ext: 'json', bytes: content('source/schema-20261101T090000Z-67daa493.json'), createdAt: '2026-11-01T09:00:00Z' });
    await (await openProject(b, tools.normalizer)).commit('normalized', { createdAt: '2026-11-01T09:10:00Z', artifacts: [{ role: 'normalized', kind: 'normalized', ext: 'json',
      generation: 'deterministic', bytes: content('normalized/normalized-20261101T091000Z-4c173267.json'), inputs: [{ role: 'sources', collection: 'source' }] }] });
    await (await openProject(b, tools.sdd)).commit('sdd', sdd('normalized/normalized-20261101T091000Z-4c173267.json', textOf(content('sdd/sdd-20261101T100000Z-fa7eae25.jsonld')), '2026-11-01T10:00:00Z'));
    for (const stage of ['source', 'normalized', 'sdd']) {
      for (const [name, node] of nodeAt(fixture, stage).entries) if (name !== 'revisions') assert.deepEqual(nodeAt(b.tree, `${stage}/${name}`).bytes, node.bytes, `${stage}/${name}`);
    }
    assert.deepEqual(codes(evaluate(await loadTree(b))), []);
  });
}

test('M2-f: same origin, two writers racing for the same names never overwrite each other (Web Locks)', async () => {
  const tree = { type: 'dir', entries: new Map() };
  const locks = localLocks(); // one origin: one lock manager, as navigator.locks is for every tab of an origin
  const yieldInWindow = { beforeMove: () => new Promise((r) => setImmediate(r)) }; // let the other writer run in the window
  const a = fakeBrowserBackend({ tree, locks, hooks: yieldInWindow });
  const b = fakeBrowserBackend({ tree, locks, hooks: yieldInWindow });
  for (let i = 0; i < 20; i++) {
    const attempt = (w, label) => w.create(`race/r-${i}.txt`, bytesOf(`${label} ${i}`)).then(() => label, (e) => { if (e.code !== 'EXISTS') throw e; return null; });
    const won = (await Promise.all([attempt(a, 'A'), attempt(b, 'B')])).filter(Boolean);
    assert.equal(won.length, 1, `r-${i}.txt has one winner`);
    assert.equal(textOf(await a.read(`race/r-${i}.txt`)), `${won[0]} ${i}`);
  }
});

test('M2-d: across origins (no shared lock), the same race can replace a file when move() replaces: the checked level\'s limit', async () => {
  const tree = { type: 'dir', entries: new Map() };
  let arrived = 0, release;
  const bothChecked = new Promise((r) => { release = r; });
  const barrier = { beforeMove: () => { if (++arrived === 2) release(); return bothChecked; } }; // both pass the check, then both move
  const a = fakeBrowserBackend({ tree, locks: localLocks(), hooks: barrier });
  const b = fakeBrowserBackend({ tree, locks: localLocks(), hooks: barrier });
  const results = await Promise.allSettled([a.create('x/same.txt', bytesOf('A')), b.create('x/same.txt', bytesOf('B'))]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled'], 'both checks passed: neither saw the other');
  assert.equal(textOf(await a.read('x/same.txt')), 'B', 'the later move() replaced the earlier file: R-W9 says this cannot be prevented, only detected');
});

// ---------------------------------------------------------------------------------------------------------------
// M2-d: two origins writing one project

test('M2-d (1): two origins committing from the same head leave the stage conflicted with two heads', async () => {
  const tree = { type: 'dir', entries: new Map() };
  const page1 = fakeBrowserBackend({ tree, locks: localLocks() });
  const normalized = await chain(page1);
  let paused = true;
  const page2 = fakeBrowserBackend({ tree, locks: localLocks(), hooks: {
    async beforeCreate(path) {
      if (paused && path.startsWith('sdd/revisions/')) {
        paused = false; // page 2 has written its SDD; before its revision, page 1 commits from the same head
        await (await openProject(page1, tools.sdd)).commit('sdd', sdd(normalized, '{"page":1}', '2026-11-01T10:00:00Z'));
      }
    },
  } });
  await (await openProject(page2, tools.sdd)).commit('sdd', sdd(normalized, '{"page":2}', '2026-11-01T10:00:00Z'));
  const r = evaluate(await loadTree(page1));
  assert.equal(r.stages.sdd.status, 'conflicted');
  assert.equal(r.stages.sdd.heads.length, 2);
  assert.deepEqual(codes(r), ['E-STAGE-CONFLICT']);
});

for (const move of MOVES) {
  test(`M2-d (2): a write in the check-to-move window is ${move === 'refuse' ? 'refused, and nothing is lost' : 'detected'} (move() ${move})`, async () => {
    const tree = { type: 'dir', entries: new Map() };
    const page1 = fakeBrowserBackend({ tree, locks: localLocks(), move });
    const normalized = await chain(page1);
    const page1Text = '{"page":1}';
    const name = `sdd/${artifactName('sdd', '2026-11-01T10:00:00Z', sha256(bytesOf(page1Text)), 8, 'jsonld')}`;
    // Page 2 (another origin) checks that page 1's future name is free; in its window, page 1 commits under that name.
    const page2 = fakeBrowserBackend({ tree, locks: localLocks(), move, hooks: {
      beforeMove: async () => { await (await openProject(page1, tools.sdd)).commit('sdd', sdd(normalized, page1Text, '2026-11-01T10:00:00Z')); },
    } });
    const outcome = await page2.create(name, bytesOf('{"page":2,"other bytes":true}')).then(() => 'written', (e) => e.code);
    const r = evaluate(await loadTree(page1));
    if (move === 'refuse') {
      assert.equal(outcome, 'EXISTS');
      assert.equal(textOf(nodeAt(tree, name).bytes), page1Text, 'page 1\'s artifact is intact');
      assert.deepEqual(codes(r), []);
    } else {
      assert.equal(outcome, 'written');
      assert.notEqual(textOf(nodeAt(tree, name).bytes), page1Text, 'page 1\'s artifact was replaced');
      assert.ok(codes(r).includes('E-INTEGRITY'), `the replacement is reported (${codes(r).join(', ')})`);
      assert.equal(r.stages.sdd.status, 'damaged');
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// M2-e: unreadable files in the browser

test('M2-e: a file the browser cannot read is E-UNREADABLE with the browser\'s error name; what depends on it is not evaluable', async () => {
  const tree = example('EX-02-chain-ok');
  const r = evaluate(await loadTree(fakeBrowserBackend({ tree, faults: { read: (p) => (p === 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld' ? 'NotReadableError' : null) } })));
  assert.deepEqual(r.diagnostics, [{ code: 'E-UNREADABLE', path: 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld', error: 'NotReadableError' }]);
  assert.equal(r.stages.sdd.status, 'unevaluable');
  const listing = evaluate(await loadTree(fakeBrowserBackend({ tree: example('EX-02-chain-ok'), faults: { list: (p) => (p === 'normalized' ? 'NotReadableError' : null) } })));
  assert.ok(listing.diagnostics.some((d) => d.code === 'E-UNREADABLE' && d.path === 'normalized' && d.error === 'NotReadableError'), JSON.stringify(listing.diagnostics));
  assert.equal(listing.stages.normalized.status, 'unevaluable');
});

test('M2-e: a listed file or folder the browser cannot open (on Windows, a path too long) is E-UNREADABLE, never missing', async () => {
  const artifact = 'sdd/sdd-20261101T100000Z-fa7eae25.jsonld';
  const file = evaluate(await loadTree(fakeBrowserBackend({ tree: example('EX-02-chain-ok'), faults: { open: (p) => (p === artifact ? 'NotFoundError' : null) } })));
  assert.deepEqual(file.diagnostics, [{ code: 'E-UNREADABLE', path: artifact, error: 'NotFoundError' }]);
  assert.equal(file.stages.sdd.status, 'unevaluable');
  const folder = evaluate(await loadTree(fakeBrowserBackend({ tree: example('EX-02-chain-ok'), faults: { open: (p) => (p === 'sdd/revisions' ? 'NotFoundError' : null) } })));
  assert.ok(folder.diagnostics.some((d) => d.code === 'E-UNREADABLE' && d.path === 'sdd/revisions' && d.error === 'NotFoundError'), JSON.stringify(folder.diagnostics));
  assert.equal(folder.stages.sdd.status, 'unevaluable');
  const b = fakeBrowserBackend({ tree: example('EX-02-chain-ok') });
  assert.equal(await b.read('sdd/not-there.jsonld'), null, 'a file that is not listed is still absent');
  assert.equal(await b.list('sdd/not-there'), null, 'a folder that is not listed is still absent');
});

test('M2-e, M2-i: the project page explains a file it cannot open or read, and says nothing when there is nothing to explain', async () => {
  const tooLong = evaluate(await loadTree(fakeBrowserBackend({ tree: example('EX-02-chain-ok'), faults: { open: (p) => (p.startsWith('sdd/sdd-') ? 'NotFoundError' : null) } })));
  assert.match(hints(tooLong).join(' '), /too deep.*shorter path/s);
  const notDownloaded = evaluate(await loadTree(fakeBrowserBackend({ tree: example('EX-02-chain-ok'), faults: { read: (p) => (p.startsWith('sdd/sdd-') ? 'NotReadableError' : null) } })));
  assert.match(hints(notDownloaded).join(' '), /not be downloaded/);
  assert.deepEqual(hints(evaluate(example('EX-02-chain-ok'))), []);
});

// ---------------------------------------------------------------------------------------------------------------
// M2-c: when folders cannot be opened

test('M2-c: the page says plainly when folder access is missing or blocked, and points to single files', () => {
  const missing = folderAccess({});
  assert.equal(missing.available, false);
  assert.match(missing.message, /cannot open folders.*single files/s);
  assert.equal(folderAccess({ showDirectoryPicker() {}, isSecureContext: false }).reason, 'insecure');
  assert.deepEqual(folderAccess({ showDirectoryPicker() {}, isSecureContext: true }), { available: true });
  assert.equal(explainFolderError(new DOMException('x', 'AbortError')).kind, 'cancelled');
  for (const name of ['SecurityError', 'NotAllowedError']) {
    const x = explainFolderError(new DOMException('blocked by policy', name));
    assert.equal(x.kind, 'blocked');
    assert.match(x.message, /policy.*single files/s);
  }
  assert.equal(explainFolderError(new DOMException('x', 'NotFoundError')).kind, 'error');
});

// ---------------------------------------------------------------------------------------------------------------
// M2-i: the project page

test('M2-i: for every example, the project page shows what eps status shows and its report is byte-identical to eps report', async () => {
  const eps = join(here, '..', 'bin', 'eps.mjs');
  const out = (args) => run(process.execPath, [eps, ...args]).then((r) => r.stdout, (e) => e.stdout);
  await Promise.all(exampleNames.map(async (name) => {
    const folder = join(examples, name, 'project');
    const state = await projectState(fakeDirectory(example(name)));
    assert.equal(textOf(state.bytes), await out(['report', folder]), `${name}: report`);
    assert.equal(`${state.text}\n`, await out(['status', folder]), `${name}: status`);
    assert.equal(state.sha256, sha256(state.bytes));
  }));
});

test('M2-i: the project page only reads: the folder is unchanged, and the page code has no write call', async () => {
  const tree = example('EX-08-stage-conflict');
  const before = cloneTree(tree);
  await projectState(fakeDirectory(tree));
  assert.deepEqual(tree, before);
  for (const file of ['project-page.mjs', 'view.mjs']) {
    const source = readFileSync(join(here, '..', 'browser', file), 'utf8');
    assert.doesNotMatch(source, /\.(create|replace|createWritable|removeEntry|move)\(|createProject|openProject|readwrite/, file);
  }
});

test('M2-i: the bundled page code computes the same reports as the modules', async () => {
  const code = bundle(join(here, '..', 'browser', 'view.mjs'));
  const bundled = (await import(`data:text/javascript,${encodeURIComponent(`${code}\nexport default __eps_browser_view_mjs;`)}`)).default;
  for (const name of exampleNames) {
    const [a, b] = [await bundled.projectState(fakeDirectory(example(name))), await projectState(fakeDirectory(example(name)))];
    assert.deepEqual(a.bytes, b.bytes, name);
  }
});

test('M2-i: the generator refuses import and export forms it does not handle', () => {
  const entry = join(here, 'x.mjs');
  assert.throws(() => bundle('virtual:a', { 'virtual:a': "import x from './y.mjs';\n" }), /unsupported import form/);
  assert.throws(() => bundle('virtual:a', { 'virtual:a': 'export default 1;\n' }), /unsupported export form/);
  assert.throws(() => bundle(entry, { [entry]: "import { a } from './missing-module.mjs';\n" }), /cannot find/);
});

test('M2-a, M2-d: the local server stands in for the published page on this computer only', () => {
  const source = readFileSync(join(here, '..', 'tools', 'serve-local.mjs'), 'utf8');
  assert.match(source, /listen\(port, '127\.0\.0\.1'/, 'it listens on the loopback address only');
  assert.match(source, /pages\.has\(name\)/, 'it serves only the generated pages');
});

test('M2-i: the generated pages contain no network address they could fetch from', () => {
  for (const page of ['eps-project.html', 'eps-browser-tests.html']) {
    const html = readFileSync(join(here, '..', 'browser', page), 'utf8');
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'/, `${page} forbids every network request`);
    assert.doesNotMatch(html, /\bfetch\(|XMLHttpRequest|WebSocket|<script[^>]+src=/, page);
  }
});

test('helpers: text() builds a file node', () => assert.equal(textOf(text('x').bytes), 'x'));
