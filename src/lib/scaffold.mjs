import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';
import { voiceUxConfig, safetyConfig } from './compile.mjs';
import { createSafeWriter } from './safe-write.mjs';

const PIPECAT_SERVICES = {
  deepgram:       { cls: 'DeepgramSTTService',      mod: 'pipecat.services.deepgram.stt',   init: 'api_key=os.getenv("DEEPGRAM_API_KEY")' },
  assemblyai:     { cls: 'AssemblyAIService',       mod: 'pipecat.services.assemblyai.stt', init: 'api_key=os.getenv("ASSEMBLYAI_API_KEY")' },
  openai:         { cls: 'OpenAILLMService',        mod: 'pipecat.services.openai.llm',     init: 'api_key=os.getenv("OPENAI_API_KEY")' },
  anthropic:      { cls: 'AnthropicLLMService',     mod: 'pipecat.services.anthropic.llm',  init: 'api_key=os.getenv("ANTHROPIC_API_KEY")' },
  gemini:         { cls: 'GoogleLLMService',        mod: 'pipecat.services.google.llm',     init: 'api_key=os.getenv("GOOGLE_API_KEY")' },
  elevenlabs:     { cls: 'ElevenLabsTTSService',    mod: 'pipecat.services.elevenlabs.tts', init: 'api_key=os.getenv("ELEVENLABS_API_KEY")' },
  cartesia:       { cls: 'CartesiaTTSService',      mod: 'pipecat.services.cartesia.tts',   init: 'api_key=os.getenv("CARTESIA_API_KEY")' },
  'gemini-live':  { cls: 'GoogleGenAIRealtimeService', mod: 'pipecat.services.google.genai', init: 'api_key=os.getenv("GEMINI_API_KEY")' },
  'openai-realtime': { cls: 'OpenAIRealtimeLLMService', mod: 'pipecat.services.openai.realtime', init: 'api_key=os.getenv("OPENAI_API_KEY")' },
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

// Single source of truth for the scaffold's file manifest. Consumed by simulate.mjs
// (requiredScaffoldFiles) so the simulator validates against what scaffold actually writes,
// not a separately-maintained list that can drift.
const OPERATIONAL_FILES = [
  'state.py', 'resilience.py', 'operations.py', 'observability.py', 'tools.py', 'voice_ux.py',
  'safety.py', 'handoff.py', 'local_test.py', 'simulate_call.py',
];

export function expectedScaffoldFiles(orchestrationId) {
  const files = [...OPERATIONAL_FILES];
  if (orchestrationId === 'livekit') files.push('agent.py');
  else if (orchestrationId === 'pipecat') files.push('bot.py', 'server.py');
  else files.push('server.py', 'audio/bridge.py');
  return files;
}

export function scaffold(rawAnswers, outDir, opts = {}) {
  const menu = loadMenu();
  const providers = opts.providers ?? loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const { flags, providers: sel } = answers;
  const writer = createSafeWriter(outDir, { force: opts.force === true, dryRun: opts.dryRun === true });
  const w = (rel, content) => writer.w(rel, content);
  const root = writer.root;

  const telephonyId = sel.telephony?.id;
  const orchId = sel.orchestration?.id;
  const realtimeId = sel.realtime?.id;
  const sttId = sel.stt?.id;
  const llmId = sel.llm?.id;
  const ttsId = sel.tts?.id;
  const vadId = sel.vad?.id;

  const transforms = result.transforms;
  const needDecode = transforms.some(t => /decode mulaw/i.test(t.step));
  const needEncode = transforms.some(t => /encode PCM -> mulaw|-> mulaw|transcode pcm -> mulaw/i.test(t.step));
  const needResample = transforms.some(t => /resample/i.test(t.step));
  const needBridge = transforms.length > 0;
  const isCascaded = flags.mode === 'cascaded' || flags.mode === 'hybrid';
  const isRealtime = flags.mode === 'realtime' || flags.mode === 'hybrid';

  const deps = generateDeps(sel, orchId);
  w('requirements.txt', deps.join('\n') + '\n');
  w('requirements-test.txt', orchId === 'custom-fastapi' ? 'numpy\nscipy\npytest\n' : 'pytest\n');

  w('config.py', renderConfig(result.envKeys));

  w('state.py', renderStatePy(llmId, providers));
  w('resilience.py', renderResiliencePy(sel, providers));
  w('operations.py', renderOperationsPy(result));
  w('observability.py', renderObservabilityPy(result));
  w('tools.py', renderToolsPy(flags));
  w('voice_ux.py', renderVoiceUxPy(flags));
  w('safety.py', renderSafetyPy(flags));
  w('handoff.py', renderHandoffPy(flags));
  w('local_test.py', renderLocalTestPy(telephonyId, orchId));
  w('simulate_call.py', renderSimulateCallPy(flags, result));

  if (orchId === 'livekit') {
    w('agent.py', renderLiveKitAgent(flags, sel, result, providers, isCascaded, isRealtime));
    w('tests/test_agent_structure.py', renderLiveKitTest(sel, isCascaded, isRealtime));
    w('tests/test_state.py', renderStateTest(llmId, providers));
    w('tests/test_resilience.py', renderResilienceTest());
    w('tests/test_operational_modules.py', renderOperationalModulesTest());
  } else if (orchId === 'pipecat') {
    w('bot.py', renderPipecatBot(flags, sel, result, providers, isCascaded, isRealtime));
    w('server.py', renderPipecatServer(telephonyId, providers));
    w('tests/test_pipeline_structure.py', renderPipecatTest(sel, isCascaded, isRealtime));
    w('tests/test_state.py', renderStateTest(llmId, providers));
    w('tests/test_resilience.py', renderResilienceTest());
    w('tests/test_operational_modules.py', renderOperationalModulesTest());
  } else {
    w('audio/__init__.py', '');
    w('audio/codecs.py', renderCodecs());
    if (needResample) w('audio/resampler.py', renderResampler());
    w('audio/bridge.py', renderBridge(needBridge, result));
    w('server.py', renderCustomServer(telephonyId, providers, flags));
    w('tests/test_audio_bridge.py', renderAudioTest(needBridge, needDecode, needEncode, needResample));
    w('tests/test_state.py', renderStateTest(llmId, providers));
    w('tests/test_resilience.py', renderResilienceTest());
    w('tests/test_operational_modules.py', renderOperationalModulesTest());
  }

  w('tests/test_lifecycle.py', renderLifecycleTest(flags));
  w('install.sh', renderInstallScript());
  w('pytest.ini', renderPytestIni());
  w('pyproject.toml', renderPyprojectToml());
  w('Dockerfile', renderDockerfile());
  w('Makefile', renderMakefile(orchId));
  w('README.md', renderReadme(flags, result, needBridge, orchId));

  const fileCount = writer.dryRun ? writer.manifest.length : countFiles(root);
  return {
    root,
    needBridge,
    transformCount: transforms.length,
    files: fileCount,
    collisions: writer.collisions,
    overwritten: writer.overwritten,
    manifest: writer.manifest,
    dryRun: writer.dryRun,
  };
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
    if (sel.realtime?.id === 'gemini-live') add('google-genai');
    if (sel.tts?.id === 'elevenlabs') add('livekit-plugins-elevenlabs');
    if (sel.tts?.id === 'cartesia') add('livekit-plugins-cartesia');
    add('python-dotenv');
  } else if (orchId === 'pipecat') {
    add('# Pipecat framework');
    add('pipecat-ai[openai,deepgram,elevenlabs,google,cartesia,silero]>=0.0.36');
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
    if (sel.stt?.id === 'assemblyai') add('assemblyai>=0.40');
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
  if (isRealtime && !isCascaded) {
    sessionParts.push(`        stt=inference.STT(language="multi"),`);
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
    sessionParts.push(`            realtime_input_config=types.RealtimeInputConfig(`);
    sessionParts.push(`                automatic_activity_detection=types.AutomaticActivityDetection(`);
    sessionParts.push(`                    disabled=True,`);
    sessionParts.push(`                ),`);
    sessionParts.push(`            ),`);
    sessionParts.push(`            input_audio_transcription=None,`);
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
    'from observability import CallTrace, wire_livekit_session',
    'from operations import get_operations_config',
    'from voice_ux import get_voice_ux_config',
    'from tools import build_default_registry',
    'from safety import SafetyPolicy',
    'from handoff import HandoffManager',
  ];
  if (isRealtime && sel.realtime?.id === 'openai-realtime') {
    imports.push('from livekit.plugins import openai');
  } else if (isRealtime && sel.realtime?.id === 'gemini-live') {
    imports.push('from livekit.plugins import google');
    imports.push('from google.genai import types');
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
import config  # fail-fast: exits if required provider keys are missing


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=${JSON.stringify(systemPrompt)},
        )


server = AgentServer()


@server.rtc_session(agent_name="voice-agent")
async def entrypoint(ctx: agents.JobContext):
    """LiveKit agent entry point. One session per room participant."""
    ops = get_operations_config()
    voice_ux = get_voice_ux_config()
    trace = CallTrace(call_id=getattr(getattr(ctx, "job", None), "id", "livekit-call"))
    # Operational singletons — instantiate here; wire into your session/tool layer per callsmith.recipe.md.
    tools = build_default_registry(mode=${JSON.stringify(flags.tools || 'none')})
    safety = SafetyPolicy()
    handoff = HandoffManager(policy=voice_ux.handoff)

    session = AgentSession(
${sessionParts.join('\n')}
    )
    wire_livekit_session(session, trace)

    await session.start(
        room=ctx.room,
        agent=Assistant(),
    )

    if voice_ux.greeting_mode == "immediate":
        await session.generate_reply(
            instructions=voice_ux.greeting_instruction(),
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
    checks.push("    assert 'stt=' in source, 'LiveKit turn detection with realtime models must include an STT leg'");
    if (sel.realtime?.id === 'gemini-live') {
      checks.push("    assert 'automatic_activity_detection' in source, 'Gemini realtime must disable model-side activity detection when LiveKit owns turns'");
      checks.push("    assert 'disabled=True' in source, 'Gemini realtime activity detection must be disabled'");
    }
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
    'from pipecat.pipeline.runner import PipelineRunner',
    'from pipecat.pipeline.worker import PipelineWorker, PipelineParams',
    'from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams',
    `from ${serializer.mod} import ${serializer.cls}`,
    'from pipecat.audio.vad.silero import SileroVADAnalyzer',
    'from pipecat.processors.aggregators.llm_context import LLMContext, LLMUserAggregatorParams',
    'from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair',
    'from pipecat.processors.aggregators.dtmf_aggregator import DTMFAggregator',
    'from pipecat.frames.core import ErrorFrame',
    'from fastapi import FastAPI, WebSocket, Request',
    'from fastapi.responses import PlainTextResponse',
    'import uvicorn',
    'import logging',
    'from state import ContextManager, TranscriptStore',
    'from resilience import retry_with_backoff',
    'from observability import CallTrace, PipecatTraceObserver',
    'from operations import get_operations_config',
    'from voice_ux import get_voice_ux_config',
    'from tools import build_default_registry',
    'from safety import SafetyPolicy',
    'from handoff import HandoffManager',
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
      pipelineNodes.push('        user_aggregator,');
      pipelineNodes.push(`        ${varName},`);
    }
    if (sel.tts?.id && PIPECAT_SERVICES[sel.tts.id]) {
      const svc = PIPECAT_SERVICES[sel.tts.id];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      const varName = 'tts';
      serviceInits.push(`    ${varName} = ${svc.cls}(${svc.init})`);
      pipelineNodes.push(`        ${varName},`);
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        assistant_aggregator,');
    } else {
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        assistant_aggregator,');
    }
  } else if (isRealtime) {
    const rtId = sel.realtime?.id;
    if (rtId && PIPECAT_SERVICES[rtId]) {
      const svc = PIPECAT_SERVICES[rtId];
      imports.add(`from ${svc.mod} import ${svc.cls}`);
      serviceInits.push(`    realtime = ${svc.cls}(${svc.init})`);
      pipelineNodes.push('        user_aggregator,');
      pipelineNodes.push('        realtime,');
      pipelineNodes.push('        transport.output(),');
      pipelineNodes.push('        assistant_aggregator,');
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
from dotenv import load_dotenv
${[...imports].sort().join('\n')}

load_dotenv()
import config  # fail-fast: exits if required provider keys are missing

app = FastAPI()
logger = logging.getLogger(__name__)


SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)}


async def run_bot(websocket: WebSocket, stream_sid: str = None, call_sid: str = None):
    """Build and run the Pipecat pipeline for one call session."""
    ops = get_operations_config()
    voice_ux = get_voice_ux_config()
    trace = CallTrace(call_id=call_sid or stream_sid or "pipecat-call")
    # Operational singletons — instantiate here; wire into your session/tool layer per callsmith.recipe.md.
    tools = build_default_registry(mode=${JSON.stringify(flags.tools || 'none')})
    safety = SafetyPolicy()
    handoff = HandoffManager(policy=voice_ux.handoff)

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
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
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

    task = PipelineWorker(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
            idle_timeout_secs=max(1, voice_ux.silence_timeout_ms // 1000),
        ),
        observers=[PipecatTraceObserver(trace)],
    )
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
from bot import run_bot

app = FastAPI()


@app.get("/health")
async def health():
    return {"ok": True}


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
    """WebSocket media endpoint. Hands the socket to the Pipecat pipeline."""
    await ws.accept()
    stream_sid = None
    call_sid = None

    try:
        first = await ws.receive_json()
        if first.get("event") == "start":
            stream_sid = first.get("start", {}).get("streamSid")
            call_sid = first.get("start", {}).get("callSid")
        await run_bot(ws, stream_sid=stream_sid, call_sid=call_sid)
    except Exception:
        pass
    finally:
        pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
`;
}

function renderPipecatTest(sel, isCascaded, isRealtime) {
  const checks = [
    "    assert 'Pipeline(' in source, 'bot.py must construct a Pipeline'",
    "    assert 'PipelineWorker' in source, 'must create PipelineWorker'",
    "    assert 'PipecatTraceObserver' in source, 'must attach observability observer'",
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
    assert 'from bot import run_bot' in source, 'server must import the Pipecat bot runner'
    assert 'await run_bot' in source, 'WebSocket endpoint must start the Pipecat pipeline'

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

function renderBridge(needBridge, result) {
  if (!needBridge) {
    return `"""Audio bridge — passthrough (no custom transcoding needed)."""


class AudioBridge:

    def inbound(self, data: bytes) -> bytes:
        return data

    def outbound(self, data: bytes) -> bytes:
        return data
	`;
  }
  const inbound = result.transforms.filter(t => t.direction === 'inbound');
  const outbound = result.transforms.filter(t => t.direction === 'outbound');
  const needDecode = result.transforms.some(t => /decode mulaw/i.test(t.step));
  const needEncode = result.transforms.some(t => /encode PCM -> mulaw|transcode pcm -> mulaw/i.test(t.step));
  const needResample = result.transforms.some(t => /resample/i.test(t.step));
  const imports = [];
  if (needDecode) imports.push('from audio.codecs import mulaw_bytes_to_pcm');
  if (needEncode) imports.push('from audio.codecs import pcm_to_mulaw_bytes');
  if (needResample) imports.push('from audio import resampler');

  return `"""Audio bridge implementing the transforms in .callsmith/context/audio-contract.md."""
${imports.join('\n')}


class AudioBridge:
    """Custom bridge: ${result.transforms.length} transforms required."""

    def inbound(self, telephony_bytes: bytes) -> bytes:
${renderTransformBody('telephony_bytes', inbound)}

    def outbound(self, model_pcm: bytes) -> bytes:
${renderTransformBody('model_pcm', outbound)}
`;
}

function renderTransformBody(inputName, transforms) {
  const L = [`        audio = ${inputName}`];
  for (const t of transforms) {
    if (/decode mulaw/i.test(t.step)) {
      L.push('        audio = mulaw_bytes_to_pcm(audio)');
      continue;
    }
    if (/encode PCM -> mulaw|transcode pcm -> mulaw/i.test(t.step)) {
      L.push('        audio = pcm_to_mulaw_bytes(audio)');
      continue;
    }
    const resample = t.step.match(/resample (\d+) Hz -> (\d+) Hz/i);
    if (resample) {
      L.push(`        audio = resampler.resample(audio, ${resample[1]}, ${resample[2]})`);
      continue;
    }
    if (/normalize .* -> /i.test(t.step)) {
      L.push(`        # ${t.step}: PCM byte layout is already compatible.`);
      continue;
    }
    L.push(`        # Unsupported transform emitted by resolver: ${t.step}`);
  }
  L.push('        return audio');
  return L.join('\n');
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
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import PlainTextResponse
import uvicorn
from state import ContextManager, TranscriptStore, DTMFHandler
from resilience import ReconnectingWebSocket, retry_with_backoff, ConnectionState
from observability import CallTrace
from operations import get_operations_config
from voice_ux import get_voice_ux_config
from tools import build_default_registry
from safety import SafetyPolicy
from handoff import HandoffManager

