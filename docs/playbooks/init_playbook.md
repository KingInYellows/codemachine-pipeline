# Init Command Playbook

## Overview

The `codepipe init` command initializes the codemachine-pipeline in a repository by:
- Detecting the git repository root
- Creating the `.codepipe/` directory structure
- Generating a schema-validated `config.json` with defaults
- Validating credentials and environment setup
- Recording initialization telemetry

This playbook documents exact command usage, approval workflows, and operational considerations for CI/homelab operators.

---

## Prerequisites

Before running `codepipe init`, ensure:

1. **Git Repository**: Current directory must be within a git repository
2. **Node.js**: v24 LTS or higher (required)
3. **Filesystem Permissions**: Write access to create `.codepipe/` directory
4. **Environment Variables** (optional but recommended):
   - `GITHUB_TOKEN` - GitHub Personal Access Token with `repo`, `workflow` scopes
   - `LINEAR_API_KEY` - Linear API key for issue tracking integration
   - `AGENT_ENDPOINT` - URL of agent service endpoint

---

## Command Synopsis

```bash
codepipe init [FLAGS]
```

### Flags

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--force` | `-f` | Force re-initialization even if config exists | `false` |
| `--validate-only` | | Only validate existing config without creating files | `false` |
| `--dry-run` | | Compute config and validation without writing files | `false` |
| `--json` | | Output results in JSON format | `false` |
| `--yes` | `-y` | Skip interactive confirmations (assume yes) | `false` |

---

## Usage Examples

### Standard Initialization

Initialize with interactive prompts:

```bash
codepipe init
```

**Output:**
```
✓ Git repository detected at: /path/to/repo
✓ Created directory: .codepipe
✓ Created directory: .codepipe/runs
✓ Created directory: .codepipe/logs
✓ Created directory: .codepipe/artifacts
✓ Created configuration file: .codepipe/config.json

⚠ Configuration created with warnings:
⚠ GitHub integration enabled but GITHUB_TOKEN not set. Set GITHUB_TOKEN with scopes: repo, workflow
⚠ Linear integration enabled but LINEAR_API_KEY not set
⚠ Agent endpoint not configured. Set AGENT_ENDPOINT or add runtime.agent_endpoint to config

✓ codemachine-pipeline initialized successfully!

Configuration file: .codepipe/config.json

Next steps:
  • Review and edit: .codepipe/config.json
  • Enable integrations and set credentials (GITHUB_TOKEN, LINEAR_API_KEY, AGENT_ENDPOINT)
  • Validate configuration: codepipe init --validate-only
  • Check environment: codepipe doctor
  • Start a feature: codepipe start --prompt "your feature description"
```

### Non-Interactive Initialization (CI/Automation)

Skip confirmations for automated workflows:

```bash
codepipe init --yes
```

### Dry Run (Test Without Changes)

Preview what would be created without writing files:

```bash
codepipe init --dry-run --json
```

**JSON Output:**
```json
{
  "status": "dry_run_success",
  "config_path": "/path/to/repo/.codepipe/config.json",
  "exit_code": 0,
  "config": {
    "schema_version": "1.0.0",
    "project": {
      "id": "repo-name",
      "repo_url": "https://github.com/org/repo.git",
      ...
    },
    ...
  },
  "warnings": [
    "GitHub integration enabled but GITHUB_TOKEN not set. Set GITHUB_TOKEN with scopes: repo, workflow",
    "Linear integration enabled but LINEAR_API_KEY not set",
    "Agent endpoint not configured. Set AGENT_ENDPOINT or add runtime.agent_endpoint to config"
  ],
  "manifest_schema_doc": "docs/requirements/run_directory_schema.md",
  "readiness_checklist": "plan/readiness_checklist.md",
  "next_steps": [
    "Review and edit: .codepipe/config.json",
    "Enable integrations and set credentials (GITHUB_TOKEN, LINEAR_API_KEY, AGENT_ENDPOINT)",
    "Validate configuration: codepipe init --validate-only",
    "Check environment: codepipe doctor",
    "Start a feature: codepipe start --prompt \"your feature description\""
  ]
}
```

### Force Re-initialization

Overwrite existing configuration:

```bash
codepipe init --force
```

⚠ **Warning:** This will replace your existing `config.json`. Back up custom settings first.

### Validate Existing Configuration

Check configuration validity without modifying files:

```bash
codepipe init --validate-only
```

**Output (Success):**
```
Validating existing configuration...
✓ Configuration is valid

