#!/usr/bin/env bash
#
# Verifies that the password-reset pages point at an API endpoint that is
# actually alive and actually accepts requests from this site.
#
# Why this exists: the Aria reset page spent months POSTing to a Container App
# hostname that had been retired. The host stopped resolving, fetch() rejected
# before a request ever left the browser, and the page reported it as a generic
# "Network error" — so every web password reset failed silently, and it looked
# like a user connectivity problem. Nothing in this repo would have caught it,
# and no code change was needed to break it: the host was retired elsewhere.
#
# That is why this runs on a schedule as well as on change.
#
# The two failure modes it covers:
#   1. Dead host  — DNS/connect failure, the original outage (curl reports 000).
#   2. Dead CORS  — host resolves but no longer allows this origin, which fails
#                   in a browser while curl-without-Origin would look healthy.
#
# Safe to run any time: it sends a deliberately invalid token, and the backend
# returns a uniform 400 for invalid tokens AND for rate limiting, so this can
# neither reset anything nor false-fail on throttling.
#
# Run locally with: bash scripts/check-reset-endpoints.sh

set -euo pipefail

ORIGIN="https://runwitharia.com"
PAGES=(
  "auth/reset-password/index.html"
  "aria-xii/reset-password/index.html"
)

failures=0

fail() {
  echo "  FAIL: $*"
  failures=$((failures + 1))
}

for page in "${PAGES[@]}"; do
  echo "== $page"

  if [ ! -f "$page" ]; then
    fail "page is missing from the repo"
    continue
  fi

  # Every absolute endpoint the page submits to.
  urls=$(grep -oE "fetch\('https://[^']+'" "$page" | sed -E "s/^fetch\('//; s/'$//" | sort -u || true)

  if [ -z "$urls" ]; then
    # Not a pass. If the page stops matching, the check has gone blind and
    # would report green forever — the same silence this exists to prevent.
    fail "found no fetch('https://...') endpoint; this check can no longer see what the page calls"
    continue
  fi

  while IFS= read -r url; do
    echo "  endpoint: $url"

    # 1. CORS preflight - proves the API still accepts this site as an origin.
    allow_origin=$(
      curl -sS -X OPTIONS \
        -H "Origin: $ORIGIN" \
        -H 'Access-Control-Request-Method: POST' \
        -H 'Access-Control-Request-Headers: content-type' \
        --max-time 20 -D - -o /dev/null "$url" 2>/dev/null \
        | tr -d '\r' \
        | grep -i '^access-control-allow-origin:' \
        | head -n1 | cut -d' ' -f2- || true
    )

    if [ "$allow_origin" = "$ORIGIN" ] || [ "$allow_origin" = "*" ]; then
      echo "    cors: ok ($allow_origin)"
    else
      fail "CORS preflight did not allow $ORIGIN (got: '${allow_origin:-none}'). A browser would block this."
    fi

    # 2. Live POST with a deliberately invalid token - proves the host resolves,
    #    the route exists, and the API is answering. 400 is the expected answer.
    #
    #    On a DNS/connect failure curl writes "000" AND exits non-zero, so the
    #    fallback must not append a second value or the 000 branch never matches.
    code=$(
      curl -sS -o /dev/null -w '%{http_code}' -X POST \
        -H 'Content-Type: application/json' \
        -H "Origin: $ORIGIN" \
        --max-time 20 \
        -d '{"token":"ci-smoke-check-not-a-real-token","newPassword":"ci-smoke-check-pw"}' \
        "$url" 2>/dev/null || true
    )
    code="${code:-000}"

    case "$code" in
      400)
        echo "    post: ok (400 invalid token, as expected)"
        ;;
      000)
        fail "could not reach the host at all (DNS or connection failure). This is the original outage."
        ;;
      *)
        fail "expected 400 for an invalid token, got HTTP $code"
        ;;
    esac
  done <<< "$urls"
done

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed - web password reset is likely broken for users."
  exit 1
fi

echo "All reset endpoints healthy."
