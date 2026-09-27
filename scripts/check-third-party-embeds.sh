#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${1:-$(git -C "$script_dir/.." rev-parse --show-toplevel)}"

node "$script_dir/check-third-party-embeds.mjs" "$repo_root"
