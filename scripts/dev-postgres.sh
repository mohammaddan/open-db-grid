#!/usr/bin/env bash
# Spins up a disposable PostgreSQL 16 for DBForge integration tests.
#   scripts/dev-postgres.sh up      # start + wait until ready
#   scripts/dev-postgres.sh down    # stop + remove (data lives in a volume)
#   scripts/dev-postgres.sh status  # report readiness
#
# The integration tests connect to:
#   postgresql://dbforge:dbforge@127.0.0.1:54329/dbforge_test
# Override with DB_CLIENT_TEST_PG_URL when running the suite manually.

set -euo pipefail

CONTAINER=dbforge-pg-test
PORT=54329
URL="postgresql://dbforge:dbforge@127.0.0.1:${PORT}/dbforge_test"

wait_ready() {
  echo "Waiting for PostgreSQL to accept connections…"
  # pg_isready can return true during the initdb phase before the final server
  # restarts, so verify with a real query until it succeeds repeatedly.
  local ok=0
  for _ in $(seq 1 120); do
    if docker exec "$CONTAINER" psql -U dbforge -d postgres -tc "SELECT 1" >/dev/null 2>&1; then
      ok=$((ok + 1))
      [ "$ok" -ge 3 ] && { echo "PostgreSQL is ready: $URL"; return 0; }
    else
      ok=0
    fi
    sleep 0.5
  done
  echo "Timed out waiting for $CONTAINER" >&2
  exit 1
}

ensure_test_db() {
  # CREATE DATABASE is idempotent-ish: ignore "already exists" (42P04)
  docker exec "$CONTAINER" psql -U dbforge -d postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname = 'dbforge_test'" | grep -q 1 ||
    docker exec "$CONTAINER" psql -U dbforge -d postgres -c "CREATE DATABASE dbforge_test" >/dev/null
}

case "${1:-up}" in
  up)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      echo "$CONTAINER already running"
    else
      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
      docker run -d --name "$CONTAINER" \
        -e POSTGRES_USER=dbforge \
        -e POSTGRES_PASSWORD=dbforge \
        -e POSTGRES_DB=dbforge_test \
        -p "127.0.0.1:${PORT}:5432" \
        postgres:16-alpine >/dev/null
    fi
    wait_ready
    ensure_test_db
    echo "Run integration tests with: npm run test:integration"
    ;;
  down)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 && echo "$CONTAINER removed" || echo "$CONTAINER was not running"
    ;;
  status)
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" \
       && docker exec "$CONTAINER" pg_isready -U dbforge -d dbforge_test >/dev/null 2>&1; then
      echo "ready: $URL"
    else
      echo "not running"
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 {up|down|status}" >&2
    exit 2
    ;;
esac