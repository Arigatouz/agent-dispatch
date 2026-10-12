# Plan: Agent Dispatch, an Obsidian plugin that fires prompts at codex, claude, agy and opencode

Date: 2026-10-04 · Author: Hermes (plan mode) · Target vault: `/Users/alig/Ali-work/Obsadian-vault/hermes-vault/Herms-vault`
Source of the idea: TikTok `@chase_ai_/video/7689274740841647373` ("jev + claude OS", 22m15s, 192.6k views, 2026-09-25),
watched locally with yt-dlp + whisper + frame sampling. Nothing from that video was executed; it is reference material.

## Goal

Ship a local, desktop-only Obsidian plugin in the Hermes vault that lets Ali pick an agent and a model
(codex, claude, agy, opencode), type a prompt, watch the CLI stream its answer into a panel, and keep the
run logged in the vault, all without leaving Obsidian.

## Current context and assumptions

### What the video actually shows (evidence, not vibes)

- Frame 1 and frame 29 (`frames/f001.jpg`, `frames/f029.jpg`): a local web app at `127.0.0.1:3217` titled
  "JARVIS / V2, your command center, redesigned". Header has an agent toggle: `Claude Code` and `Codex`.
  Left rail has SYSTEM STATUS (173K tasks, 233K brain nodes, 59K saved tokens), `CLAUDE / WEEKLY USAGE 4% USED`,
  an OBJECTIVES checklist, DOCUMENTS and TRANSCRIPT panes. Right rail has SKILLS (`Plan Today`, `Read/Research`,
  `Inbox Brief`, `Content Cascade`, `Browse all skills 21`), a VOICE box (`Tap to talk`), and `Ask… / Send`.
  Footer: `Terminals 0 open`, `Shared with Obsidian`.
- Frame 12: an Excalidraw diagram of the routing layer. "JEV sorts each request into the right tier":
  Tier 1 = rules + saved data, no AI, instant; Tier 2 = quick answer from a small fast model (Haiku / Luna);
  Tier 3 = real work, "opens a Claude Code or Codex terminal, or runs a skill in the background"; then
  "saves reports".
- Frame 20: a second surface called "Agentic OS V2" (audience, outbound views, impressions, leads, an
  X/T weekly review, an activity feed) rendered inside something that has an Obsidian status bar in the
  corner (`0 backlinks · 4,815 words · 21,939 characters`) and an Obsidian-style file tree (`content`,
  `daily-notes`, `inbox`, `ops`, `outputs`, `projects`, `system`).
- Transcript, lines 7 to 9: the visual layer "is a web app, but I've ported it over to obsidian. This is
  also an obsidian plugin that just like you saw can run on Claude code or codex. But I get all the
  advantages of being inside the obsidian desktop app. I still have access to a terminal here. I can click
  on any of these buttons, which are linked to different skills and automations."
- Transcript, lines 44 to 71: requests reach a bridge that (1) records the request inside Obsidian and
  (2) engages a local voice system (Whisper for transcription, Kokoro for the voice), then hands the text
  to JEV, which classifies the tier; tier 2 runs the smallest model, tier 3 "pulls up cloud code or codecs
  inside of your terminal"; "all the deliverables, all the conversations, everything you do with your AIS
  is then logged back in obsidian".
- Transcript, line 4: the memory layer is Obsidian, deliberately not a RAG system: a file and folder
  structure that suits a human and an agent.

So the video is three layers: visual surface, Obsidian memory, skill backbone. Ali asked for the dispatch
core of layer one, inside Obsidian, with explicit model choice across four CLIs. Everything else in the
video (voice, metrics, audience research tabs, the web app shell) is out of scope for v1 and listed as
deferred work at the end.

### What is verified on this machine today (2026-10-04, macOS 26.6.2, arm64)

| Fact | Value |
|---|---|
| Obsidian | 1.12.7, `/Applications/Obsidian.app` |
| Vault | `/Users/alig/Ali-work/Obsadian-vault/hermes-vault/Herms-vault` (not a git repo) |
| Community plugins | none. No `community-plugins.json`, no `plugins/` dir, so Restricted mode is ON |
| CLIs | `claude` = `/Users/alig/.local/bin/claude`; `codex` = `/opt/homebrew/bin/codex`; `agy` = `/Users/alig/.local/bin/agy`; `opencode` = `/opt/homebrew/bin/opencode` |
| Node | `/Users/alig/.local/bin/node` v26.8.2, npm 11.19.1 |
| codex auth | `codex login status` → `Logged in using ChatGPT` |
| opencode auth | `opencode auth list` → GitHub Copilot oauth, OpenCode Zen, OpenCode Go, OpenAI api |
| agy auth | `agy models` fetches a catalogue, so it is authenticated |
| claude auth | `claude auth status --text` → `Not logged in. Run claude auth login to authenticate.` |
| codex config | `~/.codex/config.toml`: `model = "gpt-6.1-sol"`, `model_reasoning_effort = "ultra"`, several MCP servers (webstorm, MCP_DOCKER, canva, hackmd, hostinger), and `gpt-6-astra` in its own model list |

