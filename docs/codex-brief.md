# Codex brief: adversarial read of the Agent Dispatch plugin plan

You are being asked for a second opinion, not a rewrite. Be specific and disagree where the plan is wrong.

## What to read first

- `docs/plan-agent-dispatch.md` in this repo: the full plan (phases 0 to 6, tasks, tests, risks). Read it
  before answering. Everything below assumes you have read it.

## Context you need that is not in the plan

- Target: a desktop-only Obsidian plugin (`agent-dispatch`) in Ali's vault, built at
  `/Users/alig/Ali-work/public-projects/agent-dispatch`. It lets him pick one of four local coding-agent
  CLIs (codex, claude, agy, opencode), pick a model, type a prompt, watch the CLI stream its answer into
  a right-sidebar panel, and keep the run logged in the vault.
- The machine is an M4 Max Mac on macOS 26.6.2. Obsidian 1.12.7. Node v26.8.2. The vault has never had a
  community plugin, so Restricted mode is currently ON.
- Verified CLI facts (recorded, not assumed): `codex exec -m <model> -s read-only --skip-git-repo-check
  -C <dir> -o <file> "<prompt>"` works and reports its model on stderr; `agy` needs `--model` BEFORE `-p`
  or `-p` swallows the flag as its prompt; `opencode run --model provider/model` works with the
  `opencode-go/*` ids and must never be pointed at a Claude id (that route is unfunded); `claude` is
  authenticated but currently not logged in, and `claude -p` buffers the whole answer before printing.
  A CLI can exit with rc=1 and still have printed the correct answer, so the answer is judged by output,
  not by exit code.
- Obsidian launched from Finder inherits a minimal PATH, so `spawn('codex')` is expected to ENOENT: the
  plan hardcodes absolute binary paths and sets an explicit PATH.

## The six questions

1. Which single assumption in this plan is most likely to sink the design, and what is the cheapest test
   that would falsify it today? The plan bets that `child_process` works inside a bundled Obsidian plugin
   (Task 1.2). If you think that bet is wrong, say so and propose the cheapest viable alternative.
2. Is the test-first pure-core seam (`src/agents.ts` argv builders, `src/runner.ts` spawn/stream/timeout,
   a fake CLI in `tests/fixtures/fake-cli.mjs`, no Obsidian import) the right cut? What would you move
   across the boundary, and what would you test that the plan does not?
3. The plan says a panel can only print bytes as fast as a CLI emits them, and that real token streaming
   needs each CLI's event mode (claude `--output-format stream-json --verbose`, codex `--json`, opencode
   `--format json`, agy none). Is that correct for the CLI versions you know? What breaks when the JSON
   event shape changes, and what is the right fallback?
4. Process lifecycle: the panel supports cancel and timeout, and codex itself spawns MCP subprocesses.
   Is `SIGTERM` then `SIGKILL` on the direct child enough on macOS, or does this need `detached: true`
   plus a process-group kill? Give the pattern you would actually ship, with the failure it prevents.
5. Three questions the plan leaves open for the owner. Answer them as if the decision were yours, with
   one line of reasoning each: (a) default sandbox for all four agents, read-only or workspace-write for
   codex with the vault as cwd; (b) run logs under `.obsidian/plugins/agent-dispatch/runs/` (invisible to
   Obsidian search and graph) or a searchable `10-Agent-Runs/` folder in the vault; (c) do agy and
   opencode need a read-only posture too, given they have no such flag.
6. What is missing from the plan entirely that will bite during implementation? Rank by likelihood and
   say what the mitigation is. Assume the implementer follows the plan literally.

## Output

Write the answer to `docs/codex-second-opinion.md` (the `-o` flag handles this). Structure it as one
section per question, then a short list of changes you would make to the plan before implementation
starts. Quote the plan's wording when you disagree with a specific line. Do not rewrite the plan.
