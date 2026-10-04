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

export interface RunRequest {
  prompt: string;
  model: string;
  cwd: string;
  sandbox: Sandbox;
  maxTurns: number;
  lastMessageFile: string;
}

export interface Invocation {
  binary: string;
  args: string[];
  shell: false;
}

export interface AgentSpec {
  id: AgentId;
  label: string;
  binary: string;
  models: string[];
  defaultModel: string;
  tier3Models: string[];
  /** Regexes read against stderr first, then stdout, to learn which model really answered. */
  bannerPatterns: RegExp[];
  build: (r: RunRequest) => string[];
}

const HOME = '/Users/alig';

export const AGENTS: Record<AgentId, AgentSpec> = {
  codex: {
    id: 'codex',
    label: 'Codex',
    binary: '/opt/homebrew/bin/codex',
    models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'],
    defaultModel: 'gpt-6-astra',
    tier3Models: ['gpt-6-sol', 'gpt-6.1-sol'],
    bannerPatterns: [/^\s*model:\s*([A-Za-z0-9._-]+)/m],
    build: (r) => [
      'exec',
      '-m', r.model,
      '-s', r.sandbox,
      '--skip-git-repo-check',
      '-C', r.cwd,
      '-o', r.lastMessageFile,
      '--json',
      r.prompt,
    ],
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    binary: `${HOME}/.local/bin/claude`,
    models: ['claude-haiku-4-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-4-5',
    tier3Models: ['claude-opus-5-5'],
    // stream-json puts the model in every assistant event: that is the proof, not the answer text.
    bannerPatterns: [/"model":"([A-Za-z0-9._-]+)"/],
    build: (r) => [
      '-p',
      '--model', r.model,
      '--max-turns', String(r.maxTurns),
      '--output-format', 'stream-json',
      '--verbose',
      r.prompt,
    ],
  },
  agy: {
    id: 'agy',
    label: 'Antigravity',
    binary: `${HOME}/.local/bin/agy`,
    models: [
      'gemini-3.8-flash-low',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-high',
      'gemini-3.1-pro-high',
    ],
    defaultModel: 'gemini-3.8-flash-low',
    tier3Models: ['gemini-3.1-pro-high'],
    bannerPatterns: [],
    // --model must come BEFORE -p: -p consumes the next token as its prompt.
    build: (r) => ['--model', r.model, '-p', r.prompt],
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode (GLM)',
    binary: '/opt/homebrew/bin/opencode',
    models: ['opencode-go/glm-5.3', 'opencode-go/glm-5.3-flash', 'opencode-go/glm-5.2'],
    defaultModel: 'opencode-go/glm-5.3',
    tier3Models: ['opencode-go/glm-5.3'],
    bannerPatterns: [/"model":"([A-Za-z0-9._/-]+)"/],
    build: (r) => ['run', '--model', r.model, '--format', 'json', r.prompt],
  },
};

export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export function buildInvocation(id: AgentId, r: RunRequest): Invocation {
  const spec = AGENTS[id];
  if (!spec) throw new Error(`unknown agent: ${id}`);
  return { binary: spec.binary, args: spec.build(r), shell: false };
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
