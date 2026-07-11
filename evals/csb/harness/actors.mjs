import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

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
      '--skip-git-repo-check',
      '--json',
      '-c', 'approval_policy="never"',
    ];
    if (spec.reasoning) args.push('-c', `model_reasoning_effort="${spec.reasoning}"`);
    args.push('-C', cwd, prompt);
    return { binary: spec.binary, args };
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
  const failed = events.find((event) => event.type === 'turn.failed' || event.type === 'error');
  const completed = events.findLast((event) => event.type === 'turn.completed');
  if (!started) reasons.push('Codex trace is missing thread.started');
  if (failed) reasons.push(`Codex trace contains ${failed.type}`);
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
    terminalEvent: completed ? 'turn.completed' : failed?.type || null,
    commandLog: commands.join('\n'),
  };
}

export function runActor(spec, { prompt, cwd, arm, timeout }) {
  const invocation = buildActorInvocation(spec, { prompt, cwd });
  return runProcess(invocation.binary, invocation.args, {
    cwd,
    timeout,
    env: {
      ...process.env,
      PATH: arm === 'WITH'
        ? `${join(cwd, '.bin')}:${process.env.PATH || ''}`
        : process.env.PATH || '',
    },
  });
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