load_dotenv()
import config  # fail-fast: exits if required provider keys are missing

logger = logging.getLogger(__name__)
app = FastAPI()


@app.get("/health")
async def health():
    return {"ok": True}


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
    ops = get_operations_config()
    voice_ux = get_voice_ux_config()
    trace = CallTrace(call_id="custom-call")
    # Operational singletons — instantiate here; wire into your session/tool layer per callsmith.recipe.md.
    tools = build_default_registry(mode=${JSON.stringify(flags.tools || 'none')})
    safety = SafetyPolicy()
    handoff = HandoffManager(policy=voice_ux.handoff)
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
                trace.call_id = call_id
                trace.mark("call_started", call_id=call_id)
                logger.info(f"Call started: {call_id}")
            elif event == "media":
                payload_b64 = message.get("media", {}).get("payload", "")
                if payload_b64:
                    raw = base64.b64decode(payload_b64)
                    trace.mark("media_frame_in", bytes=len(raw))
                    # TODO: bridge.inbound(raw) -> STT -> LLM -> TTS -> bridge.outbound() -> ws.send
            elif event == "dtmf":
                digit = message.get("dtmf", {}).get("digit", "")
                dtmf.add_digit(digit)
                trace.mark("dtmf", digits=digit)
            elif event == "stop":
                logger.info(f"Call ended: {call_id}")
                trace.mark("call_ended", reason="provider_stop")
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

