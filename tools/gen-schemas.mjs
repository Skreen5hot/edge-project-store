// Writes the JSON Schemas in schemas/ (EPS v0.2, contract version 2). Property order in each schema is the
// canonical key order (R-B1). `--check` verifies the files are current.
//
//   node tools/gen-schemas.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const CTX = 'https://skreen5hot.github.io/edge-project-store/context/eps-v2.jsonld';
const BASE = 'https://skreen5hot.github.io/edge-project-store/schemas/';
const VERSION = 2;
const STAGES = ['source', 'normalized', 'sdd', 'rml', 'rdf', 'graph', 'diagrams'];
const RESPONSIBILITIES = ['intake', 'normalizer', 'sdd-author', 'rml-generator', 'rdf-generator', 'graph-loader', 'diagram-exporter'];
const HASH_PREFIX = '([0-9a-f]{8}|[0-9a-f]{16}|[0-9a-f]{32}|[0-9a-f]{64})';
const ARTIFACT_PATH = `^(source|normalized|sdd|rml|rdf|graph|diagrams)/[a-z0-9][a-z0-9-]{0,39}-[0-9]{8}T[0-9]{6}Z-${HASH_PREFIX}\\.[a-z0-9]{1,10}$`;

const defs = {
  context: { const: CTX },
  sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  timestamp: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' },
  projectId: { type: 'string', pattern: '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' },
  role: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
  artifactPath: { type: 'string', pattern: ARTIFACT_PATH },
  producedBy: {
    type: 'object', required: ['responsibility', 'tool', 'version'], additionalProperties: false,
    properties: {
      responsibility: { enum: RESPONSIBILITIES },
      tool: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
      version: { type: 'string', pattern: '^[0-9A-Za-z.+-]{1,64}$' },
    },
  },
  artifactRef: {
    type: 'object', required: ['role', 'path', 'sha256'], additionalProperties: false,
    properties: { role: { $ref: '#/$defs/role' }, path: { $ref: '#/$defs/artifactPath' }, sha256: { $ref: '#/$defs/sha256' } },
  },
  member: {
    type: 'object', required: ['path', 'sha256'], additionalProperties: false,
    properties: { path: { $ref: '#/$defs/artifactPath' }, sha256: { $ref: '#/$defs/sha256' } },
  },
};

const files = new Map();
function schema(name, title, description, required, properties, { extra = {}, keep }) {
  const $defs = Object.fromEntries(Object.entries(defs).filter(([k]) => keep.includes(k)));
  Object.assign($defs, extra);
  files.set(name, {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: BASE + name, title, description,
    type: 'object', required, additionalProperties: false, properties, $defs,
  });
}

schema('edge-project-v2.schema.json', 'edge-project-store EdgeProject, contract version 2',
  'Shape of edge-project.jsonld at the root of a project folder (EPS R-P2). Property order is the canonical key order (R-B1).',
  ['@context', '@id', '@type', 'contractVersion', 'name', 'createdAt'],
  {
    '@context': { $ref: '#/$defs/context' }, '@id': { $ref: '#/$defs/projectId' }, '@type': { const: 'EdgeProject' },
    contractVersion: { const: VERSION }, name: { type: 'string', minLength: 1, maxLength: 200 }, createdAt: { $ref: '#/$defs/timestamp' },
  },
  { keep: ['context', 'projectId', 'timestamp'] });

schema('artifact-record-v2.schema.json', 'edge-project-store ArtifactRecord, contract version 2',
  'Shape of <artifact file name>.record.jsonld (EPS R-P4). An input is either an artifact input {role, relation, path, sha256} or the source collection {role, relation, collection, members}. An artifact input\'s path is any string here: path safety (R-B6, E-PATH-UNSAFE) and the work-folder rule (E-WORK-INPUT) are contract rules checked after this schema, so they get their own diagnostics. Ordering rules and cross-file rules are checked by the contract. Property order is the canonical key order (R-B1).',
  ['@context', '@type', 'contractVersion', 'project', 'stage', 'path', 'kind', 'sha256', 'bytes', 'generation', 'producedBy', 'inputs', 'createdAt'],
  {
    '@context': { $ref: '#/$defs/context' }, '@type': { const: 'ArtifactRecord' }, contractVersion: { const: VERSION },
    project: { $ref: '#/$defs/projectId' }, stage: { enum: STAGES }, path: { $ref: '#/$defs/artifactPath' },
    kind: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' }, sha256: { $ref: '#/$defs/sha256' },
    bytes: { type: 'integer', minimum: 0 }, generation: { enum: ['received', 'deterministic', 'assisted'] },
    producedBy: { $ref: '#/$defs/producedBy' }, inputs: { type: 'array', items: { $ref: '#/$defs/input' } },
    createdAt: { $ref: '#/$defs/timestamp' },
  },
  {
    extra: {
      input: {
        if: { type: 'object', required: ['collection'] },
        then: {
          type: 'object', required: ['role', 'relation', 'collection', 'members'], additionalProperties: false,
          properties: {
            role: { $ref: '#/$defs/role' }, relation: { const: 'dependency' }, collection: { const: 'source' },
            members: { type: 'array', items: { $ref: '#/$defs/member' } },
          },
        },
        else: {
          type: 'object', required: ['role', 'relation', 'path', 'sha256'], additionalProperties: false,
          properties: {
            role: { $ref: '#/$defs/role' }, relation: { enum: ['dependency', 'history'] },
            path: { type: 'string', minLength: 1, maxLength: 1024 }, sha256: { $ref: '#/$defs/sha256' },
          },
        },
      },
    },
    keep: ['context', 'sha256', 'timestamp', 'projectId', 'role', 'artifactPath', 'producedBy', 'member'],
  });

