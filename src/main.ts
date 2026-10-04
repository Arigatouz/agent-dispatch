import { Plugin, Notice, FileSystemAdapter } from 'obsidian';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 1 de-risk build: proves that an Obsidian desktop plugin can spawn a child process and write a
 * file. Everything later in this repo depends on this working, so it is verified before any UI exists.
 * The marker file it writes is the outside-the-app evidence that onload actually ran.
 */
export default class AgentDispatch extends Plugin {
  async onload() {
    const stamp = new Date().toISOString();
    let nodeProbe = 'not-run';
    try {
      nodeProbe = execFileSync('/bin/echo', ['DISPATCH-NODE-OK']).toString().trim();
    } catch (error) {
      nodeProbe = `ERR ${(error as Error).message}`;
    }

    try {
      // vault.configDir is RELATIVE (".obsidian"), so the absolute vault root has to come from the
      // desktop adapter; process.cwd() in the renderer is "/" and a relative write lands nowhere useful.
      const adapter = this.app.vault.adapter;
      const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : process.cwd();
      const dir = join(base, this.app.vault.configDir, 'plugins', 'agent-dispatch');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'LOADED.txt'),
        `loaded ${stamp}\nnodeProbe ${nodeProbe}\npid ${process.pid}\n`,
      );
    } catch (error) {
      console.error('[agent-dispatch] marker write failed', error);
    }

    this.addCommand({
      id: 'probe-node',
      name: 'Probe: run /bin/echo through child_process',
      callback: () => new Notice(`nodeProbe=${nodeProbe}`),
    });

    console.log('[agent-dispatch] onload', stamp, nodeProbe);
  }

  onunload() {
    console.log('[agent-dispatch] onunload');
  }
}
