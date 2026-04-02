#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[codex-maint] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[codex-maint] missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm

EXPECTED_NODE_MAJOR="$(node -p "require('./package.json').engines.node.match(/[0-9]+/)[0]")"
CURRENT_NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( CURRENT_NODE_MAJOR < EXPECTED_NODE_MAJOR )); then
  printf '[codex-maint] Node.js %s+ is required (current: v%s)\n' "$EXPECTED_NODE_MAJOR" "$(node -p 'process.versions.node')" >&2
  exit 1
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
    return
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $2}'
    return
  fi

  printf '[codex-maint] missing required command: sha256sum, shasum, or openssl\n' >&2
  exit 1
}

LOCK_FINGERPRINT_FILE=".codex-cloud/package-lock.sha256"

if [[ -f "$LOCK_FINGERPRINT_FILE" ]]; then
  log 'Verifying lockfile fingerprint before dependency refresh'
  read -r expected_hash _ < "$LOCK_FINGERPRINT_FILE"
  current_hash="$(hash_file package-lock.json)"
  if [[ "$current_hash" != "$expected_hash" ]]; then
    printf '[codex-maint] package-lock.json fingerprint changed; rerun setup online before offline maintenance\n' >&2
    exit 1
  fi
else
  log 'No lockfile fingerprint found; creating baseline for future resumes'
  mkdir -p .codex-cloud
  printf '%s  package-lock.json\n' "$(hash_file package-lock.json)" > "$LOCK_FINGERPRINT_FILE"
fi

log 'Re-syncing dependencies from lockfile (prefer offline cache)'
npm ci --prefer-offline --ignore-scripts --no-audit --no-fund

log 'Rebuilding dist with manifest generation disabled for offline maintenance'
OCLIF_SKIP_MANIFEST=1 npm run build

log 'Maintenance complete'
