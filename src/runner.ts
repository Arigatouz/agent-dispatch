import { spawn } from 'child_process';
import type { ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface RunOptions {
  binary: string;
  /** Args that come before the agent's own args, e.g. the fake CLI path in tests. */
  baseArgs?: string[];
  args: string[];
  cwd?: string;
  timeoutMs: number;
  /** Only PATH is read from this today; the whole env is inherited otherwise. */
  env?: NodeJS.ProcessEnv;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
  cancelled: boolean;
}

export interface RunHandle extends Promise<RunResult> {
  done: Promise<RunResult>;
  cancel: () => void;
  pid: number | undefined;
}

/**
 * The PATH the CLIs need. Obsidian started from Finder or the Dock inherits a minimal PATH
 * ("/usr/bin:/bin:/usr/sbin:/sbin"), so a bare spawn("codex") fails with ENOENT even though codex
 * works in every terminal. Absolute binaries plus this PATH is the fix.
 */
export const DISPATCH_PATH = [
  join(homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');

const SIGKILL_GRACE_MS = 2000;

/**
 * Spawn one agent, stream its output line by line, and always resolve with a result. Nothing here
 * throws for a normal failure: a missing binary, a non-zero exit, a timeout and a cancel are four
 * different results the UI has to show differently, not one exception.
 */
export function runAgent(o: RunOptions): RunHandle {
  const started = Date.now();
  // A configured working directory can be deleted between runs (that is what a moved vault looks like).
  // Spawning into a missing cwd produced a child that never spawned and a promise that never settled, so
  // the directory is checked first and the process cwd is the fallback.
  const cwd = o.cwd && existsSync(o.cwd) ? o.cwd : process.cwd();

  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(o.binary, [...(o.baseArgs ?? []), ...o.args], {
      shell: false,
      cwd,
      env: { ...process.env, PATH: o.env?.PATH ?? DISPATCH_PATH },
      // stdin is /dev/null, not a pipe. codex prints "Reading additional input from stdin..." and waits
      // for it, and claude warns about missing stdin data; an open pipe keeps both of them hanging until
      // the timeout, which is what the first live run through the plugin did.
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcessByStdio<null, Readable, Readable>;
  } catch (error) {
    return failedHandle(`spawn error: ${(error as Error).message}`, Date.now() - started);
  }

  let timedOut = false;
  let cancelled = false;
  let settled = false;
  let stdout = '';
  let stderr = '';
  let outTail = '';
  let errTail = '';
  let killTimer: NodeJS.Timeout | undefined;
  let killEscalation: NodeJS.Timeout | undefined;

  const emit = (chunk: Buffer, which: 'out' | 'err') => {
    const text = chunk.toString();
    if (which === 'out') {
      stdout += text;
      outTail += text;
      const lines = outTail.split('\n');
      outTail = lines.pop() ?? '';
      for (const line of lines) o.onStdout?.(line);
    } else {
      stderr += text;
      errTail += text;
      const lines = errTail.split('\n');
      errTail = lines.pop() ?? '';
      for (const line of lines) o.onStderr?.(line);
    }
  };

  child.stdout.on('data', (c: Buffer) => emit(c, 'out'));
  child.stderr.on('data', (c: Buffer) => emit(c, 'err'));

  killTimer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    killEscalation = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
    killEscalation.unref?.();
  }, o.timeoutMs);
  killTimer.unref?.();

  const done = new Promise<RunResult>((resolve) => {
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (killEscalation) clearTimeout(killEscalation);
      // A last line without a trailing newline is still output.
      if (outTail.length) o.onStdout?.(outTail);
      if (errTail.length) o.onStderr?.(errTail);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        ms: Date.now() - started,
        timedOut,
        cancelled,
      });
    };

    child.on('error', (error: Error) => {
      stderr += `\nspawn error: ${error.message}`;
      finish(null);
    });
    child.on('close', (code: number | null) => finish(code));
  });

  // The handle IS the promise (await runAgent(...) resolves with the result), with cancel and pid
  // hanging off it, so a caller cannot forget to await the run and then read undefined fields.
  const handle = Object.assign(done, {
    done,
    pid: child.pid,
    cancel: () => {
      cancelled = true;
      child.kill('SIGTERM');
      killEscalation = setTimeout(() => child.kill('SIGKILL'), SIGKILL_GRACE_MS);
      killEscalation.unref?.();
    },
  }) as RunHandle;

  return handle;
}

/** A result for a run that never started, shaped exactly like a real one so callers need no special case. */
function failedHandle(message: string, ms: number): RunHandle {
  const result: RunResult = {
    exitCode: null,
    stdout: '',
    stderr: message,
    ms,
    timedOut: false,
    cancelled: false,
  };
  const promise = Promise.resolve(result);
  return Object.assign(promise, { done: promise, pid: undefined, cancel: () => {} }) as RunHandle;
}
