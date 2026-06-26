import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from './validate.mjs';

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/callsmith-packs/registry/main/packs';
const FETCH_TIMEOUT_MS = 5000;

function getRegistryConfig() {
  return {
    location: process.env.CALLSMITH_REGISTRY || DEFAULT_REGISTRY_URL,
    skip: process.env.CALLSMITH_REGISTRY_SKIP === '1',
  };
}

function isLocalPath(loc) {
  return loc.startsWith('file://') || (!loc.startsWith('http://') && !loc.startsWith('https://'));
}

async function registryLookup(id, kind) {
  const { location, skip } = getRegistryConfig();
  if (skip) return null;

  if (isLocalPath(location)) {
    const base = location.replace(/^file:\/\//, '');
    const file = path.join(base, kind, `${id}.json`);
    try {
      const data = fs.readFileSync(file, 'utf8');
      const pack = JSON.parse(data);
      const errors = validatePack(pack);
      if (errors.length) return null;
      return { pack, verified: true, source: 'registry' };
    } catch {
      return null;
    }
  }

  try {
    const url = `${location}/${kind}/${id}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return null;
    const pack = await res.json();
    const errors = validatePack(pack);
    if (errors.length) return null;
    return { pack, verified: true, source: 'registry' };
  } catch {
    return null;
  }
}

function synthesizePack(id, kind) {
  const label = id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const pack = {
    id,
    kind,
    label,
    transport: 'websocket',
    ingest: { format: 'pcm', sample_rate: 16000, channels: 1 },
    egress: { format: 'pcm', sample_rate: 16000, channels: 1 },
    directions: ['inbound', 'outbound'],
    native_capabilities: [],
    model: 'UNKNOWN — research required',
    potholes: [{
      id: 'unverified-provider',
      severity: 'blocker',
      note: `UNVERIFIED PROVIDER — "${id}" was synthesized, not loaded from a verified pack. Validate its audio contract (format, sample rate, transport, directions) against live documentation before shipping.`,
    }],
    env_keys: [],
    _synthesized: true,
  };
  return { pack, verified: false, source: 'synthesized' };
}

export async function resolveUnknownProvider(id, kind) {
  const registryResult = await registryLookup(id, kind);
  if (registryResult) return registryResult;
  return synthesizePack(id, kind);
}

export async function resolveUnknowns(providers, answers) {
  const { providers: sel } = answers;
  const merged = { ...providers };
  const resolved = [];

  for (const [role, selection] of Object.entries(sel)) {
    if (role === 'llm') continue;
    if (!selection || !selection.id) continue;
    if (merged[selection.id]) continue;

    const result = await resolveUnknownProvider(selection.id, role);
    if (result) {
      merged[selection.id] = result.pack;
      resolved.push({
        id: selection.id,
        role,
        verified: result.verified,
        source: result.source,
      });
    }
  }

  return { providers: merged, resolved };
}
