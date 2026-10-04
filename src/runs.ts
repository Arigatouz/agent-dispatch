import { AGENTS, buildInvocation, parseEvent, readModelBanner, summariseEvent, type AgentId, type Sandbox } from './agents';
import { runAgent, type RunHandle, type RunOptions, type RunResult } from './runner';
import { detectSignature, type DetectedSignature } from './signatures';
import {
  renderRunJson,
  renderRunLog,
  type RunRecord,
  type RunStatus,
} from './log';

/** One live or finished run, as the panel and the log both need it. */
export interface LiveRun {
  id: string;
  agent: AgentId;
  model: string;
  prompt: string;
  status: RunStatus;
  /** Display lines: parsed event text where the CLI has an event mode, raw stdout otherwise. */
  lines: string[];
  /** The last few stderr lines, which is where codex puts its banner and every CLI puts its errors. */
  stderrTail: string[];
  answer: string;
  reportedModel: string;
  /** The CLI's own error line when a known failure is recognised, so the card can quote it. */
  errorSignature: DetectedSignature | null;
  truncated: boolean;
  exitCode: number | null;
  ms: number;
  timedOut: boolean;
  cancelled: boolean;
  startedAt: number;
  finishedAt?: number;
  pid?: number;
  cancel: () => void;
  done: Promise<LiveRun>;
}

export interface RunEvent {
  type: 'start' | 'update' | 'finish';
  run: LiveRun;
}

export interface RunManagerOptions {
  /** Injectable so tests can swap the executable. The argv still comes from the registry. */
  runner?: (options: RunOptions) => RunHandle;
  /** Where the raw JSON record goes. Defaults to doing nothing, which is what tests want. */
  writeLog?: (record: RunRecord, json: string) => Promise<void>;
  cwd: string;
  timeoutMs?: number;
  sandbox?: Sandbox;
  maxTurns?: number;
  lastMessagePathFor: (runId: string) => string;
  /** Settings can point an agent at a different binary; the registry value is the fallback. */
  binaryFor?: (agent: AgentId) => string;
  /** Reads codex's -o file, which is the reliable answer for codex. */
  readLastMessage?: (path: string) => string | null;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 300000;
const STDERR_TAIL_LINES = 40;
const SENTENCE_END = /[.!?:;)\]}"'`]$/;

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Owns every live run: starts it, streams it to subscribers, extracts the answer, proves which model
 * answered, and writes the record. Obsidian-facing code (the panel, the modal, the plugin) only talks to
 * this class, which keeps the Obsidian API out of the testable path.
 */
export class RunManager {
  private readonly opts: RunManagerOptions;
  private readonly runs = new Map<string, LiveRun>();
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly handles = new Map<string, RunHandle>();
  private counter = 0;

  constructor(options: RunManagerOptions) {
    this.opts = options;
  }

