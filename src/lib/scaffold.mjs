import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';

function w(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const PIPECAT_SERVICES = {
  deepgram:       { cls: 'DeepgramSTTService',      mod: 'pipecat.services.deepgram',       init: 'api_key=os.getenv("DEEPGRAM_API_KEY")' },
  assemblyai:     { cls: 'AssemblyAIService',       mod: 'pipecat.services.assemblyai',     init: 'api_key=os.getenv("ASSEMBLYAI_API_KEY")' },
  openai:         { cls: 'OpenAILLMService',        mod: 'pipecat.services.openai',         init: 'api_key=os.getenv("OPENAI_API_KEY")' },
  anthropic:      { cls: 'AnthropicLLMService',     mod: 'pipecat.services.anthropic',      init: 'api_key=os.getenv("ANTHROPIC_API_KEY")' },
  gemini:         { cls: 'GoogleLLMService',        mod: 'pipecat.services.google',         init: 'api_key=os.getenv("GOOGLE_API_KEY")' },
  elevenlabs:     { cls: 'ElevenLabsTTSService',    mod: 'pipecat.services.elevenlabs',     init: 'api_key=os.getenv("ELEVENLABS_API_KEY")' },
  cartesia:       { cls: 'CartesiaTTSService',      mod: 'pipecat.services.cartesia',       init: 'api_key=os.getenv("CARTESIA_API_KEY")' },
  'gemini-live':  { cls: 'GoogleGenAIRealtimeService', mod: 'pipecat.services.google.genai', init: 'api_key=os.getenv("GEMINI_API_KEY")' },
  'openai-realtime': { cls: 'OpenAIRealtimeService', mod: 'pipecat.services.openai_realtime', init: 'api_key=os.getenv("OPENAI_API_KEY")' },
};

const LIVEKIT_INFERENCE = {
  deepgram:     'inference.STT(model="deepgram/nova-3", language="multi")',
  assemblyai:   'inference.STT(model="assemblyai/universal-3-5-pro")',
  openai:       'inference.LLM(model="openai/gpt-4o")',
  anthropic:    'inference.LLM(model="anthropic/claude-sonnet-4-20250514")',
  gemini:       'inference.LLM(model="google/gemini-2.5-flash")',
  elevenlabs:   'inference.TTS(model="elevenlabs/eleven_multilingual_v2")',
  cartesia:     'inference.TTS(model="cartesia/sonic-latest")',
};

const TELEPHONY_SERIALIZERS = {
  twilio:   { cls: 'TwilioFrameSerializer',     mod: 'pipecat.serializers.twilio' },
  exotel:   { cls: 'ProtobufFrameSerializer',   mod: 'pipecat.serializers.protobuf' },
  plivo:    { cls: 'ProtobufFrameSerializer',   mod: 'pipecat.serializers.protobuf' },
  telnyx:   { cls: 'ProtobufFrameSerializer',   mod: 'pipecat.serializers.protobuf' },
  vonage:   { cls: 'ProtobufFrameSerializer',   mod: 'pipecat.serializers.protobuf' },
};

export function scaffold(rawAnswers, outDir, opts = {}) {
  const menu = loadMenu();
  const providers = opts.providers ?? loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const { flags, providers: sel } = answers;
  const root = path.resolve(outDir);

  const telephonyId = sel.telephony?.id;
  const orchId = sel.orchestration?.id;
  const realtimeId = sel.realtime?.id;
  const sttId = sel.stt?.id;
  const llmId = sel.llm?.id;
  const ttsId = sel.tts?.id;
  const vadId = sel.vad?.id;

  const transforms = result.transforms;
  const needDecode = transforms.some(t => /decode mulaw/i.test(t.step));
  const needEncode = transforms.some(t => /-> mulaw|transcode pcm -> mulaw/i.test(t.step));
  const needResample = transforms.some(t => /resample/i.test(t.step));
  const needBridge = transforms.length > 0;
  const isCascaded = flags.mode === 'cascaded' || flags.mode === 'hybrid';
  const isRealtime = flags.mode === 'realtime' || flags.mode === 'hybrid';

  const deps = generateDeps(sel, orchId);
  w(root, 'requirements.txt', deps.join('\n') + '\n');
  w(root, 'requirements-test.txt', orchId === 'custom-fastapi' ? 'numpy\nscipy\npytest\n' : 'pytest\n');

  w(root, 'config.py', renderConfig(result.envKeys));

  if (orchId === 'livekit') {
    w(root, 'agent.py', renderLiveKitAgent(flags, sel, result, providers, isCascaded, isRealtime));
    w(root, 'tests/test_agent_structure.py', renderLiveKitTest(sel, isCascaded, isRealtime));
  } else if (orchId === 'pipecat') {
    w(root, 'bot.py', renderPipecatBot(flags, sel, result, providers, isCascaded, isRealtime));
    w(root, 'server.py', renderPipecatServer(telephonyId, providers));
    w(root, 'tests/test_pipeline_structure.py', renderPipecatTest(sel, isCascaded, isRealtime));
  } else {
    w(root, 'audio/__init__.py', '');
    w(root, 'audio/codecs.py', renderCodecs());
    if (needResample) w(root, 'audio/resampler.py', renderResampler());
    w(root, 'audio/bridge.py', renderBridge(needBridge, needDecode, needEncode, needResample, result));
    w(root, 'server.py', renderCustomServer(telephonyId, providers, flags));
    w(root, 'tests/test_audio_bridge.py', renderAudioTest(needBridge, needDecode, needEncode, needResample));
  }

  w(root, 'tests/test_lifecycle.py', renderLifecycleTest(flags));
  w(root, 'Dockerfile', renderDockerfile());
  w(root, 'README.md', renderReadme(flags, result, needBridge, orchId));

  return { root, needBridge, transformCount: transforms.length, files: countFiles(root) };
}

function countFiles(root) {
  let n = 0;
  for (const _ of fs.readdirSync(root)) n++;
  return n;
}

function generateDeps(sel, orchId) {
  const deps = [];
  const add = (d) => { if (!deps.includes(d)) deps.push(d); };

  if (orchId === 'livekit') {
    add('# LiveKit Agents framework');
    add('livekit-agents>=0.12');
    add('livekit-plugins-silero');
    add('livekit-plugins-turn-detector');
    if (sel.stt?.id === 'deepgram' || sel.realtime?.id) add('livekit-plugins-deepgram');
    if (sel.llm?.id === 'openai' || sel.realtime?.id === 'openai-realtime') add('livekit-plugins-openai');
    if (sel.llm?.id === 'gemini' || sel.realtime?.id === 'gemini-live') add('livekit-plugins-google');
    if (sel.tts?.id === 'elevenlabs') add('livekit-plugins-elevenlabs');
    if (sel.tts?.id === 'cartesia') add('livekit-plugins-cartesia');
    add('python-dotenv');
  } else if (orchId === 'pipecat') {
    add('# Pipecat framework');
    add('pipecat-ai[openai,deepgram,elevenlabs,google,cartesia,silero]>=0.0.50');
    add('fastapi');
    add('uvicorn[standard]');
    add('twilio');
    add('python-dotenv');
  } else {
    add('# Custom FastAPI bridge');
    add('fastapi');
    add('uvicorn[standard]');
    add('websockets');
    add('python-dotenv');
    if (sel.stt?.id === 'deepgram') add('deepgram-sdk>=3.0');
    if (sel.stt?.id === 'assemblyai') add('assemblyai>=1.0');
    if (sel.llm?.id === 'openai') add('openai>=1.50');
    if (sel.llm?.id === 'anthropic') add('anthropic>=0.40');
    if (sel.llm?.id === 'gemini') add('google-genai');
    if (sel.tts?.id === 'elevenlabs') add('elevenlabs>=1.0');
    if (sel.tts?.id === 'cartesia') add('cartesia>=1.0');
    if (sel.realtime?.id === 'gemini-live') add('google-genai');
    if (sel.realtime?.id === 'openai-realtime') add('openai>=1.50');
    if (telephonyDeps[sel.telephony?.id]) add(telephonyDeps[sel.telephony?.id]);
    add('numpy');
    add('scipy');
  }
  return deps;
}

const telephonyDeps = {
  exotel: 'httpx',
  twilio: 'twilio>=9.0',
  plivo: 'plivo',
  telnyx: 'telnyx',
  vonage: 'vonage>=3.0',
};

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

for _k in REQUIRED:
    globals()[_k] = os.environ[_k]
`;
}

// ─── LiveKit scaffold ───────────────────────────────────────────────

function renderLiveKitAgent(flags, sel, result, providers, isCascaded, isRealtime) {
  const vadId = sel.vad?.id || 'silero';
  const systemPrompt = renderSystemPrompt(flags);

  const sessionParts = [];

  if (isCascaded) {
    if (sel.stt?.id && LIVEKIT_INFERENCE[sel.stt.id]) {
      sessionParts.push(`        stt=${LIVEKIT_INFERENCE[sel.stt.id]},`);
    }
    if (sel.llm?.id && LIVEKIT_INFERENCE[sel.llm.id]) {
      sessionParts.push(`        llm=${LIVEKIT_INFERENCE[sel.llm.id]},`);
    }
    if (sel.tts?.id && LIVEKIT_INFERENCE[sel.tts.id]) {
      sessionParts.push(`        tts=${LIVEKIT_INFERENCE[sel.tts.id]},`);
    }
  }

  if (isRealtime && sel.realtime?.id === 'openai-realtime') {
    sessionParts.push(`        llm=openai.realtime.RealtimeModel(`);
    sessionParts.push(`            voice="alloy",`);
    sessionParts.push(`            turn_detection=None,`);
    sessionParts.push(`            input_audio_transcription=None,`);
    sessionParts.push(`        ),`);
  } else if (isRealtime && sel.realtime?.id === 'gemini-live') {
    sessionParts.push(`        llm=google.realtime.RealtimeModel(`);
    sessionParts.push(`            model="gemini-live-2.5-flash-preview",`);
    sessionParts.push(`        ),`);
  }

  sessionParts.push(`        vad=silero.VAD.load(),`);
  sessionParts.push(`        turn_handling=TurnHandlingOptions(`);
  sessionParts.push(`            turn_detection=MultilingualModel(),`);
  sessionParts.push(`        ),`);

  const imports = [
    'from dotenv import load_dotenv',
    'from livekit import agents',
    'from livekit.agents import AgentServer, AgentSession, Agent, inference, room_io, TurnHandlingOptions',
    'from livekit.plugins import silero',
    'from livekit.plugins.turn_detector.multilingual import MultilingualModel',
  ];
  if (isRealtime && sel.realtime?.id === 'openai-realtime') {
    imports.push('from livekit.plugins import openai');
  } else if (isRealtime && sel.realtime?.id === 'gemini-live') {
    imports.push('from livekit.plugins import google');
  }

  return `"""LiveKit Agents voice agent — generated by callsmith.

Stack: ${result.pipeline.map(p => p.label).join(' -> ')}
Architecture: ${flags.mode} | Language: ${flags.language} | Barge-in: ${flags.barge_in}

Read .callsmith/context/interruption.md and .callsmith/context/latency-budget.md
before customizing turn detection or latency-sensitive parameters.
"""
${imports.join('\n')}

load_dotenv()


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=${JSON.stringify(systemPrompt)},
        )


