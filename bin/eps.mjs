#!/usr/bin/env node
// eps: create, write and inspect edge project folders (EPS v0.1) from the command line.
//
//   eps init <folder> --name <name>
//   eps status <folder>                    summary; exit 0 clean, 1 needs attention, 2 not a project or bad usage
//   eps report <folder>                    the ProjectReport (EPS §7), canonical JSON
//   eps add-source <folder> <file> --kind <kind>
//   eps commit <folder> <stage> <file>... --kind <kind> [--role <role>] [--generation deterministic|assisted]
//              [--dep <role>=<path>]... [--history <role>=<path>]... [--sources <role>] [--keep <role>=<path>]...
//   eps merge <folder> <stage> --choose <role>=<path>...
//
// `commit` and `merge` act as the stage's responsibility (§3), as tool "eps-cli". Times come from the clock.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { evaluate, canonicalBytes, STAGES } from '../src/contract.mjs';
import { loadTree, createProject, openProject, EpsWriteError } from '../src/project.mjs';
import { nodeBackend } from '../src/node-backend.mjs';

const TOOL = { tool: 'eps-cli', version: '0.1.0' };
const RESPONSIBILITY = new Map(STAGES.map((s) => [s.stage, s.responsibility]));
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

class UsageError extends Error {}

function parse(argv) {
  const positional = [], flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${key} needs a value`);
      if (!flags.has(key)) flags.set(key, []);
      flags.get(key).push(value);
      i++;
    } else positional.push(a);
  }
  const one = (k, fallback) => {
    const v = flags.get(k);
    if (v === undefined) { if (fallback === undefined) throw new UsageError(`--${k} is required`); return fallback; }
    if (v.length > 1) throw new UsageError(`--${k} given more than once`);
    return v[0];
  };
  const many = (k) => flags.get(k) ?? [];
  return { positional, one, many };
}

const pair = (s, flag) => {
  const i = s.indexOf('=');
  if (i < 1) throw new UsageError(`--${flag} takes <role>=<path>, not ${s}`);
  return { role: s.slice(0, i), path: s.slice(i + 1) };
};

const extOf = (file) => {
  const ext = extname(file).slice(1).toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) throw new UsageError(`${file}: the file needs an extension of 1–10 letters or digits`);
  return ext;
};

async function report(folder) {
  return evaluate(await loadTree(nodeBackend(folder)));
}

/** 0 clean, 1 needs attention (an error diagnostic or an unsettled stage), 2 not a project. */
export function exitCode(r) {
  if (!r.valid) return 2;
  if (r.diagnostics.some((d) => d.code.startsWith('E-'))) return 1;
  if (Object.values(r.stages).some((s) => ['damaged', 'incomplete', 'conflicted'].includes(s.status))) return 1;
  return 0;
}

export function summary(r) {
  const lines = [];
  if (!r.valid) return `not a valid project: ${r.diagnostics.map((d) => `${d.code} ${d.path}`).join(', ')}`;
  lines.push(`project ${r.project}`);
  for (const [stage, s] of Object.entries(r.stages)) {
    if (s.status === 'empty' && s.heads.length === 0) { lines.push(`  ${stage.padEnd(10)} empty`); continue; }
    const heads = stage === 'source' ? '' : `, ${s.heads.length} head${s.heads.length === 1 ? '' : 's'}`;
    lines.push(`  ${stage.padEnd(10)} ${s.status}${heads}`);
    for (const path of s.current) {
      const a = r.artifacts.find((x) => x.path === path);
      const flags = [];
      if (a && !a.upToDate) flags.push(`out of date: ${a.staleBecause.map((x) => `${x.code} ${x.input}`).join('; ')}`);
      if (a && !a.historyVerified) flags.push(`history: ${a.historyBecause.map((x) => x.code).join(', ')}`);
      if (a && a.pipelineReady === true) flags.push('pipeline-ready');
      if (a && a.pipelineReady === false) flags.push(`not ready: ${a.notReadyBecause.join(', ')}`);
      lines.push(`    ${path}${flags.length ? `  [${flags.join(' | ')}]` : ''}`);
    }
  }
  if (r.diagnostics.length) {
    lines.push('diagnostics:');
    for (const d of r.diagnostics) lines.push(`  ${d.code.padEnd(24)} ${d.path}`);
  }
  const stale = Object.entries(r.stages).filter(([, s]) => s.status === 'out-of-date').map(([stage]) => stage);
  if (exitCode(r) !== 0) lines.push('status: needs attention');
  else lines.push(stale.length ? `status: no errors; out of date: ${stale.join(', ')}` : 'status: clean');
  return lines.join('\n');
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parse(rest);
  const folder = args.positional[0] && resolve(args.positional[0]);
  if (!command || command === '--help' || command === 'help') {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   ')).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  if (!folder) throw new UsageError('a project folder is required');
  switch (command) {
    case 'init': {
      if (existsSync(folder) && existsSync(resolve(folder, 'edge-project.jsonld'))) throw new UsageError(`${folder} is already a project`);
      mkdirSync(folder, { recursive: true });
      const id = `urn:uuid:${randomUUID()}`;
      await createProject(nodeBackend(folder), { id, name: args.one('name'), createdAt: iso(new Date()) });
      console.log(`created ${id} in ${folder}`);
      return 0;
    }
    case 'status': {
      const r = await report(folder);
      console.log(summary(r));
      return exitCode(r);
    }
    case 'report': {
      const r = await report(folder);
      process.stdout.write(new TextDecoder().decode(canonicalBytes(r)));
      return exitCode(r);
    }
    case 'add-source': {
      const file = args.positional[1];
      if (!file) throw new UsageError('add-source needs a file');
      const p = await openProject(nodeBackend(folder), TOOL);
      const w = await p.addSource({ kind: args.one('kind'), ext: extOf(file), bytes: new Uint8Array(readFileSync(file)) });
      console.log(`added ${w.path}`);
      return 0;
    }
    case 'commit': {
      const [, stage, ...files] = args.positional;
      if (!RESPONSIBILITY.has(stage) || stage === 'source') throw new UsageError(`commit needs a stage other than source, not ${stage}`);
      if (files.length === 0 && args.many('keep').length === 0) throw new UsageError('commit needs at least one file or --keep');
      const p = await openProject(nodeBackend(folder), { ...TOOL, responsibilities: [RESPONSIBILITY.get(stage)] });
      const inputs = [
        ...args.many('dep').map((s) => ({ ...pair(s, 'dep'), relation: 'dependency' })),
        ...args.many('history').map((s) => ({ ...pair(s, 'history'), relation: 'history' })),
        ...args.many('sources').map((role) => ({ role, collection: 'source' })),
      ];
      const kind = args.one('kind', files.length ? undefined : 'unused');
      const role = args.one('role', kind);
      const generation = args.one('generation', 'deterministic');
      const result = await p.commit(stage, {
        artifacts: files.map((f) => ({ role, kind, ext: extOf(f), generation, bytes: new Uint8Array(readFileSync(f)), inputs })),
        keep: args.many('keep').map((s) => pair(s, 'keep')),
      });
      for (const a of result.artifacts) console.log(`wrote ${a.path}`);
      console.log(`committed ${result.revision}`);
      return 0;
    }
    case 'merge': {
      const stage = args.positional[1];
      if (!RESPONSIBILITY.has(stage) || stage === 'source') throw new UsageError(`merge needs a stage other than source, not ${stage}`);
      const p = await openProject(nodeBackend(folder), { ...TOOL, responsibilities: [RESPONSIBILITY.get(stage)] });
      const chosen = args.many('choose').map((s) => pair(s, 'choose'));
      if (chosen.length === 0) throw new UsageError('merge needs --choose <role>=<path>');
      console.log(`merged ${(await p.merge(stage, { current: chosen })).revision}`);
      return 0;
    }
    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

const self = fileURLToPath(import.meta.url);
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(resolve(process.argv[1]), self)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    if (e instanceof UsageError) { console.error(`eps: ${e.message}`); process.exitCode = 2; return; }
    if (e instanceof EpsWriteError) { console.error(`eps: refused: ${e.message}`); process.exitCode = e.code === 'NOT-A-PROJECT' ? 2 : 1; return; }
    console.error(`eps: ${e.stack ?? e}`);
    process.exitCode = 1;
  });
}