  list(): LiveRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: RunEvent['type'], run: LiveRun) {
    for (const listener of this.listeners) listener({ type, run });
  }

  start(agent: AgentId, model: string, prompt: string): LiveRun {
    const id = `${Date.now().toString(36)}-${++this.counter}`;
    const spec = AGENTS[agent];
    const run: LiveRun = {
      id,
      agent,
      model: model || spec.defaultModel,
      prompt,
      status: 'running',
      lines: [],
      stderrTail: [],
      answer: '',
      reportedModel: '',
      errorSignature: null,
      truncated: false,
      exitCode: null,
      ms: 0,
      timedOut: false,
      cancelled: false,
      startedAt: Date.now(),
      cancel: () => this.handles.get(id)?.cancel(),
      done: Promise.resolve({} as LiveRun),
    };

    const lastMessageFile = this.opts.lastMessagePathFor(id);
    const { binary, args } = buildInvocation(agent, {
      prompt,
      model: run.model,
      cwd: this.opts.cwd,
      sandbox: this.opts.sandbox ?? 'read-only',
      maxTurns: this.opts.maxTurns ?? 1,
      lastMessageFile,
    });

    let parsedText = '';
    let lastChunk = '';

    const runner = this.opts.runner ?? runAgent;
    const handle = runner({
      binary: this.opts.binaryFor?.(agent) ?? binary,
      args,
      cwd: this.opts.cwd,
      timeoutMs: this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onStdout: (line) => {
        const event = parseEvent(agent, line);
        if (event?.text) {
          // Claude prints the answer twice (assistant event, then result event): keep one.
          if (event.text !== lastChunk) {
            parsedText += event.text;
            lastChunk = event.text;
            run.lines.push(event.text);
          }
        } else {
          const label = summariseEvent(agent, line);
          // ASCII marker on purpose: the panel output gets copied out, and a label is easier to grep than
          // a multi-byte bullet.
          run.lines.push(label ? `event: ${label}` : line);
        }
        this.emit('update', run);
      },
      onStderr: (line) => {
        run.stderrTail.push(line);
        if (run.stderrTail.length > STDERR_TAIL_LINES) run.stderrTail.shift();
        this.emit('update', run);
      },
    });

    run.pid = handle.pid;
    this.handles.set(id, handle);
    this.runs.set(id, run);
    this.emit('start', run);

    run.done = handle.then(async (result: RunResult) => {
      this.handles.delete(id);
      const fullStdout = result.stdout;
      const fullStderr = result.stderr;

      const fromFile =
        this.opts.readLastMessage && !result.timedOut && !result.cancelled
          ? this.opts.readLastMessage(lastMessageFile)
          : null;
      // An event-mode CLI that produced no text event produced no answer: dumping its bookkeeping JSON as
      // the answer is how a quota block gets read as a result.
      const answer = (fromFile ?? (parsedText.trim() || (AGENTS[agent].eventMode ? '' : fullStdout.trim()))).trim();

      run.answer = answer;
      run.ms = result.ms;
      run.exitCode = result.exitCode;
      run.timedOut = result.timedOut;
      run.cancelled = result.cancelled;
      run.reportedModel = readModelBanner(agent, fullStderr, fullStdout);
      run.errorSignature = detectSignature(fullStderr, fullStdout, fromFile ?? undefined);
      run.truncated = answer.length > 0 && !SENTENCE_END.test(answer);
      run.status = result.cancelled
        ? 'cancelled'
        : result.timedOut
          ? 'timeout'
          : result.exitCode === 0
            ? 'done'
            : 'error';
      run.finishedAt = Date.now();

      if (this.opts.writeLog) {
        const record: RunRecord = {
          agent,
          model: run.model,
          reportedModel: run.reportedModel,
          prompt,
          answer,
          status: run.status,
          ms: run.ms,
          exitCode: run.exitCode,
          timedOut: run.timedOut,
          cancelled: run.cancelled,
          truncated: run.truncated,
          cwd: this.opts.cwd,
          created: localDate((this.opts.now ?? (() => new Date()))()),
        };
        try {
          await this.opts.writeLog(record, renderRunJson(record));
        } catch (error) {
          run.stderrTail.push(`log write failed: ${(error as Error).message}`);
        }
      }

      this.emit('finish', run);
      return run;
    });

    return run;
  }

  cancelAll(): void {
    for (const handle of this.handles.values()) handle.cancel();
  }

  /** Markdown for a finished run, ready to drop into a note. */
  toMarkdown(run: LiveRun): string {
    return renderRunLog({
      agent: run.agent,
      model: run.model,
      reportedModel: run.reportedModel,
      prompt: run.prompt,
      answer: run.answer,
      status: run.status,
      ms: run.ms,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      cancelled: run.cancelled,
      truncated: run.truncated,
      cwd: this.opts.cwd,
      created: localDate((this.opts.now ?? (() => new Date()))()),
    });
  }
}
