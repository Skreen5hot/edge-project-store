// M1 demo: runs the eps tool through a project's life in a new folder and checks every exit code.
// Writes the transcript to <folder>/demo-transcript.txt. Synthetic data only.
//
//   node demo/m1-demo.mjs <new or empty folder>

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const eps = join(here, '..', 'bin', 'eps.mjs');
const base = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: node demo/m1-demo.mjs <new or empty folder>'); process.exit(2); }
if (existsSync(base) && readdirSync(base).length) { console.error(`${base} is not empty`); process.exit(2); }
mkdirSync(join(base, 'inputs'), { recursive: true });

const pc1 = join(base, 'project'), pc2 = join(base, 'project-on-pc2');
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const rel = (s) => s.split(base + '\\').join('').split(base + '/').join('');
let failures = 0;

function step(title, args, expectedExit, { show = true } = {}) {
  let out, code;
  try { out = execFileSync(process.execPath, [eps, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); code = 0; }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status; }
  const ok = code === expectedExit;
  if (!ok) failures++;
  say(`$ eps ${args.map((a) => rel(a)).join(' ')}`);
  if (show) for (const l of out.trimEnd().split('\n')) say(`  ${rel(l)}`);
  say(`  -> exit ${code} (expected ${expectedExit}) ${ok ? 'OK' : 'MISMATCH'}`);
  say();
  return out;
}
const chapter = (s) => { say(`## ${s}`); say(); };
const input = (name, text) => { const p = join(base, 'inputs', name); writeFileSync(p, text); return p; };
const only = (folder, test) => readdirSync(folder).filter((n) => !n.endsWith('.record.jsonld') && n !== 'revisions' && test(n));

say(`# M1 demo transcript (${new Date().toISOString()})`);
say(`folder: ${base}`);
say();

chapter('1. Create a project and build source -> normalized -> SDD');
step('init', ['init', pc1, '--name', 'M1 demo'], 0);
step('source', ['add-source', pc1, input('schema.json', '{"objectTypes":["Organization","Site"]}\n'), '--kind', 'schema'], 0);
step('normalize', ['commit', pc1, 'normalized', input('normalized-1.json', '{"types":["Organization","Site"]}\n'), '--kind', 'normalized', '--sources', 'sources'], 0);
const n1 = `normalized/${only(join(pc1, 'normalized'), () => true)[0]}`;
step('sdd', ['commit', pc1, 'sdd', input('sdd-1.jsonld', '{"sdd":"first"}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${n1}`], 0);
step('status', ['status', pc1], 0);

chapter('2. A new source file makes everything downstream out of date, recursively');
step('source 2', ['add-source', pc1, input('sample.csv', 'name,site\nA,1\n'), '--kind', 'sample'], 0);
step('status', ['status', pc1], 0);
step('normalize again', ['commit', pc1, 'normalized', input('normalized-2.json', '{"types":["Organization","Site"],"sample":true}\n'), '--kind', 'normalized', '--sources', 'sources'], 0);
const n2 = `normalized/${only(join(pc1, 'normalized'), (n) => n !== n1.split('/')[1])[0]}`;
step('status', ['status', pc1], 0);
const s1 = `sdd/${only(join(pc1, 'sdd'), () => true)[0]}`;
step('sdd again, citing the previous SDD as history', ['commit', pc1, 'sdd', input('sdd-2.jsonld', '{"sdd":"second"}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${n2}`, '--history', `previous=${s1}`], 0);
step('status', ['status', pc1], 0);

chapter('3. Two PCs commit from the same state: the fork is detected and a person merges');
cpSync(pc1, pc2, { recursive: true });
say('(the project folder is copied to stand for a second PC that synchronizes the same folder)');
say();
step('PC 1 commits', ['commit', pc1, 'sdd', input('sdd-pc1.jsonld', '{"sdd":"pc1"}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${n2}`], 0);
step('PC 2 commits', ['commit', pc2, 'sdd', input('sdd-pc2.jsonld', '{"sdd":"pc2"}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${n2}`], 0);
for (const sub of ['sdd', join('sdd', 'revisions')]) {
  for (const name of readdirSync(join(pc2, sub))) if (name !== 'revisions' && !existsSync(join(pc1, sub, name))) cpSync(join(pc2, sub, name), join(pc1, sub, name));
}
say('(synchronization: PC 2\'s new files arrive in PC 1\'s folder)');
say();
step('status', ['status', pc1], 1);
step('an ordinary commit is refused while the stage is conflicted', ['commit', pc1, 'sdd', input('sdd-x.jsonld', '{"sdd":"x"}\n'), '--kind', 'sdd', '--generation', 'assisted', '--dep', `structure=${n2}`], 1);
const pc2File = only(join(pc1, 'sdd'), (n) => readFileSync(join(pc1, 'sdd', n), 'utf8').includes('"pc2"'))[0];
step('a person chooses PC 2\'s SDD', ['merge', pc1, 'sdd', '--choose', `sdd=sdd/${pc2File}`], 0);
step('status', ['status', pc1], 0);

chapter('4. A file edited by hand is detected');
const current = join(pc1, 'sdd', pc2File);
const original = readFileSync(current);
writeFileSync(current, '{"sdd":"edited outside any tool"}\n');
say(`(sdd/${pc2File} is edited by hand)`);
say();
step('status', ['status', pc1], 1);
writeFileSync(current, original);
say('(the person restores the original bytes)');
say();
step('status', ['status', pc1], 0);

chapter('5. The full report');
step('report', ['report', pc1], 0, { show: false });
say('(eps report prints the canonical ProjectReport; run it to see the whole report)');
say();

say(failures === 0 ? 'DEMO PASSED: every exit code was as expected.' : `DEMO FAILED: ${failures} exit code(s) differed.`);
writeFileSync(join(base, 'demo-transcript.txt'), lines.join('\n') + '\n');
process.exitCode = failures === 0 ? 0 : 1;