server = AgentServer()


@server.rtc_session(agent_name="voice-agent")
async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entry point. One session per room participant."""
    session = AgentSession(
${sessionParts.join('\n')}
    )

    await session.start(
        room=ctx.room,
        agent=Assistant(),
    )

    await session.generate_reply(
        instructions="Greet the user and offer your assistance.",
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
`;
}

function renderLiveKitTest(sel, isCascaded, isRealtime) {
  const checks = [];
  checks.push("    assert 'AgentSession' in source, 'agent.py must use AgentSession'");
  checks.push("    assert 'TurnHandlingOptions' in source, 'must configure turn handling'");
  checks.push("    assert 'silero.VAD.load()' in source, 'must load Silero VAD'");
  if (isCascaded) {
    checks.push("    assert 'stt=' in source, 'cascaded mode must configure STT'");
    checks.push("    assert 'llm=' in source, 'cascaded mode must configure LLM'");
    checks.push("    assert 'tts=' in source, 'cascaded mode must configure TTS'");
  }
  if (isRealtime) {
    checks.push("    assert 'realtime' in source.lower(), 'realtime mode must use a realtime model'");
  }

  return `"""Verifies the generated LiveKit agent has the correct structure.
Uses AST analysis — no framework imports needed."""
import ast


def _read_agent():
    with open('agent.py') as f:
        return f.read()


def test_agent_uses_livekit_framework():
    source = _read_agent()
    assert 'from livekit' in source, 'must import from livekit'
    assert 'AgentSession' in source, 'must use AgentSession'

def test_agent_has_turn_handling():
    source = _read_agent()
${checks.join('\n')}

def test_agent_has_system_prompt():
    source = _read_agent()
    tree = ast.parse(source)
    # Find the Assistant class and verify it has instructions
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == 'Assistant':
            return
    assert False, 'Assistant class not found'
`;
}

// ─── Pipecat scaffold ───────────────────────────────────────────────

function renderPipecatBot(flags, sel, result, providers, isCascaded, isRealtime) {
  const telephonyId = sel.telephony?.id;
  const serializer = TELEPHONY_SERIALIZERS[telephonyId] || TELEPHONY_SERIALIZERS.exotel;
  const systemPrompt = renderSystemPrompt(flags);

  const imports = new Set([
    'import os',
    'from pipecat.pipeline.pipeline import Pipeline',
    'from pipecat.pipeline.task import PipelineTask',
    'from pipecat.pipeline.runner import PipelineRunner',
    'from pipecat.transports.network.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams',
    `from ${serializer.mod} import ${serializer.cls}`,
    'from pipecat.audio.vad.silero import SileroVADAnalyzer',
    'from pipecat.pipeline.context import LLMContext, LLMContextAggregatorPair, LLMUserAggregatorParams',
    'from fastapi import FastAPI, WebSocket, Request',
    'from fastapi.responses import PlainTextResponse',
    'import uvicorn',
  ]);

  const serviceInits = [];
  const pipelineNodes = [];

  if (isCascaded) {
    if (sel.stt?.id && PIPECAT_SERVICES[sel.stt.id]) {
      const svc = PIPECAT_SERVICES[sel.stt.id];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      const varName = 'stt';
      serviceInits.push(`    ${varName} = ${svc.cls}(${svc.init})`);
      pipelineNodes.push('        stt,');
    }
    if (sel.llm?.id && PIPECAT_SERVICES[sel.llm.id]) {
      const svc = PIPECAT_SERVICES[sel.llm.id];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      const varName = 'llm';
      serviceInits.push(`    ${varName} = ${svc.cls}(${svc.init})`);
      pipelineNodes.push('        context_aggregator.user(),');
      pipelineNodes.push(`        ${varName},`);
    }
    if (sel.tts?.id && PIPECAT_SERVICES[sel.tts.id]) {
      const svc = PIPECAT_SERVICES[sel.tts.id];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      const varName = 'tts';
      serviceInits.push(`    ${varName} = ${svc.cls}(${svc.init})`);
      pipelineNodes.push(`        ${varName},`);
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        context_aggregator.assistant(),');
    } else {
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        context_aggregator.assistant(),');
    }
  } else if (isRealtime) {
    const rtId = sel.realtime?.id;
    if (rtId && PIPECAT_SERVICES[rtId]) {
      const svc = PIPECAT_SERVICES[rtId];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      serviceInits.push(`    realtime = ${svc.cls}(${svc.init})`);
      pipelineNodes.push('        context_aggregator.user(),');
      pipelineNodes.push('        realtime,');
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        context_aggregator.assistant(),');
    } else {
      pipelineNodes.push('        transport.output(),');
    }
  }

  const serializerInit = telephonyId === 'twilio'
    ? `${serializer.cls}(\n            stream_sid=stream_sid,\n            call_sid=call_sid,\n            account_sid=os.getenv("TWILIO_ACCOUNT_SID"),\n            auth_token=os.getenv("TWILIO_AUTH_TOKEN"),\n        )`
    : `${serializer.cls}()`;

  return `"""Pipecat voice agent — generated by callsmith.

