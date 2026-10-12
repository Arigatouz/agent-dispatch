/**
 * The agent registry: one AgentSpec per CLI, each owning its absolute binary path, its model list and its
 * argv shape. Nothing here imports Obsidian, so the whole invocation layer is unit-testable.
 *
 * Every argv shape was verified against the real CLI on 2026-10-04 (docs/cli-probes.md). Two of them are
 * unusual enough to deserve the comment they get: agy needs its model before -p, and codex writes its
 * model banner to stderr.
 */
export type AgentId = 'codex' | 'claude' | 'agy' | 'opencode';
export type Sandbox = 'read-only' | 'workspace-write';

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** How a run's permissions are really constrained. Declared per agent because only some CLIs accept
 *  a sandbox flag, so the panel must not promise read-only for an agent that cannot accept it.
 *  Mechanisms verified against each binary's own --help on 2026-10-09. */
export type PermissionMechanism = 'os-sandbox' | 'tool-permissions' | 'none';

export interface PermissionPosture {
  mechanism: PermissionMechanism;
  /** True only when this agent's argv actually pins the requested sandbox. */
  enforcesSandbox: boolean;
  /** One line for the panel and the run record: what protects the run, or that nothing does. */
  note: string;
}

export interface RunRequest {
  prompt: string;
  model: string;
  cwd: string;
  sandbox: Sandbox;
  maxTurns: number;
  lastMessageFile: string;
  /** What the CLI is allowed to do unattended. Defaults to plan, which is the safe posture. */
  mode?: 'plan' | 'accept-edits';
  /** Escape hatch, appended before the prompt: whatever that CLI documents for unattended runs. */
  extraArgs?: string[];
}

export interface Invocation {
  binary: string;
  args: string[];
  shell: false;
}

export interface AgentSpec {
  id: AgentId;
  label: string;
  /**
   * The command name, not a path. A published plugin cannot hardcode one developer's home directory,
   * so this stays bare and `resolveBinary()` turns it into an absolute path on the machine that runs it.
   */
  binary: string;
  models: string[];
  defaultModel: string;
  tier3Models: string[];
  /** Regexes read against stderr first, then stdout, to learn which model really answered. */
  bannerPatterns: RegExp[];
  /** True when the CLI emits a machine-readable event stream, so a text-free line is bookkeeping. */
  eventMode: boolean;
  /** What actually protects this agent's run. Surfaced in the panel and written to the run record. */
  permission: PermissionPosture;
  build: (r: RunRequest) => string[];
}

/**
 * Where a CLI usually lives when Obsidian was started from Finder and inherited a minimal PATH.
 * Resolution order at run time: the settings override, then PATH, then these directories.
 */
export const BINARY_SEARCH_DIRS = [
  join(homedir(), '.local', 'bin'),
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
];

/** Absolute candidate paths for one agent, in search order. */
export function candidatePaths(id: AgentId): string[] {
  const spec = AGENTS[id];
  if (!spec) return [];
  return BINARY_SEARCH_DIRS.map((dir) => join(dir, spec.binary));
}

/**
 * Absolute path to the CLI when one exists on this machine, else the bare command name and let the
 * spawn PATH decide. Never a hardcoded path from someone else's laptop.
 */
export function resolveBinary(id: AgentId): string {
  if (!AGENTS[id]) return id;
  for (const candidate of candidatePaths(id)) {
    if (existsSync(candidate)) return candidate;
  }
  return AGENTS[id].binary;
}

