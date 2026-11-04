// M1 validation assistant. Walks the registrar through validation/M1-validation.md (steps 1-3) on two PCs that
// share a OneDrive folder: it runs every step that can be automated with the existing tools (npm run check's
// commands, the demo, the probe and the eps tool), asks for the steps only a person can do (pausing OneDrive,
// freeing up space, disconnecting the network), saves every command's output and exit code, and writes a report of
// what was actually observed, including rows 12 and 14 of step 3.
//
// It is a validation utility, not part of EPS: it changes nothing in EPS, needs nothing installed beyond Node 22+,
// never deletes or overwrites a project (every run gets a new folder, and every evidence file is created new), and
// needs no network except OneDrive's own synchronization. Synthetic data only.
//
//   double-click validation\run-m1-validation.cmd        (or: node validation/m1-validate.mjs)
//   node validation/m1-validate.mjs --report [<run folder>] writes a new report from a run's saved evidence
//
// For testing: --pc 1|2, --root <folder> (default %OneDrive%\Documents\eps-m1-validation),
// EPS_M1_POLL_MS (default 5000), EPS_M1_FREE_WAIT_S (default 60), EPS_M1_NET_PROBE=host:port (default
// onedrive.live.com:443, only ever connected to and closed, to tell whether the PC is offline), EPS_M1_NO_OPEN=1.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), '..');
const EPS = join(REPO, 'bin', 'eps.mjs');
const POLL_MS = Number(process.env.EPS_M1_POLL_MS) || 5000;
const WAIT_MINUTES = 20;
const FREE_WAIT_S = Number(process.env.EPS_M1_FREE_WAIT_S) || 60;
const [PROBE_HOST, PROBE_PORT] = (process.env.EPS_M1_NET_PROBE || 'onedrive.live.com:443').split(':');
const HOST = hostname();
const REPORT_NAME = 'M1-validation-report';

class Stop extends Error {}
class Fatal extends Error {}

// ---------------------------------------------------------------- console and input

const say = (s = '') => console.log(s);
const heading = (s) => { say(); say(`=== ${s} ===`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const queued = [];
let waiter = null;
let inputClosed = false;
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else queued.push(l); });
rl.on('close', () => { inputClosed = true; if (waiter) { const w = waiter; waiter = null; w(null); } });
function ask(question) {
  process.stdout.write(question);
  if (queued.length) return Promise.resolve(queued.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((r) => { waiter = r; });
}
const flush = () => { queued.length = 0; };
const quit = (a) => a === null || a.trim().toLowerCase() === 'q';

async function action(title, body) {
  flush();
  say();
  say('#'.repeat(78));
  say(`#  ACTION NEEDED ON THIS PC (PC ${ctx.pc}): ${title}`);
  say('#');
  for (const l of body) say(`#  ${l}`);
  say('#'.repeat(78));
  if (quit(await ask('Press Enter when done (or type q and Enter to stop): '))) throw new Stop();
}

function banner(text) {
  say();
  say('*'.repeat(78));
  say(`*  ${text}`);
  say('*'.repeat(78));
}

async function waitFor(what, check) {
  say();
  say(`Waiting: ${what}`);
  say('  This can take a few minutes. To stop, type q and press Enter; run again later to continue.');
  const start = Date.now();
  let deadline = start + WAIT_MINUTES * 60000;
  let lastNote = start;
  for (;;) {
    const v = await check();
    if (v) { say(`  ...done (${Math.round((Date.now() - start) / 1000)} s).`); return v; }
    if (ctx.pcDir && abandoned(ctx.runDir)) {
      throw new Fatal('the other PC stopped this run, because OneDrive was not paused in time (its window says why). Nothing was changed. Resume OneDrive on both PCs, then start again on PC 1: it will start a new run.');
    }
    if (queued.some((l) => l.trim().toLowerCase() === 'q')) { flush(); throw new Stop(); }
    if (Date.now() - lastNote >= 60000) { say(`  still waiting (${Math.floor((Date.now() - start) / 60000)} min)...`); lastNote = Date.now(); }
    if (Date.now() > deadline) {
      flush();
      if (quit(await ask(`  Not done after ${WAIT_MINUTES} minutes. Is OneDrive running and syncing on both PCs? Press Enter to keep waiting, or type q to stop: `))) throw new Stop();
      deadline = Date.now() + WAIT_MINUTES * 60000;
    }
    await sleep(POLL_MS);
  }
}

// ---------------------------------------------------------------- processes and evidence

function run(file, args, { env = {}, timeoutMs = 120000 } = {}) {
  return new Promise((done) => {
    const t0 = Date.now();
    let stdout = '', stderr = '', output = '', timedOut = false, finished = false;
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ code, signal, timedOut, stdout, stderr, output, ms: Date.now() - t0 });
    };
    const p = spawn(file, args, { cwd: REPO, env: { ...process.env, ...env }, windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout += d; output += d; });
    p.stderr.on('data', (d) => { stderr += d; output += d; });
    p.on('error', (e) => { output += `\n[could not start: ${e.message}]\n`; finish(null, null); });
    p.on('close', finish);
  });
}

