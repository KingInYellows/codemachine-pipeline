#!/usr/bin/env bash
# verify_install.sh — Post-release smoke test for codemachine-pipeline
# Usage: ./scripts/tooling/verify_install.sh [version]
# Example: ./scripts/tooling/verify_install.sh 1.1.0
set -euo pipefail

VERSION="${1:-}"
PACKAGE="@kinginyellows/codemachine-pipeline"
PASS=0
FAIL=0

log()  { printf '\033[1;34m[verify]\033[0m %s\n' "$*"; }
pass() { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '\033[1;31m  ✗\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }

# --- Prerequisites ---
log "Checking prerequisites..."

NODE_VER=$(node --version 2>/dev/null || echo "none")
if [[ "$NODE_VER" == "none" ]]; then
  fail "Node.js not found"
  exit 1
fi
read -r -d . MAJOR _ <<< "${NODE_VER#v}"
if [[ "$MAJOR" -ge 24 ]]; then
  pass "Node.js $NODE_VER (>= 24)"
else
  fail "Node.js $NODE_VER (expected >= 24)"
fi

# --- Registry config ---
log "Checking npm registry config..."
if npm config get @kinginyellows:registry 2>/dev/null | grep -q "npm.pkg.github.com"; then
  pass "GitHub Packages registry configured for @kinginyellows scope"
else
  fail "Missing registry config — run: npm config set @kinginyellows:registry https://npm.pkg.github.com"
fi

# --- Package availability ---
if [[ -n "$VERSION" ]]; then
  log "Checking package availability..."
  if npm view "${PACKAGE}@${VERSION}" version --registry=https://npm.pkg.github.com >/dev/null 2>&1; then
    pass "Package ${PACKAGE}@${VERSION} found on GitHub Packages"
  else
    fail "Package ${PACKAGE}@${VERSION} not found on GitHub Packages"
  fi
fi

# --- Install ---
log "Installing ${PACKAGE}${VERSION:+@$VERSION} globally..."
if output=$(npm install -g "${PACKAGE}${VERSION:+@$VERSION}" 2>&1); then
  pass "Global install succeeded"
else
  fail "Global install failed"
  printf -- '--- npm install output ---\n%s\n--------------------------\n' "$output"
  printf '\n\033[1;31mInstall failed — skipping runtime checks.\033[0m\n'
  printf '\nResults: %d passed, %d failed\n' "$PASS" "$FAIL"
  exit 1
fi

# --- Runtime checks ---
log "Running smoke tests..."

INSTALLED_VER=$(codepipe --version 2>/dev/null || echo "")
if [[ -n "$INSTALLED_VER" ]]; then
  if [[ -n "$VERSION" && "$INSTALLED_VER" != *"$VERSION"* ]]; then
    fail "Version mismatch: expected $VERSION, got $INSTALLED_VER"
  else
    pass "codepipe --version: $INSTALLED_VER"
  fi
else
  fail "codepipe --version failed"
fi

if codepipe --help >/dev/null 2>&1; then
  pass "codepipe --help"
else
  fail "codepipe --help failed"
fi

# --- Functional test in temp repo ---
log "Running functional test in temp repo..."
WORK_DIR=$(mktemp -d); trap 'rm -rf "$WORK_DIR"' EXIT

if ! command -v git >/dev/null 2>&1; then
  fail "git not found (required for functional test)"
  printf '\n\033[1mResults: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
  exit 1
fi

pushd "$WORK_DIR" > /dev/null
  if ! git init -q 2>/dev/null; then
    fail "git init failed"
    popd > /dev/null
    printf '\n\033[1mResults: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
    exit 1
  fi
  if ! git -c user.name="verify-script" -c user.email="verify@example.com" commit --allow-empty -m "init" -q 2>/dev/null; then
    fail "git commit failed"
    popd > /dev/null
    printf '\n\033[1mResults: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
    exit 1
  fi
  if output=$(codepipe init --yes 2>&1); then
    pass "codepipe init --yes (created .codepipe/ scaffolding)"
  else
    fail "codepipe init --yes failed"
    printf -- '--- codepipe init output ---\n%s\n----------------------------\n' "$output"
  fi

  if codepipe doctor >/dev/null 2>&1; then
    pass "codepipe doctor"
  else
    fail "codepipe doctor failed"
  fi
popd > /dev/null

# --- Summary ---
printf '\n\033[1mResults: %d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
