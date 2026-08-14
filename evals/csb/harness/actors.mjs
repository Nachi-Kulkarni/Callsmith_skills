import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
const MODEL_FAMILY_PATTERNS = [
  ['luna', /(?:^|[-_/])luna(?:$|[-_/])/i],
  ['terra', /(?:^|[-_/])terra(?:$|[-_/])/i],
  ['sol', /(?:^|[-_/])sol(?:$|[-_/])/i],
  ['grok', /(?:^|[-_/])grok(?:$|[-_/])/i],
];

export function modelFamilyFor(model) {
  if (typeof model !== 'string' || !model.trim()) return null;
  return MODEL_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(model))?.[0] || null;
}

export function createIsolatedActorWorkspace(label = 'arm') {
  const root = mkdtempSync(join(tmpdir(), `callsmith-csb-${label}-`));
  return {
    root,
    cwd: join(root, 'workspace'),
    home: join(root, 'actor-home'),
    bin: join(root, 'tool-bin'),
  };
}

/**
 * Give Codex subscription auth without exposing personal config, skills, plugins,
 * memories, or history. The auth-only home is a sibling of the scored workspace,
 * is never persisted in the run bundle, and is deleted with the isolated root.
 */
export function prepareCodexActorHome(
  spec,
  actorHome,
  actorBin,
  sourceCodexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
) {
  if (spec.tool !== 'codex') return null;
  if (!actorHome) throw new Error('Codex actor requires an isolated home.');
  if (!actorBin) throw new Error('Codex actor requires an isolated tool bin.');
  const authSource = join(sourceCodexHome, 'auth.json');
  if (!existsSync(authSource)) {
    throw new Error(`Codex subscription auth not found at ${authSource}; run codex login first.`);
  }
  mkdirSync(actorHome, { recursive: false });
  cpSync(authSource, join(actorHome, 'auth.json'));
  mkdirSync(actorBin, { recursive: false });
  symlinkSync(process.execPath, join(actorBin, 'node'));
  const files = readdirSync(actorHome);
  if (files.length !== 1 || files[0] !== 'auth.json') {
    throw new Error('Codex actor home must contain auth.json only before launch.');
  }
  return actorHome;
}

/**
 * Give Grok CLI subscription auth without exposing personal config, skills, plugins,
 * marketplace sources, or session history. Grok resolves its config under `~/.grok/`,
 * so the auth-only home carries a single `.grok/auth.json` and nothing else. The home
 * is a sibling of the scored workspace, is never persisted in the run bundle, and is
 * deleted with the isolated root.
 */
export function prepareGrokActorHome(
  spec,
  actorHome,
  actorBin,
  sourceGrokHome = process.env.GROK_HOME || join(homedir(), '.grok'),
) {
  if (spec.tool !== 'grok') return null;
  if (!actorHome) throw new Error('Grok actor requires an isolated home.');
  if (!actorBin) throw new Error('Grok actor requires an isolated tool bin.');
  const authSource = join(sourceGrokHome, 'auth.json');
  if (!existsSync(authSource)) {
    throw new Error(`Grok subscription auth not found at ${authSource}; run grok login first.`);
  }
  mkdirSync(actorHome, { recursive: false });
  mkdirSync(join(actorHome, '.grok'), { recursive: false });
  cpSync(authSource, join(actorHome, '.grok', 'auth.json'));
  mkdirSync(actorBin, { recursive: false });
  symlinkSync(process.execPath, join(actorBin, 'node'));
  const grokFiles = readdirSync(join(actorHome, '.grok'));
  if (grokFiles.length !== 1 || grokFiles[0] !== 'auth.json') {
    throw new Error('Grok actor home must contain .grok/auth.json only before launch.');
  }
  const files = readdirSync(actorHome);
  if (files.length !== 1 || files[0] !== '.grok') {
    throw new Error('Grok actor home must contain the .grok directory only before launch.');
  }
  return actorHome;
}

