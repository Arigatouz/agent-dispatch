import { describe, it, expect } from 'vitest';
import { runAgent, DISPATCH_PATH } from '../src/runner';

/** The fake CLI stands in for a real agent: no network, no quota, predictable output. */
const node = process.execPath;
const fake = ['tests/fixtures/fake-cli.mjs'];

describe('runAgent', () => {
  it('streams stdout and stderr line by line and resolves with the exit code', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const res = await runAgent({
      binary: node,
      baseArgs: fake,
      args: [],
      timeoutMs: 8000,
      onStdout: (l) => out.push(l),
      onStderr: (l) => err.push(l),
    });
    expect(out).toContain('line one');
    expect(out).toContain('line two');
    expect(out.some((l) => l.startsWith('FAKE-ARGS:'))).toBe(true);
    expect(err.join('\n')).toContain('model: fake-model-1');
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.cancelled).toBe(false);
    expect(res.stdout).toContain('line two');
  });

  it('keeps the final line when it arrives without a trailing newline', async () => {
    const res = await runAgent({ binary: node, baseArgs: fake, args: [], timeoutMs: 8000 });
    expect(res.stdout).toContain('final line no trailing newline');
  });

  it('reports a non-zero exit code instead of throwing', async () => {
    const res = await runAgent({ binary: node, baseArgs: fake, args: ['--exit=3'], timeoutMs: 8000 });
    expect(res.exitCode).toBe(3);
  });

  it('kills a hanging process at the timeout and says so', async () => {
    const res = await runAgent({ binary: node, baseArgs: fake, args: ['--hang'], timeoutMs: 700 });
    expect(res.timedOut).toBe(true);
    expect(res.ms).toBeLessThan(6000);
  });

  it('cancels on demand, and the result says cancelled', async () => {
    const handle = runAgent({ binary: node, baseArgs: fake, args: ['--hang'], timeoutMs: 60000 });
    setTimeout(() => handle.cancel(), 300);
    const res = await handle.done;
    expect(res.cancelled).toBe(true);
    expect(res.timedOut).toBe(false);
  });

  it('surfaces a spawn failure as an error result, never an exception', async () => {
    const res = await runAgent({ binary: '/definitely/not/here', args: [], timeoutMs: 2000 });
    expect(res.exitCode).toBeNull();
    expect(res.stderr).toContain('spawn error');
  });

  it('falls back to the process cwd when the configured working directory is gone', async () => {
    // A deleted vault folder must not hang the run: this exact case left a promise that never settled.
    const res = await runAgent({
      binary: node,
      baseArgs: fake,
      args: [],
      cwd: '/definitely/not/here',
      timeoutMs: 8000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('line one');
  });

  it('gives the child a closed stdin, because codex and claude wait on an open one', async () => {
    // Found live: codex printed "Reading additional input from stdin..." and sat there until the timeout.
    const res = await runAgent({ binary: node, baseArgs: fake, args: ['--wait-stdin'], timeoutMs: 5000 });
    expect(res.stdout).toContain('STDIN-CLOSED');
    expect(res.timedOut).toBe(false);
  });

  it('runs two agents at once without mixing their output', async () => {
    const a: string[] = [];
    const b: string[] = [];
    const first = runAgent({ binary: node, baseArgs: fake, args: [], timeoutMs: 8000, onStdout: (l) => a.push(l) });
    const second = runAgent({
      binary: node,
      baseArgs: fake,
      args: ['--model-banner=second'],
      timeoutMs: 8000,
      onStdout: (l) => b.push(l),
      env: { PATH: DISPATCH_PATH },
    });
    const [ra, rb] = await Promise.all([first.done, second.done]);
    expect(ra.exitCode).toBe(0);
    expect(rb.exitCode).toBe(0);
    expect(a.length).toBeGreaterThan(0);
    expect(b.join('\n')).toContain('second');
  });

  it('ships a PATH that can reach the CLIs, because Obsidian started from Finder cannot', () => {
    expect(DISPATCH_PATH).toContain('/opt/homebrew/bin');
    expect(DISPATCH_PATH).toContain('/Users/alig/.local/bin');
  });
});
