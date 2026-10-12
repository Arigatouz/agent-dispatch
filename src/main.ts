import { FileSystemAdapter, MarkdownView, Notice, Plugin } from 'obsidian';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AGENTS, resolveBinary, type AgentId } from './agents';
import { FireModal, type FireModalOptions } from './fire-modal';
import { suggestNoteName } from './log';
import { RunPanelView, VIEW_TYPE_RUN_PANEL } from './run-panel';
import { runAgent } from './runner';
import { RunManager, type LiveRun } from './runs';
import {
  AgentDispatchSettingTab, mergeSettings, splitExtraArgs, type DispatchSettings,
} from './settings';

/**
 * Agent Dispatch: fire a prompt at a local coding-agent CLI, pick the model, watch it stream, keep the
 * run. All the interesting logic lives in the pure modules (agents, runner, runs, log); this file is only
 * the Obsidian wiring.
 */
export default class AgentDispatch extends Plugin {
  settings!: DispatchSettings;
  runs!: RunManager;

  async onload(): Promise<void> {
    const vaultRoot = this.vaultRoot();
    this.settings = mergeSettings((await this.loadData()) as Partial<DispatchSettings> | null, vaultRoot);

    this.runs = new RunManager({
      cwd: this.settings.workingDirectory,
      timeoutMs: this.settings.timeoutSeconds * 1000,
      sandbox: this.settings.sandbox,
      mode: this.settings.mode,
      extraArgsFor: (agent: AgentId) => splitExtraArgs(this.settings.extraArgs[agent]),
      binaryFor: (agent: AgentId) => this.settings.binaryPaths[agent] ?? resolveBinary(agent),
      lastMessagePathFor: (id) => join(this.pluginDir(), 'runs', `last-${id}.txt`),
      readLastMessage: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
      writeLog: async (record, json) => {
        if (!this.settings.runLogsEnabled) return;
        const dir = join(this.pluginDir(), 'runs');
        mkdirSync(dir, { recursive: true });
        const iso = `${record.created}T${clockStamp(new Date())}`;
        writeFileSync(join(dir, suggestNoteName(record, iso).replace(/\.md$/, '.json')), json);
      },
    });

    this.registerView(VIEW_TYPE_RUN_PANEL, (leaf) => new RunPanelView(leaf, this));
    this.addRibbonIcon('terminal', 'Agent Dispatch', () => void this.activatePanel());
    this.addSettingTab(new AgentDispatchSettingTab(this.app, this));

    this.addCommand({ id: 'fire', name: 'Fire request at an agent', callback: () => this.openFireModal() });

    this.addCommand({
      id: 'fire-selection',
      name: 'Send the selection to an agent',
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        const from = editor.getCursor('to');
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        this.openFireModal({
          prompt: selection,
          onFinish: (run) => {
            if (!view || !run.answer) return;
            // Clamped: the note can be edited while a run is in flight.
            const line = Math.min(from.line, editor.lastLine());
            editor.replaceRange(`\n\n${run.answer}\n`, { line, ch: editor.getLine(line).length });
          },
        });
      },
    });

    this.addCommand({ id: 'open-panel', name: 'Open the run panel', callback: () => void this.activatePanel() });

    // A heartbeat on disk: this is how a future session (or a check script) proves the plugin loaded in a
    // launch it cannot attach to, without needing a debug port.
    this.writeHeartbeat();

    this.addCommand({
      id: 'cancel-all',
      name: 'Cancel every live run',
      callback: () => {
        this.runs.cancelAll();
        new Notice('Cancel signal sent to every live run.');
      },
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOpenPanel && !this.app.workspace.getLeavesOfType(VIEW_TYPE_RUN_PANEL).length) {
        void this.activatePanel(false);
      }
    });
  }

  onunload(): void {
    // A plugin that leaves a codex process running after it is disabled is a bug, not a nicety.
    this.runs?.cancelAll();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activatePanel(reveal = true): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_RUN_PANEL)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_RUN_PANEL, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
  }

  openFireModal(options: FireModalOptions = {}): void {
    new FireModal(this.app, this, options).open();
  }

  startRun(agent: AgentId, model: string, prompt: string): LiveRun {
    this.settings.lastAgent = agent;
    void this.saveSettings();
    const run = this.runs.start(agent, model, prompt);
    if (this.settings.autoOpenPanel) void this.activatePanel(false);
    return run;
  }

  /** Drop text where the caret is, in whatever note is open. */
  insertText(text: string): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('No markdown note is open. Use Save as note instead.');
      return;
    }
    const editor = view.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(`\n\n${text}\n`, { line: cursor.line, ch: cursor.ch });
    new Notice('Inserted into the active note.');
  }

  /** Write a finished run into the vault, in 00-Inbox, using the vault's own frontmatter schema. */
  async saveRunAsNote(run: LiveRun): Promise<string> {
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const folder = '00-Inbox';
    const name = suggestNoteName(toRecord(run, this.settings.workingDirectory, today), `${today}T${clockStamp(now)}`);
    let path = `${folder}/${name}`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path) && n < 100) {
      path = `${folder}/${name.replace(/\.md$/, `-${n}.md`)}`;
      n += 1;
    }
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    await this.app.vault.create(path, this.runs.toMarkdown(run));
    new Notice(`Saved ${path}`);
    return path;
  }

  private vaultRoot(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : process.cwd();
  }

  private pluginDir(): string {
    return join(this.vaultRoot(), this.app.vault.configDir, 'plugins', 'agent-dispatch');
  }

  private writeHeartbeat(): void {
    try {
      mkdirSync(this.pluginDir(), { recursive: true });
      writeFileSync(
        join(this.pluginDir(), 'LOADED.txt'),
        [
          `message: agent-dispatch loaded`,
          `manifestVersion: ${this.manifest.version}`,
          `loadedAt: ${new Date().toISOString()}`,
          `electron: ${process.versions.electron ?? 'unknown'}`,
          `pid: ${process.pid}`,
          '',
        ].join('\n'),
      );
    } catch (error) {
      console.error('[agent-dispatch] heartbeat write failed', error);
    }
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function clockStamp(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toRecord(run: LiveRun, cwd: string, created: string) {
  return {
    agent: run.agent,
    model: run.model,
    reportedModel: run.reportedModel,
    prompt: run.prompt,
    answer: run.answer,
    status: run.status,
    ms: run.ms,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    cancelled: run.cancelled,
    truncated: run.truncated,
    cwd,
    permission: AGENTS[run.agent].permission.note,
    created,
  };
}