export function actorEnvironment(spec, { cwd, arm, actorHome, actorBin } = {}) {
  if (spec.tool === 'opencode') {
    // Scrub vars that would reveal the harness repo path or run configuration.
    // ponytail: full HOME isolation would also lose opencode's provider auth,
    // so opencode stays diagnostic-grade (README publication rules).
    const env = { ...process.env };
    delete env.PWD;
    delete env.OLDPWD;
    for (const key of Object.keys(env)) {
      if (key.startsWith('CSB_') || key.startsWith('OPENCODE_EVAL_')) delete env[key];
    }
    env.PATH = arm === 'WITH'
      ? `${join(cwd, '.bin')}:${process.env.PATH || ''}`
      : process.env.PATH || '';
    return env;
  }
  // codex and grok share the same fail-closed scrubbed environment; only the
  // tool-specific home variables differ.
  if (!actorHome || !actorBin) throw new Error(`${spec.tool} actor requires an isolated home and tool bin.`);
  const inheritedKeys = [
    'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  ];
  const env = Object.fromEntries(inheritedKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  env.HOME = actorHome;
  if (spec.tool === 'codex') {
    env.CODEX_HOME = actorHome;
    env.ZDOTDIR = actorHome;
  }
  env.SHELL = '/bin/zsh';
  env.PATH = [
    ...(arm === 'WITH' ? [join(cwd, '.bin')] : []),
    actorBin,
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(delimiter);
  return env;
}

const REASONING_TOOLS = ['codex', 'grok'];
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export function actorSpec({ tool = 'opencode', binary, model, reasoning } = {}) {
  if (!['codex', 'opencode', 'grok'].includes(tool)) {
    throw new Error(`Unsupported actor tool: ${tool}`);
  }
  if (!REASONING_TOOLS.includes(tool) && reasoning) {
    throw new Error(`--actor-reasoning is only supported by the ${REASONING_TOOLS.join(' or ')} actor.`);
  }
  if (reasoning && !REASONING_EFFORTS.includes(reasoning)) {
    throw new Error(`Unsupported ${tool} reasoning effort: ${reasoning}`);
  }
  return {
    tool,
    binary: binary || tool,
    model,
    reasoning: reasoning || null,
  };
}

export function buildActorInvocation(spec, { prompt, cwd }) {
  if (spec.tool === 'codex') {
    const args = [
      'exec',
      '--strict-config',
      '--model', spec.model,
      '--sandbox', 'workspace-write',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--disable', 'plugins',
      '--disable', 'remote_plugin',
      '--disable', 'plugin_sharing',
      '--disable', 'hooks',
      '--disable', 'memories',
      '--skip-git-repo-check',
      '--json',
      '-c', 'approval_policy="never"',
    ];
    if (spec.reasoning) args.push('-c', `model_reasoning_effort="${spec.reasoning}"`);
    args.push('-C', cwd, prompt);
    return { binary: resolveActorExecutable(spec.binary, cwd), args };
  }
  if (spec.tool === 'grok') {
    // Fail-closed isolation mirroring the reviewed Codex boundary:
    //   - bypassPermissions + always-approve: no interactive prompts can block the turn
    //   - no-memory: no cross-session memory persistence
    //   - no-subagents: no lateral agent escalation
    //   - no-plan: no plan-mode side channel
    //   - disable-web-search: no external retrieval that could leak the brief
    //   - sandbox workspace: filesystem writes confined to the workspace
    // Personal config/skills/plugins are excluded via the auth-only HOME (actorEnvironment).
    const args = [
      '-m', spec.model,
      '--permission-mode', 'bypassPermissions',
      '--always-approve',
      '--no-memory',
      '--no-subagents',
      '--no-plan',
      '--disable-web-search',
      '--sandbox', 'workspace',
      '--output-format', 'streaming-json',
    ];
    if (spec.reasoning) args.push('--reasoning-effort', spec.reasoning);
    args.push('-p', prompt);
    return { binary: resolveActorExecutable(spec.binary, cwd), args };
  }
  return {
    binary: spec.binary,
    args: ['run', '--auto', '--dir', cwd, '--model', spec.model, prompt],
  };
}

export function prepareActorWorkspace(spec, cwd) {
  if (!['codex', 'grok'].includes(spec.tool)) return;
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd, encoding: 'utf8', timeout: 30000 });
  if (initialized.status !== 0) {
    throw new Error(`Cannot isolate ${spec.tool} actor workspace: ${initialized.stderr || 'git init failed'}`);
  }
}

export function retainActorTrace(spec, processResult, runDir, opencodeTrace) {
  if (spec.tool === 'opencode') return opencodeTrace();
  // codex and grok both emit their event stream on stdout; persist it verbatim.
  const file = 'actor.events.jsonl';
  writeFileSync(join(runDir, file), processResult.stdout || '');
  const parsed = parseActorTrace(spec.tool, processResult.stdout || '');
  const format = spec.tool === 'codex' ? 'codex-jsonl' : 'grok-streaming-json';
  return {
    retained: Boolean(processResult.stdout),
    valid: parsed.valid,
    invalid_reasons: parsed.reasons,
    session_id: parsed.threadId,
    file,
    format,
    ephemeral: true,
    sanitized: false,
    event_count: parsed.eventCount,
    terminal_event: parsed.terminalEvent,
    recovered_error_count: parsed.recoveredErrorCount,
    command_log: parsed.commandLog,
  };
}

/**
 * Dispatch trace parsing by actor tool. Each tool emits a distinct event format;
 * all return the same receipt shape so the runner and evidence pipeline stay agnostic.
 */
export function parseActorTrace(tool, jsonl, options = {}) {
  if (tool === 'codex') return parseCodexTrace(jsonl, options);
  if (tool === 'grok') return parseGrokTrace(jsonl, options);
  return { valid: false, reasons: [`Unsupported actor tool for trace parsing: ${tool}`] };
}

export function codexThreadId(jsonl) {
  return parseCodexTrace(jsonl, { requireTerminal: false }).threadId;
}

export function parseCodexTrace(jsonl, { requireTerminal = true } = {}) {
  const events = [];
  const reasons = [];
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      reasons.push('Codex trace contains malformed JSONL');
    }
  }
  const started = events.find((event) => event.type === 'thread.started' && event.thread_id);
  const completedIndex = events.findLastIndex((event) => event.type === 'turn.completed');
  const completed = completedIndex >= 0 ? events[completedIndex] : null;
  const turnFailed = events.find((event) => event.type === 'turn.failed');
  const errorIndexes = events
    .map((event, index) => (event.type === 'error' ? index : -1))
    .filter((index) => index >= 0);
  const terminalError = errorIndexes.find((index) => completedIndex < 0 || index > completedIndex);
  const recoveredErrorCount = errorIndexes.filter((index) => completedIndex >= 0 && index < completedIndex).length;
  if (!started) reasons.push('Codex trace is missing thread.started');
  if (turnFailed) reasons.push('Codex trace contains turn.failed');
  if (terminalError !== undefined) reasons.push('Codex trace contains terminal error');
  if (requireTerminal && !completed) reasons.push('Codex trace is missing turn.completed');
  const commands = events
    .filter((event) => event.type === 'item.completed' && event.item?.type === 'command_execution')
    .map((event) => event.item.command)
    .filter(Boolean);
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    threadId: started?.thread_id || null,
    eventCount: events.length,
    terminalEvent: terminalError !== undefined ? 'error' : turnFailed ? 'turn.failed' : completed ? 'turn.completed' : null,
    recoveredErrorCount,
    commandLog: commands.join('\n'),
  };
}

