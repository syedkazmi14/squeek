#!/usr/bin/env bash
# Copies the shared detection code and rules into the Edge Functions bundle.
# Supabase deploys can't reliably import files outside supabase/, so the copy is committed.
# Run after editing packages/detection. `--check` fails if the copy is out of date (for CI).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/packages/detection"
dest="$root/supabase/functions/_shared/detection"

if [[ "${1:-}" == "--check" ]]; then
  diff -r "$src/src" "$dest/src" && diff "$src/rules/rules.json" "$dest/rules.json" \
    && echo "detection copy is up to date" && exit 0
  echo "supabase/functions/_shared/detection is stale; run scripts/sync-detection.sh" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest/src"
cp "$src"/src/*.ts "$dest/src/"
cp "$src/rules/rules.json" "$dest/rules.json"
echo "synced detection -> supabase/functions/_shared/detection"