Model ids that exist on this machine:

- codex: `gpt-6.1-sol` (config default), `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`
- claude: `claude-haiku-4-5`, `claude-opus-5-5`
- agy: `gemini-3.8-flash-high|medium|low`, `gemini-3.7-flash-*`, `gemini-3.6-flash-*`, `gemini-3.1-pro-high|low`
- opencode: `opencode-go/glm-5.3`, `opencode-go/glm-5.3-flash`, `opencode-go/deepseek-v4-flash`,
  `opencode-go/deepseek-v4-pro`, `opencode-go/deepseek-v4.1-flash`, `opencode-go/glm-5.2`,
  `opencode-go/gpt-5.6-luna`. House rule: never point opencode at a Claude id, that route is unfunded.

Verified invocations (from `--help` dumps and earlier runs recorded in the `model-tier-routing` skill):

```
claude   -p --model claude-haiku-4-5 --max-turns 1 "<prompt>"
codex    exec -m gpt-6-astra -s read-only --skip-git-repo-check -C <dir> -o <file> "<prompt>"
agy      --model gemini-3.8-flash-low -p "<prompt>"
opencode run --model opencode-go/glm-5.3 "<prompt>"
```

`codex exec --help` confirms `-m/--model`, `-s/--sandbox {read-only|workspace-write|danger-full-access}`,
`-C/--cd`, `--skip-git-repo-check`, `--json` (JSONL events), `-o/--output-last-message <FILE>`.
`opencode run --help` confirms `-m/--model provider/model`, `--format {default|json}`, `--dir`, `--pure`.

### Assumptions the implementer should not silently break

1. The plugin is for this vault only, installed by copying files. No submission to the community directory.
2. macOS desktop only. `isDesktopOnly: true`. Nothing in v1 has to work on Obsidian mobile.
3. Ali keeps all four CLIs authenticated with their own credentials. The plugin never stores, prints or
   forwards a token, and never runs a vendor login for him.
4. Default safety posture is read-only: agents get no write access to his repos unless he flips a setting.
5. The vault README forbids community plugins. This plan adds a local one and patches that line to name
   the exception, rather than leaving the README contradicting reality.

## Architecture and proposed approach

A desktop-only Obsidian plugin, id `agent-dispatch`, whose core is two pure TypeScript modules with no
Obsidian import: `src/agents.ts` (a registry of four agent specs, each owning its binary path, model list
and argv builder) and `src/runner.ts` (spawn a process with an explicit absolute binary and an explicit
PATH, stream stdout/stderr as events, enforce a timeout and a cancel, write a run log). Around that sit
`src/settings.ts`, `src/fire-modal.ts`, `src/run-panel.ts` (an `ItemView` in the right sidebar) and
`src/main.ts` which wires commands, ribbon and view together. Tier routing (rules first, JEV later) is a
third pure module, `src/tiers.ts`, added in phase 5 so v1 ships without a second API dependency.

## Step-by-step tasks

Each task is 2 to 5 minutes, names the exact file, and gives the command to prove it. Commit after every
task. Repo root for all paths below is `/Users/alig/Ali-work/public-projects/agent-dispatch`.

### Phase 0: prove the four invocations before writing plugin code

**Task 0.1: prove codex answers with the model flag**

```bash
cd /tmp && mkdir -p dispatch-probe && cd dispatch-probe
codex exec -m gpt-6-astra -s read-only --skip-git-repo-check -C /tmp/dispatch-probe \
  -o /tmp/dispatch-probe/codex-last.txt "Reply with exactly this token and nothing else: PROBE-CODEX-77"
```
Expected: stdout contains `PROBE-CODEX-77`; `/tmp/dispatch-probe/codex-last.txt` contains the same token;
stderr carries a `model:` banner and MCP transport errors for the servers in `~/.codex/config.toml`.
Ignore the errors; judge the token. Exit code may be 0 or 1 for the same result.

**Task 0.2: prove claude is unusable until Ali logs in**

```bash
claude auth status --text
claude -p --model claude-haiku-4-5 --max-turns 1 "Reply with exactly this token and nothing else: PROBE-CLAUDE-77"
```
Expected first line: `Not logged in. Run claude auth login to authenticate.` Then the invocation fails.
Action: Ali runs `! claude auth login` himself in a terminal, never through this plugin. Re-run until the
token comes back. The plugin must surface this exact string as an error row, not a crash.

**Task 0.3: prove agy flag order**

```bash
agy --model gemini-3.8-flash-low -p "Reply with exactly this token and nothing else: PROBE-AGY-77"
```
Expected: `PROBE-AGY-77`. Then run the WRONG order once, to see the failure the code must never produce:

```bash
agy -p --model gemini-3.8-flash-low "PROBE-AGY-77"
```
Expected: the CLI complains that `-p` took `--model` as its prompt. Record that string in
`docs/cli-probes.md` as the regression signature.

