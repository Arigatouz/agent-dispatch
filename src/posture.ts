import type { AgentId } from './agents';

/**
 * What each agent is allowed to do is decided in more than one place. The panel sets a mode per run, but
 * every one of these CLIs also keeps a global permission config that the panel neither sets nor can
 * override. Measured 2026-10-12 on this machine: agy carried a permission preset named TURBO plus global
 * write grants, claude had a scoped allow list, codex had an approval mode in its own config. A panel that
 * claims containment while the CLI has a global turbo preset is lying by omission, so the plugin reads
 * those files and reports what it found instead of assuming.
 */
export type PostureVerdict = 'broad' | 'scoped' | 'unknown';

export interface AgentPosture {
  agent: AgentId;
  verdict: PostureVerdict;
  /** The lines that justify the verdict, quoting the file's own values. */
  evidence: string[];
  /** Config files the check looked at, present or not, so a missing file is visible rather than silent. */
  files: { path: string; present: boolean }[];
}

/** Absolute paths, because a run's cwd is the vault and these live in the user's home. */
export const POSTURE_FILES: Record<AgentId, string[]> = {
  agy: ['.gemini/config/config.json', '.gemini/antigravity-cli/settings.json'],
  claude: ['.claude/settings.json'],
  codex: ['.codex/config.toml'],
  opencode: ['.config/opencode/opencode.json'],
};

