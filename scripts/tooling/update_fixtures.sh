#!/usr/bin/env bash
# update_fixtures.sh - Refresh integration test fixtures and update manifest hashes
#
# This script updates HTTP fixtures for GitHub and Linear integration tests:
# - Computes SHA256 hashes for all fixture files
# - Updates manifest.json with new hashes and timestamps
# - Validates fixture structure and required fields
# - Supports selective provider updates (--provider flag)
# - Dry-run mode for preview without writing changes
#
# Usage:
#   ./scripts/tooling/update_fixtures.sh [OPTIONS]
#
# Options:
#   --provider <github|linear|all>  Update specific provider or all (default: all)
#   --dry-run                       Preview changes without writing
#   --help                          Show this help message
#
# Exit codes:
#   0 - Success
#   1 - Validation failure
#   2 - Configuration error

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FIXTURES_DIR="${REPO_ROOT}/tests/fixtures"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
PROVIDER="all"
DRY_RUN=false

# Logging functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*"
}

log_section() {
  echo ""
  echo -e "${BLUE}======================================${NC}"
  echo -e "${BLUE}$*${NC}"
  echo -e "${BLUE}======================================${NC}"
}

# Help text
show_help() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Refresh integration test fixtures and update manifest hashes.

OPTIONS:
  --provider <name>       Update specific provider (github, linear, all)
                         Default: all
  --dry-run              Preview changes without writing files
  -h, --help             Show this help message

EXAMPLES:
  # Update all fixtures
  ./scripts/tooling/update_fixtures.sh

  # Update only GitHub fixtures
  ./scripts/tooling/update_fixtures.sh --provider github

  # Preview changes without writing
  ./scripts/tooling/update_fixtures.sh --dry-run

FIXTURE STRUCTURE:
  tests/fixtures/
    github/
      *.json              - HTTP response fixtures
      manifest.json       - Fixture metadata with hashes
    linear/
      *.json              - GraphQL response fixtures
      manifest.json       - Fixture metadata with hashes

For more information, see: docs/ops/integration_testing.md
EOF
}

# Compute SHA256 hash of a file
compute_hash() {
  local file="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    sha256sum "$file" | awk '{print $1}'
  fi
}

# Validate fixture JSON structure
validate_fixture() {
  local file="$1"
  local provider="$2"

  if ! python3 -m json.tool "$file" > /dev/null 2>&1; then
    log_error "Invalid JSON in $file"
    return 1
  fi

  # Check required fields
  local status
  status=$(python3 -c "import json; data=json.load(open('$file')); print(data.get('status', ''))")

  if [[ -z "$status" ]]; then
    log_error "Missing 'status' field in $file"
    return 1
  fi

  local headers
  headers=$(python3 -c "import json; data=json.load(open('$file')); print('headers' in data)")

  if [[ "$headers" != "True" ]]; then
    log_error "Missing 'headers' field in $file"
    return 1
  fi

  return 0
}

