import type { AgentId } from './agents';

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'cancelled' | 'blocked';

/** Everything one run leaves behind. Four separate fields on purpose: requested model, the model the CLI
 *  reported, the exit status and whether the answer looks complete. Averaging them into one green tick is
 *  how a wrong model or a truncated answer goes unnoticed. */
export interface RunRecord {
  agent: AgentId;
  model: string;
  reportedModel: string;
  prompt: string;
  answer: string;
  status: RunStatus;
  ms: number;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  cwd: string;
  /** One line on what actually constrained this run, taken from the agent's declared posture. */
  permission: string;
  /** YYYY-MM-DD, the vault's date format. */
  created: string;
}

/**
 * Markdown for a note in the vault. The frontmatter uses the vault's own schema (type, status, tags,
 * created, updated, priority) plus run-specific keys, and `status` stays inside the vault's status
 * vocabulary: the run outcome lives in `run_status` so Bases filters keep working.
 */
export function renderRunLog(r: RunRecord): string {
  const reported = r.reportedModel || '';
  const mismatch = reported !== '' && reported !== r.model;
  const frontmatter = [
    '---',
    'type: resource',
    'status: logged',
    `run_status: ${r.status}`,
    `agent: ${r.agent}`,
    `model: ${r.model}`,
    ...(reported ? [`reported_model: ${reported}`] : []),
    ...(mismatch ? ['model_mismatch: true'] : []),
    // Quoted, because a posture note can contain a colon and would otherwise corrupt the frontmatter.
    `permission: "${r.permission.replace(/"/g, "'")}"`,
    `tags: [${r.agent}, agent-run]`,
    `created: ${r.created}`,
    `updated: ${r.created}`,
    'priority: low',
    `duration_ms: ${r.ms}`,
    `exit_code: ${r.exitCode === null ? 'null' : r.exitCode}`,
    ...(r.truncated ? ['possibly_truncated: true'] : []),
    `working_directory: "${r.cwd}"`,
    '---',
  ].join('\n');

  const headline = `# ${r.agent} / ${r.model}`;
  const meta = [
    `- Status: ${r.status}${r.timedOut ? ' (timed out)' : ''}${r.cancelled ? ' (cancelled)' : ''}`,
    `- Duration: ${(r.ms / 1000).toFixed(1)}s`,
    `- Model the CLI reported: ${reported || 'not reported by this CLI'}`,
  ].join('\n');

  return `${frontmatter}\n${headline}\n\n${meta}\n\n## Prompt\n\n\`\`\`text\n${r.prompt}\n\`\`\`\n\n## Answer\n\n${r.answer}\n`;
}

/** The full record, for the raw run log next to the plugin. JSON so nothing is lost to formatting. */
export function renderRunJson(r: RunRecord): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}

/**
 * A kebab-case filename that sorts by date and is legal on every filesystem. The vault's attachment rule
 * is kebab-case, and slashes in an opencode model id must not turn into directories.
 */
export function suggestNoteName(r: RunRecord, iso: string): string {
  const [date = '', rest = ''] = iso.split('T');
  const clock = rest.slice(0, 5).replace(':', '');
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '');
  return `${date}-${clock}-${slug(r.agent)}-${slug(r.model)}.md`;
}