export function grokThreadId(jsonl) {
  return parseGrokTrace(jsonl, { requireTerminal: false }).threadId;
}

/**
 * Parse a Grok CLI streaming-json trace. Grok emits incremental
 * `{type:"thought"|"text",data:"..."}` events terminated by a single
 * `{type:"end",stopReason,sessionId,requestId}` event. A turn completed cleanly
 * only when an `end` event carries `stopReason === "EndTurn"`; any other terminal
 * stopReason (e.g. an error/cancellation) fails the trace closed.
 */
export function parseGrokTrace(jsonl, { requireTerminal = true } = {}) {
  const events = [];
  const reasons = [];
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      reasons.push('Grok trace contains malformed JSONL');
    }
  }
  if (!events.length) reasons.push('Grok trace is empty');
  const endEvents = events.filter((event) => event?.type === 'end');
  const end = endEvents.length ? endEvents[endEvents.length - 1] : null;
  const cleanEnd = end && end.stopReason === 'EndTurn';
  if (requireTerminal && !end) reasons.push('Grok trace is missing end event');
  if (end && !cleanEnd) reasons.push(`Grok trace ended with stopReason ${end.stopReason || 'unknown'}`);
  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    threadId: end?.sessionId || null,
    eventCount: events.length,
    terminalEvent: end ? (cleanEnd ? 'end' : `end:${end.stopReason || 'unknown'}`) : null,
    recoveredErrorCount: 0,
    commandLog: '',
  };
}

export function runActor(spec, { prompt, cwd, arm, timeout, actorHome, actorBin }) {
  const invocation = buildActorInvocation(spec, { prompt, cwd });
  return runProcess(invocation.binary, invocation.args, {
    cwd,
    timeout,
    env: actorEnvironment(spec, { cwd, arm, actorHome, actorBin }),
  });
}

export function resolveActorExecutable(binary, cwd) {
  if (isAbsolute(binary)) return binary;
  if (binary.includes('/')) return resolve(cwd, binary);
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`Cannot resolve actor executable: ${binary}`);
}

function runProcess(binary, args, { cwd, timeout, env }) {
  return new Promise((done) => {
    const started = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let error = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const detached = process.platform !== 'win32';
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env, detached });
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(stdout);
      if (remaining > 0) stdout += chunk.subarray(0, remaining).toString('utf8');
      if (chunk.length > remaining) stdoutTruncated = true;
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(stderr);
      if (remaining > 0) stderr += chunk.subarray(0, remaining).toString('utf8');
      if (chunk.length > remaining) stderrTruncated = true;
    });
    child.on('error', (caught) => { error = caught.message; });
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      signalProcessTree(child, 'SIGTERM', detached);
      killTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL', detached), 5000);
    }, timeout);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signalProcessTree(child, 'SIGTERM', detached);
      setTimeout(() => {
        signalProcessTree(child, 'SIGKILL', detached);
        done({
          status, signal, stdout, stderr, error, timedOut,
          durationMs: Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 100) / 100,
          stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated,
        });
      }, detached ? 50 : 0);
    });
  });
}

function signalProcessTree(child, signal, detached) {
  try {
    if (detached && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
