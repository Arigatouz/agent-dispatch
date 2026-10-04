import { describe, it, expect } from 'vitest';
import { detectSignature, SIGNATURES } from '../src/signatures';

describe('detectSignature', () => {
  it('recognises the codex quota line and quotes it back', () => {
    const stderr = "ERROR: You've hit your usage limit. Upgrade to Pro or try again at 8:03 PM.\n";
    const found = detectSignature(stderr);
    expect(found?.label).toBe('codex quota');
    expect(found?.evidence).toContain("hit your usage limit");
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
