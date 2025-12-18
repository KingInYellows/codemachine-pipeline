#!/usr/bin/env bash
# smoke_execution.sh - End-to-end smoke test runner for AI feature pipeline
#
# This script executes the complete smoke test suite covering:
# - Context gathering
# - PRD generation
# - Spec generation
# - Plan generation
# - Patch application
# - Validation execution
# - Resume workflows
#
# Exit codes:
#   0 - All smoke tests passed
#   1 - Smoke tests failed
#   2 - Setup/configuration error

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SMOKE_OUTPUT_DIR="${SMOKE_OUTPUT_DIR:-${REPO_ROOT}/.smoke-test-output}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="${SMOKE_OUTPUT_DIR}/run_${TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Cleanup function
cleanup() {
  local exit_code=$?
  if [ ${exit_code} -ne 0 ]; then
    log_error "Smoke tests failed with exit code ${exit_code}"
    log_info "Test artifacts preserved in: ${RUN_DIR}"
  fi
}

trap cleanup EXIT

# Main execution
main() {
  log_section "AI Feature Pipeline - Smoke Test Suite"
  log_info "Timestamp: ${TIMESTAMP}"
  log_info "Repository: ${REPO_ROOT}"
  log_info "Output Directory: ${RUN_DIR}"

  # Step 1: Setup
  log_section "Step 1: Environment Setup"
  setup_environment

  # Step 2: Pre-flight checks
  log_section "Step 2: Pre-flight Checks"
  preflight_checks

  # Step 3: Run smoke tests
  log_section "Step 3: Execute Smoke Test Suite"
  run_smoke_tests

  # Step 4: Collect results
  log_section "Step 4: Collect and Verify Results"
  collect_results

  # Step 5: Summary
  log_section "Smoke Test Summary"
  print_summary

  log_success "All smoke tests passed successfully!"
  return 0
}

setup_environment() {
  log_info "Creating output directory..."
  mkdir -p "${RUN_DIR}"

  log_info "Copying test fixtures..."
  if [ ! -d "${REPO_ROOT}/tests/fixtures/sample_repo" ]; then
    log_error "Fixture repository not found at tests/fixtures/sample_repo"
    exit 2
  fi

  log_info "Verifying Node.js version..."
  local node_version
  node_version="$(node --version)"
  log_info "Node.js version: ${node_version}"

  log_info "Verifying npm packages..."
  if [ ! -d "${REPO_ROOT}/node_modules" ]; then
    log_warning "node_modules not found. Run 'npm install' first."
    exit 2
  fi

  log_success "Environment setup complete"
}

preflight_checks() {
  log_info "Checking repository structure..."

  local required_dirs=(
    "src"
    "tests"
    "tests/integration"
    "tests/fixtures"
    "bin"
  )

  for dir in "${required_dirs[@]}"; do
    if [ ! -d "${REPO_ROOT}/${dir}" ]; then
      log_error "Required directory not found: ${dir}"
      exit 2
    fi
  done

  log_info "Checking required files..."
  local required_files=(
    "package.json"
    "tsconfig.json"
    "bin/run.js"
    "tests/integration/smoke_execution.spec.ts"
  )

  for file in "${required_files[@]}"; do
    if [ ! -f "${REPO_ROOT}/${file}" ]; then
      log_error "Required file not found: ${file}"
      exit 2
    fi
  done

  log_info "Checking build artifacts..."
  if [ ! -d "${REPO_ROOT}/dist" ]; then
    log_warning "dist/ directory not found. Building project..."
    cd "${REPO_ROOT}"
    npm run build || {
      log_error "Build failed"
      exit 2
    }
  fi

  log_success "Pre-flight checks passed"
}

run_smoke_tests() {
  log_info "Running vitest smoke test suite..."

  cd "${REPO_ROOT}"

  # Run smoke tests with output capture
  local test_output="${RUN_DIR}/test_output.log"
  local test_json="${RUN_DIR}/test_results.json"

  log_info "Test output will be saved to: ${test_output}"

  # Run the smoke test suite
  if npm run test:smoke -- --reporter=verbose --reporter=json --outputFile="${test_json}" 2>&1 | tee "${test_output}"; then
    log_success "Smoke test suite completed successfully"
    return 0
  else
    local exit_code=$?
    log_error "Smoke test suite failed with exit code ${exit_code}"
    log_info "Check output at: ${test_output}"
    return ${exit_code}
  fi
}

collect_results() {
  log_info "Collecting test artifacts..."

  # Copy test output
  if [ -f "${REPO_ROOT}/test-results.json" ]; then
    cp "${REPO_ROOT}/test-results.json" "${RUN_DIR}/" || true
  fi

  # Create result summary
  local summary_file="${RUN_DIR}/summary.txt"
  {
    echo "Smoke Test Execution Summary"
    echo "============================"
    echo ""
    echo "Timestamp: ${TIMESTAMP}"
    echo "Repository: ${REPO_ROOT}"
    echo "Node Version: $(node --version)"
    echo "npm Version: $(npm --version)"
    echo ""
    echo "Test Suite: smoke_execution.spec.ts"
    echo ""
    echo "Output Files:"
    echo "  - test_output.log"
    echo "  - test_results.json"
    echo "  - summary.txt (this file)"
    echo ""
  } > "${summary_file}"

  log_info "Summary written to: ${summary_file}"

  # Verify critical artifacts exist
  log_info "Verifying test artifacts..."
  if [ -f "${RUN_DIR}/test_output.log" ]; then
    local test_count
    test_count=$(grep -c "✓" "${RUN_DIR}/test_output.log" || echo "0")
    log_info "Tests passed: ${test_count}"
  fi

  log_success "Results collected successfully"
}

print_summary() {
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║     SMOKE TEST SUITE COMPLETED         ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
  echo ""
  echo "Timestamp:     ${TIMESTAMP}"
  echo "Output Dir:    ${RUN_DIR}"
  echo "Status:        ${GREEN}PASSED${NC}"
  echo ""
  echo "Next Steps:"
  echo "  1. Review test output: ${RUN_DIR}/test_output.log"
  echo "  2. Check test results: ${RUN_DIR}/test_results.json"
  echo "  3. View summary:       ${RUN_DIR}/summary.txt"
  echo ""
}

# Help text
show_help() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

End-to-end smoke test runner for AI feature pipeline.

OPTIONS:
  -h, --help              Show this help message
  -o, --output-dir DIR    Specify output directory (default: .smoke-test-output)
  -v, --verbose           Enable verbose output
  -k, --keep-artifacts    Preserve all test artifacts (default: yes)

ENVIRONMENT VARIABLES:
  SMOKE_OUTPUT_DIR        Override default output directory

EXAMPLES:
  # Run smoke tests with default settings
  ./scripts/tooling/smoke_execution.sh

  # Run with custom output directory
  ./scripts/tooling/smoke_execution.sh --output-dir /tmp/smoke

  # Run with verbose output
  ./scripts/tooling/smoke_execution.sh --verbose

EXIT CODES:
  0   All smoke tests passed
  1   Smoke tests failed
  2   Setup/configuration error

For more information, see: docs/ops/smoke_test_guide.md
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      show_help
      exit 0
      ;;
    -o|--output-dir)
      SMOKE_OUTPUT_DIR="$2"
      RUN_DIR="${SMOKE_OUTPUT_DIR}/run_${TIMESTAMP}"
      shift 2
      ;;
    -v|--verbose)
      set -x
      shift
      ;;
    -k|--keep-artifacts)
      # Already the default behavior
      shift
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