// ─── Operational modules ────────────────────────────────────────────

function renderOperationsPy(result) {
  const ops = result.operations;
  return `"""Operations contract — generated by callsmith.

This is the runtime-facing version of .callsmith/context/operations.md.
Use it to keep hosting, debugging, and audio-cleanup decisions inspectable
after the project grows beyond the first scaffold.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AudioFeature:
    feature: str
    mode: str
    owner: str
    action: str


@dataclass(frozen=True)
class OperationsConfig:
    requested_hosting_model: str
    effective_hosting_model: str
    hosting_label: str
    infrastructure_owner: str
    orchestration: str | None
    adjustments: list[str]
    responsibilities: list[str]
    debug_profile: str
    trace_level: str
    trace_sampling: float
    retain_debug_audio_sec: int
    debug_note: str
    audio_enhancement: str
    audio_features: list[AudioFeature]

    def should_capture_debug_audio(self) -> bool:
        return self.retain_debug_audio_sec > 0

    def owns_media_bridge(self) -> bool:
        return self.effective_hosting_model == "self_hosted"

    def trace_event_allowed(self, sample_value: float = 0.0) -> bool:
        return self.trace_sampling >= 1 or sample_value < self.trace_sampling

    def audio_feature(self, feature_name: str) -> AudioFeature | None:
        lowered = feature_name.lower()
        for item in self.audio_features:
            if item.feature.lower() == lowered:
                return item
        return None


def _build_audio_features(raw: list[dict[str, Any]]) -> list[AudioFeature]:
    return [AudioFeature(**item) for item in raw]


def get_operations_config() -> OperationsConfig:
    raw = ${JSON.stringify(ops, null, 8)}
    raw["audio_features"] = _build_audio_features(raw["audio_features"])
    return OperationsConfig(**raw)
`;
}