Configuration Summary:
  Schema Version: 1.0.0
  Project ID: repo-name
  Default Branch: main
  GitHub Integration: disabled
  Linear Integration: disabled
  Context Token Budget: 32000
  Max Concurrent Tasks: 3
```

**Output (Failure):**
```
Validating existing configuration...

❌ Configuration validation failed:

  • schema_version: Invalid schema version format (must be semver)
    → Use semver format: "1.0.0"
  • project.repo_url: Invalid repository URL format
    → Use format: "https://github.com/org/repo.git" or "git@github.com:org/repo.git"

For detailed schema documentation, see:
  docs/requirements/RepoConfig_schema.md
  .codepipe/templates/config.example.json
```

---

## Exit Codes

The `init` command uses standardized exit codes for automation and CI integration:

| Exit Code | Meaning | Description | Remediation |
|-----------|---------|-------------|-------------|
| `0` | Success | Initialization completed successfully | None |
| `10` | Validation Error | Config schema validation failed or missing required fields | Review error messages; check schema documentation |
| `20` | Environment Issue | Missing tools, version mismatches, or filesystem permission errors | Install required tools; check permissions; run `codepipe doctor` |
| `30` | Credential Issue | Missing tokens or invalid API credentials | Set required environment variables (GITHUB_TOKEN, LINEAR_API_KEY, etc.) |

### Exit Code Examples

**Validation Error (10):**
```bash
codepipe init --validate-only
# Exit code: 10
# Reason: config.json has schema errors
```

**Environment Issue (20):**
```bash
cd /read-only-filesystem && codepipe init
# Exit code: 20
# Reason: Cannot create .codepipe directory
```

**Credential Issue (30):**
```bash
# Currently, init only warns about missing credentials (exit 0)
# Exit code 30 reserved for future strict credential validation
```

---

## Approval Workflow (ADR-5)

The `init` command creates configuration with governance controls per ADR-5. By default:

1. **Config Generation**: Creates `config.json` with `governance.approval_workflow` settings
2. **Default Approvals**: All workflow gates enabled (PRD, Spec, Plan, Code, PR, Deploy)
3. **Human-in-the-Loop**: Operators must review and approve at each gate
4. **Audit Trail**: Approval records stored in run directories (`approvals.json`)

### Approval Settings in Generated Config

```json
{
  "governance": {
    "approval_workflow": {
      "require_approval_for_prd": true,
      "require_approval_for_spec": true,
      "require_approval_for_plan": true,
      "require_approval_for_code": true,
      "require_approval_for_pr": true,
      "require_approval_for_deploy": true
    },
    "accountability": {
      "record_approver_identity": true,
      "require_approval_reason": false,
      "audit_log_retention_days": 365
    },
    "risk_controls": {
      "prevent_auto_merge": true,
      "prevent_force_push": true,
      "require_branch_protection": true,
      "max_files_per_pr": 100,
      "max_lines_changed_per_pr": 5000
    }
  }
}
```

To adjust approval requirements, edit `.codepipe/config.json` after initialization.

---

## Safety Nets

The `init` command includes multiple safety mechanisms:

1. **Idempotency**: Running `init` multiple times without `--force` does not overwrite existing config
2. **Validation**: Schema validation runs before and after config creation
3. **Warnings**: Missing credentials generate warnings but do not block initialization
4. **Dry Run**: `--dry-run` allows testing without filesystem changes
5. **Telemetry**: All invocations logged to `.codepipe/logs` for audit
6. **Rollback**: Original config not modified unless `--force` provided

---

## Troubleshooting

### Error: "Not a git repository"

**Symptom:**
```
Initialization failed: Not a git repository. Please run this command from within a git repository.
```

**Remediation:**
```bash
# Option 1: Initialize git
git init

# Option 2: Navigate to git repository
cd /path/to/your/repo
```

**Exit Code:** 20

---

### Error: "Configuration file already exists"

**Symptom:**
```
⚠ Configuration already exists at: .codepipe/config.json
⚠ Use --force to re-initialize or --validate-only to check configuration

✓ Configuration is valid
```

**Remediation:**
```bash
# Validate existing config
codepipe init --validate-only

# Force re-initialization (backs up existing config)
codepipe init --force

# Or manually edit config
vim .codepipe/config.json
```

**Exit Code:** 0 (warning only)

---

### Error: "Permission denied"

**Symptom:**
```
Initialization failed: EACCES: permission denied, mkdir '.codepipe'
```

**Remediation:**
```bash
# Check directory permissions
ls -la