export const AGENTS: Record<AgentId, AgentSpec> = {
  codex: {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'],
    defaultModel: 'gpt-6-astra',
    tier3Models: ['gpt-6-sol', 'gpt-6.1-sol'],
    bannerPatterns: [/^\s*model:\s*([A-Za-z0-9._-]+)/m],
    // Human mode on purpose. Measured 2026-10-05: `codex exec --json` emits no `model:` banner on stderr
    // and no model field in any event (thread.started carries only a thread_id, turn.completed only
    // usage), so JSONL mode makes the CLI-reported model unverifiable. The banner is the evidence that the
    // requested model actually answered, so human mode wins; the prompt is still passed as one argv entry
    // and `-o <file>` remains the answer source. Progress lines keep the panel alive while it works.
    eventMode: false,
    permission: { mechanism: 'os-sandbox', enforcesSandbox: true, note: 'argv pins the sandbox: -s <mode>' },
    build: (r) => [
      'exec',
      '-m', r.model,
      '-s', r.sandbox,
      '--skip-git-repo-check',
      '-C', r.cwd,
      '-o', r.lastMessageFile,
      ...(r.extraArgs ?? []),
      r.prompt,
    ],
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    models: ['claude-haiku-4-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-4-5',
    tier3Models: ['claude-opus-5-5'],
    // stream-json puts the model in every assistant event: that is the proof, not the answer text.
    bannerPatterns: [/"model":"([A-Za-z0-9._-]+)"/],
    eventMode: true,
    // Plan mode is the only read-only posture this CLI exposes as a single-value flag. --disallowedTools
    // exists too but is variadic, so it is deliberately not wired until a probe proves it cannot eat the
    // prompt that follows it.
    permission: { mechanism: 'tool-permissions', enforcesSandbox: true, note: 'plan mode: writes are refused' },
    build: (r) => [
      '-p',
      '--permission-mode', r.mode === 'accept-edits' ? 'acceptEdits' : 'plan',
      '--model', r.model,
      '--max-turns', String(r.maxTurns),
      '--output-format', 'stream-json',
      '--verbose',
      ...(r.extraArgs ?? []),
      r.prompt,
    ],
  },
  agy: {
    id: 'agy',
    label: 'Antigravity',
    binary: 'agy',
    models: [
      'gemini-3.8-flash-low',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-high',
      'gemini-3.1-pro-high',
    ],
    defaultModel: 'gemini-3.8-flash-low',
    tier3Models: ['gemini-3.1-pro-high'],
    bannerPatterns: [],
    eventMode: false,
    // Plan mode refuses edits; --sandbox additionally restricts the terminal. Neither is an OS sandbox
    // of codex's kind, so the mechanism is declared as tool permissions rather than overclaiming.
    permission: { mechanism: 'tool-permissions', enforcesSandbox: true, note: 'plan mode + terminal sandbox' },
    // --model must come BEFORE -p: -p consumes the next token as its prompt.
    build: (r) => [
      '--mode', r.mode === 'accept-edits' ? 'accept-edits' : 'plan',
      '--sandbox',
      ...(r.extraArgs ?? []),
      '--model', r.model,
      '-p', r.prompt,
    ],
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode (GLM)',
    binary: 'opencode',
    models: ['opencode-go/glm-5.3', 'opencode-go/glm-5.3-flash', 'opencode-go/glm-5.2'],
    defaultModel: 'opencode-go/glm-5.3',
    tier3Models: ['opencode-go/glm-5.3'],
    bannerPatterns: [/"model":"([A-Za-z0-9._/-]+)"/],
    eventMode: true,
    // No permission flag exists on 'run'. --agent selects a configured profile whose tool permissions are
    // set elsewhere, and --auto is the opposite of what we want. So this agent cannot be pinned from argv
    // and the panel must say so instead of inheriting the read-only label.
    permission: { mechanism: 'none', enforcesSandbox: false, note: 'UNRESTRICTED: no permission flag on run; inherits its configured profile' },
    build: (r) => ['run', '--model', r.model, '--format', 'json', ...(r.extraArgs ?? []), r.prompt],
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

/**
 * What actually protects a run, for the card and the note. The posture depends on the mode, so a note
 * that says "plan mode: writes are refused" while the run could edit files would be a lie.
 */
export function permissionNote(id: AgentId, mode: 'plan' | 'accept-edits' = 'plan'): string {
  const spec = AGENTS[id];
  if (!spec || spec.permission.mechanism === 'none') return spec ? spec.permission.note : '';
  if (id === 'claude') {
    return mode === 'accept-edits'
      ? 'acceptEdits: file edits auto-approved, commands still gated'
      : 'plan mode: writes are refused';
  }
  if (id === 'agy') {
    return mode === 'accept-edits'
      ? 'accept-edits + terminal sandbox: edits auto-approved'
      : 'plan mode + terminal sandbox';
  }
  return spec.permission.note;
}

export function buildInvocation(id: AgentId, r: RunRequest): Invocation {
  const spec = AGENTS[id];
  if (!spec) throw new Error(`unknown agent: ${id}`);
  return { binary: resolveBinary(id), args: spec.build(r), shell: false };
}

/**
 * Which model actually answered. Never the model's own claim: the CLI's telemetry only.
 * Returns '' when the CLI printed no banner, which the UI must show as "unverified", not as a guess.
 */
export function readModelBanner(id: AgentId, stderr: string, stdout: string): string {
  const spec = AGENTS[id];
  if (!spec) return '';
  for (const pattern of spec.bannerPatterns) {
    const fromStderr = pattern.exec(stderr);
    if (fromStderr?.[1]) return fromStderr[1];
    const fromStdout = pattern.exec(stdout);
    if (fromStdout?.[1]) return fromStdout[1];
  }
  return '';
}

export interface ParsedEvent {
  text?: string;
  model?: string;
}

/**
 * Turn one line of a CLI's event stream into displayable text, or null when the line is not an event.
 * Returning null is the contract the panel relies on: it falls back to showing the raw line, so a JSON
 * shape change degrades to noisy output instead of an empty panel.
 */
export function parseEvent(id: AgentId, line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const event = parsed as Record<string, any>;

  switch (id) {
    case 'claude': {
      if (event.type === 'assistant') {
        const blocks: any[] = event.message?.content ?? [];
        const text = blocks
          .filter((b) => b?.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('');
        const model = typeof event.message?.model === 'string' ? event.message.model : undefined;
        if (!text && !model) return null;
        return { text: text || undefined, model };
      }
      if (event.type === 'result' && typeof event.result === 'string') {
        return { text: event.result };
      }
      return null;
    }
    case 'codex': {
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        return { text: String(event.item.text ?? '') };
      }
      return null;
    }
    case 'opencode': {
      if (event.type === 'text' && typeof event.part?.text === 'string') {
        return { text: event.part.text };
      }
      return null;
    }
    default:
      // agy has no event mode: the panel shows its plain text.
      return null;
  }
}

/**
 * A short label for an event that carries no text. codex opens every run with session bookkeeping, and
 * printing that JSON raw turns the panel into noise, so the line becomes "thread.started" instead.
 */
export function summariseEvent(id: AgentId, line: string): string | null {
  const spec = AGENTS[id];
  if (!spec?.eventMode) return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const event = JSON.parse(trimmed) as Record<string, any>;
    const type = typeof event.type === 'string' ? event.type : null;
    if (!type) return null;
    const itemType = typeof event.item?.type === 'string' ? ` ${event.item.type}` : '';
    return `${type}${itemType}`;
  } catch {
    return null;
  }
}
