# CLI probes, 2026-10-04

Every invocation the plugin encodes was run from the shell first, with a unique token per agent, from
`scripts/probe-clis.sh`. Raw output is in `docs/probes/` (git-ignored; re-run the script to regenerate).

| Agent | Wall clock | Token returned | Model banner the CLI printed | Exit code |
|---|---|---|---|---|
| codex `gpt-6-astra` | 11s | none | `model: gpt-6-astra` | 1 |
| claude `claude-haiku-4-5` | 4s | none | none | 1 |
| agy `gemini-3.8-flash-low` | 10s | `PROBE-AGY-77` | none | 0 |
| opencode `opencode-go/glm-5.3` | 9s | `PROBE-OC-77` | none | 0 |

Commands as run:

```
codex exec -m gpt-6-astra -s read-only --skip-git-repo-check -C docs/probes -o docs/probes/codex-last.txt "Reply with exactly this token and nothing else: PROBE-CODEX-77"
claude -p --model claude-haiku-4-5 --max-turns 1 "Reply with exactly this token and nothing else: PROBE-CLAUDE-77"
agy --model gemini-3.8-flash-low -p "Reply with exactly this token and nothing else: PROBE-AGY-77"
opencode run --model opencode-go/glm-5.3 "Reply with exactly this token and nothing else: PROBE-OC-77"
```

## What the failures were

**codex**: no answer, quota wall.

```
ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit
https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 8:03 PM.
```

The banner still printed, and that is the useful part: it proves `-m gpt-6-astra` was accepted and that the
model proof comes from stderr. A quota block and a bad flag are distinguishable, and the plugin must show
this exact string rather than a generic failure.

**claude**: no answer, not authenticated.

```
Not logged in. Run claude auth login to authenticate.
```

The user runs `claude auth login` himself. Until then the claude row of the plugin is expected to fail with
this string.

## Error strings the UI must surface verbatim

| Signature | Meaning |
|---|---|
| `You've hit your usage limit` | codex quota, wall-clock, read the retry time from the same line |
| `Not logged in. Run claude auth login to authenticate.` | claude CLI has no credentials |
| `Insufficient account funds` | opencode pointed at an unfunded route (never aim opencode at a Claude id) |
| `-p took "--model" as its prompt` | agy flags out of order: `--model` must come before `-p` |

The first three were observed today; the agy signature is the one recorded in the `model-tier-routing`
skill's verified run, and it is the exact failure the registry's argv order exists to prevent.
