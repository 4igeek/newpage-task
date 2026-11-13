#!/usr/bin/env bash
# Starts a fresh, throwaway copy of the whole stack, runs the browser tests
# against it, then deletes it (containers and volumes), pass or fail.
set -uo pipefail
cd "$(dirname "$0")"

compose=(docker compose -p docchat-e2e -f ../docker-compose.yml -f compose.e2e.yml)

"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1
"${compose[@]}" up --build --detach --wait || {
  "${compose[@]}" logs
  "${compose[@]}" down -v
  exit 1
}

pnpm exec playwright test "$@"
status=$?

if [ "$status" -ne 0 ]; then "${compose[@]}" logs api worker | tail -100; fi
"${compose[@]}" down -v
exit "$status"
