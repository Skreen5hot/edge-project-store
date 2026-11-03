// Minimal JSON Schema (draft 2020-12) checker: exactly the keyword subset the EPS schemas use. Pure.
// Adapted from the Semantic Data Dictionary's src/core/jsonschema.mjs (MIT, same author), reduced to a yes/no
// answer, because the contract reports one code per failed schema check (EPS R-P4.3, R-P5), not the cause.
//
// Supported: $ref (local "#/..." pointers only), type, enum, const, minLength, maxLength, pattern, minimum,
// required, properties, additionalProperties, items (single schema), minItems, if/then/else. Annotation-only
// keywords (title, description, $schema, $id) are ignored.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`external $ref not supported: ${ref}`);
  let node = root;
  for (const p of ref.slice(2).split('/')) {
    if (node == null || !Object.hasOwn(node, p)) throw new Error(`unresolvable $ref: ${ref}`);
    node = node[p];
  }
  return node;
}

function codePointLength(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const patternCache = new Map();
function re(p) {
  if (!patternCache.has(p)) patternCache.set(p, new RegExp(p, 'u'));
  return patternCache.get(p);
}

/** True when `instance` is valid against `schema`. */
export function isValid(schema, instance) {
  function walk(s, v) {
    if (s === true || s === undefined) return true;
    if (s === false) return false;
    if (typeof s.$ref === 'string' && !walk(resolveRef(schema, s.$ref), v)) return false;
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(v, t))) return false;
    }
    if (Array.isArray(s.enum) && !s.enum.some((x) => deepEqual(x, v))) return false;
    if (Object.hasOwn(s, 'const') && !deepEqual(s.const, v)) return false;
    if (typeof v === 'string') {
      if (typeof s.minLength === 'number' && codePointLength(v) < s.minLength) return false;
      if (typeof s.maxLength === 'number' && codePointLength(v) > s.maxLength) return false;
      if (typeof s.pattern === 'string' && !re(s.pattern).test(v)) return false;
    }
    if (typeof v === 'number' && typeof s.minimum === 'number' && v < s.minimum) return false;
    const isObj = typeOf(v) === 'object';
    if (isObj && Array.isArray(s.required) && !s.required.every((r) => Object.hasOwn(v, r))) return false;
    if (s.if !== undefined) {
      const branch = walk(s.if, v) ? s.then : s.else;
      if (branch !== undefined && !walk(branch, v)) return false;
    }
    if (isObj && (s.properties !== undefined || s.additionalProperties !== undefined)) {
      const props = s.properties || {};
      for (const k of Object.keys(v)) {
        if (Object.hasOwn(props, k)) {
          if (!walk(props[k], v[k])) return false;
        } else if (s.additionalProperties === false) {
          return false;
        } else if (s.additionalProperties !== undefined && !walk(s.additionalProperties, v[k])) {
          return false;
        }
      }
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === 'number' && v.length < s.minItems) return false;
      if (s.items !== undefined && !v.every((item) => walk(s.items, item))) return false;
    }
    return true;
  }
  return walk(schema, instance);
}