schema('stage-revision-v2.schema.json', 'edge-project-store StageRevision, contract version 2',
  'Shape of <stage>/revisions/rev-<time>-<hash>.jsonld (EPS R-P5). Property order is the canonical key order (R-B1).',
  ['@context', '@type', 'contractVersion', 'project', 'stage', 'parents', 'current', 'producedBy', 'createdAt'],
  {
    '@context': { $ref: '#/$defs/context' }, '@type': { const: 'StageRevision' }, contractVersion: { const: VERSION },
    project: { $ref: '#/$defs/projectId' }, stage: { enum: STAGES.slice(1) },
    parents: { type: 'array', items: { $ref: '#/$defs/sha256' } },
    current: { type: 'array', minItems: 1, items: { $ref: '#/$defs/artifactRef' } },
    producedBy: { $ref: '#/$defs/producedBy' }, createdAt: { $ref: '#/$defs/timestamp' },
  },
  { keep: ['context', 'sha256', 'timestamp', 'projectId', 'role', 'artifactPath', 'producedBy', 'artifactRef'] });

const nullableBoolean = { type: ['boolean', 'null'] };
schema('project-report-v2.schema.json', 'edge-project-store ProjectReport, contract version 2',
  'Shape of the report the contract\'s evaluation produces for a project folder (EPS §7). It is an output of the module, never a file in a project. A null upToDate, historyVerified or inStageCurrent means the value could not be evaluated because a file could not be read (E-UNREADABLE). Property order is the canonical key order (R-B1).',
  ['@context', '@type', 'contractVersion', 'project', 'valid', 'stages', 'artifacts', 'diagnostics'],
  {
    '@context': { $ref: '#/$defs/context' }, '@type': { const: 'ProjectReport' }, contractVersion: { const: VERSION },
    project: { type: ['string', 'null'] }, valid: { type: 'boolean' },
    stages: { type: 'object', additionalProperties: false, properties: Object.fromEntries(STAGES.map((s) => [s, { $ref: '#/$defs/stageReport' }])) },
    artifacts: { type: 'array', items: { $ref: '#/$defs/artifactReport' } },
    diagnostics: { type: 'array', items: { $ref: '#/$defs/diagnostic' } },
  },
  {
    extra: {
      reason: {
        type: 'object', required: ['code', 'input'], additionalProperties: false,
        properties: {
          code: { enum: ['INPUT-MISSING', 'INPUT-ALTERED', 'INPUT-SUPERSEDED', 'UPSTREAM-UNSETTLED', 'UPSTREAM-OUT-OF-DATE', 'SOURCE-CHANGED', 'CYCLE',
            'INPUT-UNREADABLE', 'UPSTREAM-UNEVALUABLE'] },
          input: { type: 'string' },
          added: { type: 'array', items: { $ref: '#/$defs/member' } },
          removed: { type: 'array', items: { $ref: '#/$defs/member' } },
        },
      },
      historyReason: {
        type: 'object', required: ['code', 'input'], additionalProperties: false,
        properties: { code: { enum: ['HISTORY-MISSING', 'HISTORY-ALTERED', 'HISTORY-UNREADABLE'] }, input: { type: 'string' } },
      },
      stageReport: {
        type: 'object', required: ['status', 'heads', 'current'], additionalProperties: false,
        properties: {
          status: { enum: ['empty', 'ok', 'out-of-date', 'conflicted', 'incomplete', 'damaged', 'unevaluable'] },
          heads: { type: 'array', items: { type: 'string' } },
          current: { type: 'array', items: { type: 'string' } },
        },
      },
      artifactReport: {
        type: 'object',
        required: ['path', 'sha256', 'stage', 'inStageCurrent', 'upToDate', 'staleBecause', 'historyVerified', 'historyBecause'],
        additionalProperties: false,
        properties: {
          path: { $ref: '#/$defs/artifactPath' }, sha256: { $ref: '#/$defs/sha256' }, stage: { enum: STAGES },
          inStageCurrent: nullableBoolean, upToDate: nullableBoolean,
          staleBecause: { type: 'array', items: { $ref: '#/$defs/reason' } },
          historyVerified: nullableBoolean,
          historyBecause: { type: 'array', items: { $ref: '#/$defs/historyReason' } },
        },
      },
      diagnostic: {
        type: 'object', required: ['code', 'path'], additionalProperties: false,
        properties: {
          code: { type: 'string', pattern: '^[EW]-[A-Z0-9-]+$' }, path: { type: 'string' },
          error: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        },
      },
    },
    keep: ['context', 'sha256', 'artifactPath', 'member'],
  });

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, value] of files) {
  const text = JSON.stringify(value, null, 2) + '\n';
  const path = join(OUT, name);
  if (check) {
    let current = null;
    try { current = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (current !== text) { console.error(`schemas/${name} is out of date: run node tools/gen-schemas.mjs`); stale++; }
  } else writeFileSync(path, text);
}
if (check && stale) process.exit(1);
console.log(check ? `ok: ${files.size} schemas are current` : `wrote ${files.size} schemas`);