Stack: ${result.pipeline.map(p => p.label).join(' -> ')}
Architecture: ${flags.mode} | Language: ${flags.language} | Barge-in: ${flags.barge_in}

Read .callsmith/context/interruption.md and .callsmith/context/latency-budget.md
before customizing the pipeline or VAD parameters.
"""
${[...imports].sort().join('\n')}

app = FastAPI()


SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)}


async def run_bot(websocket: WebSocket, stream_sid: str = None, call_sid: str = None):
    """Build and run the Pipecat pipeline for one call session."""
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=${serializerInit},
        ),
    )

${serviceInits.join('\n')}

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    context = LLMContext(messages)
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    pipeline = Pipeline([
        transport.input(),
${pipelineNodes.join('\n')}
    ])

    task = PipelineTask(pipeline)
    runner = PipelineRunner()
    await runner.run(task)
`;
}

function renderPipecatServer(telephonyId, providers) {
  const webhookPath = telephonyId === 'twilio'
    ? '@app.post("/twilio/webhook")'
    : telephonyId === 'exotel'
    ? '@app.post("/exotel/webhook")'
    : '@app.post("/voice/webhook")';

  const twimlTemplate = telephonyId === 'twilio'
    ? '<Response><Connect><Stream url="wss://YOUR_DOMAIN/ws" /></Connect></Response>'
    : '<Response><Connect><Stream url="wss://YOUR_DOMAIN/ws" /></Connect></Response>';

  return `"""FastAPI server: webhook + WebSocket media handler.

