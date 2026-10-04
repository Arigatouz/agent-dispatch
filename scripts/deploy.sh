#!/usr/bin/env bash
# Copy the built plugin into the vault's plugin folder. Obsidian reads the folder, so a deploy plus a
# plugin reload (or an app restart) is all that is needed; no build step happens here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${VAULT:-/Users/alig/Ali-work/Obsadian-vault/hermes-vault/Herms-vault}"
DEST="$VAULT/.obsidian/plugins/agent-dispatch"

[ -f "$ROOT/main.js" ] || { echo "main.js missing: run npm run build first" >&2; exit 1; }

mkdir -p "$DEST"
cp "$ROOT/manifest.json" "$DEST/manifest.json"
cp "$ROOT/main.js" "$DEST/main.js"
[ -f "$ROOT/styles.css" ] && cp "$ROOT/styles.css" "$DEST/styles.css"
echo "deployed to $DEST"
ls -1 "$DEST"
