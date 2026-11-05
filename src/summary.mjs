// The text of `eps status` and its exit code, from a ProjectReport. Pure: shared by the eps tool (bin/eps.mjs) and the
// browser project page (browser/), so both show a project's state the same way.

/** 0 clean, 1 needs attention (an error diagnostic, or a damaged, incomplete, conflicted or unevaluable stage), 2 not a project. */
export function exitCode(r) {
  if (!r.valid) return 2;
  if (r.diagnostics.some((d) => d.code.startsWith('E-'))) return 1;
  if (Object.values(r.stages).some((s) => ['damaged', 'incomplete', 'conflicted', 'unevaluable'].includes(s.status))) return 1;
  return 0;
}

export function summary(r) {
  const lines = [];
  if (!r.valid) return `not a valid project: ${r.diagnostics.map((d) => `${d.code} ${d.path}${d.error ? ` (${d.error})` : ''}`).join(', ')}`;
  lines.push(`project ${r.project}`);
  for (const [stage, s] of Object.entries(r.stages)) {
    if (s.status === 'empty' && s.heads.length === 0) { lines.push(`  ${stage.padEnd(10)} empty`); continue; }
    const heads = stage === 'source' ? '' : `, ${s.heads.length} head${s.heads.length === 1 ? '' : 's'}`;
    lines.push(`  ${stage.padEnd(10)} ${s.status}${heads}`);
    for (const path of s.current) {
      const a = r.artifacts.find((x) => x.path === path);
      const flags = [];
      const reasons = (list) => list.map((x) => `${x.code} ${x.input}`).join('; ');
      if (a?.upToDate === true) flags.push('up to date');
      if (a?.upToDate === false) flags.push(`out of date: ${reasons(a.staleBecause)}`);
      if (a?.upToDate === null) flags.push(`not evaluable: ${reasons(a.staleBecause)}`);
      if (a?.historyVerified === false) flags.push(`history: ${reasons(a.historyBecause)}`);
      if (a?.historyVerified === null) flags.push(`history not evaluable: ${reasons(a.historyBecause)}`);
      lines.push(`    ${path}${flags.length ? `  [${flags.join(' | ')}]` : ''}`);
    }
  }
  if (r.diagnostics.length) {
    lines.push('diagnostics:');
    for (const d of r.diagnostics) lines.push(`  ${d.code.padEnd(24)} ${d.path}${d.error ? `  (${d.error})` : ''}`);
  }
  const stale = Object.entries(r.stages).filter(([, s]) => s.status === 'out-of-date').map(([stage]) => stage);
  if (exitCode(r) !== 0) lines.push('status: needs attention');
  else lines.push(stale.length ? `status: no errors; out of date: ${stale.join(', ')}` : 'status: clean');
  return lines.join('\n');
}
