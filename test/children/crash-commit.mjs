// Child process for M1-6: commits one SDD to a project on disk and dies (process.exit, no cleanup) just before
// creating the first file whose path matches `crashAt`, or completes when `crashAt` is "never".
//   node crash-commit.mjs <project> <crashAt regexp> <normalized path>

import { nodeBackend } from '../../src/node-backend.mjs';
import { openProject } from '../../src/project.mjs';

const [root, crashAt, normalizedPath] = process.argv.slice(2);
const pattern = crashAt === 'never' ? null : new RegExp(crashAt);
const backend = nodeBackend(root, { hooks: { beforeCreate(path) { if (pattern?.test(path)) process.exit(9); } } });
const sdd = await openProject(backend, { tool: 'sdd', version: '1.1.0', responsibilities: ['sdd-author'] });
await sdd.commit('sdd', {
  artifacts: [{ role: 'sdd', kind: 'sdd', ext: 'jsonld', generation: 'assisted', bytes: new TextEncoder().encode('{"sdd":"crash test"}\n'),
    inputs: [{ role: 'structure', relation: 'dependency', path: normalizedPath }] }],
  createdAt: '2026-11-01T10:00:00Z',
});
