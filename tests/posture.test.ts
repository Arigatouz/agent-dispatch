import { describe, it, expect } from 'vitest';
import { inspectAgy, inspectClaude, inspectCodex, inspectOpencode, postureWarnings } from '../src/posture';

/**
 * The fixtures are trimmed copies of the real config files found on this machine on 2026-10-12. If a
 * parser stops recognising the shape these files actually use, this file fails, which is the point: the
 * panel's own mode is not what protects the user when a CLI has a global preset that says turbo.
 */
const AGY_CONFIG = JSON.stringify({
  plugins: [],
  userSettings: {
    autoExecutionPolicy: 'ask',
    enableTerminalSandbox: true,
    permissionPreset: 'AGENT_PERMISSION_PRESET_TURBO',
    globalPermissionGrants: {
      allow: ['write_file(/Users/someone/work/MedicineTracker)', 'read_file(/Users/someone/Android/sdk)'],
    },
  },
});

const AGY_CLI_SETTINGS = JSON.stringify({
  allowNonWorkspaceAccess: true,
  permissions: { allow: ['command(git status)', 'command(ls)', 'mcp(perplexity/search)'] },
});

const CLAUDE_SETTINGS = JSON.stringify({
  permissions: {
    allow: ['Edit(~/.claude/skills/hackmd/**)', 'Bash(claude doctor)', 'WebFetch(domain:docs.anthropic.com)'],
    deny: [],
  },
  skipDangerousModePermissionPrompt: true,
});

const CODEX_TOML = `[shell_environment_policy]
[shell_environment_policy.set]
approval_mode = "approve"
model = "gpt-6-astra"
`;

describe('the panel reports the posture the CLIs actually enforce', () => {
  it('calls out agy, which measured broad on this machine', () => {
    const p = inspectAgy(AGY_CONFIG, AGY_CLI_SETTINGS);
    expect(p.verdict).toBe('broad');
    expect(p.evidence.join(' ')).toContain('AGENT_PERMISSION_PRESET_TURBO');
    expect(p.evidence.join(' ')).toContain('write_file');
  });

  it('does not call a scoped allow list broad', () => {
    const p = inspectClaude(CLAUDE_SETTINGS);
    expect(p.verdict).toBe('scoped');
    expect(p.evidence.join(' ')).toContain('Bash(claude doctor)');
    // the convenience flags are named as evidence, not treated as scoping
    expect(p.evidence.join(' ')).toContain('skipDangerousModePermissionPrompt = true');
  });

  it('reads codex approval and sandbox keys out of its toml', () => {
    expect(inspectCodex(CODEX_TOML).evidence.join(' ')).toContain('approval_mode = "approve"');
    expect(inspectCodex(CODEX_TOML).verdict).toBe('scoped');
    expect(inspectCodex('[sandbox]\nsandbox_mode = "danger-full-access"').verdict).toBe('broad');
  });

  it('says unknown rather than guessing when a config is absent', () => {
    for (const p of [inspectClaude(null), inspectCodex(null), inspectOpencode(null)]) {
      expect(p.verdict).toBe('unknown');
      expect(p.evidence.join(' ')).toContain('not found');
    }
  });

  it('reports only the agents that are actually wider than the panel', () => {
    const postures = [
      inspectAgy(AGY_CONFIG, AGY_CLI_SETTINGS),
      inspectClaude(CLAUDE_SETTINGS),
      inspectCodex(CODEX_TOML),
      inspectOpencode(JSON.stringify({ model: 'x' })),
    ];
    const warnings = postureWarnings(postures);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('agy');
  });

  it('survives unreadable JSON instead of taking the panel down', () => {
    expect(inspectAgy('{not json', null).evidence.join(' ')).toContain('unreadable');
    expect(inspectClaude('{not json').verdict).toBe('unknown');
  });
});
