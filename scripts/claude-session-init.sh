#!/usr/bin/env bash
# Claude Code session initialization hook
# Ensures claude-flow daemon and RuVector containers are running,
# then restores the latest session.

set -euo pipefail

CF="claude-flow"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Ensure daemon is running
if ! $CF daemon status &>/dev/null; then
  cd "$PROJECT_DIR"
  $CF daemon start &>/dev/null 2>&1 || true
fi

# 2. Ensure RuVector postgres is running
if ! docker ps --filter name=ruvector-postgres --filter status=running -q | grep -q .; then
  cd "$PROJECT_DIR/my-ruvector"
  docker compose up -d postgres &>/dev/null 2>&1 || true
fi

# 3. Restore latest session
cd "$PROJECT_DIR"
$CF hooks session-start --session-id "auto-$(date +%Y%m%d)" &>/dev/null 2>&1 || true

exit 0
