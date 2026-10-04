import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type AgentDispatch from './main';
import type { LiveRun } from './runs';

export const VIEW_TYPE_RUN_PANEL = 'agent-dispatch-panel';

const DOM_LINE_CAP = 4000;

/** The live surface: one card per run, streamed as the CLI writes, with the four outcome fields visible. */
export class RunPanelView extends ItemView {
  private plugin: AgentDispatch;
  private listEl: HTMLElement | null = null;
  private cards = new Map<string, { root: HTMLElement; pre: HTMLElement; rendered: number; head: HTMLElement; actions: HTMLElement }>();
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AgentDispatch) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RUN_PANEL;
  }

  getDisplayText(): string {
    return 'Agent Dispatch';
  }

  getIcon(): string {
    return 'terminal';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('agent-dispatch-panel');

    const bar = root.createDiv({ cls: 'ad-bar' });
    bar.createEl('span', { text: 'Runs', cls: 'ad-bar-title' });
    const fire = bar.createEl('button', { text: 'Fire', cls: 'mod-cta' });
    fire.addEventListener('click', () => this.plugin.openFireModal());
    const cancelAll = bar.createEl('button', { text: 'Cancel all' });
    cancelAll.addEventListener('click', () => {
      this.plugin.runs.cancelAll();
      new Notice('Cancel signal sent to every live run.');
    });

    this.listEl = root.createDiv({ cls: 'ad-list' });
    this.unsubscribe = this.plugin.runs.subscribe((event) => {
      if (event.type === 'start') this.ensureCard(event.run);
      else this.paint(event.run);
    });
    for (const run of this.plugin.runs.list()) this.paint(run);
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.cards.clear();
  }

  private ensureCard(run: LiveRun) {
    if (!this.listEl || this.cards.has(run.id)) return;
    const root = this.listEl.createDiv({ cls: 'ad-run' });
    const head = root.createDiv({ cls: 'ad-run-head' });
    const pre = root.createEl('pre', { cls: 'ad-output' });
    const actions = root.createDiv({ cls: 'ad-run-actions' });
    // Newest first.
    this.listEl.prepend(root);
    this.cards.set(run.id, { root, pre, rendered: 0, head, actions });
  }

  private paint(run: LiveRun) {
    this.ensureCard(run);
    const card = this.cards.get(run.id);
    if (!card) return;

    card.head.empty();
    card.head.createEl('span', { text: `${run.agent} / ${run.model}`, cls: 'ad-run-title' });
    card.head.createEl('span', { text: run.status, cls: `ad-status ad-status-${run.status}` });
    const meta = [run.ms ? `${(run.ms / 1000).toFixed(1)}s` : 'running'];
    if (run.reportedModel) {
      meta.push(
        run.reportedModel === run.model
          ? `model confirmed: ${run.reportedModel}`
          : `MODEL MISMATCH: asked ${run.model}, CLI reported ${run.reportedModel}`,
      );
    } else if (run.status !== 'running') {
      meta.push('model not reported by this CLI');
    }
    if (run.truncated) meta.push('answer may be truncated');
    card.head.createEl('span', { text: meta.join(' | '), cls: 'ad-run-meta' });

    if (run.errorSignature) {
      const sig = card.head.createEl('span', { cls: 'ad-run-signature' });
      sig.createEl('b', { text: `${run.errorSignature.label}: ` });
      sig.appendText(`${run.errorSignature.evidence} | ${run.errorSignature.action}`);
    }

    // Only the new lines are appended: re-joining the whole buffer on every event chokes on chatty CLIs.
    const start = Math.max(card.rendered, run.lines.length - DOM_LINE_CAP);
    for (let i = start; i < run.lines.length; i += 1) {
      card.pre.appendText(`${run.lines[i] ?? ''}\n`);
    }
    card.rendered = run.lines.length;
    card.pre.scrollTop = card.pre.scrollHeight;

    if (run.status === 'error' && run.stderrTail.length) {
      const lastError = run.stderrTail.filter((l) => l.trim().length > 0).slice(-3).join('\n');
      if (lastError) card.pre.appendText(`\n${lastError}\n`);
    }

    card.actions.empty();
    if (run.status === 'running') {
      const cancel = card.actions.createEl('button', { text: 'Cancel' });
      cancel.addEventListener('click', () => run.cancel());
      return;
    }
    const insert = card.actions.createEl('button', { text: 'Insert into note' });
    insert.addEventListener('click', () => this.plugin.insertText(run.answer || '(no answer)'));
    const save = card.actions.createEl('button', { text: 'Save as note' });
    save.addEventListener('click', () => void this.plugin.saveRunAsNote(run));
    const copy = card.actions.createEl('button', { text: 'Copy' });
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(run.answer);
      new Notice('Answer copied.');
    });
  }
}
