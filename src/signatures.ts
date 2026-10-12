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
    // Apostrophe-agnostic on purpose: codex prints a typographic apostrophe in "You’ve hit your usage
    // limit", so a pattern anchored on the straight quote silently missed the real line.
    pattern: /hit your usage limit[^\n]*/i,
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
  {
    // Measured on agy: in headless print mode it cannot answer a permission prompt, so it auto-denies
    // its own tool call, prints this on stderr and exits 0 with an empty stdout. Without this signature
    // a blocked run is indistinguishable from a silent success.
    pattern: /no output produced[^\n]*/i,
    label: 'blocked: tool permission',
    action:
      'The CLI needed a permission it cannot ask for without a terminal, so it denied its own tools. ' +
      'Give it an allow-rule (agy reads permissions.allow in its own settings.json), switch the mode to ' +
      "accept-edits, or put that CLI's unattended-run flags in the agent's extra args.",
  },
];

export interface DetectedSignature {
  label: string;
  action: string;
  /** The CLI's own line, quoted so the UI can show what was said rather than a paraphrase. */
  evidence: string;
}

/** codex chats with unreachable MCP servers on every run. That is log noise, not the answer's company. */
const STDERR_NOISE = [/rmcp::/i, /Transport channel closed/i, /AuthRequired/i, /oauth/i, /mcp_servers/i];

/**
 * The tail of stderr the card shows: noise removed, each line capped, newest last. A run that failed for a
 * real reason still shows that reason; a run whose only stderr is MCP chatter shows nothing extra.
 */
export function cleanStderr(lines: string[], maxLines = 3, maxChars = 200): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !STDERR_NOISE.some((pattern) => pattern.test(line)))
    .slice(-maxLines)
    .map((line) => (line.length > maxChars ? `${line.slice(0, maxChars)}…` : line));
}

/**
 * What to write in the Answer block when a run captured nothing. An empty answer plus exit 0 is how a
 * blocked run gets filed as a success, so the CLI's own last words go in the answer instead of nowhere.
 */
export function answerFallback(stderrLines: string[], detected: DetectedSignature | null): string {
  const lines = cleanStderr(stderrLines, 6, 400);
  if (!lines.length) return '';
  const head = detected
    ? `> **No answer captured: ${detected.label}.** ${detected.action}`
    : '> **No answer captured.** The CLI wrote nothing to stdout; its last words were:';
  return [head, '', ...lines.map((line) => `- \`${line}\``)].join('\n');
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
