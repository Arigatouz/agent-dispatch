import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import {
  AGENTS, AGENT_IDS, buildInvocation, candidatePaths, parseEvent, permissionNote, readModelBanner,
  resolveBinary, summariseEvent,
} from '../src/agents';

const base = {
  prompt: 'PROBE-77',
  model: 'M',
  cwd: '/tmp/work',
  sandbox: 'read-only' as const,
  maxTurns: 1,
  lastMessageFile: '/tmp/work/last.txt',
};

describe('buildInvocation: one argv shape per CLI, verified against the real CLIs', () => {
  it('codex puts the model on -m, stays in human mode so the banner exists, and the prompt last', () => {
    const inv = buildInvocation('codex', { ...base, model: 'gpt-6-astra' });
    // The binary is resolved on the machine that runs it: a real path when the CLI is installed,
    // otherwise the bare command name so the spawn PATH decides. Never a hardcoded home directory.
    expect(inv.binary === 'codex' || inv.binary.endsWith('/codex')).toBe(true);
    // Deliberately no --json. Measured 2026-10-05: `codex exec --json` prints no `model:` banner on
    // stderr and no model field in any event, so the CLI-reported model becomes unverifiable, and that
    // row is the whole point of the end-to-end matrix. Human mode still prints progress lines as it
    // works, so the panel is not silent.
    expect(inv.args).toEqual([
      'exec', '-m', 'gpt-6-astra', '-s', 'read-only', '--skip-git-repo-check',
      '-C', '/tmp/work', '-o', '/tmp/work/last.txt', 'PROBE-77',
    ]);
    expect(AGENTS.codex.eventMode).toBe(false);
  });

  it('claude streams events and passes the prompt as the trailing positional', () => {
    const inv = buildInvocation('claude', { ...base, model: 'claude-haiku-4-5' });
    expect(inv.args).toEqual([
      '-p', '--permission-mode', 'plan', '--model', 'claude-haiku-4-5', '--max-turns', '1',
      '--output-format', 'stream-json', '--verbose', 'PROBE-77',
    ]);
  });

  it('agy puts the model BEFORE -p, because -p eats the next token', () => {
    const inv = buildInvocation('agy', { ...base, model: 'gemini-3.8-flash-low' });
    expect(inv.args).toEqual(['--mode', 'plan', '--sandbox', '--model', 'gemini-3.8-flash-low', '-p', 'PROBE-77']);
    const pIndex = inv.args.indexOf('-p');
    expect(inv.args[pIndex + 1]).toBe('PROBE-77');
  });

  it('opencode uses run --model provider/model with json events', () => {
    const inv = buildInvocation('opencode', { ...base, model: 'opencode-go/glm-5.3' });
    expect(inv.args).toEqual(['run', '--model', 'opencode-go/glm-5.3', '--format', 'json', 'PROBE-77']);
  });

  it('every agent declares a permission posture, not just the sandbox flag', () => {
    for (const id of AGENT_IDS) {
      const spec = AGENTS[id];
      expect(spec.permission, `${id} has no permission posture`).toBeDefined();
      expect(spec.permission.note.length).toBeGreaterThan(0);
    }
  });

  it('an agent that cannot be pinned from argv says so instead of claiming read-only', () => {
    // opencode's `run` exposes no permission flag, so its posture must not claim enforcement.
    const opencode = AGENTS.opencode.permission;
    expect(opencode.enforcesSandbox).toBe(false);
    expect(opencode.mechanism).toBe('none');
    expect(opencode.note).toMatch(/UNRESTRICTED/);
    const args = buildInvocation('opencode', { ...base, model: 'opencode-go/glm-5.3' }).args;
    expect(args).not.toContain('--auto');
  });

  it('the agents that can be constrained actually carry the pin in their argv', () => {
    expect(buildInvocation('codex', { ...base, sandbox: 'read-only' }).args).toContain('read-only');
    expect(buildInvocation('claude', base).args).toEqual(
      expect.arrayContaining(['--permission-mode', 'plan']),
    );
    expect(buildInvocation('agy', base).args).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']));
    for (const id of ['codex', 'claude', 'agy'] as const) {
      expect(AGENTS[id].permission.enforcesSandbox, `${id} claims no enforcement`).toBe(true);
    }
  });

  it('never routes the prompt through a shell, even when the prompt is hostile', () => {
    const inv = buildInvocation('codex', { ...base, prompt: 'a; rm -rf / #' });
    expect(inv.shell).toBe(false);
    expect(inv.args.at(-1)).toBe('a; rm -rf / #');
  });

  it('every agent ships at least one model, a default inside its list, and a banner strategy', () => {
    for (const spec of Object.values(AGENTS)) {
      expect(spec.models.length).toBeGreaterThan(0);
      expect(spec.models).toContain(spec.defaultModel);
      expect(typeof spec.binary).toBe('string');
      // Bare command name by design, so candidates can be built for whatever machine runs the plugin.
      expect(spec.binary.includes('/')).toBe(false);
    }
  });
});

