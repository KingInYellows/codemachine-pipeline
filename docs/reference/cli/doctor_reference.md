# Doctor Command Reference

## Overview

The `codepipe doctor` command runs comprehensive environment diagnostics to verify that your system meets all prerequisites for codemachine-pipeline operations. It validates:

- Runtime environment (Node.js, git, npm, Docker, CodeMachine CLI)
- Repository setup and permissions
- Network connectivity
- Configuration validity
- Credential availability (GITHUB_TOKEN, LINEAR_API_KEY, Agent Endpoint)

The Doctor command extends `TelemetryCommand` for automatic telemetry lifecycle
management (logger, metrics, traces) via `runWithTelemetry()`.

This reference documents all diagnostic checks, exit codes, and remediation procedures.

---

## Command Synopsis

```bash
codepipe doctor [FLAGS]
```

### Flags

| Flag        | Short | Description                          | Default |
| ----------- | ----- | ------------------------------------ | ------- |
| `--json`    |       | Output results in JSON format        | `false` |
| `--verbose` | `-v`  | Show detailed diagnostic information | `false` |

---

## Usage Examples

### Standard Diagnostics

Run all checks with human-readable output:

```bash
codepipe doctor
```

**Sample Output:**

```
Environment Diagnostics Report
======================================================================

✓ Passed Checks:
  ✓ Node.js Version: Node.js v24.1.0 (v24 LTS preferred)
  ✓ Git CLI: git version 2.43.0
  ✓ npm: npm 10.2.4
  ✓ Git Repository: Git repository detected at /path/to/repo
  ✓ Filesystem Permissions: Write permissions verified
  ✓ RepoConfig: Configuration valid
  ✓ Agent Endpoint: Configured: https://agent.example.com

⚠ Warnings:
  ⚠ Docker: Docker not found
    → Install Docker from https://docker.com/ (optional but recommended)
  ⚠ Outbound HTTPS: Unable to verify outbound HTTPS connectivity
    → Check network settings and firewall rules

❌ Failed Checks:
  ❌ GITHUB_TOKEN (GitHub): Token not set
    → Set GITHUB_TOKEN with scopes: repo, workflow
  ❌ LINEAR_API_KEY (Linear): API key not set
    → Set LINEAR_API_KEY with a valid Linear API key

Summary:
  Total checks: 12
  Passed: 8
  Warnings: 2
  Failed: 2

❌ Critical failures detected - please address failed checks before proceeding

Exit code: 30
Exit code reference:
  0  = All checks passed
  10 = Configuration validation errors
  20 = Environment issues (missing tools, permissions)
  30 = Credential issues (missing tokens/keys)

For detailed documentation, see: docs/reference/cli/doctor_reference.md
```

### JSON Output (for Automation)

Output structured JSON for CI/automation parsing:

```bash
codepipe doctor --json
```

**JSON Output:**

```json
{
  "status": "critical_failures",
  "exit_code": 30,
  "checks": [
    {
      "name": "Node.js Version",
      "status": "pass",
      "message": "Node.js v24.1.0 (v24 LTS preferred)",
      "details": {
        "version": "v24.1.0",
        "major": 24
      }
    },
    {
      "name": "GITHUB_TOKEN (GitHub)",
      "status": "fail",
      "message": "Token not set",
      "remediation": "Set GITHUB_TOKEN with scopes: repo, workflow"
    }
  ],
  "summary": {
    "total": 12,
    "passed": 8,
    "warnings": 2,
    "failed": 2
  },
  "config_path": "/path/to/repo/.codepipe/config.json",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Verbose Diagnostics

Show detailed information for each check:

```bash
codepipe doctor --verbose
```

Verbose mode includes:

- Detailed version information
- File paths and URLs
- Environment variable values (redacted)
- Network endpoints tested
- Configuration field references

---

## Diagnostic Checks

### 1. Node.js Version

**Check:** Validates Node.js version against project requirements.

**Pass Criteria:**

- Node.js v24.x (LTS) or higher

**Warn Criteria:**

- Node.js v20.x (acceptable but v24 recommended)

**Fail Criteria:**

- Node.js < v20.0.0
- Node.js not installed

**Remediation:**

```bash
# Install Node.js v24 LTS (recommended)
# macOS (homebrew)
brew install node@24

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Windows (nvm-windows)
nvm install 24
nvm use 24

