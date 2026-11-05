// M2 validation assistant. Walks the registrar through validation/M2-validation.md on one PC: it runs the automated
// checks, prepares sample projects and an empty test folder, serves the pages on http://localhost (this computer
// only), opens them in Chrome or Edge, says exactly what to click, and checks the results itself from the files the
// pages save to the Downloads folder. It writes a report of what was observed.
//
// A validation utility, not part of EPS: it changes nothing in EPS, needs nothing installed beyond Node 22+ and Chrome
// or Edge, never deletes or overwrites anything (every run gets a new folder; evidence files are created new), and
// sends nothing anywhere. Synthetic data only.
//
//   double-click validation\run-m2-validation.cmd        (or: node validation/m2-validate.mjs)
//   node validation/m2-validate.mjs --report [<run folder>] writes a new report from a run's saved evidence
//
// For testing: --root <folder> (default %OneDrive%\Documents\eps-m2-validation), --downloads <folder>,
// --browser <path to chrome.exe or msedge.exe>, --no-launch (print the addresses instead of opening them).

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SELF), '..');
const EPS = join(REPO, 'bin', 'eps.mjs');
const PAGES = join(REPO, 'browser');
const PORT = 8642;
const HOST = hostname();
const V02_COMMIT = '086b470'; // EPS v0.2: spec/, context/ and schemas/ must be unchanged since (M2-j)
const PROJECTS = { conflicted: 'EX-08-stage-conflict', clean: 'EX-02-chain-ok' };
const BROWSERS = [
  ['Chrome', ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']],
  ['Edge', ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']],
];

class Stop extends Error {}
class Fatal extends Error {}

// ---------------------------------------------------------------- console and input (as in m1-validate.mjs)

const say = (s = '') => console.log(s);
const heading = (s) => { say(); say(`=== ${s} ===`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const queued = [];
let waiter = null, inputClosed = false;
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else queued.push(l); });
rl.on('close', () => { inputClosed = true; if (waiter) { const w = waiter; waiter = null; w(null); } });
function ask(q) {
  process.stdout.write(q);
  if (queued.length) return Promise.resolve(queued.shift());
  if (inputClosed) return Promise.resolve(null);
  return new Promise((r) => { waiter = r; });
}
const flush = () => { queued.length = 0; };
const quit = (a) => a === null || a.trim().toLowerCase() === 'q';

function box(title, body) {
  say();
  say('#'.repeat(78));
  say(`#  ACTION NEEDED: ${title}`);
  say('#');
  for (const l of body) say(`#  ${l}`);
  say('#'.repeat(78));
}
async function action(title, body) {
  flush();
  box(title, body);
  if (quit(await ask('Press Enter when done (or type q and Enter to stop): '))) throw new Stop();
}
async function choose(question, options) {
  for (;;) {
    flush();
    say();
    say(question);
    options.forEach(([, label], i) => say(`  ${i + 1}. ${label}`));
    const a = await ask(`Type a number and press Enter (or q to stop): `);
    if (quit(a)) throw new Stop();
    const i = Number(a.trim()) - 1;
    if (options[i]) return options[i][0];
  }
}

// ---------------------------------------------------------------- run folder, log, evidence

const ctx = { root: null, runDir: null, downloads: null, browser: null, launch: true, server: null };
const log = (e) => appendFileSync(join(ctx.runDir, 'log.jsonl'), `${JSON.stringify({ t: now(), host: HOST, ...e })}\n`);
const readLog = (dir) => (existsSync(join(dir, 'log.jsonl')) ? readFileSync(join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const done = (dir, id) => readLog(dir).find((e) => e.step === id && e.done);

function evidence(label, text) {
  const dir = join(ctx.runDir, 'evidence');
  mkdirSync(dir, { recursive: true });
  for (let n = readdirSync(dir).length + 1; ; n++) {
    const name = `${String(n).padStart(2, '0')}-${label}`;
    try { writeFileSync(join(dir, name), text, { flag: 'wx' }); return `evidence/${name}`; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

async function step(id, title, fn) {
  const prev = done(ctx.runDir, id);
  if (prev) { say(`(${title}: already done earlier)`); return prev.data; }
  heading(title);
  const data = (await fn()) ?? null;
  log({ step: id, done: true, data });
  return data;
}

function run(file, args, { env = {}, timeoutMs = 600000 } = {}) {
  return new Promise((resolveRun) => {
    let output = '', finished = false;
    const p = spawn(file, args, { cwd: REPO, env: { ...process.env, ...env }, windowsHide: true });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const end = (code) => { if (!finished) { finished = true; clearTimeout(timer); resolveRun({ code, output }); } };
    p.stdout.on('data', (d) => { output += d; });
    p.stderr.on('data', (d) => { output += d; });
    p.on('error', (e) => { output += `\n[could not start: ${e.message}]`; end(null); });
    p.on('close', end);
  });
}
const epsOut = async (args) => { const r = await run(process.execPath, [EPS, ...args]); return r.output; };

// ---------------------------------------------------------------- browser, downloads, server

function findBrowsers() {
  return BROWSERS.flatMap(([name, paths]) => { const p = paths.find(existsSync); return p ? [[p, name]] : []; });
}

function downloadsFolder() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path"], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const p = (r.stdout ?? '').trim();
  return p && existsSync(p) ? p : join(process.env.USERPROFILE ?? '', 'Downloads');
}

function open(url, extra = []) {
  if (!ctx.launch) { say(`  (open this address yourself: ${url})`); return; }
  spawn(ctx.browser.path, [...extra, url], { detached: true, stdio: 'ignore' }).unref();
}

const pageUrl = (page, where) => (where === 'file' ? pathToFileURL(join(PAGES, page)).href : `http://localhost:${PORT}/${page}`);

async function startServer() {
  const p = spawn(process.execPath, [join(REPO, 'tools', 'serve-local.mjs'), String(PORT)], { cwd: REPO, stdio: 'ignore', windowsHide: true });
  ctx.server = p;
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/eps-project.html`)).ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Fatal(`the local page server did not start on port ${PORT}. Is another program using it? Close other validation windows and try again.`);
}

/** Waits for a file matching `pattern` to appear in Downloads after `since` (ms); the person may also type a path. */
async function waitForDownload(pattern, since, what) {
  say();
  say(`Waiting for ${what} in ${ctx.downloads}`);
  say('  (If the browser saved it somewhere else, type its full path and press Enter. To stop, type q.)');
  for (;;) {
    const typed = queued.shift();
    if (typed !== undefined) {
      if (quit(typed)) throw new Stop();
      const p = typed.trim().replace(/^"|"$/g, '');
      if (p && existsSync(p)) return p;
      if (p) say(`  not found: ${p}`);
    }
    // A file already used by an earlier step is never taken again, however recent it is.
    const used = new Set(readLog(ctx.runDir).map((e) => e.data?.saved).filter(Boolean));
    const hits = readdirSync(ctx.downloads).filter((n) => pattern.test(n)).map((n) => join(ctx.downloads, n))
      .filter((f) => { try { return !used.has(f) && statSync(f).mtimeMs >= since - 2000; } catch { return false; } })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (hits.length) { await sleep(1000); say(`  found ${basename(hits[0])}`); return hits[0]; }
    await sleep(2000);
  }
}

function browserRunning() {
  const exe = basename(ctx.browser.path);
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout ?? '').toLowerCase().includes(exe.toLowerCase());
}

// ---------------------------------------------------------------- the steps

async function automatedChecks() {
  const script = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts.check;
  const parts = [];
  say('Running the same commands as "npm run check" (about 30 seconds)...');
  for (const part of script.split('&&')) {
    const [cmd, ...args] = [...part.trim().matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
    if (cmd !== 'node') throw new Fatal(`unexpected command in npm run check: ${part}`);
    const full = args.includes('--test') ? ['--test', '--test-reporter=spec', ...args.filter((a) => a !== '--test')] : args;
    const r = await run(process.execPath, full);
    const counts = { tests: Number(r.output.match(/^ℹ tests (\d+)/m)?.[1] ?? NaN), pass: Number(r.output.match(/^ℹ pass (\d+)/m)?.[1] ?? NaN), fail: Number(r.output.match(/^ℹ fail (\d+)/m)?.[1] ?? NaN) };
    const tests = [...r.output.matchAll(/^\s*([✔✖])\s+(.+?)\s+\(\d[\d.]*m?s\)\s*$/gmu)].map((m) => ({ ok: m[1] === '✔', name: m[2] }));
    const ev = evidence('step1-check.txt', `command: node ${full.join(' ')}\nexit code: ${r.code}\n----\n${r.output}`);
    say(`  ${r.code === 0 ? 'ok  ' : 'FAIL'} node ${full.join(' ')}${args.includes('--test') ? `  (${counts.pass} of ${counts.tests} tests passed)` : ''}`);
    parts.push({ command: `node ${full.join(' ')}`, exit: r.code, evidence: ev, ...(args.includes('--test') ? { counts, tests } : {}) });
  }
  let unchanged = null;
  const g = spawnSync('git', ['diff', '--name-only', V02_COMMIT, '--', 'spec', 'context', 'schemas'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (g.status === 0) unchanged = g.stdout.trim() === '';
  say(`  ${unchanged === true ? 'ok  ' : unchanged === false ? 'FAIL' : '??  '} spec/, context/ and schemas/ unchanged since EPS v0.2 (${V02_COMMIT})${unchanged === null ? ': git is not available here' : ''}`);
  return { ok: parts.every((p) => p.exit === 0), parts, contractUnchanged: unchanged, changed: g.status === 0 ? g.stdout.trim().split('\n').filter(Boolean) : null };
}

async function prepare() {
  const expected = {};
  for (const [label, example] of Object.entries(PROJECTS)) {
    const target = join(ctx.runDir, 'projects', label);
    if (existsSync(target)) throw new Fatal(`${target} already exists; it was not touched`);
    cpSync(join(REPO, 'examples', example, 'project'), target, { recursive: true, errorOnExist: true, force: false });
    const report = await epsOut(['report', target]);
    expected[label] = { example, sha256: createHash('sha256').update(report).digest('hex'), evidence: evidence(`expected-${label}-report.jsonld`, report), status: (await epsOut(['status', target])).trim() };
    say(`  projects\\${label}: a copy of ${example}; eps report SHA-256 ${expected[label].sha256.slice(0, 16)}…`);
  }
  mkdirSync(join(ctx.runDir, 'test-folder'));
  say('  test-folder: empty, for the browser tests');
  return expected;
}

async function projectPage(where, label, expected) {
  const since = Date.now();
  const folder = join(ctx.runDir, 'projects', label);
  open(pageUrl('eps-project.html', where));
  await action(`the project page ${where === 'file' ? 'opened as a FILE' : 'from http://localhost'}`, [
    `A browser tab titled "EPS project" has opened (its address starts with ${where === 'file' ? '"file:"' : '"localhost"'}).`,
    '  1. Click "Open a project folder…".',
    '  2. Go to this folder and select it (click "Select folder"; allow if the browser asks):',
    `       ${folder}`,
    `  3. The page shows the project. Click "Save the report…".`,
    '     (If the browser asks where to save it, save it in Downloads.)',
  ]);
  const file = await waitForDownload(new RegExp(`^${label}-report( \\(\\d+\\))?\\.jsonld$`), since, `${label}-report.jsonld`);
  const bytes = readFileSync(file);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const ok = sha === expected[label].sha256;
  const ev = evidence(`m2-i-${where}-${label}-report.jsonld`, bytes);
  say(`  ${ok ? 'ok  ' : 'FAIL'} the page's report is ${ok ? 'byte-identical to' : 'DIFFERENT from'} eps report (SHA-256 ${sha.slice(0, 16)}…)`);
  return { where, label, ok, sha256: sha, expected: expected[label].sha256, saved: file, evidence: ev };
}

async function restart() {
  await action('close the browser completely', [
    `Close every ${ctx.browser.name} window (this tests whether the pages remember their folder after a restart).`,
    'Then press Enter here.',
  ]);
  let running = browserRunning();
  for (let i = 0; running && i < 10; i++) { await sleep(1000); running = browserRunning(); }
  if (running) say(`  Note: ${ctx.browser.name} is still running in the background (for example "continue running background apps"). The result is recorded as such.`);
  const results = {};
  for (const where of ['file', 'localhost']) {
    open(pageUrl('eps-project.html', where));
    await sleep(1500);
    const answer = await choose(`On the project page ${where === 'file' ? 'opened as a FILE' : 'from localhost'} that just opened, what does the grey line under the buttons say?`, [
      ['granted', '"Remembered folder: …  Permission when this page loaded: granted." (the project shows at once)'],
      ['prompt', '"… Permission when this page loaded: prompt." (there is a "Reopen" button)'],
      ['denied', '"… Permission when this page loaded: denied."'],
      ['none', '"No folder remembered yet."'],
      ['unavailable', '"Remembering a folder is not available on this page …"'],
    ]);
    let reopened = null;
    if (answer === 'prompt') {
      reopened = await choose('Click the "Reopen …" button and allow if asked. Does the project show?', [[true, 'Yes, the project shows'], [false, 'No']]);
    }
    results[where] = { permissionAfterRestart: answer, reopened };
  }
  return { browserStillRunning: running, ...results };
}

async function browserTests(where) {
  const since = Date.now();
  open(pageUrl('eps-browser-tests.html', where));
  await action(`the browser tests, ${where === 'file' ? 'opened as a FILE (this is page 1)' : 'from http://localhost (this is page 2)'}`, [
    'A tab titled "EPS browser tests" has opened. Keep it open afterwards.',
    '  1. Click "Pick the test folder…" and select this folder (allow editing if asked):',
    `       ${join(ctx.runDir, 'test-folder')}`,
    '  2. Click "Run the automatic tests" and wait for "… automatic tests passed" (about 30 seconds).',
    '  3. Click "Save the results…".',
  ]);
  const file = await waitForDownload(/^eps-browser-tests-.*\.json$/, since, 'eps-browser-tests-….json');
  return readResults(file, `m2-h-${where}-results.json`);
}

function readResults(file, label) {
  const text = readFileSync(file, 'utf8');
  const ev = evidence(label, text);
  let data;
  try { data = JSON.parse(text); } catch { throw new Fatal(`${file} is not the results file the test page saves`); }
  for (const r of data.results) say(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name}${/measured/.test(r.name) ? `: ${r.detail}` : ''}`);
  return { origin: data.origin, userAgent: data.userAgent, results: data.results, evidence: ev, saved: file };
}

async function twoPages() {
  const since = Date.now();
  await action('two pages, two origins (M2-d)', [
    'Use the two "EPS browser tests" tabs: page 1 is the one opened as a FILE, page 2 the one from localhost.',
    'Both already have the test folder picked. On each page, scroll down to "Two pages, two origins" and',
    'press the buttons 1 to 10 in order, each on the page it names. Press 5 and 10 on PAGE 1.',
    'Steps 2 and 7 pause page 2: then do the next step on page 1, and come back to press "Continue".',
    'When step 10 is done, click "Save the results…" on PAGE 1, then press Enter here.',
  ]);
  const file = await waitForDownload(/^eps-browser-tests-.*\.json$/, since, 'the results of page 1');
  const r = readResults(file, 'm2-d-two-pages-results.json');
  const rows = r.results.filter((x) => /^M2-d \((1|2)\), two origins/.test(x.name));
  if (!rows.length) say('  The results have no two-page rows: were steps 5 and 10 pressed on page 1?');
  return { ...r, rows };
}

async function noFolderAccess() {
  const profile = mkdtempSync(join(tmpdir(), 'eps-m2-no-folder-access-'));
  open(pageUrl('eps-project.html', 'file'), [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-blink-features=FileSystemAccessLocal']);
  const seen = await choose(`A separate ${ctx.browser.name} window has opened, started without folder access (a temporary profile; your usual browser is not changed). What does the "EPS project" page in it show?`, [
    ['message', 'An orange notice "This browser cannot open folders: …  A tool such as SDD can still open and save single files…", and "Open a project folder…" is greyed out'],
    ['picker', 'The "Open a project folder…" button works as usual'],
    ['other', 'Something else'],
  ]);
  say('  You can close that separate window now.');
  return { seen, ok: seen === 'message', flags: '--disable-blink-features=FileSystemAccessLocal', profile };
}

// ---------------------------------------------------------------- the report

function writeReport(runDir) {
  const L = readLog(runDir);
  const d = (id) => L.find((e) => e.step === id && e.done)?.data;
  const session = L.find((e) => e.note === 'session') ?? {};
  const out = [];
  const p = (s = '') => out.push(s);
  const pf = (b) => (b === true ? 'pass' : b === false ? '**FAIL**' : 'not run');
  const s1 = d('s1'), prep = d('prepare'), restartData = d('m2-b'), noAccess = d('m2-c');
  const pages = ['m2-i-file', 'm2-i-localhost'].map(d);
  const tests = ['m2-h-file', 'm2-h-localhost'].map(d);
  const two = d('m2-d');
  const testRow = (t, re) => t?.results.find((x) => re.test(x.name));

  p('# M2 validation report: what was observed');
  p();
  p(`Run \`${basename(runDir)}\`, folder \`${runDir}\`. Written ${now()} on ${HOST}.`);
  p();
  p('Produced by `validation/m2-validate.mjs` from the evidence in the run folder. It records observations; it is **not**');
  p('the sign-off: the registrar decides, in `validation/M2-validation.md`. Synthetic data only.');
  p();
  p('| | |');
  p('|---|---|');
  p(`| Computer | ${session.host ?? '—'} |`);
  p(`| Node | ${session.node ?? '—'} |`);
  p(`| EPS commit | ${session.commit ?? '—'} |`);
  p(`| Uncommitted changes | ${session.changes === null ? 'git not available' : session.changes?.length ? session.changes.map((c) => `\`${c.trim()}\``).join(', ') : 'none'} |`);
  p(`| Browser | ${session.browser ?? '—'} |`);
  p(`| Browser version (from the test page) | ${tests.find(Boolean)?.userAgent ?? '—'} |`);
  p(`| Assistant SHA-256 | ${session.scriptSha?.slice(0, 16) ?? '—'}… |`);
  p();
  p('## Step 1: automated checks');
  p();
  if (!s1) p('Not run.');
  else {
    for (const part of s1.parts) p(`- ${pf(part.exit === 0)}: \`${part.command}\`${part.counts ? ` (${part.counts.pass} of ${part.counts.tests} tests)` : ''} (${part.evidence})`);
    p(`- ${pf(s1.contractUnchanged)}: \`spec/\`, \`context/\` and \`schemas/\` unchanged since EPS v0.2 (\`${V02_COMMIT}\`)${s1.changed?.length ? `: changed ${s1.changed.join(', ')}` : ''}`);
  }
  p();
  p('## Step 2: in the browser');
  p();
  p('| AC | What was done | Observed | Result | Evidence |');
  p('|---|---|---|---|---|');
  for (const pg of pages) {
    if (!pg) continue;
    p(`| M2-a, M2-i | Project page ${pg.where === 'file' ? 'opened as a file' : 'from http://localhost'}: opened \`projects/${pg.label}\`, saved the report | SHA-256 \`${pg.sha256.slice(0, 16)}…\`; \`eps report\`: \`${pg.expected.slice(0, 16)}…\` | ${pg.ok ? 'pass: byte-identical' : '**FAIL**: different'} | ${pg.evidence} |`);
  }
  if (restartData) {
    for (const where of ['file', 'localhost']) {
      const x = restartData[where];
      p(`| M2-b | After closing the browser${restartData.browserStillRunning ? ' (it kept running in the background)' : ''}, reopened the project page ${where === 'file' ? 'as a file' : 'from localhost'} | handle: ${['none', 'unavailable'].includes(x.permissionAfterRestart) ? 'not kept' : 'kept'}; permission: ${x.permissionAfterRestart}${x.reopened === null ? '' : `; "Reopen" ${x.reopened ? 'worked' : 'did NOT work'}`} | measured | log.jsonl |`);
    }
  }
  if (noAccess) p(`| M2-c | Project page in ${session.browser ?? 'the browser'} started without folder access (\`${noAccess.flags}\`) | ${{ message: 'the plain notice, Open greyed out', picker: 'the picker still worked', other: 'something else' }[noAccess.seen]} | ${pf(noAccess.ok)} | log.jsonl |`);
  for (const t of tests) {
    if (!t) continue;
    for (const r of t.results) p(`| ${/^M2-/.test(r.name) ? r.name.match(/^M2-\w( \(\d\))?/)[0] : 'M2-h'} | Test page ${t.origin === 'file:' ? 'as a file' : 'from localhost'}: ${r.name} | ${r.detail.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 300)} | ${r.ok ? 'pass' : '**FAIL**'} | ${t.evidence} |`);
  }
  if (two) for (const r of two.rows) p(`| M2-d | Two pages, file: and localhost, one folder: ${r.name} | ${r.detail.replace(/\|/g, '/')} | ${r.ok ? 'pass' : '**FAIL**'} | ${two.evidence} |`);
  p();
  const move = tests.map((t) => testRow(t, /move\(\) does/)?.detail).filter(Boolean);
  p('## M2-d in a real folder');
  p();
  p(move.length ? `What \`move()\` did onto an existing name in the picked folder: ${move.map((m) => `"${m}"`).join('; ')}.` : 'The move() measurement was not run.');
  p('The browser backend is at the **checked** level (R-W9): across origins a write in the check-to-move window cannot be');
  p('prevented; the two-page test shows whether it was refused or detected. A record replaced by one with identical bytes');
  p('cannot be detected, and is harmless (the bytes are the same): a known limit, as R-W9 says.');
  p();
  const failures = [];
  if (s1 && !s1.ok) failures.push('Step 1 failed.');
  if (s1?.contractUnchanged === false) failures.push('The contract files changed since v0.2.');
  for (const pg of pages) if (pg && !pg.ok) failures.push(`The project page's report differed from eps report (${pg.where}).`);
  for (const t of tests) for (const r of t?.results ?? []) if (!r.ok) failures.push(`${t.origin}: ${r.name}`);
  for (const r of two?.rows ?? []) if (!r.ok) failures.push(`Two pages: ${r.name}`);
  if (noAccess && !noAccess.ok) failures.push('M2-c: the page did not say plainly that folders cannot be opened.');
  const missing = [['s1', 'Step 1'], ['m2-i-file', 'the project page as a file'], ['m2-i-localhost', 'the project page from localhost'], ['m2-b', 'the restart (M2-b)'],
    ['m2-h-file', 'the test page as a file'], ['m2-h-localhost', 'the test page from localhost'], ['m2-d', 'the two-page test (M2-d)'], ['m2-c', 'the page without folder access (M2-c)']]
    .filter(([id]) => !d(id)).map(([, what]) => `Not run: ${what}.`);
  if (two && !two.rows.length) missing.push('The two-page results had no M2-d rows.');
  p('## Not observed, failed or inconclusive');
  p();
  for (const f of [...failures, ...missing]) p(`- ${f}`);
  if (!failures.length && !missing.length) p('None: every step was run and gave the expected result. M2-b is a measurement (above).');
  p();
  p('Known limit of this validation: folder access blocked by an organization\'s policy is not tried in a real browser (it needs a');
  p('machine-wide policy). The page\'s words for it (SecurityError, NotAllowedError) are covered by the Node tests.');
  p();
  for (let i = 1; ; i++) {
    const name = `M2-validation-report${i === 1 ? '' : `-${i}`}.md`;
    try { writeFileSync(join(runDir, name), out.join('\n'), { flag: 'wx' }); return join(runDir, name); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// ---------------------------------------------------------------- main

function repoCommit() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}
function repoChanges() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
}

async function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  ctx.root = resolve(opt('--root') ?? (process.env.OneDrive ? join(process.env.OneDrive, 'Documents', 'eps-m2-validation') : join(process.env.USERPROFILE ?? '.', 'eps-m2-validation')));
  const runs = () => (existsSync(ctx.root) ? readdirSync(ctx.root).filter((n) => /^run-\d{8}-\d{6}$/.test(n)).sort().reverse() : []);

  if (argv.includes('--report')) {
    const given = argv[argv.indexOf('--report') + 1];
    const dir = given && !given.startsWith('--') ? resolve(given) : join(ctx.root, runs()[0] ?? '');
    if (!existsSync(join(dir, 'log.jsonl'))) throw new Fatal(`no validation run found at ${dir}`);
    say(`Report written: ${writeReport(dir)}`);
    return 0;
  }

  say('M2 validation assistant (EPS): project folders in the browser. Synthetic data only; nothing is sent anywhere.');
  say('Keep this window open. If it closes, start it again: it continues where it stopped.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Fatal(`Node ${process.version} is too old; Node 22 or later is needed`);

  // The run: continue an unfinished one, or start a new one.
  let runName = null;
  for (const name of runs()) {
    const dir = join(ctx.root, name);
    if (readdirSync(dir).some((n) => n.startsWith('M2-validation-report'))) break;
    flush();
    const a = await ask(`An unfinished run was found: ${name}. Press Enter to continue it, or type n and Enter to start a new run: `);
    if (a === null) throw new Stop();
    if (a.trim().toLowerCase() !== 'n') runName = name;
    break;
  }
  if (!runName) {
    mkdirSync(ctx.root, { recursive: true });
    runName = `run-${now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
    mkdirSync(join(ctx.root, runName));
  }
  ctx.runDir = join(ctx.root, runName);
  say(`Run folder: ${ctx.runDir}`);

  const browsers = opt('--browser') ? [[opt('--browser'), basename(opt('--browser'))]] : findBrowsers();
  if (!browsers.length) throw new Fatal('neither Chrome nor Edge was found on this PC; one of them is needed (they are the browsers with folder access)');
  const prior = readLog(ctx.runDir).find((e) => e.note === 'session')?.browser;
  const pick = prior ? browsers.find(([, n]) => n === prior) ?? browsers[0] : browsers.length === 1 ? browsers[0]
    : await choose('Which browser should the pages open in? (Use the one you will use with SDD.)', browsers.map(([path, name]) => [[path, name], name]));
  ctx.browser = { path: pick[0], name: pick[1] };
  ctx.launch = !argv.includes('--no-launch');
  ctx.downloads = opt('--downloads') ?? downloadsFolder();
  log({ note: 'session', node: process.version, commit: repoCommit(), changes: repoChanges(), browser: ctx.browser.name, browserPath: ctx.browser.path,
    downloads: ctx.downloads, scriptSha: createHash('sha256').update(readFileSync(SELF)).digest('hex') });

  await step('s1', 'Step 1: automated checks', automatedChecks);
  const expected = await step('prepare', 'Preparing two sample projects and an empty test folder', prepare);
  await startServer();
  say(`\nThe pages are served on http://localhost:${PORT} (this computer only) while this window is open.`);

  await step('m2-i-file', 'M2-a, M2-i: the project page opened as a file', () => projectPage('file', 'conflicted', expected));
  await step('m2-i-localhost', 'M2-a, M2-i: the project page from http://localhost', () => projectPage('localhost', 'clean', expected));
  await step('m2-b', 'M2-b: after the browser restarts', restart);
  await step('m2-h-file', 'M2-h: the browser tests, opened as a file', () => browserTests('file'));
  await step('m2-h-localhost', 'M2-h: the browser tests, from http://localhost', () => browserTests('localhost'));
  await step('m2-d', 'M2-d: two pages, two origins, one folder', twoPages);
  await step('m2-c', 'M2-c: a browser without folder access', noFolderAccess);

  const file = writeReport(ctx.runDir);
  say();
  say('*'.repeat(78));
  say('*  THE REPORT IS WRITTEN');
  say('*'.repeat(78));
  say(file);
  if (ctx.launch) spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
  return 0;
}

main(process.argv.slice(2)).then((code) => { ctx.server?.kill(); rl.close(); process.exit(code); }, (e) => {
  ctx.server?.kill();
  rl.close();
  if (e instanceof Stop) { say('\nStopped. Nothing was lost: start the validation again to continue where it stopped.'); process.exit(0); }
  if (e instanceof Fatal) { say(`\nSTOPPED: ${e.message}`); process.exit(1); }
  say(`\nUNEXPECTED ERROR in the validation assistant (not in EPS): ${e.stack ?? e}`);
  process.exit(1);
});
