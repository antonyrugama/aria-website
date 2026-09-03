#!/usr/bin/env bash
set -euo pipefail

readonly attribution='Exercise data and videos provided by MuscleWiki.com.'
count="$(grep -Foc "$attribution" privacy.html)"

if [[ "$count" -ne 1 ]]; then
  echo "privacy.html must contain the exact MuscleWiki attribution once; found $count" >&2
  exit 1
fi

echo "MuscleWiki privacy attribution check passed"