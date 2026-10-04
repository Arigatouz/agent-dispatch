/**
 * Error signatures the CLIs emit, with the meaning the UI should show. Kept as one table so a new one is
 * a one-line addition, and so the strings are greppable in the run logs afterwards.
 */
export interface Signature {
  pattern: RegExp;
  label: string;
  action: string;
}

export const SIGNATURES: Signature[] = [
  {
    pattern: /You'?ve hit your usage limit[^\n]*/i,
    label: 'codex quota',
    action: 'Wall-clock quota. Read the retry time in the same line, or run another agent.',
  },
  {
    pattern: /Not logged in[^\n]*/i,
    label: 'not authenticated',
    action: 'Run the CLI login in a terminal yourself. This plugin never handles credentials.',
  },
  {
    pattern: /Insufficient account funds/i,
    label: 'unfunded route',
    action: 'That model route has no funds. opencode is GLM only on this machine.',
  },
  {
    pattern: /-p took "--model" as its prompt/i,
    label: 'agy flag order',
    action: 'agy needs --model before -p. The registry builds it that way; a hand-edited command broke it.',
  },
  {
    pattern: /spawn error: [^\n]*/i,
    label: 'binary not found',
    action: 'The binary path in settings is wrong, or the file is not executable.',
  },
];

export interface DetectedSignature {
  label: string;
  action: string;
  /** The CLI's own line, quoted so the UI can show what was said rather than a paraphrase. */
  evidence: string;
}

/** First matching signature wins, and the evidence is the CLI's own text, not a paraphrase. */
export function detectSignature(...texts: (string | undefined)[]): DetectedSignature | null {
  for (const text of texts) {
    if (!text) continue;
    for (const signature of SIGNATURES) {
      const match = signature.pattern.exec(text);
      if (match) {
        return { label: signature.label, action: signature.action, evidence: match[0].trim() };
      }
    }
  }
  return null;
}