# Update manifest for a provider
update_manifest() {
  local provider="$1"
  local provider_dir="${FIXTURES_DIR}/${provider}"
  local manifest="${provider_dir}/manifest.json"

  if [[ ! -f "$manifest" ]]; then
    log_error "Manifest not found: $manifest"
    return 1
  fi

  log_info "Updating manifest for $provider..."

  # Get current timestamp
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Get current git branch
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  # Build new manifest content
  local temp_manifest="${provider_dir}/manifest.tmp.json"

  # Read existing manifest
  python3 << EOF
import json
import os

manifest_path = '${manifest}'
fixtures_dir = '${provider_dir}'

with open(manifest_path, 'r') as f:
    manifest = json.load(f)

# Update metadata
manifest['updated'] = '${timestamp}'
manifest['source_branch'] = '${branch}'

# Update fixture hashes
for fixture_entry in manifest.get('fixtures', []):
    fixture_file = fixture_entry['file']
    fixture_path = os.path.join(fixtures_dir, fixture_file)

    if os.path.exists(fixture_path):
        # Compute hash
        import hashlib
        with open(fixture_path, 'rb') as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()
        fixture_entry['hash'] = file_hash
    else:
        print(f"Warning: Fixture file not found: {fixture_file}", file=__import__('sys').stderr)

# Write updated manifest
with open('${temp_manifest}', 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
EOF

  if [[ $? -ne 0 ]]; then
    log_error "Failed to update manifest for $provider"
    return 1
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "DRY RUN: Would update $manifest"
    cat "$temp_manifest"
    rm -f "$temp_manifest"
  else
    mv "$temp_manifest" "$manifest"
    log_success "Updated $manifest"
  fi

  return 0
}

# Process fixtures for a provider
process_provider() {
  local provider="$1"
  local provider_dir="${FIXTURES_DIR}/${provider}"

  log_section "Processing $provider fixtures"

  if [[ ! -d "$provider_dir" ]]; then
    log_error "Provider directory not found: $provider_dir"
    return 1
  fi

  # Validate all fixture files
  local fixture_count=0
  local valid_count=0

  for fixture in "$provider_dir"/*.json; do
    if [[ "$(basename "$fixture")" == "manifest.json" ]]; then
      continue
    fi

    if [[ ! -f "$fixture" ]]; then
      continue
    fi

    fixture_count=$((fixture_count + 1))

    log_info "Validating $(basename "$fixture")..."

    if validate_fixture "$fixture" "$provider"; then
      valid_count=$((valid_count + 1))
      local hash
      hash=$(compute_hash "$fixture")
      log_success "✓ $(basename "$fixture") - Hash: ${hash:0:12}..."
    else
      log_warning "✗ $(basename "$fixture") - Validation failed"
    fi
  done

  if [[ $fixture_count -eq 0 ]]; then
    log_warning "No fixtures found in $provider_dir"
    return 0
  fi

  log_info "Validated $valid_count of $fixture_count fixtures"

  if [[ $valid_count -ne $fixture_count ]]; then
    log_error "Some fixtures failed validation"
    return 1
  fi

  # Update manifest
  update_manifest "$provider"

  return 0
}

# Main execution
main() {
  log_section "Fixture Update Tool"
  log_info "Repository: $REPO_ROOT"
  log_info "Fixtures Directory: $FIXTURES_DIR"
  log_info "Provider: $PROVIDER"
  log_info "Dry Run: $DRY_RUN"

  # Check prerequisites
  if ! command -v python3 &> /dev/null; then
    log_error "python3 is required but not found"
    exit 2
  fi

  if [[ ! -d "$FIXTURES_DIR" ]]; then
    log_error "Fixtures directory not found: $FIXTURES_DIR"
    exit 2
  fi

  # Process providers
  local exit_code=0

  if [[ "$PROVIDER" == "all" ]]; then
    for provider in github linear; do
      if ! process_provider "$provider"; then
        exit_code=1
      fi
    done
  else
    if ! process_provider "$PROVIDER"; then
      exit_code=1
    fi
  fi

  if [[ $exit_code -eq 0 ]]; then
    log_section "Fixture Update Summary"
    log_success "All fixtures updated successfully!"

    if [[ "$DRY_RUN" == "false" ]]; then
      echo ""
      echo "Next Steps:"
      echo "  1. Review updated manifest files"
      echo "  2. Run integration tests: npm run test tests/integration/github_linear_regression.spec.ts"
      echo "  3. Commit changes if tests pass"
      echo ""
    fi
  else
    log_error "Fixture update completed with errors"
  fi

  return $exit_code
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider)
      PROVIDER="$2"
      if [[ ! "$PROVIDER" =~ ^(github|linear|all)$ ]]; then
        log_error "Invalid provider: $PROVIDER (must be github, linear, or all)"
        exit 2
      fi
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      show_help
      exit 2
      ;;
  esac
done

# Execute main function
main "$@"
