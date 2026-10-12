# Agent Dispatch: adversarial second opinion

## 1. The assumption most likely to sink the design

**The weakest assumption is that one sandbox setting can provide a read-only default across four different agents.**

The plan promises:

> “Default safety posture is read-only: agents get no write access to his repos unless he flips a setting.”

But Task 2.2 passes `sandbox` only to Codex. Claude, agy and OpenCode silently ignore it. A dropdown that says read-only while launching agents with their existing permissions is a broken product contract.

The cheapest falsification is free: inspect or test each invocation produced for `sandbox: 'read-only'`. Three builders contain no corresponding permission configuration. This already disproves enforcement by the plugin, although it does not prove that every agent would write under its current external configuration.

The next test should use a disposable directory with a canary file. Ask each agent to modify it using its available tools, then verify the bytes independently. Include shell and MCP routes where enabled. A successful unauthorized modification falsifies read-only enforcement; a refusal alone does not prove every route is blocked.

I disagree with:

> “Node access from a plugin is the one assumption that can sink the design.”

`child_process` is a reasonable desktop Obsidian dependency. The official sample builds CommonJS and externalizes Node built-ins, consistent with this architecture. The plan’s own outcome appendix also reports successful live CLI execution, although I did not independently repeat that UI test. [Official sample build configuration](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs)

Keep Task 1.2. `/bin/echo` is the cheapest check of the bundled plugin’s ability to execute a child. Follow it with the fake CLI through the real runner, using closed stdin and the explicit PATH, after a Finder launch. Echo alone does not exercise interpreter discovery, streaming or cancellation.

If spawning genuinely fails after checking bundling, use a small supervised local helper over a Unix socket, or authenticated loopback HTTP. Changing `import` to `require` can fix a bundling mistake; it cannot restore a runtime capability that is unavailable. I would not introduce the helper before observing that failure.

## 2. The pure-core seam

**Keeping Obsidian out of invocation building, parsing and run management is correct. Calling the runner pure is inaccurate: it is an effectful adapter.**

I would use these boundaries:

| Component | Responsibility |
|---|---|
| Agent adapters | Validated argv, permission capabilities, event decoding and final-result interpretation |
| Process runner | Spawn, stream decoding, cancellation, timeout and process cleanup |
| Run manager | Run IDs, state transitions, answer assembly, model evidence and persistence coordination |
| Storage adapter | Raw log writes, final-message files and recovery |
| Obsidian layer | Settings, views, commands and safe note insertion |

Keep `renderRunLog()` pure. Move log persistence out of the runner. The current repository’s `RunManager` is already a useful step in this direction.

The original runner has concrete defects:

- `chunk.toString()` independently decodes each chunk, corrupting multibyte characters split between chunks.
- `text.split('\n')` treats chunk boundaries as line boundaries.
- Default piped stdin remains open.
- Cancel sends only SIGTERM, unlike timeout.
- `env` accepts an environment object but applies only its PATH.
- The proposed API returns `RunHandle`, while two tests await `runAgent()` directly. Those tests cannot pass against that interface.

Use `setEncoding('utf8')` or `StringDecoder`, preserve an incomplete line between chunks, and flush it at EOF. Expose decoded chunks for plain-text display so an agent that emits text without newlines can still update the panel.

I disagree with:

> “This file is the whole test strategy.”

The fake CLI is the foundation, not sufficient coverage. Add:

1. **Actual streaming:** emit one chunk, wait for a test acknowledgment, then finish. Assert the callback happened before completion. The proposed `toContain()` checks only eventual output.
2. **Framing:** split Arabic and emoji bytes, fragmented JSON, multiple events per chunk, CRLF and an unterminated final line.
3. **Lifecycle:** missing executable, invalid cwd, immediate exit, ignored SIGTERM, descendant holding stdout open, repeated cancel and cancel after completion.
4. **Answer assembly:** deltas followed by full-message snapshots and a final result, without duplicating text or deleting legitimate repeated text.
5. **Result classification:** rc=1 with an answer, rc=0 with an error event, cancellation with partial output and missing final-message files.
6. **Policy validation:** unsupported sandbox requests fail explicitly; OpenCode Claude routes are rejected even when settings are edited manually.
7. **Persistence failures:** disk-full or write-denied logging preserves the answer and produces a separate logging error.

During this review, a small reproduction turned split `م` bytes into `��` and split `"hello\n"` into `"hel"` and `"lo"` under the plan’s algorithm. The current runner fixes line accumulation, but still independently decodes buffers.

## 3. Streaming and event-shape changes

**The byte-emission claim is correct. The claim that these JSON flags provide token streaming is too broad.**

Checks on 2026-10-06 found:

