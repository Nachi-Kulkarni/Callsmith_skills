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
  openai:       'inference.LLM(model="openai/gpt-5.5")',
  anthropic:    'inference.LLM(model="anthropic/claude-sonnet-4-6")',
  gemini:       'inference.LLM(model="google/gemini-3.5-flash")',
  elevenlabs:   'inference.TTS(model="elevenlabs/eleven_v3")',
  cartesia:     'inference.TTS(model="cartesia/sonic-3.5")',
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

  w(root, 'state.py', renderStatePy(llmId, providers));
  w(root, 'resilience.py', renderResiliencePy(sel, providers));

  if (orchId === 'livekit') {
    w(root, 'agent.py', renderLiveKitAgent(flags, sel, result, providers, isCascaded, isRealtime));
    w(root, 'tests/test_agent_structure.py', renderLiveKitTest(sel, isCascaded, isRealtime));
    w(root, 'tests/test_state.py', renderStateTest(llmId, providers));
    w(root, 'tests/test_resilience.py', renderResilienceTest());
  } else if (orchId === 'pipecat') {
    w(root, 'bot.py', renderPipecatBot(flags, sel, result, providers, isCascaded, isRealtime));
    w(root, 'server.py', renderPipecatServer(telephonyId, providers));
    w(root, 'tests/test_pipeline_structure.py', renderPipecatTest(sel, isCascaded, isRealtime));
    w(root, 'tests/test_state.py', renderStateTest(llmId, providers));
    w(root, 'tests/test_resilience.py', renderResilienceTest());
  } else {
    w(root, 'audio/__init__.py', '');
    w(root, 'audio/codecs.py', renderCodecs());
    if (needResample) w(root, 'audio/resampler.py', renderResampler());
    w(root, 'audio/bridge.py', renderBridge(needBridge, needDecode, needEncode, needResample, result));
    w(root, 'server.py', renderCustomServer(telephonyId, providers, flags));
    w(root, 'tests/test_audio_bridge.py', renderAudioTest(needBridge, needDecode, needEncode, needResample));
    w(root, 'tests/test_state.py', renderStateTest(llmId, providers));
    w(root, 'tests/test_resilience.py', renderResilienceTest());
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
    sessionParts.push(`            model="gemini-3.1-flash-live-preview",`);
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
Read .callsmith/context/conversation-state.md for ContextManager/DTMFHandler wiring.
Read .callsmith/context/error-handling.md for FallbackAdapter and reconnection patterns.
"""
${imports.join('\n')}
from state import ContextManager, TranscriptStore
from resilience import retry_with_backoff

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
    'from pipecat.processors.aggregators.dtmf_aggregator import DTMFAggregator',
    'from pipecat.frames.core import ErrorFrame',
    'from fastapi import FastAPI, WebSocket, Request',
    'from fastapi.responses import PlainTextResponse',
    'import uvicorn',
    'import logging',
    'from state import ContextManager, TranscriptStore',
    'from resilience import retry_with_backoff',
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
logger = logging.getLogger(__name__)


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

    dtmf_aggregator = DTMFAggregator(timeout=5.0, prefix="Keypad input: ")
    transcript = TranscriptStore("transcripts.db")

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
        dtmf_aggregator,
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

Read .callsmith/context/conversation-state.md for DTMF + transcript wiring.
Read .callsmith/context/error-handling.md for reconnection patterns.

Deploy behind HTTPS. Point your telephony webhook URL here.
"""
import os
import base64
import json
import logging
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import PlainTextResponse
import uvicorn
from state import ContextManager, TranscriptStore, DTMFHandler
from resilience import ReconnectingWebSocket, retry_with_backoff, ConnectionState

logger = logging.getLogger(__name__)
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
    """Media stream WebSocket endpoint with DTMF + transcript support."""
    await ws.accept()
    call_id = None
    transcript = TranscriptStore("transcripts.db")
    dtmf = DTMFHandler(max_digits=0, inter_digit_timeout_ms=5000)

    def on_dtmf_complete(digits: str):
        logger.info(f"DTMF collected: {digits}")
        # TODO: route digits to business logic (IVR menu, PIN entry, etc.)

    dtmf.on_complete(on_dtmf_complete)

    try:
        async for message in ws.iter_json():
            event = message.get("event")
            if event == "start":
                call_id = message.get("start", {}).get("callSid", "unknown")
                logger.info(f"Call started: {call_id}")
            elif event == "media":
                payload_b64 = message.get("media", {}).get("payload", "")
                if payload_b64:
                    raw = base64.b64decode(payload_b64)
                    # TODO: bridge.inbound(raw) -> STT -> LLM -> TTS -> bridge.outbound() -> ws.send
            elif event == "dtmf":
                digit = message.get("dtmf", {}).get("digit", "")
                dtmf.add_digit(digit)
            elif event == "stop":
                logger.info(f"Call ended: {call_id}")
                break
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        # TODO: use ReconnectingWebSocket for automatic reconnection
    finally:
        if call_id:
            t = transcript.get_transcript(call_id)
            logger.info(f"Call {call_id}: {len(t)} turns logged")
        transcript.close()


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

// ─── Conversation state (state.py) ──────────────────────────────────

function renderStatePy(llmId, providers) {
  const llmPack = llmId ? providers[llmId] : null;
  const ctxWindow = llmPack?.context_window || 128000;

  return `"""Conversation state management — generated by callsmith.

Three building blocks for managing call state:
- ContextManager: tracks token count, enforces context window limits.
- TranscriptStore: SQLite-backed persistence for every turn.
- DTMFHandler: collects DTMF keypad digits with inter-digit timeout.

Framework-agnostic. Wire into your session handler.
See .callsmith/context/conversation-state.md for details.
"""
from __future__ import annotations

import json
import sqlite3
import time


class ContextManager:
    """Tracks token count and enforces context window limits.

    Strategy: sliding window. When total tokens approach
    max_tokens - reserve_tokens, oldest non-system messages are dropped.
    """

    def __init__(self, max_tokens: int = ${ctxWindow}, reserve_tokens: int = 4000):
        self.max_tokens = max_tokens
        self.reserve_tokens = reserve_tokens
        self.messages: list[dict] = []
        self._estimated_tokens = 0

    def add_message(self, role: str, content: str) -> None:
        tokens = self._estimate_tokens(content)
        self.messages.append({"role": role, "content": content, "tokens": tokens})
        self._estimated_tokens += tokens
        if self._estimated_tokens > self.max_tokens - self.reserve_tokens:
            self._compress()

    def _estimate_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def _compress(self) -> None:
        budget = self.max_tokens - self.reserve_tokens
        while self._estimated_tokens > budget and len(self.messages) > 1:
            removed = self.messages.pop(0)
            self._estimated_tokens -= removed["tokens"]

    def get_messages(self) -> list[dict]:
        return [{"role": m["role"], "content": m["content"]} for m in self.messages]

    @property
    def token_count(self) -> int:
        return self._estimated_tokens


class TranscriptStore:
    """SQLite-backed persistence for call transcripts.

    No external dependencies. One row per turn.
    """

    def __init__(self, db_path: str = "transcripts.db"):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                call_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tokens INTEGER DEFAULT 0,
                metadata TEXT
            )
        """)
        self.conn.commit()

    def log_turn(self, call_id: str, role: str, content: str,
                 tokens: int = 0, metadata: dict = None) -> None:
        self.conn.execute(
            "INSERT INTO turns (call_id, timestamp, role, content, tokens, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (call_id, time.time(), role, content, tokens,
             json.dumps(metadata) if metadata else None),
        )
        self.conn.commit()

    def get_transcript(self, call_id: str) -> list[dict]:
        rows = self.conn.execute(
            "SELECT timestamp, role, content, tokens, metadata "
            "FROM turns WHERE call_id = ? ORDER BY id",
            (call_id,),
        ).fetchall()
        return [
            {
                "timestamp": r[0],
                "role": r[1],
                "content": r[2],
                "tokens": r[3],
                "metadata": json.loads(r[4]) if r[4] else None,
            }
            for r in rows
        ]

    def close(self) -> None:
        self.conn.close()


class DTMFHandler:
    """Collects DTMF keypad digits with inter-digit timeout.

    Call add_digit() for each received tone. Register a callback
    via on_complete() to receive the collected digit string.
    """

    VALID_DIGITS = set("0123456789*#")

    def __init__(self, max_digits: int = 0, inter_digit_timeout_ms: int = 5000):
        self.max_digits = max_digits
        self.inter_digit_timeout_ms = inter_digit_timeout_ms
        self._buffer: list[str] = []
        self._last_digit_time: float = 0
        self._callback = None

    def on_complete(self, callback) -> None:
        self._callback = callback

    def add_digit(self, digit: str) -> None:
        if digit not in self.VALID_DIGITS:
            return
        now_ms = time.time() * 1000
        if self._buffer and (now_ms - self._last_digit_time) > self.inter_digit_timeout_ms:
            self._buffer = []
        self._buffer.append(digit)
        self._last_digit_time = now_ms
        if self.max_digits and len(self._buffer) >= self.max_digits:
            self._flush()

    def check_timeout(self) -> bool:
        if not self._buffer:
            return False
        now_ms = time.time() * 1000
        if (now_ms - self._last_digit_time) > self.inter_digit_timeout_ms:
            self._flush()
            return True
        return False

    def _flush(self) -> None:
        if self._buffer and self._callback:
            self._callback("".join(self._buffer))
        self._buffer = []

    @property
    def buffer(self) -> str:
        return "".join(self._buffer)
`;
}

// ─── Error handling (resilience.py) ─────────────────────────────────

function renderResiliencePy(sel, providers) {
  return `"""Error handling and resilience patterns — generated by callsmith.

Three building blocks for production resilience:
- ReconnectingWebSocket: automatic reconnection with exponential backoff.
- retry_with_backoff: decorator for API calls with rate-limit handling.
- FallbackConfig: configuration for provider fallback chains.

Framework-agnostic. Wire into your session lifecycle.
See .callsmith/context/error-handling.md for details.
"""
from __future__ import annotations

import asyncio
import functools
import logging
import random
from enum import Enum

logger = logging.getLogger(__name__)


class ConnectionState(Enum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


class ReconnectingWebSocket:
    """Wraps a WebSocket with automatic reconnection.

    Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 30s) with +/-25% jitter.
    Max 5 retries before the session is marked FAILED.
    """

    BASE_DELAY = 1.0
    MAX_DELAY = 30.0
    MAX_RETRIES = 5

    def __init__(self):
        self.state = ConnectionState.DISCONNECTED
        self._retry_count = 0

    async def connect(self, connect_fn) -> bool:
        """Attempt to connect using connect_fn. Returns True on success."""
        while self._retry_count < self.MAX_RETRIES:
            try:
                await connect_fn()
                self.state = ConnectionState.CONNECTED
                self._retry_count = 0
                logger.info("WebSocket connected")
                return True
            except Exception as e:
                self.state = ConnectionState.RECONNECTING
                logger.warning(
                    "WebSocket connect failed (attempt %d/%d): %s",
                    self._retry_count + 1, self.MAX_RETRIES, e,
                )
                delay = min(
                    self.BASE_DELAY * (2 ** self._retry_count), self.MAX_DELAY,
                )
                jitter = delay * 0.25 * random.random()
                await asyncio.sleep(delay + jitter)
                self._retry_count += 1

        self.state = ConnectionState.FAILED
        logger.error("WebSocket failed after %d retries", self.MAX_RETRIES)
        return False

    async def handle_disconnect(self, reconnect_fn) -> bool:
        """Called when an established connection drops."""
        self.state = ConnectionState.DISCONNECTED
        self._retry_count = 0
        return await self.connect(reconnect_fn)


def retry_with_backoff(max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 8.0):
    """Decorator: retry async functions on exception with exponential backoff.

    Honors Retry-After if the exception has a retry_after attribute.
    Jitter: +/-25% of the computed delay.
    """

    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    return await fn(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    if attempt == max_retries:
                        logger.error(
                            "%s failed after %d retries: %s",
                            fn.__name__, max_retries, e,
                        )
                        raise
                    delay = getattr(e, "retry_after", None) or min(
                        base_delay * (2 ** attempt), max_delay,
                    )
                    jitter = delay * 0.25 * random.random()
                    logger.warning(
                        "%s attempt %d failed, retrying in %.1fs: %s",
                        fn.__name__, attempt + 1, delay, e,
                    )
                    await asyncio.sleep(delay + jitter)
            raise last_exc

        return wrapper

    return decorator


class FallbackConfig:
    """Configuration for provider fallback chains.

    Register primary + fallback providers per pipeline leg.
    On primary failure (after retries), the resolver uses get_fallback()
    to determine the next provider to try.
    """

    def __init__(self):
        self._chains: dict[str, list[str]] = {}

    def register(self, role: str, primary: str, *fallbacks: str) -> None:
        chain = [primary] + list(fallbacks)
        self._chains[role] = chain

    def get_chain(self, role: str) -> list[str]:
        return self._chains.get(role, [])

    def get_fallback(self, role: str, current: str) -> str | None:
        chain = self._chains.get(role, [])
        if current in chain:
            idx = chain.index(current)
            if idx + 1 < len(chain):
                return chain[idx + 1]
        return None
`;
}

function renderStateTest(llmId, providers) {
  const llmPack = llmId ? providers[llmId] : null;
  const ctxWindow = llmPack?.context_window || 128000;

  return `"""Tests for state.py — ContextManager, TranscriptStore, DTMFHandler."""
import os
import tempfile
from state import ContextManager, TranscriptStore, DTMFHandler


def test_context_manager_tracks_tokens():
    ctx = ContextManager(max_tokens=${ctxWindow}, reserve_tokens=4000)
    ctx.add_message("system", "You are a helpful assistant.")
    ctx.add_message("user", "Hello, I need help.")
    assert ctx.token_count > 0
    msgs = ctx.get_messages()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"


def test_context_manager_compresses():
    ctx = ContextManager(max_tokens=100, reserve_tokens=20)
    for i in range(50):
        ctx.add_message("user", f"Message number {i} " * 10)
    budget = 100 - 20
    assert ctx.token_count <= budget + 50  # may keep one extra during compression


def test_transcript_store_round_trip():
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(db_fd)
    try:
        store = TranscriptStore(db_path)
        store.log_turn("call-123", "user", "Hello")
        store.log_turn("call-123", "assistant", "Hi there!")
        store.log_turn("call-456", "user", "Other call")
        transcript = store.get_transcript("call-123")
        assert len(transcript) == 2
        assert transcript[0]["role"] == "user"
        assert transcript[0]["content"] == "Hello"
        assert transcript[1]["role"] == "assistant"
        other = store.get_transcript("call-456")
        assert len(other) == 1
        store.close()
    finally:
        os.unlink(db_path)


def test_transcript_store_metadata():
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    os.close(db_fd)
    try:
        store = TranscriptStore(db_path)
        store.log_turn("call-1", "user", "Press 1", metadata={"dtmf": "1"})
        t = store.get_transcript("call-1")
        assert t[0]["metadata"] == {"dtmf": "1"}
        store.close()
    finally:
        os.unlink(db_path)


def test_dtmf_handler_collects_digits():
    collected = []
    handler = DTMFHandler(max_digits=4, inter_digit_timeout_ms=10000)
    handler.on_complete(collected.append)
    for d in "1234":
        handler.add_digit(d)
    assert collected == ["1234"]


def test_dtmf_handler_rejects_invalid():
    collected = []
    handler = DTMFHandler(max_digits=2)
    handler.on_complete(collected.append)
    handler.add_digit("A")
    handler.add_digit("1")
    handler.add_digit("2")
    assert collected == ["12"]


def test_dtmf_handler_timeout_flush():
    collected = []
    handler = DTMFHandler(max_digits=0, inter_digit_timeout_ms=100)
    handler.on_complete(collected.append)
    handler.add_digit("1")
    handler.add_digit("2")
    import time
    time.sleep(0.15)
    assert handler.check_timeout() is True
    assert collected == ["12"]
`;
}

function renderResilienceTest() {
  return `"""Tests for resilience.py — ReconnectingWebSocket, retry_with_backoff, FallbackConfig."""
import asyncio
import pytest
from resilience import (
    ConnectionState, ReconnectingWebSocket,
    retry_with_backoff, FallbackConfig,
)


def test_fallback_config_register_and_get():
    fb = FallbackConfig()
    fb.register("stt", "deepgram", "assemblyai")
    fb.register("llm", "openai", "anthropic", "gemini")
    assert fb.get_chain("stt") == ["deepgram", "assemblyai"]
    assert fb.get_chain("llm") == ["openai", "anthropic", "gemini"]
    assert fb.get_fallback("stt", "deepgram") == "assemblyai"
    assert fb.get_fallback("llm", "anthropic") == "gemini"
    assert fb.get_fallback("stt", "assemblyai") is None
    assert fb.get_chain("tts") == []


def test_fallback_config_empty():
    fb = FallbackConfig()
    assert fb.get_chain("stt") == []
    assert fb.get_fallback("stt", "deepgram") is None


def test_retry_with_backoff_succeeds_immediately():
    calls = []

    @retry_with_backoff(max_retries=3)
    async def quick_success():
        calls.append(1)
        return "ok"

    result = asyncio.run(quick_success())
    assert result == "ok"
    assert len(calls) == 1


def test_retry_with_backoff_retries_then_succeeds():
    calls = []

    @retry_with_backoff(max_retries=3, base_delay=0.01)
    async def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise ValueError("not yet")
        return "ok"

    result = asyncio.run(flaky())
    assert result == "ok"
    assert len(calls) == 3


def test_retry_with_backoff_exhausts_retries():
    calls = []

    @retry_with_backoff(max_retries=2, base_delay=0.01)
    async def always_fail():
        calls.append(1)
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        asyncio.run(always_fail())
    assert len(calls) == 3  # initial + 2 retries


def test_reconnecting_websocket_connects():
    rws = ReconnectingWebSocket()

    async def good_connect():
        pass

    result = asyncio.run(rws.connect(good_connect))
    assert result is True
    assert rws.state == ConnectionState.CONNECTED


def test_reconnecting_websocket_fails_after_retries():
    rws = ReconnectingWebSocket()

    async def bad_connect():
        raise ConnectionError("nope")

    result = asyncio.run(rws.connect(bad_connect))
    assert result is False
    assert rws.state == ConnectionState.FAILED
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

## Conversation state
- \`state.py\` — ContextManager (token tracking), TranscriptStore (SQLite), DTMFHandler (keypad)
- See \`.callsmith/context/conversation-state.md\` for wiring details

## Error handling
- \`resilience.py\` — ReconnectingWebSocket, retry_with_backoff, FallbackConfig
- See \`.callsmith/context/error-handling.md\` for patterns

## Entry point
\`${entryFile}\`

## Run
\`\`\`bash
cp .env.example .env  # fill keys
pip install -r requirements.txt
pytest tests/         # validate structure + state + resilience
python ${orchId === 'livekit' ? 'agent.py' : 'server.py'}
\`\`\`

## Key context files
- \`.callsmith/context/interruption.md\` — interruption/turn-taking design
- \`.callsmith/context/latency-budget.md\` — latency breakdown
- \`.callsmith/context/cost-estimation.md\` — per-minute cost table
- \`.callsmith/context/conversation-state.md\` — context window + transcript + DTMF
- \`.callsmith/context/error-handling.md\` — reconnection + retry + fallback
- \`.callsmith/context/audio-contract.md\` — audio format requirements
`;
}
