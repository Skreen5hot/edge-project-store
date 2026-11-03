// Reader conformance (EPS header): the evaluation of every example equals its expected.jsonld byte for byte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluate, canonicalBytes } from '../src/contract.mjs';
import { isValid } from '../src/jsonschema.mjs';
import { REPORT_SCHEMA } from '../src/schemas.mjs';
import { treeFromDisk } from './helpers.mjs';

const examples = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const names = readdirSync(examples).filter((n) => /^EX-\d\d-/.test(n)).sort();

test('all 25 examples are present', () => assert.equal(names.length, 25));

for (const name of names) {
  test(`${name} evaluates to its expected report`, () => {
    const report = evaluate(treeFromDisk(join(examples, name, 'project')));
    const expected = readFileSync(join(examples, name, 'expected.jsonld'), 'utf8');
    assert.equal(new TextDecoder().decode(canonicalBytes(report)), expected);
    assert.ok(isValid(REPORT_SCHEMA, report), 'report matches the report schema');
  });
}
