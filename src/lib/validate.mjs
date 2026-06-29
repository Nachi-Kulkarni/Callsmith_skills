import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'providers', '_schema.json'), 'utf8'));

function getType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function typeMatches(value, expected) {
  if (expected === 'integer') return getType(value) === 'number' && Number.isInteger(value);
  return getType(value) === expected;
}

function validateValue(value, schema, path, errors) {
  if (value === undefined) return;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeMatches(value, t))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${getType(value)}`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: "${value}" not in enum [${schema.enum.join(', ')}]`);
  }

  if (schema.type === 'array' || Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${path}: array needs at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateValue(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if ((schema.type === 'object' || getType(value) === 'object') && schema.properties) {
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in value)) errors.push(`${path}.${req}: required field missing`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) validateValue(value[key], sub, `${path}.${key}`, errors);
    }
  }
}

export function validatePack(pack) {
  const errors = [];
  const name = pack.id || pack.label || '<unknown>';
  if (SCHEMA.required) {
    for (const req of SCHEMA.required) {
      if (!(req in pack)) errors.push(`${name}.${req}: required field missing`);
    }
  }
  for (const [key, sub] of Object.entries(SCHEMA.properties)) {
    if (key in pack) validateValue(pack[key], sub, `${name}.${key}`, errors);
  }
  // Defense-in-depth: the resolver treats a missing/empty `format` as a no-op sentinel
  // (isAudioSentinel), which would silently produce zero transforms for a malformed pack.
  // The schema only checks type=string, so explicitly reject empty audio formats here.
  for (const leg of ['ingest', 'egress']) {
    if (pack[leg] && typeof pack[leg].format === 'string' && pack[leg].format === '') {
      errors.push(`${name}.${leg}.format: must not be empty (empty format is silently treated as a no-op by the resolver)`);
    }
  }
  return errors;
}

export function validatePacks() {
  const dir = path.join(ROOT, 'providers');
  const allErrors = [];
  for (const kindDir of fs.readdirSync(dir)) {
    if (kindDir.startsWith('_')) continue;
    const kindPath = path.join(dir, kindDir);
    if (!fs.statSync(kindPath).isDirectory()) continue;
    for (const f of fs.readdirSync(kindPath).filter(f => f.endsWith('.json'))) {
      const pack = JSON.parse(fs.readFileSync(path.join(kindPath, f), 'utf8'));
      allErrors.push(...validatePack(pack));
    }
  }
  return allErrors;
}
