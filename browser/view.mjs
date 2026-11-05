// What the project page shows for a folder: the same evaluation, report bytes and status text as `eps report` and
// `eps status` (M2-i). Pure apart from reading the folder; it never writes.

import { evaluate, canonicalBytes, sha256 } from '../src/contract.mjs';
import { loadTree } from '../src/project.mjs';
import { browserBackend } from '../src/browser-backend.mjs';
import { exitCode, summary } from '../src/summary.mjs';

/** The state of the project in a folder handle: {report, bytes, sha256, text, exit}. */
export async function projectState(handle) {
  const report = evaluate(await loadTree(browserBackend(handle)));
  const bytes = canonicalBytes(report);
  return { report, bytes, sha256: sha256(bytes), text: summary(report), exit: exitCode(report) };
}

/** Plain explanations for what a person can do about some diagnostics in a browser; [] when there is nothing to add. */
export function hints(report) {
  const out = [];
  const listedButMissing = report.diagnostics.filter((d) => d.code === 'E-UNREADABLE' && d.error === 'NotFoundError');
  if (listedButMissing.length) {
    out.push(`${listedButMissing.length === 1 ? 'A file is' : `${listedButMissing.length} files are`} in the folder but the browser could not open `
      + `${listedButMissing.length === 1 ? 'it' : 'them'} (NotFoundError). On Windows this usually means the project folder is too deep: the browser `
      + 'cannot open paths longer than about 250 characters. Move the project to a shorter path (for example directly in Documents) and open it again.');
  }
  if (report.diagnostics.some((d) => d.code === 'E-UNREADABLE' && d.error === 'NotReadableError')) {
    out.push('A file could not be read (NotReadableError). If the folder is in OneDrive, the file may not be downloaded: connect to the internet, '
      + 'or right-click the project folder and choose "Always keep on this device", then read it again.');
  }
  return out;
}

/** One line on what the exit code means, as `eps status` would exit. */
export const verdict = (exit) => [
  'Clean: no errors (exit code 0).',
  'Needs attention: an error, or a damaged, incomplete, conflicted or unevaluable stage (exit code 1).',
  'Not a project, or not a valid one (exit code 2).',
][exit];