function crashSigns(r) {
  const signs = [];
  if (r.timedOut) signs.push('did not finish within the time limit');
  if (r.signal) signs.push(`ended by signal ${r.signal}`);
  if (![0, 1, 2].includes(r.code)) signs.push(`exit code ${r.code}`);
  if (/^\s+at\s+\S.*(\(|:\d+)/m.test(r.output)) signs.push('a stack trace in the output');
  return signs;
}

const shown = (a) => (typeof a === 'string' && ctx.runDir && a.startsWith(ctx.runDir) ? relative(ctx.runDir, a) : a);

function saveEvidence(label, commandText, r, notes = []) {
  const n = readdirSync(ctx.pcDir).filter((f) => /^\d{2,}-/.test(f)).length + 1;
  const text = [
    `# ${label}`,
    `command: ${commandText}`,
    `pc: PC ${ctx.pc} (${HOST})`,
    `finished: ${now()}`,
    `exit code: ${r.code}${r.signal ? `, signal ${r.signal}` : ''}`,
    `duration: ${(r.ms / 1000).toFixed(1)} s${r.timedOut ? ' (TIMED OUT)' : ''}`,
    ...notes,
    '---- output (stdout and stderr, in order) ----',
    r.output,
  ].join('\n');
  for (let i = 0; ; i++) {
    const name = `${String(n + i).padStart(2, '0')}-${label}.txt`;
    try { writeFileSync(join(ctx.pcDir, name), text, { flag: 'wx' }); return name; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

function writeNew(file, text) { // never overwrites: an existing file is kept if identical, otherwise refused
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') === text) return file;
    throw new Fatal(`${file} already exists with other content; it was not changed`);
  }
  writeFileSync(file, text, { flag: 'wx' });
  return file;
}

async function eps(label, args, { quiet = false, echo = true } = {}) {
  const r = await run(process.execPath, [EPS, ...args]);
  r.crash = crashSigns(r);
  if (!quiet) {
    r.evidence = saveEvidence(label, `eps ${args.map(shown).join(' ')}`, r, r.crash.length ? [`crash signs: ${r.crash.join('; ')}`] : []);
    if (echo) {
      say(`> eps ${args.map(shown).join(' ')}`);
      for (const l of r.output.trimEnd().split('\n')) say(`    ${l}`);
      say(`    (exit code ${r.code}; saved as ${r.evidence})`);
    }
  }
  return r;
}

const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function summarize(rep) {
  if (!rep) return null;
  const stages = {};
  for (const [name, s] of Object.entries(rep.stages ?? {})) stages[name] = { status: s.status, heads: s.heads.length, current: s.current };
  return { valid: rep.valid, stages, diagnostics: (rep.diagnostics ?? []).map((d) => ({ code: d.code, path: d.path, ...(d.error ? { error: d.error } : {}) })) };
}

async function statusCheck(label) {
  const s = await eps(`${label}-status`, ['status', ctx.project]);
  const r = await eps(`${label}-report`, ['report', ctx.project], { echo: false });
  const rep = summarize(parseJson(r.stdout));
  noteTempFiles(rep);
  return {
    exit: s.code, crash: s.crash, clean: /^status: clean$/m.test(s.stdout), statusText: s.output.trim(),
    report: rep, evidence: [s.evidence, r.evidence],
  };
}

async function quickReport() {
  const r = await eps('poll', ['report', ctx.project], { quiet: true });
  const rep = summarize(parseJson(r.stdout));
  noteTempFiles(rep);
  return rep;
}

function noteTempFiles(rep) {
  for (const d of rep?.diagnostics ?? []) {
    if (d.code !== 'W-TEMP-FILE') continue;
    const seen = readLog(ctx.runDir, ctx.pc).some((e) => e.note === 'temp-file-seen' && e.path === d.path);
    if (!seen) logEvent({ note: 'temp-file-seen', path: d.path });
  }
}

// ---------------------------------------------------------------- run folder, log and steps

const ctx = { pc: null, root: null, run: null, runDir: null, pcDir: null, project: null };

function logEvent(e) {
  appendFileSync(join(ctx.pcDir, 'log.jsonl'), `${JSON.stringify({ t: now(), pc: ctx.pc, host: HOST, ...e })}\n`);
}
function readLog(runDir, pc) {
  const f = join(runDir, `pc${pc}`, 'log.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').flatMap((l) => { const v = l && parseJson(l); return v ? [v] : []; });
}
const doneData = (log, id) => log.find((e) => e.step === id && e.done)?.data;
const isDone = (log, id) => log.some((e) => e.step === id && e.done);
const abandoned = (runDir) => [1, 2].some((pc) => readLog(runDir, pc).some((e) => e.note === 'abandoned'));

async function step(id, title, fn) {
  const log = readLog(ctx.runDir, ctx.pc);
  if (isDone(log, id)) { say(`(${title}: already done earlier)`); return doneData(log, id); }
  heading(title);
  const data = (await fn()) ?? null;
  logEvent({ step: id, done: true, data });
  return data;
}

const inProject = (rel) => existsSync(join(ctx.project, ...rel.split('/')));
const listRevisions = (stage) => {
  const d = join(ctx.project, stage, 'revisions');
  return existsSync(d) ? readdirSync(d).filter((n) => n.startsWith('rev-') && n.endsWith('.jsonld')).map((n) => `${stage}/revisions/${n}`) : [];
};
function input(name, text) { return writeNew(join(ctx.pcDir, 'inputs', name), text); }

function scanTemp(dir = ctx.project, base = ctx.project) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.name.includes('.eps-tmp-')) out.push(relative(base, p).split('\\').join('/'));
    if (e.isDirectory()) out.push(...scanTemp(p, base));
  }
  return out;
}

function online() {
  return new Promise((done) => {
    const s = connect({ host: PROBE_HOST, port: Number(PROBE_PORT) });
    const finish = (v) => { s.destroy(); done(v); };
    s.setTimeout(5000, () => finish(false));
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
  });
}

// Windows file attributes, read without touching the file's content.
const ATTR = { 0x1: 'READONLY', 0x2: 'HIDDEN', 0x4: 'SYSTEM', 0x20: 'ARCHIVE', 0x80: 'NORMAL', 0x400: 'REPARSE_POINT', 0x1000: 'OFFLINE', 0x40000: 'RECALL_ON_OPEN', 0x80000: 'PINNED', 0x100000: 'UNPINNED', 0x400000: 'RECALL_ON_DATA_ACCESS' };
const CLOUD_ONLY = 0x1000 | 0x40000 | 0x400000;
function winAttrs(file) {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[int](Get-Item -LiteralPath $env:EPS_M1_FILE -Force).Attributes'],
    { env: { ...process.env, EPS_M1_FILE: file }, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const n = parseInt((r.stdout ?? '').trim(), 10);
  if (!Number.isFinite(n)) return null;
  return { value: `0x${n.toString(16)}`, names: Object.entries(ATTR).filter(([b]) => n & Number(b)).map(([, v]) => v), cloudOnly: Boolean(n & CLOUD_ONLY) };
}
async function waitCloudOnly(file, seconds) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const a = winAttrs(file);
    if (a?.cloudOnly || Date.now() >= end) return a;
    await sleep(Math.min(5000, POLL_MS));
  }
}

