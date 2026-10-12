import { describe, it, expect } from 'vitest';
import { renderRunLog, suggestNoteName, type RunRecord } from '../src/log';

const record: RunRecord = {
  agent: 'codex',
  model: 'gpt-6-astra',
  reportedModel: 'gpt-6-astra',
  prompt: 'Explain the tier routing in two lines.',
  answer: 'Tier one is rules, tier two is a small model, tier three is an agent.',
  status: 'done',
  ms: 11000,
  exitCode: 0,
  timedOut: false,
  cancelled: false,
  truncated: false,
  cwd: process.cwd(),
  permission: 'argv pins the sandbox: -s <mode>',
  created: '2026-10-04',
};

describe('renderRunLog', () => {
  it('opens and closes a frontmatter block that the vault schema can read', () => {
    const text = renderRunLog(record);
    expect(text.startsWith('---\n')).toBe(true);
    const [, frontmatter] = text.split('---\n');
    expect(frontmatter).toContain('type: resource');
    expect(frontmatter).toContain('status: logged');
    expect(frontmatter).toContain('agent: codex');
    expect(frontmatter).toContain('model: gpt-6-astra');
    expect(frontmatter).toContain('duration_ms: 11000');
    expect(frontmatter).toContain('exit_code: 0');
    expect(frontmatter).toContain('tags: [codex, agent-run]');
  });

  it('never lets a hostile prompt break the frontmatter, because the prompt lives in the body', () => {
    const text = renderRunLog({ ...record, prompt: '---\ntype: nonsense\n---\ninjected' });
    const frontmatter = text.split('---\n')[1] ?? '';
    expect(frontmatter).not.toContain('nonsense');
    expect(text).toContain('injected');
  });

  it('carries the prompt and the answer verbatim', () => {
    const text = renderRunLog(record);
    expect(text).toContain(record.prompt);
    expect(text).toContain(record.answer);
  });

  it('records that the CLI reported a different model than the one requested', () => {
    const text = renderRunLog({ ...record, model: 'gpt-6-astra', reportedModel: 'gpt-6-luna' });
    expect(text).toContain('reported_model: gpt-6-luna');
    expect(text).toContain('model_mismatch: true');
  });

  it('flags a run that failed with a run-specific key, leaving the vault status vocabulary intact', () => {
    const text = renderRunLog({ ...record, status: 'error', exitCode: 1, answer: '' });
    expect(text).toContain('status: logged');
    expect(text).toContain('run_status: error');
    expect(text).toContain('exit_code: 1');
  });
});

describe('suggestNoteName', () => {
  it('produces a kebab-case markdown filename that sorts by date', () => {
    expect(suggestNoteName(record, '2026-10-04T19:05:00')).toBe('2026-10-04-1905-codex-gpt-6-astra.md');
  });

  it('strips characters that are illegal in a filename', () => {
    const name = suggestNoteName(
      { ...record, agent: 'opencode', model: 'opencode-go/glm-5.3' },
      '2026-10-04T19:05:00',
    );
    expect(name).toBe('2026-10-04-1905-opencode-opencode-go-glm-5.3.md');
    expect(name).not.toContain('/');
  });
});