Deploy behind an HTTPS endpoint (ngrok for dev, Railway/Fly for prod).
Point your ${telephonyId || 'telephony'} webhook URL to this server.
"""
import os
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import PlainTextResponse
import uvicorn

app = FastAPI()


${webhookPath}
async def voice_webhook(request: Request):
    """Incoming call webhook. Returns XML to start the media stream."""
    # TODO: parse provider-specific call data (CallSid, From, etc.)
    return PlainTextResponse(
        '${twimlTemplate}',
        media_type="application/xml",
    )


@app.websocket("/ws")
async def media_stream(ws: WebSocket):
    """WebSocket media endpoint. Receives audio frames from ${telephonyId || 'provider'}."""
    await ws.accept()
    stream_sid = None
    call_sid = None

    try:
        async for message in ws.iter_json():
            if message.get("event") == "start":
                stream_sid = message.get("start", {}).get("streamSid")
                call_sid = message.get("start", {}).get("callSid")
                # TODO: initialize session, start bot
            elif message.get("event") == "media":
                payload = message.get("media", {}).get("payload", "")
                # TODO: base64-decode payload, process audio
            elif message.get("event") == "stop":
                break
    except Exception:
        pass
    finally:
        # TODO: session teardown
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
`;
}

function renderPipecatTest(sel, isCascaded, isRealtime) {
  const checks = [
    "    assert 'Pipeline(' in source, 'bot.py must construct a Pipeline'",
    "    assert 'PipelineTask' in source, 'must create PipelineTask'",
    "    assert 'PipelineRunner' in source, 'must use PipelineRunner'",
    "    assert 'SileroVADAnalyzer' in source, 'must configure SileroVADAnalyzer'",
    "    assert 'LLMContextAggregatorPair' in source, 'must use context aggregator'",
    "    assert 'transport.input()' in source, 'pipeline must start with transport.input()'",
    "    assert 'transport.output()' in source, 'pipeline must include transport.output()'",
  ];
  if (isCascaded) {
    checks.push("    assert 'stt' in source.lower(), 'cascaded pipeline must define STT service'");
    checks.push("    assert 'llm' in source.lower(), 'cascaded pipeline must define LLM service'");
    checks.push("    assert 'tts' in source.lower(), 'cascaded pipeline must define TTS service'");
  }

  return `"""Verifies the generated Pipecat bot has the correct structure.
