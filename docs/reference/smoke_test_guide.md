# Smoke Test Execution Guide

**Document Version:** 1.0.0
**Last Updated:** 2025-12-17
**Related Tasks:** I3.T8
**Related ADRs:** ADR-7 (Validation), ADR-2 (State Persistence)

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Running Smoke Tests](#running-smoke-tests)
4. [Test Coverage](#test-coverage)
5. [Interpreting Results](#interpreting-results)
6. [Troubleshooting](#troubleshooting)
7. [CI/CD Integration](#cicd-integration)
8. [Maintenance](#maintenance)

---

## Overview

The smoke test suite validates the complete AI feature pipeline execution workflow from end to end. These tests ensure that all critical paths through the system work correctly and that state persistence, resume capabilities, and validation mechanisms function as designed.

### Purpose

Smoke tests serve as:

- **Regression Prevention**: Catch breaking changes before they reach production
- **Integration Validation**: Verify all components work together correctly
- **Reproducibility Verification**: Confirm deterministic execution across environments
- **Documentation**: Demonstrate expected system behavior through executable examples

### Scope

The smoke test suite covers:

1. **Context → PRD → Spec → Plan → Patch → Validation Flow**: Complete happy path execution
2. **Resume Workflows**: Crash recovery, approval gates, queue restoration
3. **Validation Execution**: Command registry, auto-fix loops, retry logic
4. **Patch Application**: Git safety rails, diff generation, metadata tracking
5. **Export Bundles**: Artifact collection, diff summaries, hash manifests
6. **Run Directory Recovery**: State verification, integrity checks

---

## Prerequisites

### System Requirements

- **Node.js**: v24.0.0 or higher (as specified in `package.json`)
- **npm**: Latest stable version
- **Operating System**: Linux, macOS, or WSL2 on Windows
- **Disk Space**: ~100MB for test artifacts and outputs

### Installation

Before running smoke tests, ensure the project is properly set up:

```bash
# Clone repository
git clone https://github.com/KingInYellows/codemachine-pipeline.git
cd codemachine-pipeline

# Install dependencies
npm install

# Build project
npm run build

# Verify build
ls -la dist/
```

### Verification

Check that all required components are present:

```bash
# Verify test files exist
ls -la tests/integration/smoke_execution.spec.ts
ls -la tests/fixtures/sample_repo/

# Verify shell script exists
ls -la scripts/tooling/smoke_execution.sh

# Verify binary exists
ls -la bin/run.js
```

---

## Running Smoke Tests

### Method 1: Using npm Script (Recommended)

The easiest way to run smoke tests is via the npm script:

```bash
npm run test:smoke
```

This command:

- Runs the vitest smoke test suite
- Generates test reports
- Outputs results to console
- Returns appropriate exit codes for CI/CD

**Expected Output:**

```
 ✓ tests/integration/smoke_execution.spec.ts (8)
   ✓ Smoke Test: Execution Flow Integration (8)
     ✓ Scenario: Complete Happy Path Execution (1)
       ✓ should execute full workflow: context → PRD → spec → plan → patch → validate
     ✓ Scenario: Resume After Crash (2)
       ✓ should resume execution after unexpected interruption
       ✓ should handle approval gate during resume
     ✓ Scenario: Validation Command Execution (1)
       ✓ should execute validation commands and record results
     ✓ Scenario: Patch Application with Git Safety (1)
       ✓ should validate patch before application
     ✓ Scenario: Export Bundle with Diff Summaries (1)
       ✓ should create export bundle containing all artifacts and diffs
     ✓ Scenario: Run Directory Recovery (1)
       ✓ should verify all required artifacts present for recovery

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  12:00:00
   Duration  2.45s
```

### Method 2: Using Shell Script

For local development with detailed logging:

```bash
./scripts/tooling/smoke_execution.sh
```

**Options:**

```bash
# Show help
./scripts/tooling/smoke_execution.sh --help

# Custom output directory
./scripts/tooling/smoke_execution.sh --output-dir /tmp/smoke-tests

# Verbose mode
./scripts/tooling/smoke_execution.sh --verbose
```

**Output Structure:**

```
.smoke-test-output/
└── run_20251217_120000/
    ├── test_output.log      # Complete test output
    ├── test_results.json    # Structured test results
    └── summary.txt          # Execution summary
```

### Method 3: Direct Vitest Execution

For debugging individual test scenarios:

```bash
# Run specific test file
npx vitest run tests/integration/smoke_execution.spec.ts

# Run with UI
npx vitest --ui tests/integration/smoke_execution.spec.ts

# Run specific scenario
npx vitest run tests/integration/smoke_execution.spec.ts -t "Complete Happy Path"

# Watch mode for development
npx vitest watch tests/integration/smoke_execution.spec.ts
```

---

## Test Coverage

### Scenario 1: Complete Happy Path Execution

**What it tests:**

- Full workflow from context gathering through validation
- Artifact creation and persistence
- Queue management and task progression
- Hash manifest generation
- Run directory structure

**Key assertions:**

- All artifacts created with correct content
- Queue state transitions correctly
- Hash manifest includes all tracked files
- Next task selection respects dependencies

**Files verified:**

- `artifacts/context.json`
- `artifacts/prd.md`
- `artifacts/spec.md`
- `artifacts/plan.json`
- `patches/*.patch`
- `validation/ledger.json`
- `hash_manifest.json`

### Scenario 2: Resume After Crash

**What it tests:**

- Crash detection and recovery
- Queue restoration from disk
- Resume state analysis
- Approval gate integration

**Key assertions:**

- Resume coordinator identifies crash correctly
- Queue state matches pre-crash state
- Next task determined correctly
- Approval requirements block resume appropriately

**Failure modes tested:**

- Unexpected interruption (status: in_progress)
- Pending approvals (status: paused)
- Recoverable errors

### Scenario 3: Validation Command Execution

**What it tests:**

- Validation registry loading
- Command execution
- Result recording
- Ledger persistence

**Key assertions:**

- Commands execute with correct configuration
- Exit codes captured accurately
- Stdout/stderr saved to outputs directory
- Ledger summary matches individual attempts

**Commands validated:**

- `lint` with auto-fix support
- `test` without auto-fix
- Custom validation commands

### Scenario 4: Patch Application with Git Safety

**What it tests:**

- Patch format validation
- Metadata tracking
- File modification recording

**Key assertions:**

- Patch contains valid diff format
- Metadata includes all required fields
- Files modified list is accurate

**Safety rails verified:**

- Patch format validation
- File allowlist enforcement (conceptual)
- Metadata completeness

### Scenario 5: Export Bundle with Diff Summaries

**What it tests:**

- Export bundle creation
- Artifact collection
- Diff summary generation

**Key assertions:**

- Bundle includes all artifacts
- Diff summary contains file lists
- Export format matches schema

**Artifacts included:**

- Context, PRD, Spec, Plan
- Patches and metadata
- Validation results
- Hash manifest

### Scenario 6: Run Directory Recovery

**What it tests:**

- Recovery readiness verification
- Required artifact presence
- State consistency

**Key assertions:**

- Manifest exists and is valid
- Queue directory exists
- Hash manifest present
- Artifacts directory populated

**Recovery criteria:**

- All critical files present
- Manifests not corrupted
- Queue structure valid

---

## Interpreting Results

### Success Indicators

**All tests passing:**

```
✓ tests/integration/smoke_execution.spec.ts (8)
Test Files  1 passed (1)
Tests  8 passed (8)
```

**What this means:**

- All execution paths work correctly
- State persistence is reliable
- Resume capabilities function
- Validation framework operational

**Next steps:**

- Proceed with feature development
- Merge PR if in CI pipeline
- No action required

### Failure Indicators

**Test failures:**

```
✗ tests/integration/smoke_execution.spec.ts (8)
  ✗ Scenario: Complete Happy Path Execution
    ✗ should execute full workflow...
      AssertionError: Expected file to exist: artifacts/spec.md
```

**What to check:**

1. **Error message**: Read the assertion failure details
2. **Stack trace**: Identify which operation failed
3. **Test output**: Review logs for context
4. **Artifacts**: Inspect run directory if preserved

**Common failure causes:**

| Error Pattern                      | Likely Cause                    | Remediation                               |
| ---------------------------------- | ------------------------------- | ----------------------------------------- |
| "File not found: artifacts/..."    | Artifact creation failed        | Check file creation logic in test helpers |
| "Queue validation failed"          | Queue corruption                | Verify queue append/update operations     |
| "Hash mismatch"                    | Artifact modified after hashing | Check hash generation timing              |
| "Cannot resume: pending approvals" | Approval not cleared            | Verify approval completion logic          |
| "Command execution failed"         | Validation command error        | Check command configuration               |

### Exit Codes

The smoke test suite uses standard test runner exit codes:

| Exit Code | Meaning                   | Action                 |
| --------- | ------------------------- | ---------------------- |
| 0         | All tests passed          | ✓ Proceed              |
| 1         | One or more tests failed  | ✗ Fix failures, re-run |
| 2         | Configuration/setup error | ✗ Check environment    |

### Detailed Logs

For detailed test execution logs:

```bash
# Run with reporter output
npm run test:smoke -- --reporter=verbose

# Save to file
npm run test:smoke -- --reporter=verbose > smoke-test.log 2>&1

# Use shell script (includes detailed logging)
./scripts/tooling/smoke_execution.sh
```

**Log locations:**

- **npm script**: Console output only
- **Shell script**: `.smoke-test-output/run_*/test_output.log`

---

## Troubleshooting

### Problem: "Cannot find module 'xxx'"

**Cause:** Dependencies not installed or build artifacts missing

**Solution:**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild project
npm run clean
npm run build

# Re-run tests
npm run test:smoke
```

---

### Problem: "Fixture repository not found"

**Cause:** Test fixtures missing or corrupted

**Solution:**

```bash
# Verify fixture exists
ls -la tests/fixtures/sample_repo/

# If missing, check git status
git status tests/fixtures/

# Restore from git if accidentally deleted
git checkout tests/fixtures/sample_repo/
```

---

### Problem: Tests timeout

**Cause:** Long-running operations or resource constraints

**Solution:**

```bash
# Increase vitest timeout
npx vitest run tests/integration/smoke_execution.spec.ts --testTimeout=60000

# Check system resources
htop  # or top

# Close resource-intensive applications
```

---

### Problem: "Permission denied" on shell script

**Cause:** Execute permission not set

**Solution:**

```bash
chmod +x scripts/tooling/smoke_execution.sh
./scripts/tooling/smoke_execution.sh
```

---

### Problem: Intermittent failures

**Cause:** Race conditions or non-deterministic behavior

**Solution:**

```bash
# Run tests multiple times to identify flakiness
for i in {1..5}; do
  echo "Run $i"
  npm run test:smoke || echo "Failed on run $i"
done

# Report flakiness to team with reproduction steps
```

---

### Problem: "Build failed" during pre-flight checks

**Cause:** TypeScript compilation errors

**Solution:**

```bash
# Run TypeScript compiler directly
npm run build

# Check for errors
npx tsc --noEmit

# Fix reported errors, then rebuild
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Smoke Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  smoke-tests:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build project
        run: npm run build

      - name: Run smoke tests
        run: npm run test:smoke

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: smoke-test-results
          path: |
            .smoke-test-output/
            test-results.json
```

### GitLab CI

```yaml
smoke-tests:
  stage: test
  image: node:24
  script:
    - npm ci
    - npm run build
    - npm run test:smoke
  artifacts:
    when: always
    paths:
      - .smoke-test-output/
      - test-results.json
    reports:
      junit: test-results.xml
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-push

echo "Running smoke tests before push..."
npm run test:smoke

if [ $? -ne 0 ]; then
  echo "❌ Smoke tests failed. Push aborted."
  exit 1
fi

echo "✓ Smoke tests passed"
```

---

## Maintenance

### Updating Fixtures

When repository structure changes, update test fixtures:

```bash
# Edit fixture config
vi tests/fixtures/sample_repo/.codepipe/config.json

# Add new fixture files
touch tests/fixtures/sample_repo/src/new_module.ts

# Update fixture README
vi tests/fixtures/sample_repo/README.md

# Verify fixtures still work
npm run test:smoke
```

### Adding New Test Scenarios

To add new smoke test scenarios:

1. **Identify the scenario**: What workflow needs testing?
2. **Add test case**: Edit `tests/integration/smoke_execution.spec.ts`
3. **Create helpers**: Add helper functions if needed
4. **Document**: Update this guide with new scenario details
5. **Verify**: Run smoke tests to ensure new scenario works

**Example:**

```typescript
describe('Scenario: New Feature Workflow', () => {
  it('should handle new feature correctly', async () => {
    // Setup
    const artifact = await createNewArtifact(runDir);

    // Execute
    const result = await processNewWorkflow(artifact);

    // Assert
    expect(result.success).toBe(true);
  });
});
```

### Monitoring Test Performance

Track smoke test execution time:

```bash
# Run with timing
time npm run test:smoke

# Check historical trends
git log --all --grep="smoke test" --oneline
```

**Performance targets:**

- Total suite: < 5 seconds
- Individual scenario: < 1 second
- Setup/teardown: < 500ms

If tests slow down significantly, investigate:

- Excessive file I/O
- Synchronous operations
- Large artifact generation

---

## Best Practices

1. **Run Before Committing**: Always run smoke tests before pushing changes
2. **Keep Fixtures Minimal**: Fixture repo should be small and fast to set up
3. **Test One Thing**: Each scenario should validate a single workflow
4. **Clean Up**: Tests should clean up temporary files in `afterEach`
5. **Deterministic**: Tests should produce same results every run
6. **Fast**: Optimize for quick feedback (target < 5s total)
7. **Informative**: Failure messages should clearly indicate what broke

---

## Related Documentation

- **Task Specification**: `.codemachine/artifacts/plan/02_Iteration_I3.md` (Task I3.T8)
- **Validation Playbook**: `docs/playbooks/validation_playbook.md`
- **Resume Coordinator**: Integration test patterns in `tests/integration/resume_flow.spec.ts`
- **CLI Surface Tests**: `tests/integration/cli_status_plan.spec.ts`
- **Architecture**: `.codemachine/artifacts/architecture/04_Operational_Architecture.md`

---

## Changelog

### 1.0.0 (2025-12-17)

- Initial smoke test guide
- Documented all test scenarios
- Added troubleshooting section
- Included CI/CD integration examples
- Created maintenance guidelines
