import { describe, it, expect } from 'vitest';
import { detectSignature, cleanStderr, SIGNATURES } from '../src/signatures';

describe('detectSignature', () => {
  it('recognises the codex quota line and quotes it back', () => {
    const stderr = "ERROR: You've hit your usage limit. Upgrade to Pro or try again at 8:03 PM.\n";
    const found = detectSignature(stderr);
    expect(found?.label).toBe('codex quota');
    expect(found?.evidence).toContain('hit your usage limit');
  });

  it('recognises the same quota line when the CLI uses a curly apostrophe', () => {
    // The real codex prints a typographic apostrophe. Straight-quote-only matching missed it live.
    const stderr = 'ERROR: You\u2019ve hit your usage limit. Upgrade to Pro or try again at 8:03 PM.\n';
    expect(detectSignature(stderr)?.label).toBe('codex quota');
  });

  it('recognises the claude login state', () => {
    const found = detectSignature('{"result":"Not logged in · Please run /login"}');
    expect(found?.label).toBe('not authenticated');
  });

  it('recognises an unfunded opencode route and a missing binary', () => {
    expect(detectSignature('Insufficient account funds')?.label).toBe('unfunded route');
    expect(detectSignature(undefined, 'spawn error: ENOENT')?.label).toBe('binary not found');
  });

  it('returns null when nothing matches, so the UI can stay quiet', () => {
    expect(detectSignature('everything is fine', 'still fine')).toBeNull();
  });

  it('every signature carries an action for the reader', () => {
    for (const signature of SIGNATURES) {
      expect(signature.label.length).toBeGreaterThan(0);
      expect(signature.action.length).toBeGreaterThan(10);
    }
  });
});

describe('cleanStderr', () => {
  it('drops MCP transport chatter but keeps a real error line', () => {
    const lines = [
      '2026-10-04T16:08:11Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed',
      'OAuth refresh token was rejected: invalid_grant',
      'real error: quota exceeded for this account',
    ];
    expect(cleanStderr(lines)).toEqual(['real error: quota exceeded for this account']);
  });

  it('caps each line and keeps only the newest few', () => {
    const long = 'x'.repeat(300);
    const out = cleanStderr(['one', 'two', 'three', 'four', long]);
    expect(out.length).toBe(3);
    expect(out.at(-1)!.length).toBeLessThan(210);
    expect(out.at(-1)!.endsWith('…')).toBe(true);
  });
});
describe('the two failures that used to arrive as empty answers', () => {
  it('recognises claude refusing a tool it cannot get approval for', () => {
    const stderr =
      'Permission for this tool use was denied. It requires approval, and this session has no approval ' +
      'surface — nobody can answer a permission prompt here — so it was denied automatically.';
    const found = detectSignature(stderr, '', undefined);
    expect(found?.label).toBe('tool denied: no approval surface');
  });

  it('recognises a run that stopped at its turn limit, even from stdout', () => {
    const stdout = '{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":3}';
    const found = detectSignature('', stdout, undefined);
    expect(found?.label).toBe('ran out of turns');
    expect(found?.action).toContain('Max turns per run');
  });
});