| Agent | Finding |
|---|---|
| Claude, installed 2.1.291 | Add `--include-partial-messages` to `--output-format stream-json --verbose` for incremental text. Parse text deltas separately from complete assistant messages and the final result. |
| Codex, installed 0.155.1 | `--json` emits JSONL events. That establishes event streaming, not a guaranteed token-delta contract. The documented example delivers an agent message through `item.completed`. |
| OpenCode | `--format json` is documented. Current upstream `run.ts` emits text when `part.time.end` exists, meaning completed text parts rather than necessarily token deltas. Installed-version verification was blocked because even `--version` attempted a prohibited temporary-directory write. |
| agy | Installed `--help` now advertises `--output-format stream-json`. The plan’s “none found” is stale. Its precise event shape and emission timing still need a recorded probe. |

Sources: [Claude streaming documentation](https://code.claude.com/docs/en/headless#stream-responses), [Codex non-interactive output](https://developers.openai.com/codex/noninteractive/), [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode upstream implementation](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/run.ts).

Keep agy’s model and other options before `-p`, as established by the recorded invocation constraint.

I disagree with:

> “if event parsing yields no text, show the raw line.”

“No text” includes legitimate progress, usage, tool-call and model-metadata events. Printing all of those into the answer mixes protocol traffic with the deliverable.

Return distinct parser outcomes: `text-delta`, `message-snapshot`, `metadata`, `completion`, `error`, `unknown` and `malformed`. Preserve message IDs where available. Runtime validation must handle syntactically valid JSON with unexpected field types.

When a shape changes:

- Keep known text visible.
- Show a visible “unrecognized output format” notice.
- Make bounded raw diagnostics available separately.
- Mark answer completeness unknown if completion cannot be established.
- Preserve raw events according to the log policy.
- Do not automatically rerun in text mode. That can repeat charges and tool actions.

Retain Codex’s `-o` file as a separate final-answer source, but use a fresh path per run. A stale file must never make a failed run appear successful.

The plan correctly separates requested model, reported model, exit status and completeness. Keep that separation. A model banner on a quota failure proves what the CLI selected or reported, not that the model answered.

## 4. Process lifecycle on macOS

**Ship process-group termination from the beginning. Direct-child termination is insufficient for the documented MCP process tree.**

The failure is concrete: Codex exits, but a descendant continues running or keeps an inherited output pipe open. The runner can remain waiting for `close`, and the descendant can continue work after the panel reports cancellation.

On macOS, `detached: true` makes the spawned child the leader of a new process group and session. It does not by itself provide cleanup. [Node child-process documentation](https://nodejs.org/api/child_process.html#optionsdetached)

The core pattern I would ship is:

```ts
const child = spawn(binary, args, {
  cwd,
  env,
  shell: false,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const pgid = child.pid;
let stopping = false;
let released = false;

function signalGroup(signal: NodeJS.Signals): boolean {
  if (released || pgid === undefined) return false;

  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      released = true;
      return false;
    }
    throw error; // Report cleanup failure; do not pretend it stopped.
  }
}

function terminate(reason: 'cancelled' | 'timeout' | 'unload') {
  if (stopping || released) return;
  stopping = true;
  recordTerminationReason(reason);

  if (signalGroup('SIGTERM')) {
    scheduleGroupEscalation(() => signalGroup('SIGKILL'), 2000);
  }
}
```

That signaling core needs explicit lifecycle rules:

- Cancel, timeout and unload use the same idempotent path.
- Do not cancel escalation merely because the direct child emitted `exit` or `close`; descendants may still exist.
- Distinguish “stopping” from confirmed cleanup.
- Bound output-drain waiting after termination. Report incomplete cleanup instead of leaving `done` pending forever.
- On normal parent exit, check and clean up remaining members of the group this run owns.
- Release group ownership and cancel pending timers once the group is gone. Never kill persisted stale PIDs after restarting Obsidian.
- Do not `unref()` the child as a cleanup strategy.

Test with a fake CLI that starts a grandchild which ignores SIGTERM and holds stdout open. Verify the recorded descendant PID disappears. `pgrep 'codex exec|opencode run'` can miss an MCP child named `node`, `python` or something unrelated.

A descendant that starts its own session can escape the group. An already-running remote service is outside it too. If those cases occur, use the agent’s cancellation protocol or a supervisor. An Obsidian crash also cannot be covered by an `onunload()` callback.

## 5. My decisions on the owner questions

**(a) Default sandbox:** Read-only for every enabled agent; Codex should use `-s read-only` even with the vault as cwd, because a prompt dispatcher should not implicitly authorize editing notes or plugin files.

**(b) Run logs:** Keep automatic logs under the configured plugin directory’s `runs/`, with retention and explicit “Save as note”; transient diagnostics should not become searchable knowledge by default.

**(c) agy and OpenCode:** Yes, both need an enforced read-only posture; until verified, disable their read-only mode or identify them explicitly as unrestricted rather than silently ignoring the setting.

There are two corrections behind those decisions:

- Installed agy help advertises `--mode plan` and `--sandbox`. Their names do not establish full filesystem or MCP protection.
- OpenCode supports configurable tool permissions despite lacking Codex’s exact sandbox flag. Use configuration appropriate to the installed version and verify its effective permissions. Denying edits while allowing arbitrary shell execution does not enforce read-only behavior. [OpenCode agent permissions](https://opencode.ai/docs/agents/)

The same problem applies to Claude: the proposed invocation contains no read-only policy. A turn limit is not a permission restriction.

For each adapter, document whether protection comes from an OS sandbox, tool permissions or neither. Disable unneeded MCP tools, hooks and other mutation routes in the dispatch profile. Codex’s sandbox flag should not be treated as a blanket guarantee about external services.

## 6. Missing requirements, ranked by likelihood

The outcome appendix already records some implementation discoveries. These are gaps in the original executable instructions, not claims that every gap remains unfixed today.

| Rank | Likelihood | Missing requirement and mitigation |
|---|---|---|
| 1 | Already observed | **Explicit stdin policy.** The original runner leaves stdin open. Use `['ignore', 'pipe', 'pipe']` for argv prompts. If stdin becomes a prompt transport, write the prompt and close it deliberately. |
| 2 | High | **Event framing and answer reconstruction.** One recorded event per agent cannot catch fragmented bytes, snapshots or duplicates. Add transcript fixtures with timing and message identity. |
| 3 | High | **Headless permissions and inherited configuration.** An agent may deny a required tool, load hooks or start unrelated MCP servers. Define a tested dispatch profile and surface permission denial distinctly from authentication failure. |
| 4 | High | **Working-directory failure semantics.** Reject a missing or invalid configured cwd. The appendix’s fallback to `process.cwd()` can execute against the wrong directory and load different instructions. Catch spawn failures without changing the requested scope. |
| 5 | High | **Asynchronous editor targeting.** `fire-selection` can finish after the selection, document or active pane changes. Capture the document identity and anchor, verify they remain valid, and otherwise keep the result in the panel for explicit insertion. |
| 6 | High over repeated use | **Crash recovery and log-write failure.** Create a run record at start, checkpoint output, finalize atomically and mark unfinished runs interrupted after restart. Logging failure must not discard the answer. |
| 7 | Medium-high | **Memory and storage budgets.** A 4,000-line DOM cap does not bound unlimited strings, giant individual lines or retained runs. Set byte limits, batch rendering, spool output and prune old logs. |
| 8 | Medium | **Prompt transport limits.** `shell: false` prevents shell interpretation, but not leading-option ambiguity, NUL rejection or argv size limits. Test each CLI’s `--` handling or supported stdin transport, and define maximum prompt size. |
| 9 | Medium | **Settings validation and route enforcement.** Validate persisted and externally edited settings, snapshot them per run, and enforce the OpenCode provider/model restriction below the UI. A dropdown alone cannot enforce the house rule. |
| 10 | Medium | **Runtime and capability drift.** Obsidian uses Electron’s embedded Node, not necessarily the terminal’s Node 26.8.2. Record both runtimes and CLI versions, pin dependencies, and recheck capabilities after CLI updates. |

Two specific lines also need correction.

> “on completion, inserts the answer below the selection with `editor.replaceSelection`.”

`replaceSelection` replaces the selected text. It does not mean “insert below.” Define and test the intended edit operation, including what happens when the source changes during the run.

> “The UI flags a final line that does not end in sentence punctuation as `possibly truncated`”

This is a poor completeness test for code, Markdown tables, identifiers and short answers. Conversely, an interrupted answer can end in punctuation. Prefer explicit completion events and finish reasons; otherwise record completeness as unknown.

Finally, “v1 stores none” is not a sufficient secrets policy. Raw stdout, stderr, tool events and prompts can contain sensitive values even when the plugin never stores credentials intentionally. Define redaction, retention and export behavior. A hidden Obsidian directory is not a confidentiality boundary.

Verification for this review: I read the complete plan, outcome appendix, recorded probes and relevant implementation; checked installed Codex, Claude and agy help; consulted primary documentation and OpenCode source; reproduced the proposed decoder defects; and ran TypeScript checking successfully. I did not rerun the reported 58 tests, paid CLI prompts or live Obsidian checks. Direct file writes were unavailable in this session; this report is supplied for the caller’s `-o` capture.

## Changes I would make before implementation

1. Replace the shared sandbox promise with verified per-agent permission contracts.
2. Keep the Obsidian spawn probe and add a Finder-launched fake-CLI lifecycle test.
3. Correct Claude’s streaming flags, reprobe agy, and stop equating JSON events with token streaming.
4. Specify UTF-8 decoding, event assembly, final-answer selection and unknown-event handling.
5. Require process-group termination with descendant tests for cancel, timeout and unload.
6. Reject invalid cwd, protect asynchronous note insertion, and add durable logs with bounded resource use.
7. Replace punctuation-based completeness and banner-based “model answered” claims with explicit evidence fields.