**Task 0.4: prove opencode**

```bash
opencode run --model opencode-go/glm-5.3 "Reply with exactly this token and nothing else: PROBE-OC-77"
```
Expected: `PROBE-OC-77`, in roughly 9 to 20 seconds. Check the last line is a finished sentence, since a
long answer can be truncated at exit 0.

**Task 0.5: record the probes**

Create `docs/cli-probes.md` with a table: agent, exact command, wall-clock seconds, token seen, model
banner seen, exit code. This file is the source for the model lists in `src/agents.ts`.

```bash
git init && git add docs/cli-probes.md && git commit -m "docs: record verified CLI probes"
```

### Phase 1: scaffold the repo, then de-risk Node access inside Obsidian

**Task 1.1: create the scaffold**

Files `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `versions.json`, `.gitignore`.
Copy the shapes from the official sample plugin, which is what Obsidian itself maintains.

`package.json`:
```json
{
  "name": "agent-dispatch",
  "version": "0.1.0",
  "description": "Fire prompts at local coding-agent CLIs (codex, claude, agy, opencode) with model selection.",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "deploy": "bash scripts/deploy.sh"
  },
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.15.17",
    "esbuild": "0.25.5",
    "obsidian": "latest",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2021",
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "moduleResolution": "node",
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "types": ["node"],
    "lib": ["ES2021", "DOM"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`esbuild.config.mjs`: identical to the sample, entry `src/main.ts`, `format: 'cjs'`, `target: 'es2021'`,
`external: ['obsidian', 'electron', ...builtinModules]`, `outfile: 'main.js'`, `minify: prod`.
`manifest.json`:
```json
{
  "id": "agent-dispatch",
  "name": "Agent Dispatch",
  "version": "0.1.0",
  "minAppVersion": "1.12.0",
  "description": "Fire prompts at local coding-agent CLIs (codex, claude, agy, opencode) and pick the model.",
  "author": "A.G.",
  "isDesktopOnly": true
}
```
Note the constraints the directory enforces, which this id and name satisfy: the id is lowercase and
hyphenated, does not contain the word "obsidian", and does not end with "plugin"; the name contains
neither "Obsidian" nor "Plugin".

```bash
npm install
npx tsc -noEmit -skipLibCheck && echo TS-OK
```
Expected: `TS-OK` and no other output.

**Task 1.2: de-risk Node access before building anything (5 minutes, highest-value task in the plan)**

Create `src/main.ts` with a throwaway command that proves the plugin can spawn a process:

```ts
import { Plugin, Notice } from 'obsidian';
import { execFile } from 'child_process';

export default class AgentDispatch extends Plugin {
  async onload() {
    this.addCommand({
      id: 'probe-node',
      name: 'Probe: run /bin/echo through child_process',
      callback: () =>
        execFile('/bin/echo', ['DISPATCH-NODE-OK'], (err, stdout) => {
          new Notice(err ? `ERR ${err.message}` : `OK ${stdout.trim()}`);
        }),
    });
  }
}
```
Build, deploy, enable, run the command from the palette.
Expected: a notice reading `OK DISPATCH-NODE-OK`. If the notice reports an error instead, stop the plan
here and report: the plugin route needs rethinking before any UI work. This single test is what decides
whether the whole approach is viable, so do it first.

If it fails on a missing module, the fallback is to import through `require('child_process')` inside the
bundled CJS output, or to drive a small local helper process. Do not proceed to phase 2 on an unproven
spawn.

### Phase 2: the pure core, test first

**Task 2.1: write the failing test for argv building**

`tests/agents.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { AGENTS, buildInvocation } from '../src/agents';

describe('buildInvocation', () => {
  it('codex puts the model on -m and the prompt last', () => {
    const inv = buildInvocation('codex', { prompt: 'P', model: 'gpt-6-astra', cwd: '/tmp', sandbox: 'read-only', maxTurns: 1, lastMessageFile: '/tmp/last.txt' });
    expect(inv.args).toEqual(['exec', '-m', 'gpt-6-astra', '-s', 'read-only', '--skip-git-repo-check', '-C', '/tmp', '-o', '/tmp/last.txt', 'P']);
  });

  it('agy puts the model BEFORE -p', () => {
    const inv = buildInvocation('agy', { prompt: 'P', model: 'gemini-3.8-flash-low', cwd: '/tmp', sandbox: 'read-only', maxTurns: 1, lastMessageFile: '/tmp/last.txt' });
    expect(inv.args).toEqual(['--model', 'gemini-3.8-flash-low', '-p', 'P']);
  });

  it('claude passes the prompt as the trailing positional', () => {
    const inv = buildInvocation('claude', { prompt: 'P', model: 'claude-haiku-4-5', cwd: '/tmp', sandbox: 'read-only', maxTurns: 1, lastMessageFile: '/tmp/last.txt' });
    expect(inv.args).toEqual(['-p', '--model', 'claude-haiku-4-5', '--max-turns', '1', 'P']);
  });

  it('opencode uses run --model provider/model', () => {
    const inv = buildInvocation('opencode', { prompt: 'P', model: 'opencode-go/glm-5.3', cwd: '/tmp', sandbox: 'read-only', maxTurns: 1, lastMessageFile: '/tmp/last.txt' });
    expect(inv.args).toEqual(['run', '--model', 'opencode-go/glm-5.3', 'P']);
  });

  it('never string-concatenates the prompt into a shell string', () => {
    const inv = buildInvocation('codex', { prompt: 'a; rm -rf /', model: 'gpt-6-astra', cwd: '/tmp', sandbox: 'read-only', maxTurns: 1, lastMessageFile: '/tmp/last.txt' });
    expect(inv.args.at(-1)).toBe('a; rm -rf /');
    expect(inv.shell).toBe(false);
  });
});
```

```bash
npx vitest run tests/agents.test.ts
```
Expected: failure, `Cannot find module '../src/agents'`.

**Task 2.2: implement `src/agents.ts` minimally**

```ts
export type AgentId = 'codex' | 'claude' | 'agy' | 'opencode';
export type Sandbox = 'read-only' | 'workspace-write';

export interface RunRequest {
  prompt: string;
  model: string;
  cwd: string;
  sandbox: Sandbox;
  maxTurns: number;
  lastMessageFile: string;
}

export interface Invocation { binary: string; args: string[]; shell: false; }

export interface AgentSpec {
  id: AgentId;
  label: string;
  binary: string;
  models: string[];
  defaultModel: string;
  tier3Models: string[];
  /** Model banner regexes read from stderr or stdout. Empty means: use probeModel(). */
  bannerPatterns: RegExp[];
  build: (r: RunRequest) => string[];
}

export const AGENTS: Record<AgentId, AgentSpec> = {
  codex: {
    id: 'codex', label: 'Codex', binary: '/opt/homebrew/bin/codex',
    models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'], defaultModel: 'gpt-6-astra',
    tier3Models: ['gpt-6-sol', 'gpt-6.1-sol'],
    bannerPatterns: [/^\s*model:\s*(\S+)/m],
    build: (r) => ['exec', '-m', r.model, '-s', r.sandbox, '--skip-git-repo-check', '-C', r.cwd, '-o', r.lastMessageFile, r.prompt],
  },
  claude: {
    id: 'claude', label: 'Claude Code', binary: '/Users/alig/.local/bin/claude',
    models: ['claude-haiku-4-5', 'claude-opus-5-5'], defaultModel: 'claude-haiku-4-5',
    tier3Models: ['claude-opus-5-5'],
    bannerPatterns: [], // the text output does not name the model; see probeModel()
    build: (r) => ['-p', '--model', r.model, '--max-turns', String(r.maxTurns), r.prompt],
  },
  agy: {
    id: 'agy', label: 'Antigravity', binary: '/Users/alig/.local/bin/agy',
    models: ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high', 'gemini-3.1-pro-high'],
    defaultModel: 'gemini-3.8-flash-low',
    tier3Models: ['gemini-3.1-pro-high'],
    bannerPatterns: [],
    build: (r) => ['--model', r.model, '-p', r.prompt],
  },
  opencode: {
    id: 'opencode', label: 'OpenCode (GLM)', binary: '/opt/homebrew/bin/opencode',
    models: ['opencode-go/glm-5.3', 'opencode-go/glm-5.3-flash', 'opencode-go/glm-5.2'],
    defaultModel: 'opencode-go/glm-5.3',
    tier3Models: ['opencode-go/glm-5.3'],
    bannerPatterns: [],
    build: (r) => ['run', '--model', r.model, r.prompt],
  },
};

export function buildInvocation(id: AgentId, r: RunRequest): Invocation {
  const spec = AGENTS[id];
  return { binary: spec.binary, args: spec.build(r), shell: false };
}
```

```bash
npx vitest run tests/agents.test.ts && npx tsc -noEmit -skipLibCheck && echo GREEN
```
Expected: `5 passed`, then `GREEN`. Commit: `feat(agents): argv builders for the four CLIs`.

**Task 2.3: model proof, test first**

`tests/banner.test.ts`: feed the recorded stderr from Phase 0 into `readModelBanner(agentId, stderr, stdout)`
and assert `gpt-6-astra`; assert an empty string for a CLI that prints no banner; assert that a line
`model: something-else` wins over a claim in stdout.

```bash
npx vitest run tests/banner.test.ts     # expect: Cannot find module
```
Implement in `src/agents.ts`:
```ts
export function readModelBanner(id: AgentId, stderr: string, stdout: string): string {
  for (const re of AGENTS[id].bannerPatterns) {
    const m = re.exec(stderr) ?? re.exec(stdout);
    if (m && m[1]) return m[1];
  }
  return '';
}
```
Green, then commit: `feat(agents): read the model the CLI itself reported`.

### Phase 3: the process runner, test first

**Task 3.1: a fake CLI so tests never spend money**

`tests/fixtures/fake-cli.mjs`:
```js
#!/usr/bin/env node
const args = process.argv.slice(2);
console.log('FAKE-ARGS:' + JSON.stringify(args));
console.log('line one');
process.stdout.write('line two\n');
console.error('model: fake-model-1');
const [killAfter] = args.filter((a) => a.startsWith('--kill-after=')).map((a) => Number(a.split('=')[1]));
if (killAfter) setTimeout(() => process.exit(0), killAfter);
if (args.includes('--hang')) setInterval(() => {}, 1000);
```
This file is the whole test strategy: streaming, exit codes, banners and timeouts are all exercised with
`node tests/fixtures/fake-cli.mjs`, no network, no quota.

**Task 3.2: the failing runner test**

`tests/runner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/runner';

const spec = {
  binary: process.execPath,              // node
  baseArgs: ['tests/fixtures/fake-cli.mjs'],
};

describe('runAgent', () => {
  it('streams stdout lines in order and finishes', async () => {
    const lines: string[] = [];
    const res = await runAgent({ ...spec, args: [], timeoutMs: 5000, onStdout: (l) => lines.push(l) });
    expect(lines).toContain('line one');
    expect(lines).toContain('line two');
    expect(res.exitCode).toBe(0);
  });

  it('kills a hanging process at the timeout and reports it as timed out', async () => {
    const res = await runAgent({ ...spec, args: ['--hang'], timeoutMs: 700, onStdout: () => {} });
    expect(res.timedOut).toBe(true);
    expect(res.ms).toBeLessThan(4000);
  });

  it('cancels on demand', async () => {
    const handle = runAgent({ ...spec, args: ['--hang'], timeoutMs: 30000, onStdout: () => {} });
    setTimeout(() => handle.cancel(), 300);
    const res = await handle.done;
    expect(res.cancelled).toBe(true);
  });
});
```
```bash
npx vitest run tests/runner.test.ts     # expect: cannot find module ../src/runner
```

**Task 3.3: implement `src/runner.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface RunOptions {
  binary: string;
  baseArgs?: string[];
  args: string[];
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
  cancelled: boolean;
}

export interface RunHandle {
  done: Promise<RunResult>;
  cancel: () => void;
  pid: number | undefined;
}

/** PATH the CLIs need. Obsidian launched from Finder inherits a minimal PATH. */
export const DISPATCH_PATH = [
  '/Users/alig/.local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');

export function runAgent(o: RunOptions): RunHandle {
  const started = Date.now();
  let timedOut = false;
  let cancelled = false;
  let out = '';
  let err = '';

  const child: ChildProcessWithoutNullStreams = spawn(o.binary, [...(o.baseArgs ?? []), ...o.args], {
    shell: false,                                   // never a shell: the prompt is one argv entry
    cwd: o.cwd,
    env: { ...process.env, PATH: o.env?.PATH ?? DISPATCH_PATH },
  });

  const feed = (chunk: Buffer, sink: (line: string) => void, acc: 'out' | 'err') => {
    const text = chunk.toString();
    if (acc === 'out') out += text; else err += text;
    text.split('\n').forEach((line) => { if (line.length) sink(line); });
  };
  child.stdout.on('data', (c) => feed(c, o.onStdout ?? (() => {}), 'out'));
  child.stderr.on('data', (c) => feed(c, o.onStderr ?? (() => {}), 'err'));

  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000);
  }, o.timeoutMs);

  const done = new Promise<RunResult>((resolve) => {
    const finish = (code: number | null) => {
      clearTimeout(killTimer);
      resolve({ exitCode: code, stdout: out, stderr: err, ms: Date.now() - started, timedOut, cancelled });
    };
    child.on('error', (e) => { err += `\nspawn error: ${e.message}`; finish(null); });
    child.on('close', finish);
  });

  return { done, pid: child.pid, cancel: () => { cancelled = true; child.kill('SIGTERM'); } };
}
```
```bash
npx vitest run tests/runner.test.ts && npx tsc -noEmit -skipLibCheck && echo GREEN
```
Expected: `3 passed`, `GREEN`. Commit: `feat(runner): spawn, stream, timeout, cancel`.

**Task 3.4: log every run**

Test first: `tests/log.test.ts` asserts `renderRunLog()` output starts with the vault frontmatter block and
contains agent, model, ms, exit code. Then implement `src/log.ts`:
```ts
export function renderRunLog(r: RunRecord): string {
  const fm = ['---', 'type: resource', 'status: logged', `agent: ${r.agent}`, `model: ${r.model}`,
    `tags: [${r.agent}, agent-run]`, `created: ${r.created}`, `updated: ${r.created}`,
    `priority: low`, `duration_ms: ${r.ms}`, `exit_code: ${r.exitCode}`, '---'].join('\n');
  return `${fm}\n# ${r.agent} / ${r.model}\n\n## Prompt\n\n\`\`\`\n${r.prompt}\n\`\`\`\n\n## Answer\n\n${r.answer}\n`;
}
```
Raw logs are written under `<vault>/.obsidian/plugins/agent-dispatch/runs/`, which Obsidian does not index,
so 260-word run logs never pollute search or the graph. Saving a run as a note is a separate, explicit
button that writes into `00-Inbox/` with a kebab-case filename, matching the vault README.

**Task 3.5: per-agent output mode, because a CLI's buffering decides what "streaming" means**

A panel can only print bytes at the moment the CLI emits them. In plain text mode `claude -p` collects the
whole answer and prints it at the end, `codex exec` prints progress lines then the answer, and
`opencode run` prints its banner then the answer. Real token streaming needs each CLI's event mode, which
all three expose:

| Agent | Event mode | Why |
|---|---|---|
| claude | `--output-format stream-json --verbose` | streams events, and each assistant event carries `message.model`, which is the model proof for claude |
| codex | `--json` | JSONL events; keep `-o <file>` as well, since the final message file is the reliable answer source |
| opencode | `--format json` | raw JSON events |
| agy | none found | text only; the panel shows a spinner then the answer |

Implement `parseEvent(agentId, line): { text?: string; model?: string } | null` in `src/agents.ts` with a
test per agent fed from a recorded line in `tests/fixtures/events/`. The fallback rule is simple and must
stay: if event parsing yields no text, show the raw line. A user staring at an empty panel because a JSON
shape changed is worse than a user staring at JSON.

```bash
npx vitest run tests/events.test.ts && echo GREEN
```

### Phase 4: Obsidian surface

**Task 4.1: settings**

`src/settings.ts`: interface `DispatchSettings { binaryPaths: Record<AgentId,string>; models: Record<AgentId,string[]>; defaultModels: Record<AgentId,string>; sandbox: Sandbox; timeoutMs: number; workingDirectory: string; autoOpenPanel: boolean }`
with `DEFAULT_SETTINGS` mirroring `AGENTS`, plus a `PluginSettingTab` that renders one text field per
binary path, one comma-separated models field per agent, a sandbox dropdown, a timeout number field and a
working directory field. Persist with `this.plugin.saveData(...)`; re-read in `onExternalSettingsChange`.
Verify: change the codex timeout to 30, close the tab, reopen it, value is 30, and
`<vault>/.obsidian/plugins/agent-dispatch/data.json` contains it.

**Task 4.2: the fire modal**

`src/fire-modal.ts`: a `Modal` with three controls built with `createEl`, in this order: agent `<select>`,
model `<select>` (repopulated on agent change from settings), prompt `<textarea>` (Enter fires,
Shift+Enter newlines), and a Run button. On submit, call `this.plugin.startRun({agent, model, prompt})`
and close. Register command `fire` as "Fire request at agent…" and a second command `fire-selection` that
pre-fills the prompt from `editor.getSelection()` and, on completion, inserts the answer below the
selection with `editor.replaceSelection`.

**Task 4.3: the run panel**

`src/run-panel.ts`: an `ItemView` with `getViewType() = 'agent-dispatch-panel'`, `getDisplayText() = 'Agent Dispatch'`,
and `onOpen()` that renders one card per run: header `agent / model / status / elapsed`, a `<pre>` that
appends streamed lines (cap at 4000 lines in the DOM, keep the full text in memory), and buttons
`Cancel`, `Insert into note`, `Save as note in 00-Inbox`, `Copy`. Status is one of
`queued | running | done | error | timeout | cancelled`. A run whose stderr matches the recorded
`-p took "--model"` signature, or `Insufficient account funds`, or `Not logged in`, renders that exact
string in the card instead of a generic failure.

**Task 4.4: wiring**

`src/main.ts`: `registerView`, `addRibbonIcon('terminal', 'Agent Dispatch', ...)`, four commands, the
settings tab, and `onunload()` that cancels every live run (call `handle.cancel()` for each entry in the
plugin's run map). Verify: reload the plugin while a run is streaming (Settings > Community plugins, toggle
off and on) and confirm the process is gone with
`pgrep -fl 'codex exec|opencode run'` printing nothing.

### Phase 5: install into the vault and prove it end to end

**Task 5.1: deploy script**

`scripts/deploy.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
VAULT="/Users/alig/Ali-work/Obsadian-vault/hermes-vault/Herms-vault"
DEST="$VAULT/.obsidian/plugins/agent-dispatch"
mkdir -p "$DEST"
cp manifest.json main.js "$DEST/"
[ -f styles.css ] && cp styles.css "$DEST/"
echo "deployed to $DEST"
```
```bash
npm run build && npm run deploy
ls -la "/Users/alig/Ali-work/Obsadian-vault/hermes-vault/Herms-vault/.obsidian/plugins/agent-dispatch/"
```
Expected: `main.js`, `manifest.json`, and a `deployed to ...` line.

**Task 5.2: enable it (Ali does this once, in the app)**

Settings > Community plugins > Turn off Restricted mode > the plugin appears under Installed plugins >
Enable. Then open Settings > Agent Dispatch and confirm the four binary paths are pre-filled from the
defaults. Record the Restricted mode flip in the vault README (Task 5.4).

**Task 5.3: the end-to-end matrix**

From the panel, one run per agent, same prompt, unique tokens:

| Agent | Model | Expected |
|---|---|---|
| codex | gpt-6-astra | answer contains `E2E-CODEX`, banner row shows `gpt-6-astra` (from stderr) |
| claude | claude-haiku-4-5 | answer contains `E2E-CLAUDE`; if not logged in, the card shows `Not logged in. Run claude auth login to authenticate.` |
| agy | gemini-3.8-flash-low | answer contains `E2E-AGY` |
| opencode | opencode-go/glm-5.3 | answer contains `E2E-OC`, last line a finished sentence |

Then: cancel a run mid-stream (card reads `cancelled`, `pgrep` shows no leftover process), let one hit a
60 second timeout (card reads `timeout`), and fire two agents at once (both answer, neither clobbers the
other's text). Cross-check each answer against the CLI's own banner or telemetry, never the model's
self-report.

**Task 5.4: keep the vault's own docs true**

Patch `README.md` section 8 rule 4 to name the exception ("no community plugins except the local
`agent-dispatch` plugin, which is built in this repo"), add a `03-Resources/Agent Dispatch.md` resource
note with the frontmatter the vault schema expects, and link it from `02-Areas/Architecture/Architecture.md`.

### Phase 6: tier routing (the video's JEV layer), only after the above works

- `src/tiers.ts`, rules first, no model: an explicit `/tier1` prefix, a list of exact phrase commands
  ("bring up the terminal", "open the panel", "show today's note"), and a regex for arithmetic and lookups
  that the plugin can answer from local state.
- Tier 2 defaults: claude `claude-haiku-4-5`, codex `gpt-6-luna`, agy `gemini-3.8-flash-low`, opencode
  `opencode-go/glm-5.3-flash`.
- Tier 3 defaults: from `AgentSpec.tier3Models`.
- An override prefix `/tier2` `/tier3` and a visible tier badge on each run card, so a misclassification is
  visible instead of silent.
- JEV classifier behind a setting (`classifier: 'rules' | 'jev'`). The TypeSafe key is read from
  `~/.hermes/.env` at runtime, never stored in the plugin's `data.json`.

## Tests and validation

- Unit tests (vitest, no network): `tests/agents.test.ts` (5 argv cases, including a prompt that contains
  `; rm -rf /` and asserting `shell === false`), `tests/banner.test.ts` (model proof), `tests/runner.test.ts`
  (stream, timeout, cancel against `tests/fixtures/fake-cli.mjs`), `tests/log.test.ts` (frontmatter shape).
- Gate command, run before every commit:
  ```bash
  npx tsc -noEmit -skipLibCheck && npx vitest run && npm run build && echo ALL-GREEN
  ```
  Expected on success: `ALL-GREEN` as the last line, with `5 passed`, `3 passed` in the vitest blocks.
- Integration proof: Phase 3 only has value if the fake CLI tests actually exercise the real spawn path, so
  the fake CLI is invoked through `runAgent()` with `process.execPath`, not mocked.
- E2E proof: the Phase 5.3 matrix, with the model string taken from the CLI's own output.
- Regression signature file `docs/cli-probes.md` is the reference for every error string the UI has to
  surface verbatim.

## Risks, tradeoffs and open questions

1. **Node access from a plugin is the one assumption that can sink the design.** The official manifest
   reference documents `isDesktopOnly` as the flag for plugins that "use NodeJS or Electron APIs", which is
   the basis for expecting `child_process` to work in the desktop app, and community plugins that shell out
   exist. It is still an assumption until Task 1.2 passes. Do that task first; if it fails, the fallback is
   a tiny local HTTP helper the plugin talks to, which is a different (and worse) architecture.
2. **The vault README currently forbids community plugins.** This plan breaks that rule deliberately and
   patches the README in the same change, rather than leaving the vault self-contradictory.
3. **claude is not logged in today**, so one of the four agents is half-built until Ali runs
   `claude auth login`. The plugin treats it as a first-class, quoted error, not a crash.
4. **codex quota is wall-clock limited** and some models are gated. The banner line is the evidence that
   the requested model answered; a quota refusal must show the CLI's own text.
5. **Long runs and process trees.** codex spawns MCP subprocesses of its own. `SIGTERM` then `SIGKILL` on
   the child may orphan grandchildren; verify with `pgrep` after cancel, and if grandchildren survive,
   spawn with `detached: true` and kill the process group with `process.kill(-pid, 'SIGTERM')`.
6. **No shell means no shell conveniences.** Nothing may rely on `$(cat file)` or pipes. Prompts are passed
   as a single argv entry, which is also what removes every quoting bug.
7. **Truncated answers at exit 0** (documented for `opencode run`). The UI flags a final line that does not
   end in sentence punctuation as `possibly truncated` rather than presenting it as complete.
8. **Observability of a long run inside Obsidian.** All streaming goes through one panel; if a run produces
   200k lines the DOM will die. Cap the DOM at 4000 lines and keep the full text in the run record.
9. **Secrets.** v1 stores none. If JEV lands in phase 6, the key is read from `~/.hermes/.env` at runtime.
   No token is ever typed into chat or into a note by this plugin.
11. **A CLI can only be read as fast as it writes.** "Streaming" is the CLI's buffering decision, not the
    plugin's feature: in plain text mode `claude -p` buffers the whole answer, so the event modes in Task
    3.5 are what make a live panel possible. Requested model, CLI-reported model, exit status and answer
    completeness stay four separate fields in the run record, so a wrong model, a disguised failure or a
    truncated answer is always visible instead of averaged into one green tick.
12. **Open questions for Ali before implementation starts, none of them blocking Phase 0 to 3:**
    - Should the default sandbox be `read-only` for all four agents (safe, and `codex` cannot edit files),
      or `workspace-write` for codex with the vault as cwd?
    - v1 log destination: `.obsidian/plugins/agent-dispatch/runs/` (invisible to search and graph) versus a
      `10-Agent-Runs/` folder inside the vault (searchable, and one more folder in the folder map)?
    - Should `agy` and `opencode` runs also get the read-only style treatment, or only codex and claude have
      such flags at all?

## Deferred, with the reason

| Deferred | Reason |
|---|---|
| Voice in and out (Whisper, Kokoro) | Local models plus an audio pipeline; the user asked for text dispatch first |
| JEV classifier | Needs a second API dependency and key handling; rules cover tier 1 and 2 from day one |
| Metrics and audience dashboards | Those read other people's APIs (X, YouTube, GA4) and are a separate data project |
| Vault graph rendering in the plugin | The vault already renders its own graph; the video's node cloud is eye candy |
| Terminal emulator inside a pane | The streamed-output panel covers the need; a PTY inside Obsidian is its own project |
| Cost meter | The CLIs do not agree on a cost surface (`claude` reports USD, `codex` reports tokens) |
| Packaged install for teammates or clients | Depends on the community-directory rules and on this plugin being stable first |

## Provenance of this plan

Written by Hermes from primary sources: the video (yt-dlp, whisper, 30 sampled frames), the machine's own
CLI help dumps and auth state, the official Obsidian developer docs (manifest reference, plugin anatomy,
views) and the official sample plugin's scaffolding. A codex `gpt-6-astra` adversarial read of this plan
was requested and fired; it died on the account's usage limit after 36,159 tokens with nothing written to
its output file, and it is tracked as a kanban card with the retry command. The one thing that run said
before it was cut is already folded in as Risk 11 and Task 3.5: a panel can print bytes as fast as a CLI
writes them, but it cannot make a buffering CLI stream, so requested model, CLI-reported model, exit status
and answer completeness stay separate fields.

## Outcome, 2026-10-04

Built and verified in one session, phases 0 to 5. Repo: `/Users/alig/Ali-work/public-projects/agent-dispatch`,
5 commits, 58 unit tests green, deployed into the vault and loaded by a normal Obsidian launch.

Live results through the plugin: agy answered in 9s, opencode in 10s, claude returned its own
`Not logged in · Please run /login` line, codex returned its quota line with the model banner still on
stderr. Cancel killed a live run, an 8 second timeout killed a live run, a run was saved into `00-Inbox/`
with the vault's frontmatter, and the panel rendered all four cards in the sidebar.

Four deviations from the plan, each because the plan was wrong or incomplete:

1. **stdin had to be /dev/null.** The plan did not mention it. codex printed "Reading additional input from
   stdin..." and sat there past 40 seconds; claude warned about missing stdin data. `stdio: ['ignore',
   'pipe', 'pipe']` fixed both and made agy three times faster on the same prompt.
2. **A missing working directory left a promise that never settled**, discovered when tests hung. The
   runner now checks the directory and falls back to the process cwd.
3. **`vault.configDir` is relative** (".obsidian"), so the first heartbeat write landed nowhere. The
   absolute root comes from `FileSystemAdapter.getBasePath()`.
4. **The quota signature missed the real line**, because codex prints a typographic apostrophe in "You’ve
   hit your usage limit". The pattern is now apostrophe-agnostic.

Also added beyond the plan: `src/signatures.ts` (known failure strings, quoted rather than paraphrased),
`scripts/obsidian-cdp.mjs` (drives the running app over the loopback CDP port, which is how the panel was
verified and screenshotted), and a load heartbeat file that proves the plugin ran in a launch nothing could
attach to.

One row remains unproven: a successful codex answer, blocked by the account quota until 20:03.
