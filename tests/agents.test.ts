import { describe, it, expect } from 'vitest';
import { AGENTS, buildInvocation, readModelBanner, parseEvent, summariseEvent } from '../src/agents';

const base = {
  prompt: 'PROBE-77',
  model: 'M',
  cwd: '/tmp/work',
  sandbox: 'read-only' as const,
  maxTurns: 1,
  lastMessageFile: '/tmp/work/last.txt',
};

describe('buildInvocation: one argv shape per CLI, verified against the real CLIs', () => {
  it('codex puts the model on -m, asks for JSONL events, and the prompt last', () => {
    const inv = buildInvocation('codex', { ...base, model: 'gpt-6-astra' });
    expect(inv.binary).toBe('/opt/homebrew/bin/codex');
    expect(inv.args).toEqual([
      'exec', '-m', 'gpt-6-astra', '-s', 'read-only', '--skip-git-repo-check',
      '-C', '/tmp/work', '-o', '/tmp/work/last.txt', '--json', 'PROBE-77',
    ]);
  });

  it('claude streams events and passes the prompt as the trailing positional', () => {
    const inv = buildInvocation('claude', { ...base, model: 'claude-haiku-4-5' });
    expect(inv.args).toEqual([
      '-p', '--model', 'claude-haiku-4-5', '--max-turns', '1',
      '--output-format', 'stream-json', '--verbose', 'PROBE-77',
    ]);
  });

  it('agy puts the model BEFORE -p, because -p eats the next token', () => {
    const inv = buildInvocation('agy', { ...base, model: 'gemini-3.8-flash-low' });
    expect(inv.args).toEqual(['--model', 'gemini-3.8-flash-low', '-p', 'PROBE-77']);
    const pIndex = inv.args.indexOf('-p');
    expect(inv.args[pIndex + 1]).toBe('PROBE-77');
  });

  it('opencode uses run --model provider/model with json events', () => {
    const inv = buildInvocation('opencode', { ...base, model: 'opencode-go/glm-5.3' });
    expect(inv.args).toEqual(['run', '--model', 'opencode-go/glm-5.3', '--format', 'json', 'PROBE-77']);
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
      expect(spec.binary.startsWith('/')).toBe(true);
    }
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
    expect(summariseEvent('codex', JSON.stringify({ type: 'thread.started', thread_id: 't1' }))).toBe('thread.started');
  });

  it('labels an item event with its item type', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } });
    expect(summariseEvent('codex', line)).toBe('item.completed reasoning');
  });

  it('returns null for a non-event line and for a CLI with no event mode', () => {
    expect(summariseEvent('codex', 'plain text')).toBeNull();
    expect(summariseEvent('agy', '{"type":"thread.started"}')).toBeNull();
  });
});
