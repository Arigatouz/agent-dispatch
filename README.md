# Agent Dispatch

An Obsidian plugin that fires a prompt at a local coding-agent CLI, lets you pick the model, streams the
answer into a sidebar panel, and keeps the run in the vault.

Four agents are wired, each with its own model list and argv shape, all verified against the real CLIs:

| Agent | CLI | Models | Events |
|---|---|---|---|
| Codex | `codex exec` | `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol` | plain text, model banner on stderr |
| Claude Code | `claude -p` | `claude-haiku-4-5`, `claude-opus-5-5` | `stream-json`, model in every assistant event |
| Antigravity | `agy` | `gemini-3.8-flash-*`, `gemini-3.1-pro-*` | plain text |
| OpenCode | `opencode run` | `opencode-go/glm-5.3*` | `--format json` |

Desktop only (`isDesktopOnly: true`): it spawns processes, which needs Node access inside Obsidian.

## Install

### From a release (no build)

```bash
# with the vault-forge CLI
python3 /path/to/vault-forge plugin install --from-github Arigatouz/agent-dispatch

# or by hand: download manifest.json, main.js, styles.css from the latest release into
# <vault>/.obsidian/plugins/agent-dispatch/, then add "agent-dispatch" to
# <vault>/.obsidian/community-plugins.json
```

### From source

```bash
git clone https://github.com/Arigatouz/agent-dispatch.git
cd agent-dispatch
npm install
npm run build            # tsc -noEmit + esbuild bundle -> main.js
VAULT="$HOME/notes/my-vault" npm run deploy
```

`npm run deploy` copies `manifest.json`, `main.js` and `styles.css` into
`$VAULT/.obsidian/plugins/agent-dispatch/`. Reload the plugin or restart Obsidian, then enable it in
Settings > Community plugins. A hand-written `community-plugins.json` listing the id is honoured on
launch, so nobody has to click Restricted mode off.

## Binaries

The plugin stores a **bare command name** per agent (`codex`, `claude`, `agy`, `opencode`) plus a search
list, because a published plugin cannot hardcode one machine's home directory. At run time it resolves
in this order:

1. the path in Settings > Agent Dispatch (edit it if your CLI lives somewhere unusual),
2. `~/.local/bin`, `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`,
3. the bare command name, so the spawn `PATH` decides.

The spawn always gets an explicit `PATH` because Obsidian started from Finder inherits only
`/usr/bin:/bin:/usr/sbin:/sbin`, and stdin is `/dev/null` so a CLI that waits for stdin cannot hang.

## Safety posture

Every run declares what actually constrains it, and the panel shows that instead of a generic
"read-only" label:

- **Codex**: `-s read-only` in argv, an OS sandbox.
- **Claude Code**: `--permission-mode plan`.
- **Antigravity**: `--mode plan --sandbox`.
- **OpenCode**: no permission flag exists on `run`, so the panel says `UNRESTRICTED` rather than
  pretending otherwise.

The prompt is passed as a single argv entry with `shell: false`, so no prompt can become a shell
command. Runs are logged under `<vault>/.obsidian/plugins/agent-dispatch/runs/`, which Obsidian does not
index, so run logs never pollute vault search or the graph.

## Development

```bash
npm install
npm test                 # 64 unit tests, no network, no quota
npx tsc -noEmit -skipLibCheck
npm run build
```

The pure modules (`src/agents.ts` argv builders and model banner readers, `src/runner.ts` process
runner, `src/runs.ts` run manager, `src/log.ts` note rendering) import nothing from Obsidian, which is
what makes them testable. `tests/fixtures/fake-cli.mjs` exercises spawning, streaming, exit codes,
timeouts and cancels without spending a token.

`docs/cli-probes.md` records the verified invocation per CLI; `docs/obsidian-cdp.md` records how to
drive the running app over its loopback debug port to verify the panel.

## Releasing

Tag and push:

```bash
npm version patch
git push --follow-tags
```

`.github/workflows/release.yml` builds on the tag and attaches `manifest.json`, `main.js` and
`styles.css` to the release, which is exactly the asset set BRAT and manual installs expect.

## License

MIT

## How far a run may reach

Three modes, set in Settings, none of which is a bypass. `plan` is the default.

| Mode | Codex | Claude Code | Antigravity | OpenCode |
|---|---|---|---|---|
| `plan` | `-s read-only` | `--permission-mode plan` | `--mode plan --sandbox` | own config |
| `workspace` (contained) | `-s workspace-write -c approval_policy=never` | `--permission-mode acceptEdits --permission-prompts none` | `--mode accept-edits --sandbox` | own config, unchanged |
| `accept-edits` | sandbox from settings | `--permission-mode acceptEdits` | `--mode accept-edits --sandbox` | own config |

Each `workspace` line was verified against the installed CLI: agy, claude and codex each answered a real
directory listing with exit 0 in this vault. OpenCode has no scoped flag, so `workspace` leaves it alone.

**Bypass flags are refused.** With **Allow bypass flags in extra args** off (the default), a run whose extra
args contain `--dangerously-*`, `--yolo`, `--auto` or `bypassPermissions` is stopped before anything is
spawned, and the refusal is recorded as a run that names the flag. The flags exist if you decide you want
them; nothing in the plugin adds them for you.

