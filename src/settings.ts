import { App, PluginSettingTab, Setting } from 'obsidian';
import { AGENTS, AGENT_IDS, resolveBinary, type AgentId, type Sandbox } from './agents';
import type AgentDispatch from './main';

export interface DispatchSettings {
  binaryPaths: Record<AgentId, string>;
  models: Record<AgentId, string[]>;
  defaultModels: Record<AgentId, string>;
  sandbox: Sandbox;
  timeoutSeconds: number;
  workingDirectory: string;
  runLogsEnabled: boolean;
  autoOpenPanel: boolean;
  /** Remembered so the modal opens on the agent you used last. */
  lastAgent: AgentId;
}

export function defaultSettings(vaultPath: string): DispatchSettings {
  const binaryPaths = {} as Record<AgentId, string>;
  const models = {} as Record<AgentId, string[]>;
  const defaultModels = {} as Record<AgentId, string>;
  for (const id of AGENT_IDS) {
    // A real path when the CLI is on this machine, else the bare command name; both are editable.
    binaryPaths[id] = resolveBinary(id);
    models[id] = [...AGENTS[id].models];
    defaultModels[id] = AGENTS[id].defaultModel;
  }
  return {
    binaryPaths,
    models,
    defaultModels,
    sandbox: 'read-only',
    timeoutSeconds: 300,
    workingDirectory: vaultPath,
    runLogsEnabled: true,
    autoOpenPanel: true,
    lastAgent: 'codex',
  };
}

/** Settings arrive from data.json, which Ali can hand-edit, so every field is checked on load. */
export function mergeSettings(stored: Partial<DispatchSettings> | null, vaultPath: string): DispatchSettings {
  const base = defaultSettings(vaultPath);
  if (!stored) return base;
  const merged: DispatchSettings = { ...base, ...stored };
  merged.binaryPaths = { ...base.binaryPaths, ...(stored.binaryPaths ?? {}) };
  merged.models = { ...base.models, ...(stored.models ?? {}) };
  merged.defaultModels = { ...base.defaultModels, ...(stored.defaultModels ?? {}) };
  if (!Number.isFinite(merged.timeoutSeconds) || merged.timeoutSeconds < 5) merged.timeoutSeconds = 300;
  if (merged.sandbox !== 'workspace-write') merged.sandbox = 'read-only';
  if (!merged.workingDirectory) merged.workingDirectory = vaultPath;
  if (!AGENT_IDS.includes(merged.lastAgent)) merged.lastAgent = 'codex';
  for (const id of AGENT_IDS) {
    const list = (merged.models[id] ?? []).filter((m) => typeof m === 'string' && m.trim().length > 0);
    merged.models[id] = list.length ? list : [...AGENTS[id].models];
    if (!merged.models[id].includes(merged.defaultModels[id])) merged.defaultModels[id] = merged.models[id][0]!;
  }
  return merged;
}

export class AgentDispatchSettingTab extends PluginSettingTab {
  plugin: AgentDispatch;

  constructor(app: App, plugin: AgentDispatch) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Agent Dispatch' });
    containerEl.createEl('p', {
      text: 'Local coding-agent CLIs. Nothing here is sent anywhere else, and no token is stored: each CLI uses its own login.',
    });

    new Setting(containerEl)
      .setName('Working directory')
      .setDesc('Where agents run. Point it at a repo to let Codex and Claude read code.')
      .addText((text) =>
        text.setValue(this.plugin.settings.workingDirectory).onChange(async (value) => {
          this.plugin.settings.workingDirectory = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Sandbox')
      .setDesc('read-only passes codex -s read-only and no write flags elsewhere. workspace-write lets codex edit files.')
      .addDropdown((drop) =>
        drop
          .addOption('read-only', 'read-only')
          .addOption('workspace-write', 'workspace-write')
          .setValue(this.plugin.settings.sandbox)
          .onChange(async (value) => {
            this.plugin.settings.sandbox = value === 'workspace-write' ? 'workspace-write' : 'read-only';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Timeout (seconds)')
      .setDesc('A run that outlives this is killed with SIGTERM, then SIGKILL two seconds later.')
      .addText((text) =>
        text.setValue(String(this.plugin.settings.timeoutSeconds)).onChange(async (value) => {
          const seconds = Number(value);
          if (Number.isFinite(seconds) && seconds >= 5) {
            this.plugin.settings.timeoutSeconds = seconds;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Write run logs')
      .setDesc('Keeps the raw JSON of every run under .obsidian/plugins/agent-dispatch/runs/ (not indexed by the vault).')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.runLogsEnabled).onChange(async (value) => {
          this.plugin.settings.runLogsEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Open the run panel on start')
      .setDesc('Brings the sidebar panel forward when a request is fired from the command palette.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpenPanel).onChange(async (value) => {
          this.plugin.settings.autoOpenPanel = value;
          await this.plugin.saveSettings();
        }),
      );

    containerEl.createEl('h3', { text: 'Agents' });
    for (const id of AGENT_IDS) {
      const spec = AGENTS[id];
      containerEl.createEl('h4', { text: spec.label });

      new Setting(containerEl)
        .setName(`${spec.label} binary`)
        .setDesc('Absolute path. Obsidian started from Finder cannot see your shell PATH.')
        .addText((text) =>
          text.setValue(this.plugin.settings.binaryPaths[id]).onChange(async (value) => {
            this.plugin.settings.binaryPaths[id] = value.trim() || spec.binary;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(containerEl)
        .setName(`${spec.label} models`)
        .setDesc('Comma separated. One id per entry, exactly as the CLI spells it.')
        .addText((text) =>
          text.setValue(this.plugin.settings.models[id].join(', ')).onChange(async (value) => {
            const list = value
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean);
            if (list.length) {
              this.plugin.settings.models[id] = list;
              await this.plugin.saveSettings();
            }
          }),
        );

      new Setting(containerEl)
        .setName(`${spec.label} default model`)
        .addDropdown((drop) => {
          for (const model of this.plugin.settings.models[id]) drop.addOption(model, model);
          drop.setValue(this.plugin.settings.defaultModels[id]).onChange(async (value) => {
            this.plugin.settings.defaultModels[id] = value;
            await this.plugin.saveSettings();
          });
        });
    }
  }
}