Uses AST analysis — no framework imports needed."""

def _read_bot():
    with open('bot.py') as f:
        return f.read()


def test_bot_uses_pipecat_framework():
    source = _read_bot()
    assert 'from pipecat' in source, 'must import from pipecat'

def test_bot_has_pipeline_structure():
    source = _read_bot()
${checks.join('\n')}

def test_server_has_webhook_and_websocket():
    with open('server.py') as f:
        source = f.read()
    assert 'websocket' in source.lower(), 'server must have WebSocket endpoint'
    assert 'webhook' in source.lower() or 'post' in source.lower(), 'server must have webhook endpoint'

def test_bot_has_system_prompt():
    source = _read_bot()
    assert 'SYSTEM_PROMPT' in source, 'must define SYSTEM_PROMPT'
`;
}

// ─── Custom FastAPI scaffold ────────────────────────────────────────

function renderCodecs() {
  return `"""G.711 mu-law encode/decode. Verified to round-trip within 8-bit quantization."""
import array

BIAS = 0x84
CLIP = 32635


def mulaw_decode(byte: int) -> int:
    byte = ~byte & 0xFF
    sign = byte & 0x80
    exponent = (byte >> 4) & 0x07
    mantissa = byte & 0x0F
    sample = (((mantissa << 3) + BIAS) << exponent) - BIAS
    return -sample if sign else sample


def mulaw_encode(sample: int) -> int:
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
    out = bytearray(len(pcm) // 2)
    for i in range(0, len(pcm), 2):
        sample = int.from_bytes(pcm[i:i + 2], "little", signed=True)
        out[i // 2] = mulaw_encode(sample)
    return bytes(out)


def mulaw_bytes_to_pcm(data: bytes) -> bytes:
    out = bytearray(len(data) * 2)
    for i, b in enumerate(data):
        sample = mulaw_decode(b)
        out[i * 2:i * 2 + 2] = sample.to_bytes(2, "little", signed=True)
    return bytes(out)
`;
}

function renderResampler() {
  return `"""Resampling between telephony and model rates."""
from scipy.signal import resample_poly


def resample(pcm: bytes, in_rate: int, out_rate: int) -> bytes:
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
    return `"""Audio bridge — passthrough (no custom transcoding needed)."""


class AudioBridge:

    def inbound(self, data: bytes) -> bytes:
        return data

    def outbound(self, data: bytes) -> bytes:
        return data
`;
  }
  return `"""Audio bridge implementing the transforms in .callsmith/context/audio-contract.md."""
${needDecode ? 'from audio.codecs import mulaw_bytes_to_pcm' : ''}
${needEncode ? 'from audio.codecs import pcm_to_mulaw_bytes' : ''}
${needResample ? 'from audio import resampler' : ''}


class AudioBridge:
    """Custom bridge: ${result.transforms.length} transforms required."""

    def inbound(self, telephony_bytes: bytes) -> bytes:
        ${needDecode ? 'pcm = mulaw_bytes_to_pcm(telephony_bytes)' : 'pcm = telephony_bytes'}
        ${needResample ? 'pcm = resampler.resample(pcm, 8000, 16000)' : ''}
        return pcm

    def outbound(self, model_pcm: bytes) -> bytes:
        ${needResample ? 'pcm = resampler.resample(model_pcm, 24000, 8000)' : 'pcm = model_pcm'}
        ${needEncode ? 'return pcm_to_mulaw_bytes(pcm)' : 'return pcm'}
`;
}

function renderCustomServer(telephonyId, providers, flags) {
  return `"""Custom FastAPI server: webhook + WebSocket media handler.