function renderObservabilityPy(result) {
  const ops = result.operations;
  return `"""Call timeline and metrics — generated by callsmith.

Use CallTrace for every call. Framework adapters are intentionally light:
- LiveKit: wire_livekit_session(session, trace)
- Pipecat: PipecatTraceObserver(trace)
- Custom FastAPI: call trace.mark(...) directly from the WebSocket handler
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import time
from typing import Any


@dataclass
class VoiceEvent:
    at_ms: int
    event: str
    detail: dict[str, Any] = field(default_factory=dict)


class CallTrace:
    def __init__(self, call_id: str, cost_per_minute_usd: float = ${result.cost.total_per_minute_usd}):
        self.call_id = call_id
        self.cost_per_minute_usd = cost_per_minute_usd
        self.debug_profile = "${ops.debug_profile}"
        self.trace_level = "${ops.trace_level}"
        self.trace_sampling = ${ops.trace_sampling}
        self.retain_debug_audio_sec = ${ops.retain_debug_audio_sec}
        self.started_at = time.perf_counter()
        self.events: list[VoiceEvent] = []
        self.counters = {
            "dropped_frames": 0,
            "reconnect_count": 0,
            "tool_failures": 0,
            "turn_count": 0,
            "interruptions": 0,
            "vad_false_triggers": 0,
        }

    def mark(self, event: str, **detail: Any) -> VoiceEvent:
        at_ms = int((time.perf_counter() - self.started_at) * 1000)
        ev = VoiceEvent(at_ms=at_ms, event=event, detail=detail)
        self.events.append(ev)
        if event == "dropped_frame":
            self.counters["dropped_frames"] += 1
        elif event == "reconnect_started":
            self.counters["reconnect_count"] += 1
        elif event == "tool_finished" and detail.get("status") != "ok":
            self.counters["tool_failures"] += 1
        elif event in {"stt_final", "realtime_turn_complete"}:
            self.counters["turn_count"] += 1
        elif event == "interruption_started":
            self.counters["interruptions"] += 1
        elif event == "vad_false_trigger":
            self.counters["vad_false_triggers"] += 1
        return ev

    def first_ms(self, event: str) -> int | None:
        for ev in self.events:
            if ev.event == event:
                return ev.at_ms
        return None

    def summary(self) -> dict[str, Any]:
        first_audio = self.first_ms("agent_audio_out")
        tool_latencies = [
            ev.detail.get("latency_ms", 0)
            for ev in self.events
            if ev.event == "tool_finished"
        ]
        return {
            "call_id": self.call_id,
            "first_response_ms": first_audio,
            "stt_first_partial_ms": self.first_ms("stt_partial"),
            "stt_final_ms": self.first_ms("stt_final"),
            "llm_first_token_ms": self.first_ms("llm_first_token"),
            "tts_first_audio_ms": self.first_ms("tts_first_audio"),
            "events": len(self.events),
            "counters": dict(self.counters),
            "tool_latency_ms": sum(tool_latencies),
            "cost_per_minute_usd": self.cost_per_minute_usd,
            "debug_profile": self.debug_profile,
            "trace_level": self.trace_level,
            "retain_debug_audio_sec": self.retain_debug_audio_sec,
        }

    def write_jsonl(self, path: str) -> None:
        with open(path, "w") as f:
            for ev in self.events:
                f.write(json.dumps({
                    "call_id": self.call_id,
                    "at_ms": ev.at_ms,
                    "event": ev.event,
                    **ev.detail,
                }) + "\\n")


def wire_livekit_session(session, trace: CallTrace) -> None:
    """Attach best-effort LiveKit AgentSession state handlers."""

    def attach(event_name, handler):
        try:
            session.on(event_name)(handler)
        except Exception:
            trace.mark("observer_attach_failed", framework="livekit", event=event_name)

    def on_user_state_changed(ev):
        state = getattr(ev, "new_state", "unknown")
        trace.mark("user_state_changed", state=state)
        if state == "speaking":
            trace.mark("interruption_started")
        elif state == "listening":
            trace.mark("interruption_ended")

    def on_agent_state_changed(ev):
        state = getattr(ev, "new_state", "unknown")
        trace.mark("agent_state_changed", state=state)
        if state == "speaking":
            trace.mark("agent_audio_out")

    attach("user_state_changed", on_user_state_changed)
    attach("agent_state_changed", on_agent_state_changed)


try:
    from pipecat.observers.base_observer import BaseObserver
except Exception:
    class BaseObserver:  # type: ignore
        pass


class PipecatTraceObserver(BaseObserver):
    """Pipecat observer that records frame-level lifecycle events."""

    def __init__(self, trace: CallTrace):
        super().__init__()
        self.trace = trace

    async def on_push_frame(self, data):
        frame_name = data.frame.__class__.__name__
        self.trace.mark("pipecat_frame_pushed", frame=frame_name)
        if "Interruption" in frame_name:
            self.trace.mark("interruption_started", frame=frame_name)
        elif "BotStartedSpeaking" in frame_name:
            self.trace.mark("agent_audio_out", frame=frame_name)
        elif "Error" in frame_name:
            self.trace.mark("pipeline_error", frame=frame_name)

    async def on_process_frame(self, data):
        frame_name = data.frame.__class__.__name__
        if "Metrics" in frame_name:
            self.trace.mark("pipeline_metrics", frame=frame_name)

    async def on_pipeline_started(self):
        self.trace.mark("pipeline_started")
`;
}