# Verify
node --version
```

**Exit Code Impact:** Failure → 20 (Environment Issue); Warning if v20.x

---

### 2. Git CLI

**Check:** Verifies git command-line tool is installed and accessible.

**Pass Criteria:**

- `git --version` returns successfully
- Any modern git version accepted

**Fail Criteria:**

- `git` command not found
- `git --version` returns non-zero exit code

**Remediation:**

```bash
# macOS
brew install git

# Ubuntu/Debian
sudo apt-get install git

# Windows
# Download from https://git-scm.com/

# Verify
git --version
```

**Exit Code Impact:** Failure → 20 (Environment Issue)

---

### 3. npm

**Check:** Validates npm package manager is installed.

**Pass Criteria:**

- `npm --version` returns successfully

**Fail Criteria:**

- `npm` command not found

**Remediation:**

```bash
# npm is bundled with Node.js
# Reinstall Node.js if npm is missing

# Or install npm separately
curl -L https://www.npmjs.com/install.sh | sh

# Verify
npm --version
```

**Exit Code Impact:** Failure → 20 (Environment Issue)

---

### 4. Docker

**Check:** Checks if Docker is installed and accessible.

**Pass Criteria:**

- `docker --version` returns successfully

**Warn Criteria:**

- `docker` command not found (optional dependency)

**Remediation:**

```bash
# macOS
brew install --cask docker

# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Windows
# Download from https://docker.com/

# Verify
docker --version
```

**Exit Code Impact:** Warning only (Docker is optional)

---

### 5. Git Repository

**Check:** Verifies current directory is within a git repository.

**Pass Criteria:**

- `git rev-parse --show-toplevel` returns successfully
- Valid git repository root detected

**Fail Criteria:**

- Not in a git repository
- `.git` directory not found

**Remediation:**

```bash
# Initialize new repository
git init

# Or clone existing repository
git clone https://github.com/org/repo.git
cd repo

# Verify
git status
```

**Exit Code Impact:** Failure → 20 (Environment Issue)

---

### 6. Filesystem Permissions

**Check:** Tests write permissions in `.codepipe/` directory.

**Pass Criteria:**

- Can create test directory
- Can write test file
- Can delete test artifacts

**Fail Criteria:**

- Permission denied errors (EACCES)
- Read-only filesystem
- Disk full

**Remediation:**

```bash
# Check current permissions
ls -la .codepipe/

# Fix directory permissions (Unix/Linux)
chmod u+w .codepipe/

# Check disk space
df -h .

# Verify ownership
ls -la | grep codemachine-pipeline
```

**Exit Code Impact:** Failure → 20 (Environment Issue)

---

### 7. Outbound HTTPS Connectivity

**Check:** Verifies ability to reach external HTTPS endpoints.

**Test Endpoint:** `https://api.github.com`

**Pass Criteria:**

- `curl -Is https://api.github.com` succeeds, OR
- `wget --spider https://api.github.com` succeeds

**Warn Criteria:**

- curl/wget not installed (cannot verify)
- Connection timeout
- Network unreachable

**Remediation:**

```bash
# Test connectivity manually
curl -I https://api.github.com

# Check firewall rules
# Ubuntu/Debian
sudo ufw status

# Check proxy settings
echo $HTTP_PROXY
echo $HTTPS_PROXY

# Verify DNS resolution
nslookup api.github.com
```

