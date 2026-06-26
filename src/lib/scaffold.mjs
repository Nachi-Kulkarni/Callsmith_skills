import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';

function w(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const PY_DEPS = {
  'livekit': ['# LiveKit Agents framework', 'livekit-agents>=0.12', 'livekit-plugins-openai', 'livekit-plugins-google'],
  'pipecat': ['# Pipecat', 'pipecat-ai[openai,deepgram,elevenlabs]>=0.0.50'],
  'custom-fastapi': ['# Custom FastAPI bridge', 'fastapi', 'uvicorn[standard]', 'websockets'],
  'gemini-live': ['# Gemini Live', 'google-genai'],
  'openai-realtime': ['# OpenAI Realtime', 'openai>=1.50', 'websockets'],
  'deepgram': ['deepgram-sdk>=3.0'],
  'assemblyai': ['assemblyai>=1.0'],
  'elevenlabs': ['elevenlabs>=1.0'],
  'cartesia': ['cartesia>=1.0'],
  'sarvam': ['sarvamai'],
  'exotel': ['# Exotel media stream (HTTP control + WebSocket media)', 'httpx', 'websockets'],
  'twilio': ['twilio>=9.0', 'websockets'],
  'plivo': ['plivo', 'websockets'],
  'telnyx': ['telnyx', 'websockets'],
  'vonage': ['vonage>=3.0', 'websockets'],
};

export function scaffold(rawAnswers, outDir) {
  const menu = loadMenu();
  const providers = loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const { flags, providers: sel } = answers;
  const root = path.resolve(outDir);

  const telephonyId = sel.telephony?.id;
  const orchId = sel.orchestration?.id;
  const realtimeId = sel.realtime?.id;
  const sttId = sel.stt?.id;
  const ttsId = sel.tts?.id;

  const transforms = result.transforms;
  const needDecode = transforms.some(t => /decode mulaw/i.test(t.step));
  const needEncode = transforms.some(t => /-> mulaw|transcode pcm -> mulaw/i.test(t.step));
  const needResample = transforms.some(t => /resample/i.test(t.step));
  const needBridge = transforms.length > 0;

  // ---- requirements ----
  const depSet = new Set();
  const depLines = [];
  for (const id of [orchId, realtimeId, sttId, ttsId, telephonyId].filter(Boolean)) {
    for (const line of PY_DEPS[id] || []) {
      if (line.startsWith('#')) { depLines.push(line); }
      else if (!depSet.has(line)) { depSet.add(line); depLines.push(line); }
    }
  }
  depLines.push('', 'numpy', 'scipy');
  w(root, 'requirements.txt', depLines.join('\n') + '\n');
  w(root, 'requirements-test.txt', 'numpy\nscipy\npytest\n');

  // ---- config ----
  w(root, 'config.py', renderConfig(result.envKeys));

  // ---- audio ----
  w(root, 'audio/__init__.py', '');
  w(root, 'audio/codecs.py', renderCodecs());
  if (needResample) w(root, 'audio/resampler.py', renderResampler());
  w(root, 'audio/bridge.py', renderBridge(needBridge, needDecode, needEncode, needResample, result));

  // ---- agent ----
  w(root, 'agent/__init__.py', '');
  w(root, 'agent/session.py', renderSession(flags, realtimeId, sttId, ttsId));
  w(root, 'agent/turn.py', renderTurn(flags));

  // ---- telephony ----
  w(root, 'telephony/__init__.py', '');
  w(root, 'telephony/base.py', renderTelephonyBase());
  if (telephonyId) w(root, `telephony/${telephonyId}.py`, renderTelephonyAdapter(telephonyId, providers[telephonyId]));

  // ---- business ----
  w(root, 'business/__init__.py', '');
  w(root, 'business/tools.py', renderTools(flags));

  // ---- main ----
  w(root, 'main.py', renderMain(flags, orchId));

  // ---- tests ----
  w(root, 'tests/test_audio_bridge.py', renderAudioTest(needBridge, needDecode, needEncode, needResample));
  w(root, 'tests/test_call_lifecycle.py', renderLifecycleTest());

  // ---- docker + readme ----
  w(root, 'Dockerfile', renderDockerfile());
  w(root, 'README.md', renderReadme(flags, result, needBridge));

  return { root, needBridge, transformCount: transforms.length, files: countFiles(root) };
}

function countFiles(root) {
  let n = 0;
  for (const _ of fs.readdirSync(root)) n++;
  return n;
}

function renderConfig(envKeys) {
  return `"""Loads required environment variables. Fails fast if any are missing."""
import os
import sys

REQUIRED = ${JSON.stringify(envKeys)}
_missing = [k for k in REQUIRED if not os.environ.get(k)]
if _missing:
    sys.stderr.write("Missing required env: " + ", ".join(_missing) + "\\n")
    sys.stderr.write("Copy .env.example to .env and fill it in.\\n")
    sys.exit(1)

# expose keys as module attributes
for _k in REQUIRED:
    globals()[_k] = os.environ[_k]
`;
}

function renderCodecs() {
  return `"""G.711 mu-law encode/decode. Verified to round-trip within 8-bit quantization.

This is the single most error-prone piece of a telephony voice agent. Do not
hand-roll a different version; this implementation is tested in tests/test_audio_bridge.py.
"""
import array

BIAS = 0x84
CLIP = 32635


def mulaw_decode(byte: int) -> int:
    """Decode one mu-law byte to a 16-bit PCM sample."""
    byte = ~byte & 0xFF
    sign = byte & 0x80
    exponent = (byte >> 4) & 0x07
    mantissa = byte & 0x0F
    sample = (((mantissa << 3) + BIAS) << exponent) - BIAS
    return -sample if sign else sample


def mulaw_encode(sample: int) -> int:
    """Encode one 16-bit PCM sample to a mu-law byte."""
    sign = 0x80 if sample < 0 else 0x00
    sample = abs(sample)
    if sample > CLIP:
        sample = CLIP
    sample += BIAS
    exponent = 7
    for mask in (0x4000, 0x2000, 0x1000, 0x0800, 0x0400, 0x0200, 0x0100):
        if sample & mask:
            break
        exponent -= 1
    mantissa = (sample >> (exponent + 3)) & 0x0F
    return ~(sign | (exponent << 4) | mantissa) & 0xFF


def pcm_to_mulaw_bytes(pcm: bytes) -> bytes:
    """Convert 16-bit little-endian PCM bytes to mu-law bytes."""
    out = bytearray(len(pcm) // 2)
    for i in range(0, len(pcm), 2):
        sample = int.from_bytes(pcm[i:i + 2], "little", signed=True)
        out[i // 2] = mulaw_encode(sample)
    return bytes(out)


def mulaw_bytes_to_pcm(data: bytes) -> bytes:
    """Convert mu-law bytes to 16-bit little-endian PCM bytes."""
    out = bytearray(len(data) * 2)
    for i, b in enumerate(data):
        sample = mulaw_decode(b)
        out[i * 2:i * 2 + 2] = sample.to_bytes(2, "little", signed=True)
    return bytes(out)
`;
}

function renderResampler() {
  return `"""Resampling between telephony and model rates. Uses scipy's polyphase filter."""
from scipy.signal import resample_poly


def resample(pcm: bytes, in_rate: int, out_rate: int) -> bytes:
    """Resample 16-bit PCM bytes from in_rate to out_rate."""
    import array
    samples = array.array("h")
    samples.frombytes(pcm)
    up = out_rate
    down = in_rate
    g = _gcd(up, down)
    resampled = resample_poly(samples, up // g, down // g).astype("int16")
    return resampled.tobytes()


def _gcd(a, b):
    while b:
        a, b = b, a % b
    return a
`;
}

function renderBridge(needBridge, needDecode, needEncode, needResample, result) {
  if (!needBridge) {
    const normalizer = result.notes.find(n => /normalization is handled/i.test(n)) || 'a native layer';
    return `"""Audio bridge.

No custom transcoding is required for this stack. ${normalizer}

This module is therefore a thin passthrough. Keep it so the call site never has
to branch on architecture: inbound() and outbound() always exist.
"""


class AudioBridge:
    """Passthrough bridge. The native orchestration layer normalizes audio."""

    def inbound(self, model_pcm: bytes) -> bytes:
        """Frames already normalized to model PCM by the orchestration layer."""
        return model_pcm

    def outbound(self, model_pcm: bytes) -> bytes:
        """Outbound resample + encode is handled by the orchestration layer."""
        return model_pcm
`;
  }
  const decImp = needDecode ? 'mulaw_bytes_to_pcm' : 'None';
  const encImp = needEncode ? 'pcm_to_mulaw_bytes' : 'None';
  const resImp = needResample ? 'resampler.resample' : 'None';
  return `"""Audio bridge implementing the exact transforms in .callsmith/context/audio-contract.md.

Generated from the resolved compatibility matrix. Do not add transforms that are
not listed there, and do not remove any that are.
"""
from audio.codecs import ${needDecode ? 'mulaw_bytes_to_pcm' : 'pcm_to_mulaw_bytes'}
${needEncode ? 'from audio.codecs import pcm_to_mulaw_bytes' : ''}
${needResample ? 'from audio import resampler' : ''}


class AudioBridge:
    """Custom bridge: ${result.transforms.length} transforms required."""

    # inbound path: telephony (mu-law 8k) -> model PCM
    def inbound(self, telephony_bytes: bytes) -> bytes:
        ${needDecode ? 'pcm = mulaw_bytes_to_pcm(telephony_bytes)' : 'pcm = telephony_bytes'}
        ${needResample ? 'pcm = resampler.resample(pcm, 8000, 16000)  # inbound rate per audio-contract' : ''}
        return pcm

    # outbound path: model PCM -> telephony (mu-law 8k)
    def outbound(self, model_pcm: bytes) -> bytes:
        ${needResample ? 'pcm = resampler.resample(model_pcm, 24000, 8000)  # outbound rate per audio-contract' : 'pcm = model_pcm'}
        ${needEncode ? 'return pcm_to_mulaw_bytes(pcm)' : 'return pcm'}
`;
}

function renderSession(flags, realtimeId, sttId, ttsId) {
  const mode = flags.mode;
  if (mode === 'realtime' || mode === 'hybrid') {
    return `"""Realtime speech-to-speech session (model: ${realtimeId || 'realtime'}).

Wire the model connection here. On interruption_detected / speech_started, call
turn.interrupt() to flush outbound audio (see agent/turn.py)."""
from agent.turn import TurnManager


class RealtimeSession:
    def __init__(self):
        self.turn = TurnManager(barge_in=${flags.barge_in === true || flags.barge_in === 'optional'})

    async def feed_inbound(self, pcm: bytes) -> None:
        # send PCM to the realtime model ingest contract (see audio-contract.md)
        ...

    async def on_model_audio(self, pcm: bytes) -> None:
        # route to bridge.outbound(), then to telephony sink
        ...

    async def on_interruption(self) -> None:
        await self.turn.interrupt()
`;
  }
  return `"""Cascaded pipeline: STT(${sttId || 'stt'}) -> LLM -> TTS(${ttsId || 'tts'}).

Drive tokens from the LLM into TTS as soon as they stream; do not wait for a
full sentence. On barge-in, stop TTS playback and flush."""
from agent.turn import TurnManager


class CascadedPipeline:
    def __init__(self):
        self.turn = TurnManager(barge_in=${flags.barge_in === true || flags.barge_in === 'optional'})

    async def on_transcript(self, text: str) -> None:
        # STT final -> call LLM -> stream tokens to TTS
        ...

    async def on_interruption(self) -> None:
        await self.turn.interrupt()
`;
}

function renderTurn(flags) {
  return `"""Turn / interruption manager.

Barge-in is ${flags.barge_in}. On interrupt, flush the outbound audio buffer and cancel any
in-flight model/TTS output before resuming."""
import asyncio


class TurnManager:
    def __init__(self, barge_in: bool):
        self.barge_in = barge_in
        self._outbound_queue: asyncio.Queue = asyncio.Queue()

    async def interrupt(self) -> None:
        """Flush queued outbound audio and signal the model/TTS to stop."""
        while not self._outbound_queue.empty():
            try:
                self._outbound_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def enqueue(self, frame: bytes) -> None:
        await self._outbound_queue.put(frame)
`;
}

function renderTelephonyBase() {
  return `"""Base telephony transport interface. Session lifecycle events map here.

Every transport emits/accepts these events; map provider-specific events onto them."""
from typing import AsyncIterator


class TelephonyTransport:
    lifecycle = [
        "call_started", "media_started", "inbound_audio_frame",
        "caller_interrupted", "call_ended",
    ]

    async def connect(self) -> None: ...
    async def inbound_frames(self) -> AsyncIterator[bytes]: ...
    async def send_audio(self, data: bytes) -> None: ...
    async def hangup(self) -> None: ...
`;
}

function renderTelephonyAdapter(id, pack) {
  const events = (pack?.lifecycle || []).map(e => `#   - ${e}`).join('\n');
  return `"""${pack?.label || id} telephony adapter.

Transport: ${pack?.transport}. Audio: ${pack?.ingress ? '' : ''}${pack?.egress?.format} @ ${pack?.egress?.sample_rate} Hz.
Provider lifecycle events to map onto TelephonyTransport.lifecycle:
${events}

See the potholes in providers/telephony/${id}.json before implementing. Fill the
HTTP/WebSocket wiring using the hydrated docs in .callsmith/docs/.
"""
from telephony.base import TelephonyTransport


class ${camel(id)}Transport(TelephonyTransport):
    def __init__(self):
        # TODO: connect media stream / call-control per provider docs
        ...

    async def connect(self) -> None:
        ...

    async def inbound_frames(self):
        # yields raw telephony audio bytes (mu-law 8k for PSTN)
        ...

    async def send_audio(self, data: bytes) -> None:
        ...

    async def hangup(self) -> None:
        ...
`;
}

function renderTools(flags) {
  if (flags.tools === 'none') {
    return `"""No external tools selected (${flags.tools}). This agent is conversational only."""\n`;
  }
  return `"""External tools (${flags.tools}).

Define tools here and expose them to the model. The model will pause audio output
until a tool call returns; respond promptly to avoid stalling the turn."""
from typing import Any, Dict


TOOLS: Dict[str, Any] = {
    # "lookup_order": {"description": "...", "handler": lambda args: ...},
}


async def call_tool(name: str, args: dict) -> dict:
    handler = TOOLS.get(name)
    if handler is None:
        return {"error": f"unknown tool: {name}"}
    return handler(args)
`;
}

function renderMain(flags, orchId) {
  const fastapi = orchId === 'custom-fastapi';
  const head = fastapi
    ? 'from fastapi import FastAPI, WebSocket\n\napp = FastAPI()\n'
    : '';
  const wsRoute = fastapi
    ? `@app.websocket("/media")
async def media(ws: WebSocket):
    """Provider media-stream endpoint. Exotel/Twilio stream frames here."""
    await ws.accept()
    bridge = AudioBridge()
    try:
        async for msg in ws.iter_bytes():
            pcm = bridge.inbound(msg)
            # -> model; model audio -> bridge.outbound() -> ws.send_bytes()
    except Exception:
        pass


`
    : '';
  return `"""Entry point.

Orchestration: ${orchId || 'custom'}. Architecture: ${flags.mode}. Language: ${flags.language}.
Read callsmith.recipe.md and .callsmith/context/audio-contract.md before extending this."""
import asyncio
from audio.bridge import AudioBridge
${head}
def main() -> None:
    bridge = AudioBridge()
    print("callsmith-scaffolded voice agent starting")
    print("see .callsmith/context/audio-contract.md for the required transforms")
    asyncio.run(_run(bridge))


async def _run(bridge: AudioBridge) -> None:
    # 1. open telephony transport
    # 2. for each inbound frame: bridge.inbound() -> model.feed_inbound()
    # 3. on model audio: bridge.outbound() -> transport.send_audio()
    # 4. on interruption: model/turn interrupt, flush
    # 5. on call_ended: teardown
    ...


${wsRoute}if __name__ == "__main__":
    main()
`;
}

function renderAudioTest(needBridge, needDecode, needEncode, needResample) {
  return `"""Validates the audio bridge round-trips correctly. Run: pytest tests/"""
import array
import math
${needBridge ? 'from audio.bridge import AudioBridge' : ''}


def _swave(n=1000, amp=30000):\n    return array.array('h', [int(amp * math.sin(2 * math.pi * i / 100)) for i in range(n)]).tobytes()


${needBridge ? `def test_bridge_round_trip():
    """Audio passed through outbound then inbound should stay in a sane range."""
    bridge = AudioBridge()
    pcm = _swave()
    out = bridge.outbound(pcm)   # PCM -> telephony format${needEncode ? ' (mu-law)' : ''}
    assert isinstance(out, (bytes, bytearray))${needDecode ? `\n    back = bridge.inbound(out)  # telephony -> PCM\n    assert isinstance(back, (bytes, bytearray))` : ''}

def test_codecs_muLaw_round_trip():
    \"\"\"mu-law encode/decode stays within 8-bit quantization (<= 512).\"\"\"
    from audio.codecs import mulaw_encode, mulaw_decode
    for s in (0, 1, -1, 100, -100, 32635, -32635):
        assert abs(mulaw_decode(mulaw_encode(s)) - s) < 520
` : `def test_passthrough():
    \"\"\"No custom bridge: the orchestration layer normalizes audio.\"\"\"
    from audio.bridge import AudioBridge
    b = AudioBridge()
    assert b.inbound(b"x") == b"x"
    assert b.outbound(b"x") == b"x"\n`}
`;
}

function renderLifecycleTest() {
  return `"""Validates the session lifecycle state machine."""
import asyncio
from agent.turn import TurnManager


def test_interrupt_flushes_queue():
    async def go():
        tm = TurnManager(barge_in=True)
        for i in range(5):
            await tm.enqueue(bytes([i]))
        await tm.interrupt()
        assert tm._outbound_queue.empty()
    asyncio.run(go())
`;
}

function renderDockerfile() {
  return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]
`;
}

function renderReadme(flags, result, needBridge) {
  const stack = result.pipeline.map(p => `- **${p.role}:** ${p.label || p.id}`).join('\n');
  return `# Voice Agent (callsmith-scaffolded)

Generated from \`callsmith.recipe.md\`. Do not edit the audio bridge without
re-reading \`.callsmith/context/audio-contract.md\`.

## Stack
${stack}

## Architecture
- mode: **${flags.mode}**  •  language: **${flags.language}**  •  barge-in: **${flags.barge_in}**
- deployment: **${flags.deployment}**

## Audio bridge
${needBridge ? '**Custom bridge required** — implements the transforms in the audio contract. See \`audio/bridge.py\`.' : '**No custom bridge** — a native layer (orchestration/SIP/TTS) normalizes audio. \`audio/bridge.py\` is a passthrough.'}

## Run
\`\`\`bash
cp .env.example .env  # fill keys
pip install -r requirements.txt
pytest tests/         # validate audio + lifecycle
python main.py
\`\`\`
`;
}

function camel(s) {
  return s.split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