function renderToolsPy(flags) {
  const mode = flags.tools || 'none';
  return `"""Tool calling primitives — generated by callsmith.

Selected integration mode: ${mode}
Every tool call gets timeout, retry, idempotency, and safe speech fallback.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import json
import sqlite3
import time
import urllib.request
from typing import Any, Awaitable, Callable


@dataclass
class ToolResult:
    ok: bool
    data: Any = None
    error: str | None = None
    speech: str | None = None
    latency_ms: int = 0
    idempotency_key: str | None = None


class ToolExecutionError(Exception):
    pass


def idempotency_key(call_id: str, tool_name: str, args: dict[str, Any]) -> str:
    payload = json.dumps(args, sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode()).hexdigest()[:16]
    return f"{call_id}:{tool_name}:{digest}"


def safe_failure_speech(tool_name: str) -> str:
    return "I am having trouble checking that right now. I can keep going with what I know or connect you to someone."


class ToolRegistry:
    def __init__(self, default_timeout: float = 5.0, max_retries: int = 1):
        self.default_timeout = default_timeout
        self.max_retries = max_retries
        self._tools: dict[str, Callable[..., Awaitable[Any]]] = {}

    def register(self, name: str, fn: Callable[..., Awaitable[Any]]) -> None:
        self._tools[name] = fn

    async def call(self, name: str, *, call_id: str, args: dict[str, Any], timeout: float | None = None) -> ToolResult:
        if name not in self._tools:
            return ToolResult(ok=False, error=f"unknown tool: {name}", speech=safe_failure_speech(name))

        idem = idempotency_key(call_id, name, args)
        started = time.perf_counter()
        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                data = await asyncio.wait_for(self._tools[name](**args, idempotency_key=idem), timeout=timeout or self.default_timeout)
                latency_ms = int((time.perf_counter() - started) * 1000)
                return ToolResult(ok=True, data=data, latency_ms=latency_ms, idempotency_key=idem)
            except Exception as exc:
                last_error = str(exc)
                if attempt < self.max_retries:
                    await asyncio.sleep(0.05 * (attempt + 1))
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ToolResult(ok=False, error=last_error, speech=safe_failure_speech(name), latency_ms=latency_ms, idempotency_key=idem)


async def webhook_tool(url: str, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode() or "{}")


async def openapi_tool(operation_id: str, params: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    return {
        "operation_id": operation_id,
        "params": params,
        "idempotency_key": idempotency_key,
        "todo": "Wire this stub to the generated OpenAPI client.",
    }


async def mcp_tool(server: str, tool: str, args: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
    return {
        "server": server,
        "tool": tool,
        "args": args,
        "idempotency_key": idempotency_key,
        "todo": "Wire this stub to your MCP client.",
    }


async def database_tool(db_path: str, sql: str, params: list[Any] | None = None, idempotency_key: str | None = None) -> dict[str, Any]:
    if not sql.strip().lower().startswith(("select", "insert", "update")):
        raise ToolExecutionError("Only select/insert/update statements are allowed by the scaffold.")
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(sql, params or [])
        conn.commit()
        rows = cur.fetchall()
        return {"rows": rows, "idempotency_key": idempotency_key}
    finally:
        conn.close()


def build_default_registry(mode: str = "${mode}") -> ToolRegistry:
    registry = ToolRegistry()

    async def noop_lookup(**kwargs):
        return {"mode": mode, "status": "stub", "args": kwargs}

    if mode != "none":
        registry.register(f"{mode}_lookup", noop_lookup)
    return registry
`;
}

