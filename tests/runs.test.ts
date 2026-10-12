import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { runAgent } from '../src/runner';
import { RunManager, isProbablyTruncated, type RunEvent } from '../src/runs';

/** Absolute, because the manager runs agents in its own cwd and a relative path would not resolve there. */
const FAKE_CLI = resolve('tests/fixtures/fake-cli.mjs');

/**
 * The manager is exercised with the fake CLI in place of a real agent binary. The registry still builds
 * the real argv (so the argv shape is covered), only the executable is swapped, which keeps every run in
 * this file free of network, quota and API keys.
 */
function makeManager(behaviour: string[] = [], overrides: Partial<ConstructorParameters<typeof RunManager>[0]> = {}) {
  const written: { record: Record<string, unknown>; json: string }[] = [];
  const events: RunEvent[] = [];
  const manager = new RunManager({
    runner: (options) =>
      runAgent({
        ...options,
        binary: process.execPath,
        baseArgs: [FAKE_CLI, ...behaviour],
      }),
    writeLog: async (record, json) => {
      written.push({ record: record as unknown as Record<string, unknown>, json });
    },
    cwd: '/tmp/agent-dispatch-tests',
    timeoutMs: 8000,
    lastMessagePathFor: (id) => `/tmp/agent-dispatch-tests/last-${id}.txt`,
    now: () => new Date('2026-10-04T19:30:00'),
    ...overrides,
  });
  manager.subscribe((event) => events.push(event));
  return { manager, written, events };
}

describe('isProbablyTruncated', () => {
  it('leaves a short token answer alone, because that is a normal answer', () => {
    expect(isProbablyTruncated('E2E3-OC')).toBe(false);
  });

  it('flags a long answer that stops mid-sentence', () => {
    expect(isProbablyTruncated('word '.repeat(80).trim())).toBe(true);
  });

  it('leaves a long answer that ends properly', () => {
    expect(isProbablyTruncated(`${'word '.repeat(80).trim()}.`)).toBe(false);
  });
});

describe('RunManager', () => {
  it('starts a run and lists it as running', () => {
    const { manager } = makeManager(['--hang']);
    const run = manager.start('codex', 'gpt-6-astra', 'PROMPT-TEXT');
    expect(run.status).toBe('running');
    expect(run.agent).toBe('codex');
    expect(run.model).toBe('gpt-6-astra');
    expect(run.prompt).toBe('PROMPT-TEXT');
    expect(manager.list().length).toBe(1);
    manager.cancelAll();
  });

  it('emits update events while streaming and one finish event at the end', async () => {
    const { manager, events } = makeManager();
    const run = manager.start('opencode', 'opencode-go/glm-5.3', 'P');
    await run.done;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.run.id === run.id)).toBe(true);
    const last = events.at(-1);
    expect(last?.type).toBe('finish');
    expect(last?.run.status).toBe('done');
  });

  it('falls back to the raw stream for a CLI with no event mode, and records the outcome', async () => {
    const { manager, written } = makeManager();
    const run = manager.start('agy', 'gemini-3.8-flash-low', 'P');
    const result = await run.done;
    expect(result.status).toBe('done');
    expect(result.exitCode).toBe(0);
    expect(result.answer).toContain('line two');
    expect(run.lines.join('\n')).toContain('line one');
    expect(written.length).toBe(1);
    expect(written[0]?.record.agent).toBe('agy');
    expect(JSON.parse(written[0]!.json).prompt).toBe('P');
  });

  it('proves the model from the CLI banner, not from the request', async () => {
    const { manager } = makeManager(['--model-banner=fake-model-9']);
    const run = manager.start('codex', 'gpt-6-astra', 'P');
    const result = await run.done;
    expect(result.reportedModel).toBe('fake-model-9');
    expect(result.model).toBe('gpt-6-astra');
  });

  it('prefers parsed events over the raw stream when the CLI has an event mode', async () => {
    const { manager } = makeManager(['--events=claude']);
    const run = manager.start('claude', 'claude-haiku-4-5', 'P');
    const result = await run.done;
    expect(result.answer).toBe('EVENT-ANSWER');
    expect(result.reportedModel).toBe('claude-haiku-4-5');
  });

  it('parses an event-mode CLI instead of dumping raw JSON into the panel', async () => {
    // codex is human mode as of 2026-10-05 (its CLI-reported model only exists there), so the event-mode
    // guarantees are pinned on opencode, which really emits events.
    const { manager } = makeManager(['--events=opencode']);
    const run = manager.start('opencode', 'opencode-go/glm-5.3', 'P');
    const result = await run.done;
    expect(result.answer).toBe('EVENT-ANSWER.');
    expect(run.lines.join('\n')).not.toContain('"part"');
  });

  it('keeps an event-mode answer empty when only bookkeeping arrives, so a quota block is not read as an answer', async () => {
    const { manager } = makeManager(['--events=none', '--exit=1']);
    const run = manager.start('opencode', 'opencode-go/glm-5.3', 'P');
    const result = await run.done;
    expect(result.answer).toBe('');
    expect(result.status).toBe('error');
    expect(run.lines).toContain('event: thread.started');
  });

  it('marks a cancelled run as cancelled and still writes a record', async () => {
    const { manager, written } = makeManager(['--hang']);
    const run = manager.start('codex', 'gpt-6-astra', 'P');
    setTimeout(() => run.cancel(), 300);
    const result = await run.done;
    expect(result.status).toBe('cancelled');
    expect(written.length).toBe(1);
    expect(written[0]?.record.cancelled).toBe(true);
  });

  it('marks a run that outlives its timeout as timed out', async () => {
    const { manager, written } = makeManager(['--hang'], { timeoutMs: 500 });
    const run = manager.start('agy', 'gemini-3.8-flash-low', 'P');
    const result = await run.done;
    expect(result.status).toBe('timeout');
    expect(result.timedOut).toBe(true);
    expect(written[0]?.record.status).toBe('timeout');
  });

  it('reports a failing CLI as an error run rather than throwing', async () => {
    const { manager } = makeManager(['--exit=2']);
    const run = manager.start('opencode', 'opencode-go/glm-5.3', 'P');
    const result = await run.done;
    expect(result.status).toBe('error');
    expect(result.exitCode).toBe(2);
  });

  it('runs two agents at once and keeps their output apart', async () => {
    const { manager } = makeManager();
    const a = manager.start('codex', 'gpt-6-astra', 'FIRST');
    const b = manager.start('agy', 'gemini-3.8-flash-low', 'SECOND');
    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.prompt).toBe('FIRST');
    expect(rb.prompt).toBe('SECOND');
    expect(a.lines).not.toBe(b.lines);
    expect(manager.list().length).toBe(2);
  });

  it('cancelAll stops every live run, which is what onunload needs', async () => {
    const { manager } = makeManager(['--hang']);
    const a = manager.start('codex', 'gpt-6-astra', 'A');
    const b = manager.start('agy', 'gemini-3.8-flash-low', 'B');
    manager.cancelAll();
    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.status).toBe('cancelled');
    expect(rb.status).toBe('cancelled');
  });
});
