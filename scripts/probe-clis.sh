#!/usr/bin/env bash
# Phase 0 probes: prove each CLI invocation from the shell, verbatim, before any plugin code.
# Writes one .out and one .err per agent into docs/probes/ and prints a one-line summary per agent.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/probes"
mkdir -p "$OUT"

run() {
  local name="$1"; shift
  local t="$1"; shift
  local start ms rc token banner
  start=$(date +%s)
  perl -e 'alarm shift; exec @ARGV' "$t" "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  rc=$?
  ms=$(( $(date +%s) - start ))
  token=$(grep -oE "PROBE-[A-Z]+-77" "$OUT/$name.out" | head -1)
  banner=$(grep -oE "model: *[A-Za-z0-9._-]+" "$OUT/$name.err" | head -1)
  printf "%-9s rc=%-3s %4ss token=%-15s banner=%s\n" "$name" "$rc" "$ms" "${token:--}" "${banner:--}"
}

run codex    180 codex exec -m gpt-6-astra -s read-only --skip-git-repo-check -C "$OUT" \
                 -o "$OUT/codex-last.txt" "Reply with exactly this token and nothing else: PROBE-CODEX-77"
run claude    90 claude -p --model claude-haiku-4-5 --max-turns 1 \
                 "Reply with exactly this token and nothing else: PROBE-CLAUDE-77"
run agy      120 agy --model gemini-3.8-flash-low -p \
                 "Reply with exactly this token and nothing else: PROBE-AGY-77"
run opencode 120 opencode run --model opencode-go/glm-5.3 \
                 "Reply with exactly this token and nothing else: PROBE-OC-77"

echo "--- claude auth status ---"
claude auth status --text 2>&1 | head -2
echo "--- codex quota line, if any ---"
grep -iE "usage limit|try again at" "$OUT"/codex.err | tail -2
echo "--- opencode last line (truncation check) ---"
tail -1 "$OUT/opencode.out"
echo "--- files written ---"
ls -1 "$OUT"