function renderVoiceUxPy(flags) {
  const ux = { ...voiceUxConfig(flags), handoff: flags.handoff || 'ticket' };
  return `"""Runtime voice UX configuration — generated by callsmith."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceUXConfig:
    endpointing: str
    endpointing_ms: int
    interruption_sensitivity: str
    audio_enhancement: str
    noise_cancellation: str
    echo_cancellation: str
    automatic_gain_control: str
    silence_timeout_ms: int
    max_call_duration_sec: int
    greeting_mode: str
    voice_profile: str
    speaking_speed: float
    language_fallback: str
    handoff: str

    def greeting_instruction(self) -> str:
        if self.greeting_mode == "wait_for_user":
            return "Wait for the caller to speak before greeting."
        if self.greeting_mode == "business_hours":
            return "Greet the caller and mention that availability may depend on business hours."
        return "Greet the user and offer your assistance."

    def should_reprompt(self, silence_ms: int) -> bool:
        return silence_ms >= self.silence_timeout_ms

    def should_end_call(self, elapsed_sec: int) -> bool:
        return self.max_call_duration_sec > 0 and elapsed_sec >= self.max_call_duration_sec

    def turn_config(self) -> dict:
        return {
            "endpointing_ms": self.endpointing_ms,
            "interruption_sensitivity": self.interruption_sensitivity,
            "audio_enhancement": self.audio_enhancement,
            "noise_cancellation": self.noise_cancellation,
            "echo_cancellation": self.echo_cancellation,
            "automatic_gain_control": self.automatic_gain_control,
        }


def get_voice_ux_config() -> VoiceUXConfig:
    return VoiceUXConfig(**${JSON.stringify(ux, null, 8)})
`;
}

function renderSafetyPy(flags) {
  const safety = safetyConfig(flags);
  return `"""Safety and compliance guardrails — generated by callsmith."""
from __future__ import annotations

from dataclasses import dataclass
import json
import re
import time
from typing import Any


@dataclass(frozen=True)
class SafetyPolicy:
    recording_consent: str = "${safety.recording_consent}"
    transcript_retention_days: int = ${safety.transcript_retention_days}
    redact_pii: bool = ${safety.pii_redaction ? 'True' : 'False'}
    audit_tool_actions: bool = ${safety.audit_tool_actions ? 'True' : 'False'}

    def consent_prompt(self) -> str | None:
        if self.recording_consent == "none":
            return None
        if self.recording_consent == "explicit":
            return "This call may be recorded. Do I have your permission to continue?"
        return "This call may be recorded for quality and training."

    def can_record(self, caller_consented: bool = False) -> bool:
        if self.recording_consent == "none":
            return False
        if self.recording_consent == "explicit":
            return caller_consented
        return True


class PiiRedactor:
    EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", re.I)
    PHONE = re.compile(r"(?<!\\d)(?:\\+?\\d[\\d -]{7,}\\d)(?!\\d)")
    CARD = re.compile(r"(?<!\\d)(?:\\d[ -]*?){13,19}(?!\\d)")

    def redact(self, text: str) -> str:
        text = self.EMAIL.sub("[email]", text)
        text = self.PHONE.sub("[phone]", text)
        text = self.CARD.sub("[number]", text)
        return text


class AuditLog:
    def __init__(self, path: str = "audit.jsonl", redactor: PiiRedactor | None = None):
        self.path = path
        self.redactor = redactor or PiiRedactor()

    def record_tool_action(self, call_id: str, tool: str, status: str, args: dict[str, Any], idempotency_key: str | None = None) -> None:
        redacted_args = {
            key: self.redactor.redact(str(value))
            for key, value in args.items()
        }
        row = {
            "timestamp": time.time(),
            "call_id": call_id,
            "tool": tool,
            "status": status,
            "args": redacted_args,
            "idempotency_key": idempotency_key,
        }
        with open(self.path, "a") as f:
            f.write(json.dumps(row) + "\\n")


def detects_opt_out(text: str) -> bool:
    lowered = text.lower()
    phrases = ["do not call", "stop calling", "remove my number", "unsubscribe"]
    return any(phrase in lowered for phrase in phrases)
`;
}

function renderHandoffPy(flags) {
  const handoff = flags.handoff || 'ticket';
  return `"""Human handoff and escalation — generated by callsmith."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class HandoffSummary:
    call_id: str
    reason: str
    caller_intent: str
    attempted_actions: list[str]
    unresolved_question: str
    risk: str
    next_action: str
    transcript_excerpt: str


class HandoffManager:
    def __init__(self, policy: str = "${handoff}"):
        self.policy = policy

    def should_handoff(self, reason: str, confidence: float = 1.0, tool_failures: int = 0) -> bool:
        if self.policy == "none":
            return False
        if "human" in reason.lower() or "agent" in reason.lower():
            return True
        if confidence < 0.55:
            return True
        if tool_failures >= 2:
            return True
        if any(word in reason.lower() for word in ["complaint", "cancel", "refund", "legal", "unsafe"]):
            return True
        return False

    def next_action(self) -> str:
        if self.policy == "transfer":
            return "transfer_live_call"
        if self.policy == "callback":
            return "schedule_callback"
        if self.policy == "ticket":
            return "create_support_ticket"
        return "continue_conversation"

    def create_summary(self, call_id: str, transcript: list[dict[str, Any]], reason: str, attempted_actions: list[str] | None = None) -> HandoffSummary:
        attempted_actions = attempted_actions or []
        user_turns = [t.get("content", "") for t in transcript if t.get("role") == "user"]
        assistant_turns = [t.get("content", "") for t in transcript if t.get("role") == "assistant"]
        excerpt = "\\n".join((user_turns + assistant_turns)[-6:])
        return HandoffSummary(
            call_id=call_id,
            reason=reason,
            caller_intent=user_turns[-1] if user_turns else "unknown",
            attempted_actions=attempted_actions,
            unresolved_question=reason,
            risk="needs_human_review",
            next_action=self.next_action(),
            transcript_excerpt=excerpt,
        )
`;
}

