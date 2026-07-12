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

export function actorEnvironment(spec, { cwd, arm, actorHome, actorBin } = {}) {
  if (spec.tool !== 'codex') {
    return {
      ...process.env,
      PATH: arm === 'WITH'
        ? `${join(cwd, '.bin')}:${process.env.PATH || ''}`
        : process.env.PATH || '',
    };
  }
  if (!actorHome || !actorBin) throw new Error('Codex actor requires an isolated home and tool bin.');
  const inheritedKeys = [
    'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  ];
  const env = Object.fromEntries(inheritedKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  env.HOME = actorHome;
  env.CODEX_HOME = actorHome;
  env.ZDOTDIR = actorHome;
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

export function actorSpec({ tool = 'opencode', binary, model, reasoning } = {}) {
  if (!['codex', 'opencode'].includes(tool)) {
    throw new Error(`Unsupported actor tool: ${tool}`);
  }
  if (tool !== 'codex' && reasoning) {
    throw new Error('--actor-reasoning is only supported by the codex actor.');
  }
  if (reasoning && !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(reasoning)) {
    throw new Error(`Unsupported Codex reasoning effort: ${reasoning}`);
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
    return { binary: resolveExecutable(spec.binary, cwd), args };
  }
  return {
    binary: spec.binary,
    args: ['run', '--auto', '--dir', cwd, '--model', spec.model, prompt],
  };
}

export function prepareActorWorkspace(spec, cwd) {
  if (spec.tool !== 'codex') return;
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd, encoding: 'utf8', timeout: 30000 });
  if (initialized.status !== 0) {
    throw new Error(`Cannot isolate Codex actor workspace: ${initialized.stderr || 'git init failed'}`);
  }
}

export function retainActorTrace(spec, processResult, runDir, opencodeTrace) {
  if (spec.tool !== 'codex') return opencodeTrace();
  const file = 'actor.events.jsonl';
  writeFileSync(join(runDir, file), processResult.stdout || '');
  const parsed = parseCodexTrace(processResult.stdout || '');
  return {
    retained: Boolean(processResult.stdout),
    valid: parsed.valid,
    invalid_reasons: parsed.reasons,
    session_id: parsed.threadId,
    file,
    format: 'codex-jsonl',
    ephemeral: true,
    sanitized: false,
    event_count: parsed.eventCount,
    terminal_event: parsed.terminalEvent,
    recovered_error_count: parsed.recoveredErrorCount,
    command_log: parsed.commandLog,
  };
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

export function runActor(spec, { prompt, cwd, arm, timeout, actorHome, actorBin }) {
  const invocation = buildActorInvocation(spec, { prompt, cwd });
  return runProcess(invocation.binary, invocation.args, {
    cwd,
    timeout,
    env: actorEnvironment(spec, { cwd, arm, actorHome, actorBin }),
  });
}

function resolveExecutable(binary, cwd) {
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
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
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
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeout);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      done({
        status, signal, stdout, stderr, error, timedOut,
        durationMs: Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 100) / 100,
        stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated,
      });
    });
  });
}