# Fix permissions (Unix/Linux)
chmod u+w .

# Or run with appropriate permissions
sudo codepipe init  # Not recommended
```

**Exit Code:** 20

---

### Warning: "GITHUB_TOKEN not set"

**Symptom:**
```
⚠ GitHub integration enabled but GITHUB_TOKEN not set. Set GITHUB_TOKEN with scopes: repo, workflow
```

**Remediation:**
```bash
# Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# Verify
codepipe init --validate-only
```

**Exit Code:** 0 (warning does not fail initialization)

---

## Next Steps After Initialization

After running `codepipe init`, follow these steps:

1. **Verify Environment**
   ```bash
   codepipe doctor
   ```

2. **Set Credentials**
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   export LINEAR_API_KEY=lin_api_your_key_here
   export AGENT_ENDPOINT=https://agent.example.com
   ```

3. **Validate Configuration**
   ```bash
   codepipe init --validate-only
   ```

4. **Review Config**
   ```bash
   cat .codepipe/config.json
   ```

5. **Customize Settings** (Optional)
   - Edit `.codepipe/config.json`
   - Adjust governance controls
   - Configure integration toggles
   - Set runtime constraints

6. **Start First Feature**
   ```bash
   codepipe start --prompt "Add user authentication"
   ```

---

## CI/Homelab Integration

### GitHub Actions Example

```yaml
name: Initialize Pipeline
on:
  workflow_dispatch:

jobs:
  init:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install CLI
        run: npm install -g codemachine-pipeline

      - name: Initialize Pipeline
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          AGENT_ENDPOINT: ${{ secrets.AGENT_ENDPOINT }}
        run: |
          codepipe init --yes --json > init-result.json
          cat init-result.json

      - name: Check Exit Code
        run: |
          exit_code=$(jq -r '.exit_code' init-result.json)
          if [ "$exit_code" -ne 0 ]; then
            echo "Initialization failed with exit code $exit_code"
            exit "$exit_code"
          fi
```

### Cron/Scheduled Initialization

```bash
#!/bin/bash
# init-pipeline.sh - Idempotent initialization script

set -euo pipefail

cd /path/to/repo

# Set credentials
export GITHUB_TOKEN="${GITHUB_TOKEN:-}"
export LINEAR_API_KEY="${LINEAR_API_KEY:-}"
export AGENT_ENDPOINT="${AGENT_ENDPOINT:-}"

# Initialize (idempotent - safe to run multiple times)
codepipe init --yes --json > /tmp/init-result.json

# Check exit code
exit_code=$(jq -r '.exit_code' /tmp/init-result.json)

if [ "$exit_code" -eq 0 ]; then
  echo "Pipeline initialized successfully"
  exit 0
elif [ "$exit_code" -eq 10 ]; then
  echo "Validation error - check configuration"
  exit 10
elif [ "$exit_code" -eq 20 ]; then
  echo "Environment issue - run doctor for diagnostics"
  codepipe doctor
  exit 20
elif [ "$exit_code" -eq 30 ]; then
  echo "Credential issue - check environment variables"
  exit 30
else
  echo "Unknown error"
  exit 1
fi
```

---

## Related Documentation

- [RepoConfig Schema](../requirements/RepoConfig_schema.md) - Detailed configuration schema reference
- [Run Directory Schema](../requirements/run_directory_schema.md) - Run directory structure and manifests
- [ADR-5: Approval Workflow](../adr/005-approval-workflow.md) - Governance and approval controls
- [Doctor Reference](./doctor_reference.md) - Environment diagnostics command
- [Readiness Checklist](../../plan/readiness_checklist.md) - Pre-flight checklist for pipeline readiness

---

## Telemetry

The `init` command records telemetry to `.codepipe/logs/`:

- **Logs**: NDJSON format in `logs/init-YYYY-MM-DD.log`
- **Metrics**: Prometheus format in `metrics/prometheus.txt`
- **Traces**: OpenTelemetry format in `telemetry/traces.json`

Telemetry includes:
- Command invocation timestamp
- Flags used (`--dry-run`, `--json`, `--force`, etc.)
- Exit code
- Duration
- Validation errors/warnings
- Config schema version

All telemetry respects the `safety.redact_secrets: true` setting to prevent credential leakage.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-XX | Initial playbook for I1.T8 (init command with --dry-run, --json, --yes flags) |
