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

/** One line on what the exit code means, as `eps status` would exit. */
export const verdict = (exit) => [
  'Clean: no errors (exit code 0).',
  'Needs attention: an error, or a damaged, incomplete, conflicted or unevaluable stage (exit code 1).',
  'Not a project, or not a valid one (exit code 2).',
][exit];