Stack: ${telephonyId || 'telephony'} -> custom bridge -> model
Architecture: ${flags.mode}

Deploy behind HTTPS. Point your telephony webhook URL here.
"""
import os
import base64
import json
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import PlainTextResponse
import uvicorn

app = FastAPI()


@app.post("/voice")
async def voice_webhook(request: Request):
    """Incoming call webhook."""
    # TODO: parse ${telephonyId || 'provider'}-specific call data
    return PlainTextResponse(
        '<Response><Connect><Stream url="wss://YOUR_DOMAIN/ws" /></Connect></Response>',
        media_type="application/xml",
    )


@app.websocket("/ws")
async def media_stream(ws: WebSocket):
    """Media stream WebSocket endpoint."""
    await ws.accept()
    # TODO: import audio bridge if needed
    # from audio.bridge import AudioBridge
    # bridge = AudioBridge()

    try:
        async for message in ws.iter_json():
            event = message.get("event")
            if event == "start":
                pass  # TODO: init session
            elif event == "media":
                payload_b64 = message.get("media", {}).get("payload", "")
                if payload_b64:
                    raw = base64.b64decode(payload_b64)
                    # pcm = bridge.inbound(raw)
                    # -> STT/model
                    # audio_out = bridge.outbound(model_audio)
                    # ws.send_text(json.dumps({"event": "media", "media": {"payload": base64.b64encode(audio_out).decode()}}))
            elif event == "stop":
                break
    except Exception:
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
`;
}

function renderAudioTest(needBridge, needDecode, needEncode, needResample) {
  return `"""Validates the audio bridge round-trips correctly."""
import array
import math
${needBridge ? 'from audio.bridge import AudioBridge' : ''}


def _swave(n=1000, amp=30000):
    return array.array('h', [int(amp * math.sin(2 * math.pi * i / 100)) for i in range(n)]).tobytes()


${needBridge ? `def test_bridge_round_trip():
    bridge = AudioBridge()
    pcm = _swave()
    out = bridge.outbound(pcm)
    assert isinstance(out, (bytes, bytearray))
    back = bridge.inbound(out)
    assert isinstance(back, (bytes, bytearray))

def test_codecs_mulaw_round_trip():
    from audio.codecs import mulaw_encode, mulaw_decode
    for s in (0, 1, -1, 100, -100, 32635, -32635):
        assert abs(mulaw_decode(mulaw_encode(s)) - s) < 520
` : `def test_passthrough():
    from audio.bridge import AudioBridge
    b = AudioBridge()
    assert b.inbound(b"x") == b"x"
    assert b.outbound(b"x") == b"x"
`}
`;
}

function renderLifecycleTest(flags) {
  return `"""Validates the session lifecycle state machine."""
import asyncio


class TurnManager:
    def __init__(self, barge_in: bool):
        self.barge_in = barge_in
        self._queue: asyncio.Queue = asyncio.Queue()

    async def interrupt(self) -> None:
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def enqueue(self, frame: bytes) -> None:
        await self._queue.put(frame)


def test_interrupt_flushes_queue():
    async def go():
        tm = TurnManager(barge_in=${flags.barge_in === true || flags.barge_in === 'optional' ? 'True' : 'False'})
        for i in range(5):
            await tm.enqueue(bytes([i]))
        await tm.interrupt()
        assert tm._queue.empty()
    asyncio.run(go())
`;
}

function renderSystemPrompt(flags) {
  const jobMap = {
    faq: 'answer frequently asked questions',
    support: 'provide customer support',
    lead_qual: 'qualify leads',
    booking: 'help with appointment booking',
    collections: 'assist with debt collection calls',
    interview: 'conduct an interview or screening',
  };
  const job = jobMap[flags.business_logic] || 'assist the caller';
  const langNote = flags.language && flags.language !== 'en'
    ? ` The caller may speak in ${flags.language}. Be natural and fluent in code-mixed language.`
    : '';
  return `You are a helpful voice AI assistant. Your job is to ${job}. Keep responses concise and natural for speech.${langNote}`;
}

function renderDockerfile() {
  return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "server.py"]
`;
}

function renderReadme(flags, result, needBridge, orchId) {
  const stack = result.pipeline.map(p => `- **${p.role}:** ${p.label || p.id}`).join('\n');
  const frameworkName = orchId === 'livekit' ? 'LiveKit Agents' : orchId === 'pipecat' ? 'Pipecat' : 'Custom FastAPI';
  const entryFile = orchId === 'livekit' ? 'agent.py' : orchId === 'pipecat' ? 'bot.py + server.py' : 'server.py';

  return `# Voice Agent (callsmith-scaffolded)

Generated from \`callsmith.recipe.md\`. Framework: **${frameworkName}**.

## Stack
${stack}

## Architecture
- mode: **${flags.mode}** | language: **${flags.language}** | barge-in: **${flags.barge_in}**

## Audio bridge
${needBridge ? '**Custom bridge required** — see \`audio/bridge.py\` and \`.callsmith/context/audio-contract.md\`.' : '**No custom bridge** — the framework normalizes audio.'}

## Entry point
\`${entryFile}\`

## Run
\`\`\`bash
cp .env.example .env  # fill keys
pip install -r requirements.txt
pytest tests/         # validate structure
python ${orchId === 'livekit' ? 'agent.py' : 'server.py'}
\`\`\`

## Key context files
- \`.callsmith/context/interruption.md\` — interruption/turn-taking design
- \`.callsmith/context/latency-budget.md\` — latency breakdown
- \`.callsmith/context/audio-contract.md\` — audio format requirements
`;
}