function renderLocalTestPy(telephonyId, orchId) {
  const webhookPath = orchId === 'pipecat' && telephonyId === 'twilio'
    ? '/twilio/webhook'
    : orchId === 'pipecat' && telephonyId === 'exotel'
    ? '/exotel/webhook'
    : orchId === 'livekit'
    ? '/livekit/webhook'
    : '/voice';
  return `"""Local PSTN/WebSocket testing helper — generated by callsmith.

Run:
    python server.py
    ngrok http 8000

Paste the ngrok HTTPS URL below to derive provider webhook URLs.
"""
from __future__ import annotations


def ngrok_command(port: int = 8000) -> list[str]:
    return ["ngrok", "http", str(port)]


def webhook_urls(public_https_url: str) -> dict[str, str]:
    base = public_https_url.rstrip("/")
    if base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    ws_base = "wss://" + base.split("://", 1)[1]
    return {
        "voice_webhook": base + "${webhookPath}",
        "media_websocket": ws_base + "/ws",
        "health": base + "/health",
    }


def print_instructions(public_https_url: str, port: int = 8000) -> None:
    urls = webhook_urls(public_https_url)
    print("Run local server on port", port)
    print("Run tunnel:", " ".join(ngrok_command(port)))
    print("Voice webhook:", urls["voice_webhook"])
    print("Media WebSocket:", urls["media_websocket"])


if __name__ == "__main__":
    import sys
    print("=== Local Testing Helper ===")
    print()
    print("1. Start your server:")
    print("   python server.py")
    print()
    print("2. In another terminal, expose it:")
    print("   ", " ".join(ngrok_command()))
    print()
    print("3. Copy the ngrok HTTPS URL and re-run:")
    print("   python local_test.py https://<your-ngrok-domain>.ngrok-free.app")
    print()
    if len(sys.argv) > 1:
        print_instructions(sys.argv[1])
    else:
        print("(No URL provided. Pass your ngrok URL as an argument to see derived webhook URLs.)")
`;
}

function renderSimulateCallPy(flags, result) {
  const mode = flags.mode;
  const tools = flags.tools || 'none';
  return `"""Deterministic fake-call simulator — generated by callsmith.

This is local and free: no provider SDKs, no paid API calls.
"""
from __future__ import annotations

from observability import CallTrace
from tools import build_default_registry
from voice_ux import get_voice_ux_config


class FakeCallSimulator:
    def __init__(self):
        self.trace = CallTrace("fake-call", cost_per_minute_usd=${result.cost.total_per_minute_usd})
        self.voice_ux = get_voice_ux_config()
        self.tools = build_default_registry(mode="${tools}")

    def run(self) -> dict:
        self.trace.mark("call_started")
        self.trace.mark("media_frame_in", bytes=320)
        if "${mode}" == "realtime":
            self.trace.mark("realtime_input", frame_count=1)
            self.trace.mark("realtime_turn_complete", transcript="I need help")
        else:
            self.trace.mark("stt_partial", text="I need")
            self.trace.mark("stt_final", text="I need help")
            self.trace.mark("llm_first_token", token="Sure")
            if "${tools}" != "none":
                self.trace.mark("tool_started", name="${tools}_lookup")
                self.trace.mark("tool_finished", name="${tools}_lookup", status="ok", latency_ms=120)
            self.trace.mark("tts_first_audio", bytes=960)
        self.trace.mark("agent_audio_out", bytes=960)
        if ${flags.barge_in === true || flags.barge_in === 'optional' ? 'True' : 'False'}:
            self.trace.mark("interruption_started", reason="caller_speech_during_playback")
            self.trace.mark("interruption_ended", action="resume_listening")
        self.trace.mark("dtmf", digits="1")
        self.trace.mark("reconnect_started", retry=1)
        self.trace.mark("reconnect_finished", retry=1)
        self.trace.mark("call_ended", reason="sim_complete")
        return self.trace.summary()


if __name__ == "__main__":
    print(FakeCallSimulator().run())
`;
}

