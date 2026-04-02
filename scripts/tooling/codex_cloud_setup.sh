#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

log() {
  printf '[codex-setup] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[codex-setup] missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm

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

  printf '[codex-setup] missing required command: sha256sum, shasum, or openssl\n' >&2
  exit 1
}

EXPECTED_NODE_MAJOR="$(node -p "require('./package.json').engines.node.match(/[0-9]+/)[0]")"
CURRENT_NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( CURRENT_NODE_MAJOR < EXPECTED_NODE_MAJOR )); then
  printf '[codex-setup] Node.js %s+ is required (current: v%s)\n' "$EXPECTED_NODE_MAJOR" "$(node -p 'process.versions.node')" >&2
  exit 1
fi

TEMP_NPMRC=""
if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
  require_cmd mktemp
  log 'Writing temporary npm user config for authenticated installs'
  TEMP_NPMRC="$(mktemp)"
  export NPM_CONFIG_USERCONFIG="$TEMP_NPMRC"
  cat > "$TEMP_NPMRC" <<'NPMRC'
@kinginyellows:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
always-auth=true
NPMRC
  cleanup() {
    rm -f "$TEMP_NPMRC"
  }
  trap cleanup EXIT
fi

log 'Installing dependencies deterministically (npm ci, scripts disabled)'
npm ci --ignore-scripts --no-audit --no-fund

log 'Building distributable artifacts (dist/, oclif.manifest.json)'
npm run build

log 'Preparing non-secret runtime config for offline agent phase'
mkdir -p .codepipe
if [[ -f .codepipe/config.json ]]; then
  log 'Keeping existing .codepipe/config.json'
else
  cat > .codepipe/config.json <<'CONFIG'
{
  "schema_version": "1.0.0",
  "project": {
    "id": "codemachine-pipeline",
    "repo_url": "https://github.com/KingInYellows/codemachine-pipeline.git"
  },
  "github": {
    "enabled": false
  },
  "linear": {
    "enabled": false
  },
  "runtime": {
    "agent_endpoint_env_var": "AGENT_ENDPOINT",
    "run_directory": ".codepipe/runs"
  },
  "safety": {
    "redact_secrets": true
  },
  "feature_flags": {
    "enable_auto_merge": false,
    "enable_deployment_triggers": false,
    "enable_linear_sync": false,
    "enable_context_summarization": true,
    "enable_resumability": true,
    "enable_developer_preview": false
  }
}
CONFIG
fi

log 'Capturing dependency fingerprint for maintenance verification'
mkdir -p .codex-cloud
LOCK_FINGERPRINT_FILE=".codex-cloud/package-lock.sha256"
printf '%s  package-lock.json\n' "$(hash_file package-lock.json)" > "$LOCK_FINGERPRINT_FILE"

log 'Setup complete'
