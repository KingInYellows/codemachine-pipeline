# Validation Command Registry & Auto-Fix Loop Playbook

**Document Version:** 1.0.0
**Last Updated:** 2025-12-17
**Related ADRs:** ADR-7 (Validation Auto-Fix Loop), ADR-2 (State Persistence)
**Related FRs:** FR-14 (Validation Command Registry)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Validation Commands](#validation-commands)
4. [Auto-Fix Loop](#auto-fix-loop)
5. [CLI Usage](#cli-usage)
6. [Configuration](#configuration)
7. [Run Directory Structure](#run-directory-structure)
8. [Exit Codes](#exit-codes)
9. [Manual Overrides](#manual-overrides)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The Validation Command Registry provides a deterministic, auditable framework for executing code quality checks (lint, test, typecheck, build) with automatic retry and fix capabilities. This system implements ADR-7's validation auto-fix loop with bounded retries, ensuring that code changes meet quality standards before proceeding through the pipeline.

### Key Features

- **Configurable Command Registry**: Define validation commands in RepoConfig or use sensible defaults
- **Auto-Fix Retry Loop**: Automatically attempt fixes for commands that support it (e.g., `lint --fix`)
- **Bounded Retries**: Capped retry attempts with exponential backoff to prevent infinite loops
- **Audit Trail**: Complete logging of all attempts with stdout/stderr capture
- **Manual Re-runs**: CLI command for manual validation execution during development
- **Deterministic Execution**: All validation state persisted to run directory for resumability

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Validation System                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────┐            │
│  │  CLI Command     │         │ Execution Engine │            │
│  │  ai-feature      │────────▶│                  │            │
│  │  validate        │         │                  │            │
│  └──────────────────┘         └──────────────────┘            │
│           │                            │                       │
│           │                            │                       │
│           ▼                            ▼                       │
│  ┌──────────────────────────────────────────────┐             │
│  │         Validation Registry Service          │             │
│  │  - Load command configs from RepoConfig      │             │
│  │  - Track validation attempts                 │             │
│  │  - Maintain ledger with audit trail          │             │
│  └──────────────────────────────────────────────┘             │
│           │                                                    │
│           ▼                                                    │
│  ┌──────────────────────────────────────────────┐             │
│  │          Auto-Fix Engine                     │             │
│  │  - Execute commands with timeout             │             │
│  │  - Retry with backoff on failure             │             │
│  │  - Attempt auto-fix if supported             │             │
│  │  - Capture stdout/stderr                     │             │
│  │  - Summarize errors                          │             │
│  └──────────────────────────────────────────────┘             │
│           │                                                    │
│           ▼                                                    │
│  ┌──────────────────────────────────────────────┐             │
│  │         Run Directory Storage                │             │
│  │  validation/                                 │             │
│  │    ├── commands.json    (registry)           │             │
│  │    ├── ledger.json      (attempt history)    │             │
│  │    └── outputs/         (stdout/stderr)      │             │
│  └──────────────────────────────────────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Initialization**: Registry loaded from RepoConfig or defaults
2. **Command Selection**: User/automation selects which commands to run
3. **Execution Loop**: Auto-fix engine executes with retry/backoff
4. **Attempt Recording**: Each attempt logged to ledger with full context
5. **Result Aggregation**: Summary generated from all attempts
6. **Output**: JSON or human-readable results returned

---

## Validation Commands

### Command Types

The system supports four validation command types:

| Command Type | Purpose | Default Command | Supports Auto-Fix | Typical Timeout |
|--------------|---------|-----------------|-------------------|-----------------|
| `lint` | Code quality checks (ESLint) | `npm run lint` | ✓ (via `lint:fix`) | 60s |
| `typecheck` | TypeScript type checking | `npm run typecheck` | ✗ | 120s |
| `test` | Automated test suite | `npm run test` | ✗ | 180s |
| `build` | Production build verification | `npm run build` | ✗ | 120s |

### Command Configuration Schema

Each command configuration includes:

```typescript
{
  type: 'lint' | 'test' | 'typecheck' | 'build',
  command: string,              // Shell command to execute
  cwd: string,                  // Working directory (relative to repo root)
  env?: Record<string, string>, // Environment variables
  required: boolean,            // Whether required for pipeline success
  timeout_ms: number,           // Command timeout (1s - 10min)
  max_retries: number,          // Maximum retry attempts (0-10)
  backoff_ms: number,           // Backoff multiplier between retries
  supports_auto_fix: boolean,   // Whether command can auto-fix issues
  auto_fix_command?: string,    // Auto-fix variant (e.g., 'npm run lint:fix')
  description?: string          // Human-readable description
}
```

### Default Command Configurations

```json
[
  {
    "type": "lint",
    "command": "npm run lint",
    "description": "Run ESLint code quality checks",
    "required": true,
    "supports_auto_fix": true,
    "auto_fix_command": "npm run lint:fix",
    "timeout_ms": 60000,
    "max_retries": 2,
    "backoff_ms": 500,
    "cwd": "."
  },
  {
    "type": "typecheck",
    "command": "npm run typecheck",
    "description": "Run TypeScript type checking",
    "required": true,
    "supports_auto_fix": false,
    "timeout_ms": 120000,
    "max_retries": 1,
    "backoff_ms": 1000,
    "cwd": "."
  },
  {
    "type": "test",
    "command": "npm run test",
    "description": "Run automated test suite",
    "required": true,
    "supports_auto_fix": false,
    "timeout_ms": 180000,
    "max_retries": 2,
    "backoff_ms": 2000,
    "cwd": "."
  },
  {
    "type": "build",
    "command": "npm run build",
    "description": "Create production-ready build artifacts",
    "required": true,
    "supports_auto_fix": false,
    "timeout_ms": 180000,
    "max_retries": 1,
    "backoff_ms": 1000,
    "cwd": "."
  }
]
```

---

## Auto-Fix Loop

### Loop Algorithm

```
FOR each validation command:
  attempts = 0

  WHILE attempts < max_retries + 1:
    attempts++

    IF attempts > 1 AND supports_auto_fix:
      command = auto_fix_command
    ELSE:
      command = standard_command

    result = execute_command(command, timeout_ms)
    record_attempt(result)

    IF result.exit_code == 0:
      RETURN success

    IF attempts < max_retries + 1:
      backoff = backoff_ms * attempts
      sleep(backoff)

  RETURN failure (all attempts exhausted)
```

### Retry Strategy

- **Initial Attempt**: Standard command execution
- **Retry Attempts**: If initial attempt fails and auto-fix is supported, subsequent attempts use auto-fix variant
- **Backoff**: Linear backoff (backoff_ms × attempt_number)
- **Bounded**: Maximum attempts = `max_retries + 1` (initial + retries)
- **Exit on Success**: Loop terminates immediately upon successful execution

### Example Execution Timeline

Lint command with `max_retries: 2`:

```
Time 0ms:     Attempt 1 - Execute 'npm run lint'           → Exit code 1 (failed)
Time 500ms:   Attempt 2 - Execute 'npm run lint:fix'       → Exit code 1 (failed)
Time 1500ms:  Attempt 3 - Execute 'npm run lint:fix'       → Exit code 0 (success)
Result: SUCCESS after 3 attempts (1 initial + 2 retries)
```

---

## CLI Usage

### Initialize Validation Registry

Before first use, initialize the validation registry from your RepoConfig:

```bash
ai-feature validate --init
```

This reads your repository configuration and creates the validation registry in the current feature's run directory.

### Run All Validations

Execute all required validation commands:

```bash
ai-feature validate
```

### Run Specific Command

Execute a single validation command:

```bash
ai-feature validate --command lint
ai-feature validate --command test
ai-feature validate --command typecheck
ai-feature validate --command build
```

### Disable Auto-Fix

Run validations without attempting auto-fix:

```bash
ai-feature validate --no-auto-fix
```

### Override Retry Limits

Bypass configured retry limits (useful for manual debugging):

```bash
ai-feature validate --max-retries 5
```

### Override Timeout

Increase timeout for slow commands:

```bash
ai-feature validate --command test --timeout 600  # 600 seconds = 10 minutes
```

### Specify Feature

Validate a specific feature:

```bash
ai-feature validate --feature feature-auth-123
```

### JSON Output

Get machine-readable output for automation:

```bash
ai-feature validate --json
```

**JSON Output Schema:**

```json
{
  "feature_id": "feature-auth-123",
  "success": true,
  "total_attempts": 5,
  "auto_fix_successes": 1,
  "exceeded_retry_limits": [],
  "results": [
    {
      "command_type": "lint",
      "success": true,
      "exit_code": 0,
      "duration_ms": 3420,
      "attempt_number": 2,
      "auto_fix_attempted": true,
      "stdout_path": "validation/outputs/lint_abc123.stdout.txt",
      "stderr_path": "validation/outputs/lint_abc123.stderr.txt",
      "error_summary": null
    }
  ],
  "validation_summary": {
    "total_attempts": 12,
    "successful_attempts": 10,
    "failed_attempts": 2,
    "auto_fix_successes": 3,
    "last_updated": "2025-12-17T10:30:00Z"
  },
  "exit_code": 0
}
```

### Verbose Output

Show detailed execution logs:

```bash
ai-feature validate --verbose
```

---

## Configuration

### RepoConfig Integration

Validation commands are defined in `.ai-feature-pipeline/config.json` under the `validation` key. `ai-feature validate --init` ingests this section and persists the resolved commands (including template context and defaults) into the current run directory.

```json
{
  "validation": {
    "template_context": {
      "validation_branch": "feature/{{feature_id}}"
    },
    "commands": [
      {
        "type": "lint",
        "command": "npm run lint",
        "auto_fix_command": "npm run lint:fix",
        "required": true,
        "max_retries": 3,
        "timeout_ms": 90000
      },
      {
        "type": "custom_security_scan",
        "command": "npm run security:scan",
        "required": false,
        "max_retries": 1,
        "timeout_ms": 120000
      },
      {
        "type": "build",
        "command": "npm run build -- --mode=production",
        "required": true
      }
    ]
  }
}
```

**Field reference:**

- `validation.commands`: Array of validation command objects (shape matches the registry schema).
  - `type`, `command`, `cwd`, `env`, `required`, `timeout_ms`, `max_retries`, `backoff_ms`, `supports_auto_fix`, `auto_fix_command`, `description`.
  - `template_context`: Optional per-command template variables.
- `validation.template_context`: Optional global template variables merged into every command definition.

Any command omitted from the config inherits the default definition shown earlier, ensuring lint/test/typecheck/build are always available even if only a subset is overridden.

### Environment Variable Overrides

Commands can reference environment variables:

```json
{
  "type": "test",
  "command": "npm run test",
  "env": {
    "NODE_ENV": "test",
    "CI": "true"
  }
}
```

### Command Templating

Commands support lightweight templating via `{{token}}` placeholders. The auto-fix engine provides the following built-in tokens:

| Token | Value |
|-------|-------|
| `{{feature_id}}` | Current feature ID (run directory name) |
| `{{run_dir}}` | Absolute path to the feature run directory |
| `{{repo_root}}` | Absolute path to the git repository root |
| `{{command_cwd}}` | Fully resolved working directory for the command |

Define additional tokens in `validation.template_context` or per-command `template_context`. These custom values merge with the built-ins before rendering, enabling commands such as:

```json
{
  "type": "lint",
  "command": "npm run lint -- --branch {{validation_branch}}",
  "template_context": {
    "validation_branch": "feature/{{feature_id}}"
  }
}
```

---

## Run Directory Structure

Validation data is stored in the feature run directory:

```
.ai-feature-pipeline/runs/<feature-id>/
└── validation/
    ├── commands.json          # Registry of configured commands
    ├── ledger.json            # Complete attempt history
    └── outputs/               # Command outputs
        ├── lint_abc123.stdout.txt
        ├── lint_abc123.stderr.txt
        ├── test_def456.stdout.txt
        ├── test_def456.stderr.txt
        └── ...
```

### commands.json (Registry)

```json
{
  "schema_version": "1.0.0",
  "feature_id": "feature-auth-123",
  "commands": [
    {
      "type": "lint",
      "command": "npm run lint",
      "required": true,
      "supports_auto_fix": true,
      "auto_fix_command": "npm run lint:fix",
      "timeout_ms": 60000,
      "max_retries": 2,
      "backoff_ms": 500,
      "cwd": "."
    }
  ],
  "metadata": {
    "updated_at": "2025-12-17T10:00:00Z",
    "config_hash": "sha256:abc123..."
  }
}
```

### ledger.json (Attempt History)

```json
{
  "schema_version": "1.0.0",
  "feature_id": "feature-auth-123",
  "attempts": [
    {
      "attempt_id": "xyz789-abc123",
      "command_type": "lint",
      "attempt_number": 1,
      "exit_code": 1,
      "started_at": "2025-12-17T10:15:00Z",
      "completed_at": "2025-12-17T10:15:03Z",
      "duration_ms": 3200,
      "auto_fix_attempted": false,
      "stdout_path": "validation/outputs/lint_xyz789.stdout.txt",
      "stderr_path": "validation/outputs/lint_xyz789.stderr.txt",
      "error_summary": "error  'useState' is defined but never used  @typescript-eslint/no-unused-vars",
      "metadata": {
        "command": "npm run lint",
        "cwd": "/path/to/repo",
        "timeout_ms": 60000
      }
    }
  ],
  "summary": {
    "total_attempts": 12,
    "successful_attempts": 10,
    "failed_attempts": 2,
    "auto_fix_successes": 3,
    "last_updated": "2025-12-17T10:30:00Z"
  }
}
```

---

## Exit Codes

The `ai-feature validate` command uses the following exit codes:

| Exit Code | Meaning | Automation Action |
|-----------|---------|-------------------|
| **0** | All validations passed | ✓ Proceed with pipeline (e.g., create PR) |
| **1** | General error (config/setup) | ✗ Fix configuration, then retry |
| **10** | Validation failed (recoverable) | ⚠ Review errors, fix code, then retry |
| **11** | Retry limit exceeded | ⚠ Manual intervention required; review logs and fix root cause |

### Usage in CI/CD

```bash
# Fail pipeline if validations don't pass
ai-feature validate --json || exit $?

# Conditional logic based on exit code
ai-feature validate --json
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ Validations passed - creating PR"
  ai-feature pr
elif [ $EXIT_CODE -eq 10 ]; then
  echo "⚠ Validations failed - please fix code quality issues"
  exit 1
elif [ $EXIT_CODE -eq 11 ]; then
  echo "✗ Retry limits exceeded - manual intervention required"
  exit 1
else
  echo "✗ Configuration error"
  exit 1
fi
```

---

## Manual Overrides

### Skip Specific Commands

Prefer editing `.ai-feature-pipeline/config.json` (`validation.commands`) and rerunning `ai-feature validate --init` to change which commands are required. Each command can set `required: false`, tweak retries, or adjust timeouts.

For one-off overrides without touching config history:

1. Temporarily edit `.ai-feature-pipeline/runs/<feature-id>/validation/commands.json` to set `required: false`
2. Re-run validation

**Example:**

```bash
# Edit registry (advanced users only)
vi .ai-feature-pipeline/runs/<feature-id>/validation/commands.json

# Set test.required = false
# Then re-run
ai-feature validate
```

### Force Re-run After Retry Limit

If retry limits are exceeded and you've fixed the underlying issue:

```bash
# Clear ledger (resets attempt counts)
rm .ai-feature-pipeline/runs/<feature-id>/validation/ledger.json

# Re-run validation
ai-feature validate
```

**OR** use `--max-retries` override:

```bash
ai-feature validate --max-retries 10
```

For a permanent change, increase `max_retries` inside `.ai-feature-pipeline/config.json` and run `ai-feature validate --init` so the registry picks up the new ceiling.

### Debugging Command Failures

View full stdout/stderr output:

```bash
cat .ai-feature-pipeline/runs/<feature-id>/validation/outputs/lint_abc123.stderr.txt
```

View attempt history:

```bash
cat .ai-feature-pipeline/runs/<feature-id>/validation/ledger.json | jq '.attempts'
```

---

## Troubleshooting

### Problem: "Validation registry not found"

**Cause:** Registry hasn't been initialized for this feature.

**Solution:**
```bash
ai-feature validate --init
```

---

### Problem: "Retry limit exceeded"

**Cause:** Command has failed more than `max_retries + 1` times.

**Solution:**
1. Review error summary in CLI output
2. Inspect stderr: `cat .ai-feature-pipeline/runs/<feature-id>/validation/outputs/<command>_*.stderr.txt`
3. Fix underlying code issue
4. Clear ledger or use `--max-retries` override:
   ```bash
   ai-feature validate --max-retries 5
   ```

---

### Problem: "Command timed out"

**Cause:** Command execution exceeded configured timeout.

**Solution:**
1. Check if timeout is too short for your environment
2. Override timeout:
   ```bash
   ai-feature validate --command test --timeout 600
   ```
3. Update command configuration in registry (edit `commands.json`)

---

### Problem: "Auto-fix not working"

**Cause:** Either command doesn't support auto-fix or `--no-auto-fix` flag is set.

**Solution:**
1. Verify command configuration has `supports_auto_fix: true`
2. Ensure `auto_fix_command` is specified
3. Don't use `--no-auto-fix` flag
4. Check that auto-fix command exists in `package.json` scripts

---

### Problem: "Validation passed locally but fails in CI"

**Cause:** Environment differences (dependencies, Node version, etc.)

**Solution:**
1. Ensure CI uses same Node version (`engines` in `package.json`)
2. Verify dependencies are locked (`package-lock.json` committed)
3. Check for environment-specific config (`.env` files)
4. Run with `--verbose` to compare outputs

---

### Problem: "Want to add custom validation command"

**Cause:** Default commands don't cover your needs (e.g., security scans).

**Solution (Future):**
Add custom command to RepoConfig `validation.commands` array. For now, manually edit `validation/commands.json` after initialization.

---

## Best Practices

1. **Initialize Early**: Run `ai-feature validate --init` when starting a new feature
2. **Use Auto-Fix**: Let the system automatically fix simple issues (e.g., formatting)
3. **Monitor Retries**: If commands frequently exceed retry limits, adjust `max_retries` or fix flaky tests
4. **Review Ledgers**: Periodically inspect `ledger.json` to identify patterns in validation failures
5. **Tune Timeouts**: Adjust timeouts based on your environment (CI may need longer timeouts)
6. **JSON Mode in CI**: Always use `--json` in automation for consistent parsing
7. **Gate PRs**: Use exit code 0 as requirement for PR creation

---

## Related Documentation

- **ADR-7**: Validation Auto-Fix Loop (architecture decisions)
- **FR-14**: Validation Command Registry (functional requirements)
- **Run Directory Schema**: `.ai-feature-pipeline/runs/` structure
- **RepoConfig Schema**: Configuration reference

---

## Changelog

### 1.0.0 (2025-12-17)

- Initial validation playbook
- Documented CLI usage and exit codes
- Added troubleshooting guide
- Defined auto-fix loop algorithm
