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
  const audio = synthesizedAudioContract(kind);
  const pack = {
    id,
    kind,
    label,
    transport: audio.transport,
    ingest: audio.ingest,
    egress: audio.egress,
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

// Synthesized audio contracts for unknown providers. NOTE: only telephony/realtime/stt/tts
// contracts are pipeline-active (they can be a sink/source in planAudioDiff). The llm and
// vad branches are schema-completeness fillers — those kinds are never an audio sink/source
// (resolver.mjs picks sink from realtime|stt and source from realtime|tts), so their
// contracts never drive transforms. The realtime default mirrors Gemini Live's asymmetric
// 16k-in/24k-out; the synthesized pack carries a blocker UNVERIFIED pothole forcing manual
// verification, so any false asymmetry warning is surfaced to the operator.
function synthesizedAudioContract(kind) {
  if (kind === 'telephony') {
    return {
      transport: 'websocket',
      ingest: { format: 'mulaw', sample_rate: 8000, channels: 1 },
      egress: { format: 'mulaw', sample_rate: 8000, channels: 1 },
    };
  }
  if (kind === 'realtime') {
    return {
      transport: 'websocket',
      ingest: { format: 'pcm', sample_rate: 16000, channels: 1 },
      egress: { format: 'pcm', sample_rate: 24000, channels: 1 },
    };
  }
  if (kind === 'stt') {
    return {
      transport: 'websocket',
      ingest: { format: 'pcm', sample_rate: 16000, channels: 1 },
      egress: { format: 'text', sample_rate: 0, channels: 0 },
    };
  }
  if (kind === 'llm') {
    return {
      transport: 'http',
      ingest: { format: 'text', sample_rate: 0, channels: 0 },
      egress: { format: 'text', sample_rate: 0, channels: 0 },
    };
  }
  if (kind === 'tts') {
    return {
      transport: 'websocket',
      ingest: { format: 'text', sample_rate: 0, channels: 0 },
      egress: { format: 'pcm', sample_rate: 24000, channels: 1 },
    };
  }
  return {
    transport: kind === 'vad' ? 'inline' : 'websocket',
    ingest: { format: 'pcm', sample_rate: 16000, channels: 1 },
    egress: { format: 'pcm', sample_rate: 16000, channels: 1 },
  };
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