function repoCommit() {
  try {
    const head = readFileSync(join(REPO, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    const f = join(REPO, '.git', ...ref.split('/'));
    if (existsSync(f)) return `${readFileSync(f, 'utf8').trim()} (${basename(ref)})`;
    const line = readFileSync(join(REPO, '.git', 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? `${line.split(' ')[0]} (${basename(ref)})` : 'unknown';
  } catch { return 'unknown'; }
}
function repoChanges() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
}

// ---------------------------------------------------------------- steps 1 and 2 (each PC)

const tokenize = (s) => [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const testLines = (out) => [...out.matchAll(/^\s*([✔✖])\s+(.+?)\s+\(\d[\d.]*m?s\)\s*$/gmu)].map((m) => ({ ok: m[1] === '✔', name: m[2] }));
const count = (out, word) => Number(out.match(new RegExp(`^ℹ ${word} (\\d+)`, 'mu'))?.[1] ?? NaN);

async function automatedChecks() {
  const script = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts.check;
  const parts = [];
  let tests = [], counts = null, allOk = true;
  say('Running the same commands as "npm run check" (about 15 seconds)...');
  for (const part of script.split('&&')) {
    const [cmd, ...args] = tokenize(part.trim());
    if (cmd !== 'node') throw new Fatal(`unexpected command in npm run check: ${part}`);
    const isTest = args.includes('--test');
    const full = isTest ? ['--test', '--test-reporter=spec', ...args.filter((a) => a !== '--test')] : args;
    const r = await run(process.execPath, full, { timeoutMs: 600000 });
    const ev = saveEvidence('step1-check', `node ${full.join(' ')}`, r);
    const ok = r.code === 0;
    if (!ok) allOk = false;
    if (isTest) { tests = testLines(r.output); counts = { tests: count(r.output, 'tests'), pass: count(r.output, 'pass'), fail: count(r.output, 'fail') }; }
    say(`  ${ok ? 'ok  ' : 'FAIL'} node ${full.join(' ')}${isTest ? `  (${counts.pass} of ${counts.tests} tests passed)` : ''}`);
    parts.push({ command: `node ${full.join(' ')}`, exit: r.code, evidence: ev, firstLine: r.output.trim().split('\n')[0] });
  }

  say('Running the disk tests inside OneDrive (about 10 seconds)...');
  const testDir = join(ctx.pcDir, 'test-tmp');
  mkdirSync(testDir, { recursive: true });
  const files = ['test/node-backend.test.mjs', 'test/unreadable.test.mjs'];
  const od = await run(process.execPath, ['--test', '--test-reporter=spec', ...files], { env: { EPS_TEST_DIR: testDir }, timeoutMs: 600000 });
  const odEv = saveEvidence('step1-onedrive-tests', `EPS_TEST_DIR=${shown(testDir)} node --test ${files.join(' ')}`, od);
  const oneDrive = { exit: od.code, tests: count(od.output, 'tests'), pass: count(od.output, 'pass'), fail: count(od.output, 'fail'), evidence: odEv, lines: testLines(od.output) };
  say(`  ${od.code === 0 ? 'ok  ' : 'FAIL'} ${oneDrive.pass} of ${oneDrive.tests} disk tests passed inside OneDrive`);

  say('Running the file-system probe in OneDrive...');
  const pr = await run(process.execPath, ['tools/probe-fs.mjs', ctx.pcDir]);
  const prEv = saveEvidence('step1-probe', `node tools/probe-fs.mjs ${shown(ctx.pcDir)}`, pr);
  const probe = parseJson(pr.stdout);
  say(`  ${pr.code === 0 && probe ? 'ok  ' : 'FAIL'} probe: link onto an existing name ${probe?.['link onto an existing name (must fail with EEXIST)']}, long path ${probe?.['path over 260 characters']}`);

  return { ok: allOk, parts, counts, tests, oneDrive, probe, probeEvidence: prEv };
}

async function demo() {
  const folder = join(ctx.pcDir, 'demo');
  if (existsSync(folder)) throw new Fatal(`${folder} already exists; it was not changed`);
  say('Running the demo (about 10 seconds)...');
  const r = await run(process.execPath, ['demo/m1-demo.mjs', folder], { timeoutMs: 300000 });
  const ev = saveEvidence('step2-demo', `node demo/m1-demo.mjs ${shown(folder)}`, r);
  const last = r.stdout.trim().split('\n').pop() ?? '';
  const ok = r.code === 0 && last.includes('DEMO PASSED');
  say(`  ${ok ? 'ok  ' : 'FAIL'} ${last}`);
  return { ok, exit: r.code, lastLine: last, evidence: ev };
}

// ---------------------------------------------------------------- step 3, the two PCs

const other = () => (ctx.pc === 1 ? 2 : 1);

async function forkSteps(normalizedPath) {
  await step('r05', 'Row 5: pause OneDrive on both PCs', async () => {
    await action('pause OneDrive on BOTH PCs', [
      ...(ctx.pc === 1 ? [
        'FIRST wait until the PC 2 window shows this same message. It appears once PC 2 has',
        'received the project, after its own checks and demo (a few minutes). Then:',
      ] : []),
      'Pause OneDrive on both PCs before pressing Enter on either of them:',
      '  1. Click the OneDrive cloud icon at the bottom right of the screen',
      '     (if you cannot see it, click the small ^ arrow first).',
      '  2. Click the gear icon, then "Pause syncing", then "2 hours".',
      'Press Enter here only when OneDrive is paused on BOTH PCs.',
    ]);
    return { confirmedAt: now() };
  });

  const row = ctx.pc === 1 ? 6 : 7;
  const mine = await step(`r0${row}`, `Row ${row}: commit an SDD on this PC while OneDrive is paused`, async () => {
    const early = listRevisions('sdd');
    if (early.length) {
      logEvent({ note: 'abandoned', reason: 'fork-impossible', revisions: early });
      throw new Fatal(`PC ${other()}'s SDD has already arrived on this PC, so OneDrive was not paused in time and the two PCs cannot make a conflict in this run. Nothing was changed. Resume OneDrive on both PCs, then start again on PC 1: it will start a new run.`);
    }
    const file = input(`s${ctx.pc}.jsonld`, `{"@context": {}, "label": "Synthetic SDD written on PC ${ctx.pc}"}\n`);
    const r = await eps(`r0${row}-commit-sdd`, ['commit', ctx.project, 'sdd', file, '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${normalizedPath}`]);
    const artifact = r.stdout.match(/^wrote (sdd\/\S+)/m)?.[1];
    const revision = r.stdout.match(/^committed (sdd\/revisions\/\S+)/m)?.[1];
    if (r.code !== 0 || !artifact || !revision) throw new Fatal(`the SDD commit failed (exit code ${r.code}); see ${r.evidence}`);
    return { exit: r.code, artifact, revision, evidence: r.evidence };
  });
  banner(`SDD COMMITTED ON PC ${ctx.pc}`);

  await step('r08', 'Row 8: resume OneDrive', async () => {
    await action('resume OneDrive', [
      `First wait until the PC ${other()} window also says "SDD COMMITTED ON PC ${other()}".`,
      'Then resume OneDrive on THIS PC: click the OneDrive cloud icon, then the gear icon,',
      'then "Resume syncing".',
    ]);
    return { confirmedAt: now() };
  });
  return mine;
}

async function waitForOthersCommit(otherRow) {
  return waitFor(`PC ${other()}'s SDD to arrive here through OneDrive`, () => {
    const theirs = doneData(readLog(ctx.runDir, other()), `r0${otherRow}`);
    if (!theirs) return false;
    return [theirs.artifact, `${theirs.artifact}.record.jsonld`, theirs.revision].every(inProject) ? theirs : false;
  });
}

async function row14() {
  return step('r14', 'Row 14: temporary files', async () => {
    const inOutputs = [];
    for (const f of readdirSync(ctx.pcDir).filter((n) => /^\d{2,}-r\d\d-.*-(status|report)\.txt$/.test(n))) {
      for (const l of readFileSync(join(ctx.pcDir, f), 'utf8').split('\n')) if (l.includes('W-TEMP-FILE')) inOutputs.push({ file: f, line: l.trim() });
    }
    const seenWhilePolling = readLog(ctx.runDir, ctx.pc).filter((e) => e.note === 'temp-file-seen').map((e) => e.path);
    const presentNow = scanTemp();
    say(`  W-TEMP-FILE in saved status/report outputs: ${inOutputs.length ? inOutputs.map((x) => x.line).join('; ') : 'none'}`);
    say(`  W-TEMP-FILE seen while waiting for OneDrive: ${seenWhilePolling.length ? seenWhilePolling.join(', ') : 'none'}`);
    say(`  .eps-tmp- files in the project now: ${presentNow.length ? presentNow.join(', ') : 'none'}`);
    return { inOutputs, seenWhilePolling, presentNow };
  });
}

async function pc1() {
  await step('s1', 'Step 1: automated checks', automatedChecks);
  await step('s2', 'Step 2: the demo', demo);

  await step('r01', 'Row 1: create the test project', async () => {
    if (existsSync(ctx.project)) throw new Fatal(`${ctx.project} already exists; it was not touched. Start a new run.`);
    const r = await eps('r01-init', ['init', ctx.project, '--name', `M1 sync test ${ctx.run}`]);
    return { exit: r.code, ok: r.code === 0 && /^created urn:uuid:/m.test(r.stdout), evidence: r.evidence };
  });
  await step('r02', 'Row 2: add a source file', async () => {
    const r = await eps('r02-add-source', ['add-source', ctx.project, input('schema.json', '{"title": "Synthetic sync test schema"}\n'), '--kind', 'schema']);
    return { exit: r.code, ok: r.code === 0 && /^added source\//m.test(r.stdout), evidence: r.evidence };
  });
  const r3 = await step('r03', 'Row 3: commit a normalized schema', async () => {
    const r = await eps('r03-commit-normalized', ['commit', ctx.project, 'normalized', input('n.json', '{"fields": ["id", "name"]}\n'), '--kind', 'normalized', '--sources', 'sources']);
    return { exit: r.code, ok: r.code === 0 && /^committed /m.test(r.stdout), normalized: r.stdout.match(/^wrote (normalized\/\S+)/m)?.[1], evidence: r.evidence };
  });
  if (!r3.ok) throw new Fatal('rows 1-3 did not succeed; see the evidence files');

  banner('NOW START THE VALIDATION ON PC 2 (leave this window open)');
  say('On PC 2: open File Explorer, go to OneDrive > Documents > edge-project-store > validation,');
  say('double-click run-m1-validation.cmd, and type 2 when it asks which PC it is.');

  const mine = await forkSteps(r3.normalized);

  await step('r09', 'Row 9: the conflict is reported', async () => {
    await waitForOthersCommit(7);
    const s = await statusCheck('r09');
    const sdd = s.report?.stages.sdd;
    const codes = (s.report?.diagnostics ?? []).map((d) => d.code);
    const ok = s.exit === 1 && !s.crash.length && sdd?.status === 'conflicted' && sdd.heads === 2 && codes.includes('E-STAGE-CONFLICT')
      && !codes.includes('E-INTEGRITY') && !codes.includes('W-INTERRUPTED-REVISION');
    return { ...s, statusText: undefined, ok, foreign: (s.report?.diagnostics ?? []).filter((d) => d.code === 'W-FOREIGN-FILE').map((d) => d.path) };
  });
  const r10 = await step('r10', 'Row 10: merge, choosing the SDD from PC 1', async () => {
    const r = await eps('r10-merge', ['merge', ctx.project, 'sdd', '--choose', `sdd=${mine.artifact}`]);
    return { exit: r.code, ok: r.code === 0 && /^merged /m.test(r.stdout), chosen: mine.artifact, revision: r.stdout.match(/^merged (sdd\/revisions\/\S+)/m)?.[1], evidence: r.evidence };
  });
  if (!r10.ok) throw new Fatal('the merge failed; see the evidence files');
  await step('r11', 'Row 11: clean after the merge (PC 1)', async () => afterMerge(await statusCheck('r11'), r10.chosen));
  await row14();
  logEvent({ step: 'pc-finished', done: true, data: null });

  banner('PC 1 IS DONE. NOW FOLLOW THE PC 2 WINDOW (rows 12 and 13).');
  await waitFor('PC 2 to finish rows 12-14 (its results arrive through OneDrive)', () => isDone(readLog(ctx.runDir, 2), 'pc-finished'));
  finishReport();
}

function afterMerge(s, chosen) {
  const sdd = s.report?.stages.sdd;
  const ok = s.exit === 0 && !s.crash.length && s.clean && sdd?.status === 'ok' && sdd.heads === 1 && sdd.current.includes(chosen);
  return { ...s, statusText: undefined, ok, currentSdd: sdd?.current[0] };
}

async function pc2() {
  await step('s1', 'Step 1: automated checks', automatedChecks);
  await step('s2', 'Step 2: the demo', demo);

  const r4 = await step('r04', 'Row 4: PC 2 sees the project', async () => {
    await waitFor('the project from PC 1 to arrive through OneDrive', async () => {
      const r3 = doneData(readLog(ctx.runDir, 1), 'r03');
      if (!r3?.normalized || !inProject(r3.normalized) || !listRevisions('normalized').length) return false;
      const rep = await quickReport();
      return rep?.stages.normalized?.status === 'ok' && rep.stages.normalized.heads === 1;
    });
    const s = await statusCheck('r04');
    const n = s.report?.stages.normalized;
    return { ...s, statusText: undefined, ok: s.exit === 0 && s.clean && n?.status === 'ok' && n.heads === 1, normalized: n?.current[0] };
  });
  if (!r4.ok) throw new Fatal('row 4 did not show a clean project; see the evidence files');

  await forkSteps(r4.normalized);

  await step('r09', 'Row 9 (seen from PC 2): the conflict', async () => {
    await waitForOthersCommit(6);
    const s = await statusCheck('r09');
    return { ...s, statusText: undefined, informational: true };
  });
  const r10 = await waitFor('PC 1 to merge (row 10) and the merge to arrive here', () => {
    const d = doneData(readLog(ctx.runDir, 1), 'r10');
    return d?.revision && inProject(d.revision) ? d : false;
  });
  const r11 = await step('r11', 'Row 11: clean after the merge (PC 2)', async () => afterMerge(await statusCheck('r11'), r10.chosen));

  await step('r12', 'Row 12: a file not downloaded, read while offline', () => row12(r11.currentSdd));
  await step('r13', 'Row 13: back online', row13);
  await row14();
  logEvent({ step: 'pc-finished', done: true, data: null });
  banner('PC 2 IS DONE. Go back to PC 1: it writes the report when these results arrive.');
  say('Keep OneDrive running on this PC until PC 1 says the report is written.');
  const report = await waitFor('the report from PC 1 (optional: you can close this window now)', () => findReports(ctx.runDir)[0]);
  say(`The report is in: ${join(ctx.runDir, report)}`);
}

async function row12(currentSdd) {
  const file = join(ctx.project, ...currentSdd.split('/'));
  const result = { file: currentSdd, attrs: {}, freedBy: null };
  result.attrs.before = winAttrs(file);
  let a = result.attrs.before;
  if (!a?.cloudOnly) {
    say('Asking OneDrive to free up space on the current SDD file (attrib +U -P)...');
    const r = spawnSync('attrib', ['+U', '-P', file], { encoding: 'utf8', windowsHide: true });
    result.attribExit = r.status;
    a = await waitCloudOnly(file, FREE_WAIT_S);
    if (a?.cloudOnly) result.freedBy = 'attrib +U -P (the same as "Free up space")';
  } else result.freedBy = 'already cloud-only';
  while (!a?.cloudOnly) {
    await action('free up space on one file', [
      'OneDrive has not freed the file yet. Please do it by hand:',
      `  1. Open File Explorer and go to this folder:`,
      `       ${dirname(file)}`,
      `  2. Right-click the file  ${basename(file)}`,
      '     and choose "Free up space".',
      '  3. Wait until its Status column shows a cloud icon.',
    ]);
    a = await waitCloudOnly(file, Math.ceil(FREE_WAIT_S / 2));
    if (a?.cloudOnly) { result.freedBy = 'File Explorer, Free up space'; break; }
    flush();
    const ans = await ask('The file still looks downloaded. Press Enter to try again, type c to continue anyway (row 12 will be marked inconclusive), or q to stop: ');
    if (quit(ans)) throw new Stop();
    if (ans.trim().toLowerCase() === 'c') { result.freedBy = 'not freed (continued anyway)'; break; }
  }
  result.attrs.freed = winAttrs(file);
  result.cloudOnly = Boolean(result.attrs.freed?.cloudOnly);
  say(`  file attributes now: ${result.attrs.freed ? `${result.attrs.freed.names.join(', ')} (${result.attrs.freed.value})` : 'unknown'}`);

  await action('disconnect this PC from the internet', [
    'Turn on Airplane mode: click the network icon at the bottom right of the screen and',
    'click "Airplane mode" (or turn Wi-Fi off, or unplug the network cable).',
    'Keep this window open. The next steps work without the internet.',
  ]);
  result.offline = !(await online());
  while (!result.offline) {
    flush();
    const ans = await ask(`This PC can still reach the internet (${PROBE_HOST} answered). Disconnect it, then press Enter; or type c to continue anyway (row 12 will be marked inconclusive): `);
    if (quit(ans)) throw new Stop();
    if (ans.trim().toLowerCase() === 'c') break;
    result.offline = !(await online());
  }
  say(`  network: ${result.offline ? 'offline (confirmed)' : 'STILL ONLINE'}`);

  const s = await statusCheck('r12-offline');
  result.attrs.after = winAttrs(file);
  const unreadable = (s.report?.diagnostics ?? []).filter((d) => d.code === 'E-UNREADABLE');
  result.status = { exit: s.exit, crash: s.crash, clean: s.clean, evidence: s.evidence, sddStatus: s.report?.stages.sdd?.status, unreadable };
  if (s.crash.length) result.outcome = 'crash';
  else if (s.exit === 0 && s.clean) result.outcome = 'A';
  else if (s.exit === 1 && unreadable.length && s.report?.stages.sdd?.status === 'unevaluable') result.outcome = 'B';
  else result.outcome = 'unexpected';
  result.conclusive = result.cloudOnly && result.offline;
  say(`  row 12 outcome: ${describe12(result)}`);
  return result;
}

function describe12(r) {
  const base = {
    A: 'status: clean, exit 0 (Windows still had the file)',
    B: `E-UNREADABLE ${r.status.unreadable.map((d) => `${d.path} (${d.error ?? 'no error given'})`).join(', ')}, sdd unevaluable, exit 1, no crash`,
    crash: `CRASH: ${r.status.crash.join('; ')}`,
    unexpected: `unexpected: exit ${r.status.exit}, sdd ${r.status.sddStatus}`,
  }[r.outcome];
  return r.conclusive ? base : `${base} [inconclusive: ${[!r.cloudOnly && 'the file was not cloud-only', !r.offline && 'the PC was not confirmed offline'].filter(Boolean).join(', ')}]`;
}

async function row13() {
  await action('reconnect this PC to the internet', ['Turn Airplane mode off (or Wi-Fi on, or plug the cable back in).']);
  await waitFor('the internet connection', online);
  let attempts = 0;
  await waitFor('OneDrive to bring the file back and the project to be clean', async () => {
    attempts++;
    const r = await eps('poll', ['status', ctx.project], { quiet: true });
    return r.code === 0 && /^status: clean$/m.test(r.stdout);
  });
  const s = await statusCheck('r13');
  return { ...s, statusText: undefined, attempts, ok: s.exit === 0 && s.clean && !s.crash.length };
}

// ---------------------------------------------------------------- the report

const findReports = (runDir) => (existsSync(runDir) ? readdirSync(runDir).filter((n) => n.startsWith(REPORT_NAME) && n.endsWith('.md')).sort() : []);
const yesNo = (b) => (b === true ? 'pass' : b === false ? '**FAIL**' : 'not run');
const ev = (pc, files) => [files].flat().filter(Boolean).map((f) => `pc${pc}/${f}`).join(', ');

const AC = [
  ['M1-1', 'Exclusive: a create never replaces an existing name, also against another process', /^M1-1:/],
  ['M1-2', 'Temp file, fsync, link(); wx where links are unavailable; never rename() onto a final name', /^M1-2:/],
  ['M1-3', 'The writer behaves on disk as in memory; EX-02 written to disk equals the fixture', /^M1-3:/],
  ['M1-4', 'Every example read from disk equals its expected report', /^M1-4:/],
  ['M1-5', 'Links are never followed', /^M1-5:/],
  ['M1-6', 'A killed process leaves only §10 states; rerunning completes', /^M1-6:/],
  ['M1-7', 'Own temporary files removed; stale ones removed on the next write; fresh ones kept', /^M1-7:/],
  ['M1-8', 'eps commands; report identical to the library; exit codes 0/1/2', /^M1-8:/],
  ['M1-9', 'In OneDrive: link() and wx refuse existing names; paths over 260 characters work', null],
  ['M1-10', 'Two PCs synchronizing through OneDrive (step 3)', null],
  ['M1-11', 'Work files: a briefly refused rename is retried about 1.5 s, then fails cleanly', /^item 4: replace\(\)/],
  ['M1-12', 'An unreadable file is reported (E-UNREADABLE), dependants not evaluable, eps exits 1', /^(R-E10|eps: an unreadable file)/],
];

function writeReport(runDir) {
  const L = [1, 2].map((pc) => readLog(runDir, pc));
  const d = (pc, id) => doneData(L[pc - 1], id);
  const session = (pc) => L[pc - 1].find((e) => e.note === 'session');
  const out = [];
  const p = (s = '') => out.push(s);

  p('# M1 validation report: what was observed');
  p();
  p(`Run \`${basename(runDir)}\`, folder \`${runDir}\`. Written ${now()} on ${HOST}.`);
  p();
  p('This report was produced by `validation/m1-validate.mjs` from the evidence files in the run folder. It records');
  p('observations; it is **not** the sign-off. The registrar decides, and fills in the Registrar column of');
  p('`validation/M1-validation.md`. Synthetic data only.');
  p();
  p('## The two PCs');
  p();
  p('| | PC 1 | PC 2 |');
  p('|---|---|---|');
  p(`| Computer | ${session(1)?.host ?? '—'} | ${session(2)?.host ?? '—'} |`);
  p(`| Node | ${session(1)?.node ?? '—'} | ${session(2)?.node ?? '—'} |`);
  p(`| EPS commit | ${session(1)?.commit ?? '—'} | ${session(2)?.commit ?? '—'} |`);
  p(`| Uncommitted changes in the repository | ${changes(session(1))} | ${changes(session(2))} |`);
  p(`| Validation script SHA-256 | ${session(1)?.scriptSha?.slice(0, 16) ?? '—'}… | ${session(2)?.scriptSha?.slice(0, 16) ?? '—'}… |`);
  p(`| Started | ${session(1)?.t ?? '—'} | ${session(2)?.t ?? '—'} |`);
  p(`| Finished | ${L[0].find((e) => e.step === 'pc-finished')?.t ?? 'not finished'} | ${L[1].find((e) => e.step === 'pc-finished')?.t ?? 'not finished'} |`);
  if ((session(1)?.host && session(1)?.host === session(2)?.host)) p(`| **Note** | **Both PCs report the same computer name: this was not a two-PC run.** | |`);
  p();

  p('## Step 1: automated checks');
  p();
  p('| | PC 1 | PC 2 |');
  p('|---|---|---|');
  const s1 = [d(1, 's1'), d(2, 's1')];
  p(`| \`npm run check\` (schemas, examples, module, tests) | ${s1.map((s) => (s ? `${yesNo(s.ok)}: ${s.counts?.pass} of ${s.counts?.tests} tests` : 'not run')).join(' | ')} |`);
  p(`| Disk tests inside OneDrive | ${s1.map((s) => (s ? `${yesNo(s.oneDrive.exit === 0)}: ${s.oneDrive.pass} of ${s.oneDrive.tests}` : 'not run')).join(' | ')} |`);
  p(`| Probe: link / wx onto an existing name | ${s1.map((s) => (s?.probe ? `${s.probe['link onto an existing name (must fail with EEXIST)']} / ${s.probe['wx onto an existing name (must fail with EEXIST)']}` : '—')).join(' | ')} |`);
  p(`| Probe: path over 260 characters | ${s1.map((s) => s?.probe?.['path over 260 characters'] ?? '—').join(' | ')} |`);
  p(`| Evidence | ${s1.map((s, i) => (s ? ev(i + 1, [...s.parts.map((x) => x.evidence), s.oneDrive.evidence, s.probeEvidence]) : '—')).join(' | ')} |`);
  p();
  p('## Step 2: the demo');
  p();
  p('| | PC 1 | PC 2 |');
  p('|---|---|---|');
  const s2 = [d(1, 's2'), d(2, 's2')];
  p(`| Result | ${s2.map((s) => (s ? `${yesNo(s.ok)}: ${s.lastLine}` : 'not run')).join(' | ')} |`);
  p(`| Evidence | ${s2.map((s, i) => (s ? ev(i + 1, s.evidence) : '—')).join(' | ')} |`);
  p();

  p('## Step 3: two PCs synchronizing through OneDrive');
  p();
  p('| Row | PC | Observed | Expected | Result | Evidence |');
  p('|---|---|---|---|---|---|');
  const st = (x) => (x ? `exit ${x.exit}; ${x.clean ? 'status: clean' : 'not clean'}${x.crash?.length ? `; crash: ${x.crash.join(', ')}` : ''}` : '');
  const stages = (x, ...names) => names.map((n) => `${n} ${x?.report?.stages[n]?.status}, ${x?.report?.stages[n]?.heads} head(s)`).join('; ');
  const diags = (x) => (x?.report?.diagnostics ?? []).map((g) => `${g.code} ${g.path ?? ''}${g.error ? ` (${g.error})` : ''}`.trim()).join(', ') || 'no diagnostics';
  const row = (n, pc, obs, exp, res, evidence) => p(`| ${n} | ${pc} | ${obs} | ${exp} | ${res} | ${evidence} |`);
  const r = (pc, id) => d(pc, id);
  row(1, 'PC 1', r(1, 'r01') ? `exit ${r(1, 'r01').exit}` : '', '`created urn:uuid:…`', r(1, 'r01') ? yesNo(r(1, 'r01').ok) : 'not run', ev(1, r(1, 'r01')?.evidence));
  row(2, 'PC 1', r(1, 'r02') ? `exit ${r(1, 'r02').exit}` : '', '`added source/…`', r(1, 'r02') ? yesNo(r(1, 'r02').ok) : 'not run', ev(1, r(1, 'r02')?.evidence));
  row(3, 'PC 1', r(1, 'r03') ? `exit ${r(1, 'r03').exit}; ${r(1, 'r03').normalized}` : '', '`committed normalized/revisions/…`', r(1, 'r03') ? yesNo(r(1, 'r03').ok) : 'not run', ev(1, r(1, 'r03')?.evidence));
  row(4, 'PC 2', r(2, 'r04') ? `${st(r(2, 'r04'))}; ${stages(r(2, 'r04'), 'normalized')}` : '', '`normalized ok, 1 head`, clean', r(2, 'r04') ? yesNo(r(2, 'r04').ok) : 'not run', ev(2, r(2, 'r04')?.evidence));
  row(5, 'both', [1, 2].map((pc) => (r(pc, 'r05') ? `PC ${pc} confirmed paused ${r(pc, 'r05').confirmedAt}` : `PC ${pc}: not confirmed`)).join('; '), 'paused on both', r(1, 'r05') && r(2, 'r05') ? 'confirmed on both PCs by the person running them' : 'not run', '');
  row(6, 'PC 1', r(1, 'r06') ? `exit ${r(1, 'r06').exit}; ${r(1, 'r06').artifact}` : '', '`committed sdd/revisions/…`', r(1, 'r06') ? yesNo(r(1, 'r06').exit === 0) : 'not run', ev(1, r(1, 'r06')?.evidence));
  row(7, 'PC 2', r(2, 'r07') ? `exit ${r(2, 'r07').exit}; ${r(2, 'r07').artifact}` : '', '`committed sdd/revisions/…`', r(2, 'r07') ? yesNo(r(2, 'r07').exit === 0) : 'not run', ev(2, r(2, 'r07')?.evidence));
  row(8, 'both', [1, 2].map((pc) => (r(pc, 'r08') ? `PC ${pc} resumed ${r(pc, 'r08').confirmedAt}` : `PC ${pc}: not confirmed`)).join('; '), 'resumed; both SDDs arrive', r(1, 'r09') && r(2, 'r09') ? 'both SDDs arrived on both PCs' : 'not run', '');
  const r9 = r(1, 'r09');
  row(9, 'PC 1', r9 ? `${st(r9)}; ${stages(r9, 'sdd')}; ${diags(r9)}` : '', '`sdd conflicted, 2 heads`, `E-STAGE-CONFLICT`, exit 1; no `E-INTEGRITY`, no `W-INTERRUPTED-REVISION`', r9 ? yesNo(r9.ok) : 'not run', ev(1, r9?.evidence));
  const r9b = r(2, 'r09');
  row('9 (seen on PC 2)', 'PC 2', r9b ? `${st(r9b)}; ${stages(r9b, 'sdd')}; ${diags(r9b)}` : '', 'information only (PC 1 may already have merged)', r9b ? 'observed' : 'not run', ev(2, r9b?.evidence));
  row(10, 'PC 1', r(1, 'r10') ? `exit ${r(1, 'r10').exit}; chose ${r(1, 'r10').chosen}` : '', '`merged sdd/revisions/…`', r(1, 'r10') ? yesNo(r(1, 'r10').ok) : 'not run', ev(1, r(1, 'r10')?.evidence));
  for (const pc of [1, 2]) {
    const x = r(pc, 'r11');
    row(11, `PC ${pc}`, x ? `${st(x)}; ${stages(x, 'sdd')}; current ${x.currentSdd}` : '', '`sdd ok, 1 head`, the chosen SDD current, clean', x ? yesNo(x.ok) : 'not run', ev(pc, x?.evidence));
  }
  const r12 = r(2, 'r12');
  row(12, 'PC 2', r12 ? describe12(r12) : '', 'clean, or `E-UNREADABLE` with its error, `sdd unevaluable`, exit 1; no crash', r12 ? (r12.outcome === 'A' || r12.outcome === 'B' ? (r12.conclusive ? 'pass' : 'inconclusive') : '**FAIL**') : 'not run', ev(2, r12?.status?.evidence));
  const r13 = r(2, 'r13');
  row(13, 'PC 2', r13 ? `${st(r13)} (after ${r13.attempts} check(s))` : '', 'clean, exit 0', r13 ? yesNo(r13.ok) : 'not run', ev(2, r13?.evidence));
  const r14 = [r(1, 'r14'), r(2, 'r14')];
  row(14, 'both', r14.map((x, i) => (x ? `PC ${i + 1}: ${tempSummary(x)}` : `PC ${i + 1}: not run`)).join('; '), 'note any `W-TEMP-FILE`; rare and harmless', r14.every(Boolean) ? 'observed' : 'not run', '');
  p();

  p('### Row 12 in detail');
  p();
  if (!r12) p('Not run.');
  else {
    p(`- File: \`${r12.file}\``);
    p(`- Attributes before: ${attrText(r12.attrs.before)}`);
    p(`- Freed by: ${r12.freedBy}${r12.attribExit !== undefined ? ` (attrib exit code ${r12.attribExit})` : ''}`);
    p(`- Attributes when freed: ${attrText(r12.attrs.freed)} → cloud-only: **${r12.cloudOnly ? 'yes' : 'no'}**`);
    p(`- Network when \`status\` ran: **${r12.offline ? 'offline (a connection to ' + PROBE_HOST + ' failed)' : 'online'}**`);
    p(`- \`eps status\`: exit ${r12.status.exit}; sdd ${r12.status.sddStatus}; crash signs: ${r12.status.crash.length ? r12.status.crash.join('; ') : 'none'}`);
    p(`- E-UNREADABLE: ${r12.status.unreadable.length ? r12.status.unreadable.map((g) => `\`${g.path}\`, error \`${g.error ?? '—'}\``).join('; ') : 'none'}`);
    p(`- Attributes afterwards: ${attrText(r12.attrs.after)}`);
    p(`- **Outcome: ${describe12(r12)}**`);
  }
  p();
  p('### Row 14 in detail');
  p();
  for (const [i, x] of r14.entries()) {
    if (!x) { p(`- PC ${i + 1}: not run.`); continue; }
    p(`- PC ${i + 1}: W-TEMP-FILE in saved status/report outputs: ${x.inOutputs.length ? x.inOutputs.map((o) => `\`${o.line}\` (${o.file})`).join('; ') : 'none'}. Seen while waiting for OneDrive: ${x.seenWhilePolling.length ? x.seenWhilePolling.map((s) => `\`${s}\``).join(', ') : 'none'}. \`.eps-tmp-\` files left in the project at the end: ${x.presentNow.length ? x.presentNow.map((s) => `\`${s}\``).join(', ') : 'none'}.`);
  }
  p();
  p('Temporary files exist only for a moment, so this covers the saved outputs and the checks made every few seconds while');
  p('waiting for OneDrive; one that came and went between checks would not be seen.');
  p();

  p('## Acceptance criteria: what this run shows');
  p();
  p('"Automated" means the named tests ran in step 1 on that PC; it is evidence for the registrar, not a sign-off.');
  p();
  p('| AC | Criterion | PC 1 | PC 2 | Registrar |');
  p('|---|---|---|---|---|');
  for (const [id, text, re] of AC) {
    let cells;
    if (re) cells = s1.map((s) => acTests(s, re));
    else if (id === 'M1-9') cells = s1.map((s) => (s ? `${yesNo(Boolean(s.probe) && s.probe['link onto an existing name (must fail with EEXIST)'] === 'EEXIST' && s.probe['wx onto an existing name (must fail with EEXIST)'] === 'EEXIST' && String(s.probe['path over 260 characters']).startsWith('ok') && s.oneDrive.exit === 0)}: probe and ${s.oneDrive.pass} of ${s.oneDrive.tests} disk tests in OneDrive` : 'not run'));
    else cells = [m110(r), 'see step 3'];
    p(`| ${id} | ${text} | ${cells[0]} | ${cells[1]} | |`);
  }
  p();
  const open = openPoints(r, s1, s2);
  p('## Not observed, failed or inconclusive');
  p();
  if (open.length) for (const o of open) p(`- ${o}`);
  else p('None: every row was run and gave the expected result. Row 14 is an observation (above).');
  p();

  let name;
  for (let i = 1; ; i++) {
    name = `${REPORT_NAME}${i === 1 ? '' : `-${i}`}.md`;
    try { writeFileSync(join(runDir, name), out.join('\n'), { flag: 'wx' }); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return join(runDir, name);
}

const changes = (s) => (!s ? '—' : s.changes === null ? 'git not available' : s.changes.length ? s.changes.map((c) => `\`${c.trim()}\``).join(', ') : 'none');
const attrText = (a) => (a ? `${a.names.join(', ') || 'none'} (${a.value})` : 'unknown');
const tempSummary = (x) => {
  const all = [...new Set([...x.inOutputs.map((o) => o.line), ...x.seenWhilePolling, ...x.presentNow])];
  return all.length ? all.join(', ') : 'none seen';
};
function acTests(s, re) {
  if (!s) return 'not run';
  const found = s.tests.filter((t) => re.test(t.name));
  if (!found.length) return 'no matching test found';
  const failed = found.filter((t) => !t.ok).length;
  return failed ? `**FAIL**: ${failed} of ${found.length} tests failed` : `automated: ${found.length} test(s) passed`;
}
function m110(r) {
  const need = [[1, 'r01'], [1, 'r02'], [1, 'r03'], [2, 'r04'], [1, 'r09'], [1, 'r10'], [1, 'r11'], [2, 'r11'], [2, 'r13']];
  if (need.some(([pc, id]) => !r(pc, id))) return 'incomplete: not every row was run';
  if (need.some(([pc, id]) => r(pc, id).ok === false)) return '**FAIL**: see step 3';
  const x = r(2, 'r12');
  if (!x) return 'row 12 not run';
  if (!['A', 'B'].includes(x.outcome)) return '**FAIL**: row 12';
  return x.conclusive ? 'rows 1–13 as expected; row 14 observed' : 'rows 1–11 and 13 as expected; **row 12 inconclusive**';
}
function openPoints(r, s1, s2) {
  const o = [];
  for (const pc of [1, 2]) {
    if (!s1[pc - 1]) o.push(`Step 1 not run on PC ${pc}.`); else if (!s1[pc - 1].ok || s1[pc - 1].oneDrive.exit !== 0) o.push(`Step 1 failed on PC ${pc}.`);
    if (!s2[pc - 1]) o.push(`Step 2 not run on PC ${pc}.`); else if (!s2[pc - 1].ok) o.push(`Step 2 failed on PC ${pc}.`);
  }
  for (const [pc, id, label] of [[1, 'r01', 'Row 1'], [1, 'r02', 'Row 2'], [1, 'r03', 'Row 3'], [2, 'r04', 'Row 4'], [1, 'r09', 'Row 9'], [1, 'r10', 'Row 10'], [1, 'r11', 'Row 11 (PC 1)'], [2, 'r11', 'Row 11 (PC 2)'], [2, 'r13', 'Row 13']]) {
    const x = r(pc, id);
    if (!x) o.push(`${label} was not run.`); else if (x.ok === false) o.push(`${label} did not give the expected result.`);
  }
  const x = r(2, 'r12');
  if (!x) o.push('Row 12 was not run.');
  else if (!['A', 'B'].includes(x.outcome)) o.push(`Row 12 failed: ${describe12(x)}.`);
  else if (!x.conclusive) o.push(`Row 12 is inconclusive: ${describe12(x)}.`);
  if (r(1, 'r09')?.foreign?.length) o.push(`Row 9: OneDrive made conflict copies (W-FOREIGN-FILE): ${r(1, 'r09').foreign.join(', ')}.`);
  return o;
}

function finishReport() {
  const file = writeReport(ctx.runDir);
  banner('THE REPORT IS WRITTEN');
  say(file);
  say('It is in OneDrive, so it is also on the other PC. The evidence files are beside it, in pc1 and pc2.');
  if (process.platform === 'win32' && !process.env.EPS_M1_NO_OPEN) spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
}

// ---------------------------------------------------------------- choosing the run

const runs = (root) => (existsSync(root) ? readdirSync(root).filter((n) => /^run-\d{8}-\d{6}$/.test(n)).sort().reverse() : []);

async function choosePc1Run() {
  for (const name of runs(ctx.root)) {
    const dir = join(ctx.root, name);
    const log = readLog(dir, 1);
    if (!log.length || abandoned(dir) || findReports(dir).length) continue;
    flush();
    const a = await ask(`An unfinished run was found: ${name} (started ${log[0].t}). Press Enter to continue it, or type n and Enter to start a new run: `);
    if (a === null) throw new Stop();
    if (a.trim().toLowerCase() !== 'n') return name;
    break;
  }
  mkdirSync(ctx.root, { recursive: true });
  const stamp = now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `run-${stamp}`;
  mkdirSync(join(ctx.root, name)); // fails if it exists: never reuses a folder
  return name;
}

async function choosePc2Run() {
  const candidate = () => {
    for (const name of runs(ctx.root)) {
      const dir = join(ctx.root, name);
      if (abandoned(dir) || findReports(dir).length || isDone(readLog(dir, 2), 'pc-finished')) continue;
      const log1 = readLog(dir, 1);
      if (isDone(log1, 'r03')) return { name, host: log1[0]?.host, t: log1[0]?.t };
    }
    return false;
  };
  const c = candidate() || await waitFor('PC 1 to create the test project (start the validation on PC 1 first)', candidate);
  flush();
  say(`Found the run ${c.name}, started on ${c.host} at ${c.t}.`);
  if (c.host === HOST) {
    const a = await ask(`That run was started on THIS computer (${HOST}). PC 2 must be a different PC. Type y and Enter to continue anyway, or just Enter to stop: `);
    if (a === null || a.trim().toLowerCase() !== 'y') throw new Stop();
  } else if (quit(await ask('Press Enter to continue with it (or type q to stop): '))) throw new Stop();
  return c.name;
}

// ---------------------------------------------------------------- main

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  ctx.root = resolve(opt('--root') ?? (process.env.OneDrive ? join(process.env.OneDrive, 'Documents', 'eps-m1-validation') : ''));
  if (!opt('--root') && !process.env.OneDrive) throw new Fatal('OneDrive was not found on this PC (no %OneDrive% folder). Is OneDrive installed and signed in?');

  if (argv.includes('--report')) {
    const given = argv[argv.indexOf('--report') + 1];
    const dir = given && !given.startsWith('--') ? resolve(given) : join(ctx.root, runs(ctx.root)[0] ?? '');
    if (!existsSync(join(dir, 'pc1'))) throw new Fatal(`no validation run found at ${dir}`);
    ctx.runDir = dir;
    say(`Report written: ${writeReport(dir)}`);
    return 0;
  }

  say('M1 validation assistant (EPS). Synthetic data only; nothing is sent anywhere except by OneDrive itself.');
  say(`Runs are kept in: ${ctx.root}`);
  say('Keep this window open. If it closes, start it again: it continues where it stopped.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Fatal(`Node ${process.version} is too old; Node 22 or later is needed (nodejs.org, the LTS version)`);
  if (!existsSync(EPS)) throw new Fatal(`the eps tool was not found at ${EPS}`);

  let pc = Number(opt('--pc'));
  while (pc !== 1 && pc !== 2) {
    flush();
    const a = await ask('\nWhich PC is this? Type 1 for PC 1 (start there first) or 2 for PC 2, then press Enter: ');
    if (a === null) throw new Stop();
    pc = Number(a.trim());
  }
  ctx.pc = pc;
  ctx.run = pc === 1 ? await choosePc1Run() : await choosePc2Run();
  ctx.runDir = join(ctx.root, ctx.run);
  ctx.pcDir = join(ctx.runDir, `pc${pc}`);
  ctx.project = join(ctx.runDir, 'project');
  mkdirSync(join(ctx.pcDir, 'inputs'), { recursive: true });
  logEvent({ note: 'session', node: process.version, commit: repoCommit(), changes: repoChanges(), scriptSha: createHash('sha256').update(readFileSync(SELF)).digest('hex') });
  say(`\nThis is PC ${pc}, run ${ctx.run}. Evidence is saved in ${ctx.pcDir}`);

  if (pc === 1) await pc1(); else await pc2();
  return 0;
}

main(process.argv.slice(2)).then((code) => { rl.close(); process.exit(code); }, (e) => {
  rl.close();
  if (e instanceof Stop) { say('\nStopped. Nothing was lost: start the validation again to continue where it stopped.'); process.exit(0); }
  if (e instanceof Fatal) { say(`\nSTOPPED: ${e.message}`); process.exit(1); }
  say(`\nUNEXPECTED ERROR in the validation assistant (not in EPS): ${e.stack ?? e}`);
  process.exit(1);
});