**Exit Code Impact:** Warning only (network connectivity issues don't block operations, but may affect integrations)

---

### 8. RepoConfig Validation

**Check:** Validates `.codepipe/config.json` against schema.

**Pass Criteria:**

- Config file exists
- Schema validation passes
- No validation errors

**Warn Criteria:**

- Config exists with warnings (missing optional fields)
- Config not found (not yet initialized)

**Fail Criteria:**

- Config exists but has schema errors
- Invalid JSON syntax
- Required fields missing

**Remediation:**

```bash
# If config not found
codepipe init

# If config invalid
codepipe init --validate-only

# View validation errors
cat .codepipe/config.json | jq .

# Fix schema errors manually
vim .codepipe/config.json

# Re-validate
codepipe init --validate-only
```

**Exit Code Impact:** Failure → 10 (Validation Error)

---

### 9. GITHUB_TOKEN (GitHub Integration)

**Check:** Verifies GitHub Personal Access Token is set when GitHub integration is enabled.

**Pass Criteria:**

- `config.github.enabled === false`, OR
- `config.github.enabled === true` AND `GITHUB_TOKEN` env var is set

**Fail Criteria:**

- `config.github.enabled === true` AND `GITHUB_TOKEN` not set

**Remediation:**

```bash
# Create GitHub Personal Access Token
# 1. Go to https://github.com/settings/tokens
# 2. Click "Generate new token (classic)"
# 3. Select scopes: repo, workflow
# 4. Copy token

# Set token
export GITHUB_TOKEN=ghp_your_token_here

# Persist in shell profile (optional)
echo 'export GITHUB_TOKEN=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc

# Verify
codepipe doctor
```

**Required Scopes:**

- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows

**Exit Code Impact:** Failure → 30 (Credential Issue)

---

### 10. LINEAR_API_KEY (Linear Integration)

**Check:** Verifies Linear API key is set when Linear integration is enabled.

**Pass Criteria:**

- `config.linear.enabled === false`, OR
- `config.linear.enabled === true` AND `LINEAR_API_KEY` env var is set

**Fail Criteria:**

- `config.linear.enabled === true` AND `LINEAR_API_KEY` not set

**Remediation:**

```bash
# Create Linear API Key
# 1. Go to https://linear.app/settings/api
# 2. Click "Create new API key"
# 3. Copy key

# Set key
export LINEAR_API_KEY=lin_api_your_key_here

# Persist in shell profile (optional)
echo 'export LINEAR_API_KEY=lin_api_your_key_here' >> ~/.bashrc
source ~/.bashrc

# Verify
codepipe doctor
```

**Exit Code Impact:** Failure → 30 (Credential Issue)

---

### 11. CodeMachine CLI (Execution)

**Check:** Verifies that the external CodeMachine CLI binary is available and optionally meets a minimum version requirement.

**Pass Criteria:**

- Binary found (via `CODEMACHINE_BIN_PATH`, npx, or global install) and `--version` succeeds
- Version satisfies `execution.codemachine_cli_version` from config (if set)

**Warn Criteria:**

- Binary not found (optional dependency)
- Binary found but `--version` fails
- Version below configured minimum

**Remediation:**

```bash
# Install CodeMachine CLI globally
npm install -g codemachine@^0.8.0

# Or set the binary path explicitly
export CODEMACHINE_BIN_PATH=/path/to/codemachine

# Verify
codemachine --version
```

**Exit Code Impact:** Warning only (CodeMachine CLI is optional; the pipeline can use the built-in codemachine-cli strategy)

---

### 12. Agent Endpoint

**Check:** Verifies agent service endpoint is configured.

**Pass Criteria:**

- `config.runtime.agent_endpoint` is set, OR
- `AGENT_ENDPOINT` env var is set

**Warn Criteria:**

- Neither `runtime.agent_endpoint` nor `AGENT_ENDPOINT` is set

**Remediation:**

```bash
# Option 1: Set via environment variable
export AGENT_ENDPOINT=https://agent.example.com

# Option 2: Set in config.json
vim .codepipe/config.json
# Add: "runtime": { "agent_endpoint": "https://agent.example.com" }

# Verify
codepipe doctor
```

**Exit Code Impact:** Warning only (agent endpoint may not be needed for all operations)

---

## Exit Codes

| Exit Code | Meaning           | Typical Causes                                                        | Remediation                                                      |
| --------- | ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `0`       | All Checks Passed | All diagnostics passed (warnings allowed)                             | None - system ready                                              |
| `10`      | Validation Error  | RepoConfig has schema errors or invalid JSON                          | Run `codepipe init --validate-only` for details; fix config.json |
| `20`      | Environment Issue | Missing Node.js, git, npm; filesystem permissions; git repo not found | Install required tools; check permissions; run from git repo     |
| `30`      | Credential Issue  | Missing GITHUB_TOKEN, LINEAR_API_KEY, or other required credentials   | Set required environment variables; verify scopes                |

**Exit Code Priority:** When multiple failure types exist, the highest-priority exit code is returned:

1. Credential issues (30) take precedence
2. Environment issues (20) are next
3. Validation errors (10) are lowest priority

---

## Common Failure Scenarios

### Scenario 1: Fresh Install (No Configuration)

**Command:**

```bash
codepipe doctor
```

**Output:**

```
⚠ RepoConfig: Configuration file not found
  → Run "codepipe init" to create configuration
```

**Exit Code:** 0 (warning only)

**Resolution:**

```bash
codepipe init
codepipe doctor
```

---

### Scenario 2: Missing Credentials

**Command:**

```bash
codepipe doctor
```

**Output:**

```
❌ GITHUB_TOKEN (GitHub): Token not set
  → Set GITHUB_TOKEN with scopes: repo, workflow
❌ LINEAR_API_KEY (Linear): API key not set
  → Set LINEAR_API_KEY with a valid Linear API key
```

**Exit Code:** 30

**Resolution:**

```bash
export GITHUB_TOKEN=ghp_your_token
export LINEAR_API_KEY=lin_api_your_key
codepipe doctor
```

---

### Scenario 3: Outdated Node.js

**Command:**

```bash
codepipe doctor
```

**Output:**

```
❌ Node.js Version: Node.js v18.12.0 is below minimum required version
  → Install Node.js v20 or v24 LTS from https://nodejs.org/
```

**Exit Code:** 20

Note: Node.js v20 produces a warning (not a failure) recommending upgrade to v24.

**Resolution:**

```bash
nvm install 24
nvm use 24
codepipe doctor
```

---

### Scenario 4: Not in Git Repository

**Command:**

```bash
cd /tmp && codepipe doctor
```

**Output:**

```
❌ Git Repository: Not in a git repository
  → Run "git init" or navigate to a git repository
```

**Exit Code:** 20

**Resolution:**

```bash
cd /path/to/your/repo
codepipe doctor
```

---

## CI/Automation Integration

### GitHub Actions Example

```yaml
name: Environment Check
on: [push, pull_request]

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install CLI
        run: npm install -g codemachine-pipeline

      - name: Run Diagnostics
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          AGENT_ENDPOINT: ${{ secrets.AGENT_ENDPOINT }}
        run: |
          codepipe doctor --json > doctor-report.json
          cat doctor-report.json

      - name: Upload Report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctor-report
          path: doctor-report.json

      - name: Check Exit Code
        run: |
          exit_code=$(jq -r '.exit_code' doctor-report.json)
          if [ "$exit_code" -ne 0 ]; then
            echo "Doctor checks failed with exit code $exit_code"
            jq -r '.checks[] | select(.status=="fail")' doctor-report.json
            exit "$exit_code"
          fi
```

### Bash Script Example

```bash
#!/bin/bash
# pre-flight-check.sh

set -euo pipefail

echo "Running environment diagnostics..."

# Run doctor and capture output
codepipe doctor --json > /tmp/doctor-report.json

# Parse results
exit_code=$(jq -r '.exit_code' /tmp/doctor-report.json)
status=$(jq -r '.status' /tmp/doctor-report.json)
failed_count=$(jq -r '.summary.failed' /tmp/doctor-report.json)

echo "Status: $status"
echo "Exit Code: $exit_code"

if [ "$exit_code" -eq 0 ]; then
  echo "✓ All checks passed - system ready"
  exit 0
elif [ "$exit_code" -eq 10 ]; then
  echo "❌ Configuration validation errors detected"
  jq -r '.checks[] | select(.status=="fail") | "  - \(.name): \(.message)"' /tmp/doctor-report.json
  exit 10
elif [ "$exit_code" -eq 20 ]; then
  echo "❌ Environment issues detected"
  jq -r '.checks[] | select(.status=="fail") | "  - \(.name): \(.message)\n    → \(.remediation)"' /tmp/doctor-report.json
  exit 20
elif [ "$exit_code" -eq 30 ]; then
  echo "❌ Credential issues detected"
  jq -r '.checks[] | select(.status=="fail") | "  - \(.name): \(.message)\n    → \(.remediation)"' /tmp/doctor-report.json
  exit 30
else
  echo "❌ Unknown error"
  exit 1
fi
```

---

## Telemetry

The `doctor` command records telemetry to `.codepipe/logs/`:

- **Logs**: NDJSON format in `logs/doctor-YYYY-MM-DD.log`
- **Metrics**: Prometheus format in `metrics/prometheus.txt`
  - `command_invocations_total{command="doctor",exit_code="N"}`
  - `command_execution_duration_ms{command="doctor"}`
- **Traces**: OpenTelemetry format in `telemetry/traces.json`

Telemetry includes:

- Command invocation timestamp
- Individual check results (pass/warn/fail)
- Exit code
- Duration
- Verbose flag

All telemetry respects `safety.redact_secrets: true` to prevent credential leakage.

---

## Related Documentation

- [Init Playbook](../../playbooks/init_playbook.md) - Initialization command reference
- [Observability Baseline](../../playbooks/observability_baseline.md) - Telemetry and logging reference

---

## Version History

| Version | Date       | Changes                                                                                 |
| ------- | ---------- | --------------------------------------------------------------------------------------- |
| 1.0.0   | 2025-01-XX | Initial doctor reference for I1.T8 (environment diagnostics with exit codes 0/10/20/30) |
