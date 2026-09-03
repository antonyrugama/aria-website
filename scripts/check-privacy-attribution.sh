#!/usr/bin/env bash
set -euo pipefail

readonly attribution='Exercise data and videos provided by MuscleWiki.com.'
readonly privacy_file="${1:-privacy.html}"
count="$(
  { grep -Fo "$attribution" "$privacy_file" || true; } |
    wc -l |
    tr -d '[:space:]'
)"

if [[ "$count" -ne 1 ]]; then
  echo "$privacy_file must contain the exact MuscleWiki attribution once; found $count" >&2
  exit 1
fi

echo "MuscleWiki privacy attribution check passed"