/** Presets whose whole purpose is to stop asking. Matched case-insensitively as substrings. */
const BROAD_PRESETS = ['turbo', 'yolo', 'bypass', 'unrestricted', 'danger'];
/** Permission-rule targets that mean "write anywhere", once present in an allow list. */
const BROAD_RULE = /(^|[(\s,])(write_file|edit_file|create_file|multi_edit|write)\(/i;
/** Values that remove the OS sandbox or the approval step. */
const BROAD_VALUE = /(danger-full-access|dangerously|bypasspermissions|"never"|=\s*never|approval_mode\s*=\s*"never")/i;

function quote(line: string): string {
  return line.trim().slice(0, 160);
}

export function inspectAgy(configJson: string | null, cliSettingsJson: string | null): AgentPosture {
  const evidence: string[] = [];
  let verdict: PostureVerdict = 'unknown';

  for (const [text, label] of [
    [configJson, 'config.json userSettings'],
    [cliSettingsJson, 'antigravity-cli settings.json permissions'],
  ] as [string | null, string][]) {
    if (text === null) continue;
    if (verdict === 'unknown') verdict = 'scoped';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      evidence.push(`${label}: unreadable JSON`);
      continue;
    }
    const flat = JSON.stringify(parsed);
    const preset = /"permissionPreset"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    if (preset) {
      if (BROAD_PRESETS.some((p) => preset.toLowerCase().includes(p))) verdict = 'broad';
      evidence.push(`${label}: permissionPreset = ${preset}`);
    }
    const allowMatch = /"(?:globalPermissionGrants|permissions)"\s*:\s*\{[\s\S]{0,1200}?"allow"\s*:\s*\[([\s\S]{0,2000}?)\]/.exec(text);
    if (allowMatch) {
      const rules = (allowMatch[1] ?? '').split(',').map((r) => r.replace(/["\s]/g, '')).filter(Boolean);
      const broad = rules.filter((r) => BROAD_RULE.test(r));
      evidence.push(`${label}: ${rules.length} allow rule(s), e.g. ${rules.slice(0, 3).join(', ')}`);
      if (broad.length > 0) {
        verdict = 'broad';
        evidence.push(`${label}: write-capable rule(s): ${broad.slice(0, 3).join(', ')}`);
      }
    } else if (flat.includes('"allow"')) {
      evidence.push(`${label}: an allow list exists but its shape was not recognised`);
    }
  }
  if (evidence.length === 0) evidence.push('no global permission config found');
  return { agent: 'agy', verdict, evidence, files: [] };
}

export function inspectClaude(settingsJson: string | null): AgentPosture {
  const evidence: string[] = [];
  if (settingsJson === null) {
    return { agent: 'claude', verdict: 'unknown', evidence: ['~/.claude/settings.json not found'], files: [] };
  }
  let verdict: PostureVerdict = 'scoped';
  try {
    const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
    const permissions = (parsed.permissions ?? {}) as { allow?: string[]; deny?: string[] };
    const allow = permissions.allow ?? [];
    const deny = permissions.deny ?? [];
    evidence.push(`permissions.allow: ${allow.length} rule(s), deny: ${deny.length}`);
    if (allow.length > 0) evidence.push(`examples: ${allow.slice(0, 3).map(quote).join(' | ')}`);
    for (const key of ['skipDangerousModePermissionPrompt', 'skipAutoPermissionPrompt', 'autoMode']) {
      if (parsed[key] === true) evidence.push(`${key} = true`);
    }
    if (allow.some((rule) => /^(Edit|Write)\(\*\*|^Bash\(\*\)|\(\\\*\\\*\)/.test(rule))) verdict = 'broad';
  } catch {
    evidence.push('unreadable JSON');
    verdict = 'unknown';
  }
  return { agent: 'claude', verdict, evidence, files: [] };
}

export function inspectCodex(configToml: string | null): AgentPosture {
  if (configToml === null) {
    return { agent: 'codex', verdict: 'unknown', evidence: ['~/.codex/config.toml not found'], files: [] };
  }
  const evidence: string[] = [];
  let verdict: PostureVerdict = 'scoped';
  for (const line of configToml.split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    if (/^\s*(approval_policy|approval_mode|sandbox_mode|sandbox)\s*=/i.test(line)) {
      evidence.push(quote(line));
      if (BROAD_VALUE.test(line)) verdict = 'broad';
    }
    if (/(^|\s)dangerously_(bypass|skip)/i.test(line)) {
      evidence.push(quote(line));
      verdict = 'broad';
    }
  }
  if (evidence.length === 0) evidence.push('no approval or sandbox key in config.toml');
  return { agent: 'codex', verdict, evidence, files: [] };
}

export function inspectOpencode(configJson: string | null): AgentPosture {
  if (configJson === null) {
    return { agent: 'opencode', verdict: 'unknown', evidence: ['~/.config/opencode/opencode.json not found'], files: [] };
  }
  const evidence: string[] = [];
  let verdict: PostureVerdict = 'scoped';
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const permission = parsed.permission;
    if (permission === undefined) {
      evidence.push('no permission block: its defaults apply');
    } else {
      evidence.push(`permission: ${JSON.stringify(permission).slice(0, 200)}`);
      if (/"?(edit|write|bash|webfetch)"?\s*:\s*"?(allow|\*)?"?/.test(JSON.stringify(permission))) {
        if (/allow|\*/.test(JSON.stringify(permission))) verdict = 'broad';
      }
    }
  } catch {
    evidence.push('unreadable JSON');
    verdict = 'unknown';
  }
  return { agent: 'opencode', verdict, evidence, files: [] };
}

/** Reads every agent's global config through the supplied reader, which is the plugin's file access. */
export function inspectAllPostures(
  home: string,
  read: (absolutePath: string) => string | null,
): AgentPosture[] {
  const readAgent = (agent: AgentId, index: number): string | null =>
    read(`${home}/${POSTURE_FILES[agent][index] ?? ''}`) ?? null;
  const agyConfig = readAgent('agy', 0);
  const agySettings = readAgent('agy', 1);
  const claudeSettings = readAgent('claude', 0);
  const codexConfig = readAgent('codex', 0);
  const opencodeConfig = readAgent('opencode', 0);
  return [
    inspectAgy(agyConfig, agySettings),
    inspectClaude(claudeSettings),
    inspectCodex(codexConfig),
    inspectOpencode(opencodeConfig),
  ];
}

/** One line per agent for a Notice or a log, only for the agents worth mentioning. */
export function postureWarnings(postures: AgentPosture[]): string[] {
  return postures
    .filter((p) => p.verdict === 'broad')
    .map((p) => `${p.agent}: global permission config is broader than the panel's mode (${p.evidence[0] ?? ''})`);
}
