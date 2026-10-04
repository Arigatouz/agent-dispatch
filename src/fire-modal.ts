import { App, Modal, Notice } from 'obsidian';
import { AGENT_IDS, AGENTS, type AgentId } from './agents';
import type AgentDispatch from './main';
import type { LiveRun } from './runs';

export interface FireModalOptions {
  /** Pre-filled prompt, e.g. the editor selection. */
  prompt?: string;
  /** Called when the run finishes, so a selection command can drop the answer back into the note. */
  onFinish?: (run: LiveRun) => void;
}

/**
 * The whole firing surface: agent, model, prompt. Deliberately three controls and one button, because the
 * distance between "I have a question" and "an agent is answering it" is the thing that decides whether
 * this gets used.
 */
export class FireModal extends Modal {
  private plugin: AgentDispatch;
  private options: FireModalOptions;
  private agent: AgentId;
  private model: string;
  private prompt: string;

  constructor(app: App, plugin: AgentDispatch, options: FireModalOptions = {}) {
    super(app);
    this.plugin = plugin;
    this.options = options;
    this.agent = plugin.settings.lastAgent ?? 'codex';
    this.model = plugin.settings.defaultModels[this.agent] ?? AGENTS[this.agent].defaultModel;
    this.prompt = options.prompt ?? '';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('agent-dispatch-modal');
    contentEl.createEl('h3', { text: 'Fire at an agent' });

    new Row(contentEl, 'Agent').append(
      select(
        AGENT_IDS.map((id) => ({ value: id, label: AGENTS[id].label })),
        this.agent,
        (value) => {
          this.agent = value as AgentId;
          const models = this.plugin.settings.models[this.agent];
          this.model = this.plugin.settings.defaultModels[this.agent] ?? models[0]!;
          this.renderModels();
        },
      ),
    );

    this.modelRow = new Row(contentEl, 'Model');
    this.renderModels();

    const promptRow = new Row(contentEl, 'Prompt');
    const textarea = promptRow.el.createEl('textarea', { cls: 'agent-dispatch-prompt' });
    textarea.value = this.prompt;
    textarea.rows = 6;
    textarea.addEventListener('input', () => {
      this.prompt = textarea.value;
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.fire();
      }
    });
    window.setTimeout(() => textarea.focus(), 0);

    const actions = contentEl.createDiv({ cls: 'agent-dispatch-actions' });
    const run = actions.createEl('button', { text: 'Run', cls: 'mod-cta' });
    run.addEventListener('click', () => this.fire());
    const cancel = actions.createEl('button', { text: 'Close' });
    cancel.addEventListener('click', () => this.close());
  }

  private modelRow: Row | null = null;

  private renderModels(): void {
    if (!this.modelRow) return;
    this.modelRow.el.empty();
    const models = this.plugin.settings.models[this.agent];
    if (!models.includes(this.model)) this.model = models[0]!;
    this.modelRow.el.append(
      select(
        models.map((m) => ({ value: m, label: m })),
        this.model,
        (value) => {
          this.model = value;
        },
      ),
    );
  }

  private fire(): void {
    const prompt = this.prompt.trim();
    if (!prompt) {
      new Notice('Nothing to send: the prompt is empty.');
      return;
    }
    const run = this.plugin.startRun(this.agent, this.model, prompt);
    if (this.options.onFinish) {
      const onFinish = this.options.onFinish;
      void run.done.then((finished) => onFinish(finished));
    }
    new Notice(`${AGENTS[this.agent].label} / ${this.model} started.`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class Row {
  el: HTMLElement;
  constructor(parent: HTMLElement, label: string) {
    this.el = parent.createDiv({ cls: 'agent-dispatch-row' });
    this.el.createEl('label', { text: label, cls: 'agent-dispatch-label' });
  }
  append(child: HTMLElement): void {
    this.el.append(child);
  }
}

function select(
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const el = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    if (option.value === value) item.selected = true;
    el.append(item);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