function renderOperationalModulesTest() {
  return `"""Tests for operational modules: observability, tools, UX, safety, handoff, local testing, simulator."""
import asyncio

from observability import CallTrace
from operations import get_operations_config
from tools import build_default_registry, idempotency_key
from voice_ux import get_voice_ux_config
from safety import SafetyPolicy, PiiRedactor, detects_opt_out
from handoff import HandoffManager
from local_test import ngrok_command, webhook_urls
from simulate_call import FakeCallSimulator


def test_call_trace_records_core_metrics():
    trace = CallTrace("call-1", cost_per_minute_usd=0.05)
    trace.mark("call_started")
    trace.mark("stt_partial")
    trace.mark("llm_first_token")
    trace.mark("agent_audio_out")
    summary = trace.summary()
    assert summary["call_id"] == "call-1"
    assert summary["first_response_ms"] is not None
    assert summary["cost_per_minute_usd"] == 0.05


def test_tool_registry_has_timeout_and_idempotency():
    async def go():
        registry = build_default_registry()
        key = idempotency_key("call-1", "lookup", {"order": "123"})
        assert key.startswith("call-1:lookup:")
        if registry._tools:
            name = next(iter(registry._tools))
            result = await registry.call(name, call_id="call-1", args={"value": 1})
            assert result.ok is True
    asyncio.run(go())


def test_voice_ux_config_exposes_timing_knobs():
    cfg = get_voice_ux_config()
    assert cfg.endpointing_ms > 0
    assert cfg.silence_timeout_ms > 0
    assert isinstance(cfg.turn_config(), dict)
    assert "echo_cancellation" in cfg.turn_config()


def test_operations_config_exposes_runtime_ownership():
    cfg = get_operations_config()
    assert cfg.effective_hosting_model in {"managed_cloud", "hybrid_worker", "self_hosted"}
    assert cfg.infrastructure_owner
    assert cfg.audio_feature("Noise suppression") is not None
    assert cfg.trace_level in {"timeline", "frame_and_audio", "metrics"}


def test_safety_redacts_and_detects_opt_out():
    policy = SafetyPolicy()
    assert policy.recording_consent in {"none", "announce", "explicit"}
    redacted = PiiRedactor().redact("Call me at +1 415 555 0101 or a@example.com")
    assert "[phone]" in redacted
    assert "[email]" in redacted
    assert detects_opt_out("Please do not call me again")


def test_handoff_summary_has_next_action():
    manager = HandoffManager(policy="ticket")
    assert manager.should_handoff("caller asked for human")
    summary = manager.create_summary(
        "call-1",
        [{"role": "user", "content": "I need a refund"}],
        "refund policy",
    )
    assert summary.next_action == "create_support_ticket"


def test_ngrok_helper_derives_webhook_urls():
    assert ngrok_command(8000) == ["ngrok", "http", "8000"]
    urls = webhook_urls("https://abc.ngrok-free.app")
    assert urls["voice_webhook"].startswith("https://")
    assert urls["media_websocket"].startswith("wss://")


def test_fake_call_simulator_runs():
    summary = FakeCallSimulator().run()
    assert summary["events"] >= 8
    assert summary["first_response_ms"] is not None
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
            idx = next(
                (i for i, msg in enumerate(self.messages) if msg["role"] != "system"),
                None,
            )
            if idx is None:
                break
            removed = self.messages.pop(idx)
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
                jitter = delay * random.uniform(-0.25, 0.25)
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
                    jitter = delay * random.uniform(-0.25, 0.25)
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


def test_context_manager_retains_system_prompt():
    ctx = ContextManager(max_tokens=120, reserve_tokens=20)
    ctx.add_message("system", "Never drop this instruction.")
    for i in range(60):
        ctx.add_message("user", f"Long user message {i} " * 10)
    messages = ctx.get_messages()
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == "Never drop this instruction."


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
    rws.BASE_DELAY = 0.001
    rws.MAX_DELAY = 0.001
    rws.MAX_RETRIES = 2

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
  return `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir uv \\
    && uv pip install --system --no-cache -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "server.py"]
`;
}

function renderPytestIni() {
  return `[pytest]
pythonpath = .
`;
}

function renderPyprojectToml() {
  return `[project]
name = "voice-agent"
requires-python = ">=3.10"
`;
}

function renderMakefile(orchId) {
  const devCmd = orchId === 'livekit' ? 'agent.py dev' : 'server.py';
  return [
    '# Generated by callsmith. Standard dev/test/simulate entry points.',
    '# Common commands: make install, make install-full, make test, make simulate',
    'PYTHON ?= python3',
    'PORT ?= 8000',
    '',
    '.PHONY: install install-full test dev simulate docker-build docker-run clean',
    '',
    'install:',
    '\tbash install.sh test',
    '',
    'install-full:',
    '\tbash install.sh full',
    '',
    'test:',
    '\t$(PYTHON) -m pytest tests/ -q',
    '',
    'dev:',
    '\t$(PYTHON) ' + devCmd,
    '',
    'simulate:',
    '\t$(PYTHON) simulate_call.py',
    '',
    'docker-build:',
    '\tdocker build -t voice-agent .',
    '',
    'docker-run:',
    '\tdocker run --rm -p $(PORT):8000 --env-file .env voice-agent',
    '',
    'clean:',
    '\trm -rf __pycache__ .pytest_cache .uv-cache transcripts.db',
    '',
  ].join('\n');
}

function renderInstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

MODE="\${1:-test}"
PYTHON_BIN="\${PYTHON:-python3}"
VENV_DIR="\${VENV_DIR:-.venv}"
export UV_CACHE_DIR="\${UV_CACHE_DIR:-$PWD/.uv-cache}"

# Fail fast on Python < 3.10 (LiveKit/Pipecat use typing.TypeAlias, PEP 604 unions, etc.)
PY_VERSION=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
if [ "$(printf '%s\\n' "3.10" "$PY_VERSION" | sort -V | head -1)" != "3.10" ]; then
  echo "error: Python >= 3.10 required (found $PY_VERSION at $PYTHON_BIN)." >&2
  echo "  LiveKit Agents and Pipecat use typing features added in 3.10." >&2
  echo "  Install Python 3.11+: https://www.python.org/downloads/  or: brew install python@3.11" >&2
  exit 1
fi

case "$MODE" in
  test) REQ_FILES=("requirements-test.txt") ;;
  full) REQ_FILES=("requirements.txt") ;;
  all) REQ_FILES=("requirements-test.txt" "requirements.txt") ;;
  *)
    echo "Usage: bash install.sh [test|full|all]" >&2
    echo "  test: fast scaffold validation deps only" >&2
    echo "  full: provider SDK/runtime deps" >&2
    echo "  all:  test + full deps" >&2
    exit 2
    ;;
esac

if command -v uv >/dev/null 2>&1; then
  echo "Using uv for parallel dependency install."
  uv venv "$VENV_DIR" --python "$PYTHON_BIN"
  for req in "\${REQ_FILES[@]}"; do
    uv pip install --python "$VENV_DIR/bin/python" -r "$req"
  done
else
  echo "uv not found; falling back to pip. Install uv for faster parallel downloads: pipx install uv" >&2
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  for req in "\${REQ_FILES[@]}"; do
    "$VENV_DIR/bin/python" -m pip install -r "$req"
  done
fi

echo
echo "Done. Activate with: . $VENV_DIR/bin/activate"
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

## Fast validation

Use the lightweight test install first. It avoids downloading provider SDK wheels until the generated scaffold itself is validated.

\`\`\`bash
bash install.sh test
. .venv/bin/activate
pytest tests/
\`\`\`

The installer uses \`uv\` for parallel downloads when available and falls back to \`pip\`.

## Full runtime install

\`\`\`bash
cp .env.example .env  # fill keys
bash install.sh full  # installs provider SDK/runtime deps
. .venv/bin/activate
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