describe('binary resolution: portable across machines', () => {
  it('candidate paths are absolute and live in the usual bin directories', () => {
    for (const id of AGENT_IDS) {
      const paths = candidatePaths(id);
      expect(paths.length).toBeGreaterThan(0);
      for (const candidate of paths) {
        expect(candidate.startsWith('/')).toBe(true);
        expect(candidate.endsWith(AGENTS[id].binary)).toBe(true);
      }
    }
  });

  it('resolves to an absolute path when the CLI exists, else to the bare command name', () => {
    for (const id of AGENT_IDS) {
      const resolved = resolveBinary(id);
      expect(typeof resolved).toBe('string');
      const installed = candidatePaths(id).some((candidate) => existsSync(candidate));
      if (installed) expect(resolved.startsWith('/')).toBe(true);
      else expect(resolved).toBe(AGENTS[id].binary);
    }
  });

  it('buildInvocation uses the resolved binary, not the registry string', () => {
    const inv = buildInvocation('agy', { ...base, model: 'gemini-3.8-flash-low' });
    expect(inv.binary).toBe(resolveBinary('agy'));
  });
});

describe('mode and extra args: policy is an input, not a hardcode', () => {
  it('defaults to plan and takes accept-edits, spelled the way each CLI spells it', () => {
    expect(buildInvocation('claude', base).args).toContain('plan');
    expect(buildInvocation('claude', { ...base, mode: 'accept-edits' }).args).toContain('acceptEdits');
    expect(buildInvocation('agy', base).args).toContain('plan');
    expect(buildInvocation('agy', { ...base, mode: 'accept-edits' }).args).toContain('accept-edits');
  });

  it('keeps the prompt the trailing positional, with extra args before it', () => {
    for (const id of AGENT_IDS) {
      const inv = buildInvocation(id, { ...base, extraArgs: ['--dangerously-skip-permissions'] });
      const at = inv.args.indexOf('--dangerously-skip-permissions');
      expect(at, `${id} dropped its extra args`).toBeGreaterThan(-1);
      expect(at, `${id} put extra args after the prompt`).toBeLessThan(inv.args.length - 1);
      expect(inv.args.at(-1), `${id} lost the prompt`).toBe(base.prompt);
    }
    // agy is the picky one: its --model has to precede -p, so the escape hatch goes before both.
    const agy = buildInvocation('agy', { ...base, extraArgs: ['--x'] }).args;
    expect(agy.indexOf('--x')).toBeLessThan(agy.indexOf('--model'));
  });

  it('the permission note follows the mode, so a record cannot claim plan while edits are allowed', () => {
    expect(permissionNote('claude', 'plan')).toMatch(/writes are refused/);
    expect(permissionNote('claude', 'accept-edits')).toMatch(/acceptEdits/);
    expect(permissionNote('agy', 'accept-edits')).toMatch(/edits auto-approved/);
    expect(permissionNote('opencode', 'accept-edits')).toMatch(/UNRESTRICTED/);
  });
});

describe('readModelBanner: trust the CLI, not the model', () => {
  it('reads the codex banner from stderr, where codex writes it', () => {
    const stderr = 'reading prompt\nmodel: gpt-6-astra\nreasoning effort: ultra\ntokens used\n1,234\n';
    expect(readModelBanner('codex', stderr, '')).toBe('gpt-6-astra');
  });

  it('prefers stderr over stdout when both claim a model', () => {
    const stderr = 'model: gpt-6-astra';
    const stdout = 'I am definitely claude-opus-5-5';
    expect(readModelBanner('codex', stderr, stdout)).toBe('gpt-6-astra');
  });

  it('returns an empty string for a CLI that prints no banner', () => {
    expect(readModelBanner('agy', 'some noise\n', 'PROBE-77')).toBe('');
  });

  it('reads the model out of a claude stream-json assistant event', () => {
    const line = JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', content: [] } });
    expect(readModelBanner('claude', '', line)).toBe('claude-haiku-4-5');
  });
});

describe('parseEvent: text and model out of each CLI event stream', () => {
  it('claude: assistant text blocks become text, and the model is reported', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'hello' }] },
    });
    expect(parseEvent('claude', line)).toEqual({ text: 'hello', model: 'claude-haiku-4-5' });
  });

  it('claude: the final result event carries the answer', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'PROBE-CLAUDE-77' });
    expect(parseEvent('claude', line)).toEqual({ text: 'PROBE-CLAUDE-77' });
  });

  it('codex: an agent message event becomes text', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } });
    expect(parseEvent('codex', line)).toEqual({ text: 'done' });
  });

  it('opencode: a part event with text becomes text', () => {
    const line = JSON.stringify({ type: 'text', part: { type: 'text', text: 'hi' } });
    expect(parseEvent('opencode', line)).toEqual({ text: 'hi' });
  });

  it('returns null for a line that is not an event, and for a CLI with no event mode', () => {
    expect(parseEvent('claude', 'plain text')).toBeNull();
    expect(parseEvent('agy', '{"type":"assistant"}')).toBeNull();
  });
});

describe('summariseEvent: event noise gets a label, never a JSON dump', () => {
  it('labels a bookkeeping event', () => {
    // The labeller is agent-agnostic; what eventMode controls is the gate, so exercise it through a CLI
    // that really emits events. codex was moved to human mode on 2026-10-05.
    expect(summariseEvent('opencode', JSON.stringify({ type: 'step_start' }))).toBe('step_start');
  });

  it('labels an item event with its item type', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } });
    expect(summariseEvent('opencode', line)).toBe('item.completed reasoning');
  });

  it('returns null for a non-event line, for a human-mode CLI, and for codex', () => {
    expect(summariseEvent('opencode', 'plain text')).toBeNull();
    expect(summariseEvent('agy', '{"type":"thread.started"}')).toBeNull();
    // codex runs human mode: a JSON-looking line from it is an answer fragment, not an event, so the
    // panel must show it as-is rather than inventing a label.
    expect(summariseEvent('codex', '{"type":"item.completed"}')).toBeNull();
  });
});
