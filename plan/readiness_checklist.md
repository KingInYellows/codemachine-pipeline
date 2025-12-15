# AI Feature Pipeline - Readiness Checklist

## Overview

This checklist enumerates gating questions and verification steps to ensure the ai-feature-pipeline is properly configured and ready for operation. Each iteration should review and update this checklist to validate system readiness before proceeding with feature development workflows.

**Last Updated:** 2025-01-XX
**Current Iteration:** I1 (Bootstrap)
**Schema Version:** 1.0.0

---

## How to Use This Checklist

1. **Review** each check category before starting a new iteration
2. **Verify** each check passes (see Status column)
3. **Update** Last Verified timestamp after validation
4. **Reference** linked RepoConfig fields to understand configuration impact
5. **Remediate** any failing checks before proceeding

**Status Values:**
- ✅ **PASS** - Check completed successfully
- ⚠️ **WARN** - Check passed with warnings; operation possible but not optimal
- ❌ **FAIL** - Check failed; must be remediated before proceeding
- ⏸️ **SKIP** - Check not applicable for current iteration
- ⏳ **PENDING** - Check not yet executed

---

## Checklist Categories

### 1. Runtime Environment

Validates that the execution environment meets minimum requirements per Section 1 (Key Assumptions).

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| Node.js v20+ installed | ⏳ | N/A | Never | Run `ai-feature doctor` to verify |
| Node.js v24 LTS (preferred) | ⏳ | N/A | Never | Preferred for optimal performance |
| git CLI installed | ⏳ | N/A | Never | Required for repository operations |
| npm/pnpm installed | ⏳ | N/A | Never | Package manager for dependencies |
| Docker installed (optional) | ⏳ | N/A | Never | Recommended for containerized agents |
| Outbound HTTPS connectivity | ⏳ | N/A | Never | Required for GitHub/Linear/Agent APIs |
| Filesystem write access | ⏳ | `runtime.run_directory` | Never | Must write to `.ai-feature-pipeline/` |

**Verification Command:**
```bash
ai-feature doctor
```

**Exit Criteria:**
- All checks PASS or WARN
- No FAIL status in critical checks (Node.js, git, filesystem)

---

### 2. Repository Setup

Validates git repository structure and baseline documentation.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| In git repository | ⏳ | `project.repo_url` | Never | Must run from within git repo |
| Git remote configured | ⏳ | `project.repo_url` | Never | Origin remote should point to GitHub |
| Default branch exists | ⏳ | `project.default_branch` | Never | Typically `main` or `master` |
| README.md exists | ⏳ | `project.context_paths` | Never | Baseline documentation required |
| docs/ directory exists | ⏳ | `project.context_paths` | Never | Architecture/design docs |
| No conflicting `.ai-feature-pipeline/` | ⏳ | `runtime.run_directory` | Never | Directory must be clean or valid |

**Verification Commands:**
```bash
git remote -v
git branch --list
ls README.md docs/
```

**Exit Criteria:**
- Git repository properly initialized
- Baseline documentation present
- No pre-existing pipeline conflicts

---

### 3. Configuration Validity

Validates RepoConfig schema compliance and field correctness.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| `config.json` exists | ⏳ | N/A | Never | Created by `ai-feature init` |
| Schema version valid | ⏳ | `schema_version` | Never | Must be semver (e.g., "1.0.0") |
| Project ID set | ⏳ | `project.id` | Never | Typically derived from repo name |
| Repo URL valid | ⏳ | `project.repo_url` | Never | Must be HTTPS or SSH git URL |
| Default branch matches git | ⏳ | `project.default_branch` | Never | Should match actual default branch |
| Context paths valid | ⏳ | `project.context_paths` | Never | Paths must exist in repository |
| Run directory writable | ⏳ | `runtime.run_directory` | Never | Must have write permissions |
| Token budget reasonable | ⏳ | `runtime.context_token_budget` | Never | 32000 default, adjust per model |
| Max concurrent tasks valid | ⏳ | `runtime.max_concurrent_tasks` | Never | 1-10, default 3 |
| Config history present | ⏳ | `config_history` | Never | At least one entry (initial creation) |

**Verification Command:**
```bash
ai-feature init --validate-only
```

**Exit Criteria:**
- All schema validation passes
- No validation errors
- Warnings addressed or acknowledged

---

### 4. Integration Credentials

Validates that required API credentials are available when integrations are enabled.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| GitHub integration toggle | ⏳ | `github.enabled` | Never | Enable if using GitHub PR automation |
| GITHUB_TOKEN set (if enabled) | ⏳ | `github.token_env_var` | Never | Required when `github.enabled=true` |
| GitHub token scopes valid | ⏳ | `github.required_scopes` | Never | Must include `repo`, `workflow` |
| Linear integration toggle | ⏳ | `linear.enabled` | Never | Enable if using Linear issue tracking |
| LINEAR_API_KEY set (if enabled) | ⏳ | `linear.api_key_env_var` | Never | Required when `linear.enabled=true` |
| Linear team/project IDs | ⏳ | `linear.team_id`, `linear.project_id` | Never | Optional but recommended |
| Agent endpoint configured | ⏳ | `runtime.agent_endpoint` | Never | Required for agent operations |
| Agent endpoint reachable | ⏳ | `runtime.agent_endpoint` | Never | Test connectivity to agent service |

**Verification Commands:**
```bash
# Check environment variables
echo $GITHUB_TOKEN | wc -c
echo $LINEAR_API_KEY | wc -c
echo $AGENT_ENDPOINT

# Run doctor
ai-feature doctor
```

**Exit Criteria:**
- All enabled integrations have valid credentials
- Agent endpoint is reachable
- No credential FAIL status in doctor report

---

### 5. Governance & Approvals

Validates approval workflow configuration per ADR-5.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| Governance section exists | ⏳ | `governance` | Never | Added in schema v1.0.0 |
| PRD approval configured | ⏳ | `governance.approval_workflow.require_approval_for_prd` | Never | Default: true |
| Spec approval configured | ⏳ | `governance.approval_workflow.require_approval_for_spec` | Never | Default: true |
| Plan approval configured | ⏳ | `governance.approval_workflow.require_approval_for_plan` | Never | Default: true |
| Code approval configured | ⏳ | `governance.approval_workflow.require_approval_for_code` | Never | Default: true |
| PR approval configured | ⏳ | `governance.approval_workflow.require_approval_for_pr` | Never | Default: true |
| Deploy approval configured | ⏳ | `governance.approval_workflow.require_approval_for_deploy` | Never | Default: true |
| Approver identity recording | ⏳ | `governance.accountability.record_approver_identity` | Never | Default: true |
| Audit log retention set | ⏳ | `governance.accountability.audit_log_retention_days` | Never | Default: 365 days |
| Auto-merge prevention | ⏳ | `governance.risk_controls.prevent_auto_merge` | Never | Default: true |
| Force push prevention | ⏳ | `governance.risk_controls.prevent_force_push` | Never | Default: true |

**Verification Commands:**
```bash
# Check governance config
cat .ai-feature-pipeline/config.json | jq '.governance'
```

**Exit Criteria:**
- Governance controls align with organizational policies
- Approval workflow gates are appropriately configured
- Risk controls are enabled

---

### 6. Safety & Constraints

Validates safety settings and resource constraints.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| Secret redaction enabled | ⏳ | `safety.redact_secrets` | Never | Default: true (critical for logs) |
| Allowed file patterns set | ⏳ | `safety.allowed_file_patterns` | Never | Whitelist of editable files |
| Blocked file patterns set | ⏳ | `safety.blocked_file_patterns` | Never | Prevents editing .env, keys, etc. |
| Max file size reasonable | ⏳ | `constraints.max_file_size_kb` | Never | Default: 1000KB |
| Max context files reasonable | ⏳ | `constraints.max_context_files` | Never | Default: 100 files |
| Rate limits configured | ⏳ | `constraints.rate_limits` | Never | GitHub, Linear, Agent limits |
| GitHub rate limit appropriate | ⏳ | `constraints.rate_limits.github_requests_per_hour` | Never | Default: 5000 |
| Linear rate limit appropriate | ⏳ | `constraints.rate_limits.linear_requests_per_minute` | Never | Default: 60 |
| Agent rate limit appropriate | ⏳ | `constraints.rate_limits.agent_requests_per_hour` | Never | Default: 100 |

**Verification Commands:**
```bash
# Check safety config
cat .ai-feature-pipeline/config.json | jq '.safety, .constraints'
```

**Exit Criteria:**
- Secret redaction is enabled
- File pattern restrictions prevent sensitive file edits
- Resource constraints prevent runaway operations

---

### 7. Directory Structure

Validates that required directories exist and are writable per Section 3 (Directory Structure).

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| `.ai-feature-pipeline/` exists | ⏳ | N/A | Never | Root pipeline directory |
| `.ai-feature-pipeline/runs/` exists | ⏳ | `runtime.run_directory` | Never | Run-specific state directories |
| `.ai-feature-pipeline/logs/` exists | ⏳ | N/A | Never | Telemetry logs |
| `.ai-feature-pipeline/artifacts/` exists | ⏳ | N/A | Never | Generated artifacts (PRDs, specs) |
| `.ai-feature-pipeline/config.json` exists | ⏳ | N/A | Never | Validated configuration |
| `docs/` directory exists | ⏳ | `project.context_paths` | Never | Architecture docs |
| `docs/adr/` directory exists | ⏳ | N/A | Never | Architecture Decision Records |
| `plan/` directory exists | ⏳ | N/A | Never | Iteration plans and checklists |
| `plan/readiness_checklist.md` exists | ⏳ | N/A | Never | This file |

**Verification Commands:**
```bash
# List directory structure
ls -la .ai-feature-pipeline/
ls -la docs/ plan/
```

**Exit Criteria:**
- All required directories exist
- Directories are writable
- Structure matches specification

---

### 8. Telemetry & Observability

Validates telemetry infrastructure is operational.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| Logs directory writable | ⏳ | N/A | Never | `.ai-feature-pipeline/logs/` |
| Logs format configured | ⏳ | `runtime.logs_format` | Never | Default: ndjson |
| Metrics directory exists | ⏳ | N/A | Never | For Prometheus exports |
| Traces directory exists | ⏳ | N/A | Never | For OpenTelemetry traces |
| Init command telemetry works | ⏳ | N/A | Never | Run `ai-feature init` and check logs |
| Doctor command telemetry works | ⏳ | N/A | Never | Run `ai-feature doctor` and check logs |
| Telemetry redaction enabled | ⏳ | `safety.redact_secrets` | Never | Prevents credential leakage |

**Verification Commands:**
```bash
# Run commands and check telemetry
ai-feature init --dry-run
ai-feature doctor
ls -la .ai-feature-pipeline/logs/
cat .ai-feature-pipeline/logs/*.log | head -20
```

**Exit Criteria:**
- Telemetry logs are created
- Metrics and traces are recorded
- No credentials leaked in logs

---

### 9. Feature Flags

Validates feature flag configuration for iteration-specific capabilities.

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| Auto-merge disabled (default) | ⏳ | `feature_flags.enable_auto_merge` | Never | Default: false (safety) |
| Deployment triggers configured | ⏳ | `feature_flags.enable_deployment_triggers` | Never | Default: false |
| Linear sync configured | ⏳ | `feature_flags.enable_linear_sync` | Never | Default: false |
| Context summarization enabled | ⏳ | `feature_flags.enable_context_summarization` | Never | Default: true |
| Resumability enabled | ⏳ | `feature_flags.enable_resumability` | Never | Default: true |
| Developer preview features | ⏳ | `feature_flags.enable_developer_preview` | Never | Default: false |

**Verification Commands:**
```bash
# Check feature flags
cat .ai-feature-pipeline/config.json | jq '.feature_flags'
```

**Exit Criteria:**
- Feature flags align with iteration goals
- Risky features (auto-merge) remain disabled
- Core features (resumability, summarization) enabled

---

### 10. Iteration-Specific Checks

Additional checks specific to the current iteration (I1: Bootstrap).

| Check Name | Status | RepoConfig Field | Last Verified | Notes |
|------------|--------|------------------|---------------|-------|
| All I1 tasks completed | ⏳ | N/A | Never | See `.codemachine/artifacts/plan/02_Iteration_I1.md` |
| RepoConfig schema finalized | ⏳ | `schema_version` | Never | Task I1.T2 |
| Run directory persistence working | ⏳ | `runtime.run_directory` | Never | Task I1.T3 |
| HTTP client rate-limiting works | ⏳ | `constraints.rate_limits` | Never | Task I1.T4 |
| Telemetry baseline operational | ⏳ | `runtime.logs_format` | Never | Task I1.T5 |
| CLI commands registered | ⏳ | N/A | Never | Task I1.T6 |
| Model schemas documented | ⏳ | N/A | Never | Task I1.T7 |
| Init/doctor commands work | ⏳ | N/A | Never | Task I1.T8 (this task) |
| Architecture diagrams exported | ⏳ | N/A | Never | Task I1.T9 |

**Verification Commands:**
```bash
# Check iteration progress
ai-feature status

# Verify CLI commands
ai-feature --help
ai-feature init --help
ai-feature doctor --help

# Test commands
ai-feature doctor --json
ai-feature init --dry-run --json
```

**Exit Criteria:**
- All I1 tasks marked done
- CLI commands functional
- Telemetry operational
- Schemas and docs complete

---

## Readiness Summary

**Overall Status:** ⏳ **PENDING**

**Gate Status by Category:**

| Category | Status | Pass | Warn | Fail | Skip | Pending |
|----------|--------|------|------|------|------|---------|
| 1. Runtime Environment | ⏳ | 0 | 0 | 0 | 0 | 7 |
| 2. Repository Setup | ⏳ | 0 | 0 | 0 | 0 | 6 |
| 3. Configuration Validity | ⏳ | 0 | 0 | 0 | 0 | 10 |
| 4. Integration Credentials | ⏳ | 0 | 0 | 0 | 0 | 8 |
| 5. Governance & Approvals | ⏳ | 0 | 0 | 0 | 0 | 11 |
| 6. Safety & Constraints | ⏳ | 0 | 0 | 0 | 0 | 9 |
| 7. Directory Structure | ⏳ | 0 | 0 | 0 | 0 | 9 |
| 8. Telemetry & Observability | ⏳ | 0 | 0 | 0 | 0 | 7 |
| 9. Feature Flags | ⏳ | 0 | 0 | 0 | 0 | 6 |
| 10. Iteration-Specific | ⏳ | 0 | 0 | 0 | 0 | 9 |
| **TOTAL** | **⏳** | **0** | **0** | **0** | **0** | **82** |

---

## Automated Verification

To automatically update this checklist, run:

```bash
# Run all readiness checks
./scripts/verify-readiness.sh

# Output updated checklist
./scripts/verify-readiness.sh > plan/readiness_checklist.md
```

*(Script not yet implemented - planned for I2)*

---

## Sign-Off

Once all checks pass, iteration lead should sign off:

| Iteration | Lead | Sign-Off Date | Notes |
|-----------|------|---------------|-------|
| I1 | TBD | Pending | Awaiting completion of all I1 tasks |

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-01-XX | Initial checklist for I1 (Bootstrap) | ai-feature init (I1.T8) |

---

## References

- **Plan Overview**: `.codemachine/artifacts/plan/01_Plan_Overview_and_Setup.md`
- **Iteration I1**: `.codemachine/artifacts/plan/02_Iteration_I1.md`
- **RepoConfig Schema**: `docs/requirements/RepoConfig_schema.md`
- **Run Directory Schema**: `docs/requirements/run_directory_schema.md`
- **ADR-5 (Approvals)**: `docs/adr/005-approval-workflow.md`
- **Init Playbook**: `docs/ops/init_playbook.md`
- **Doctor Reference**: `docs/ops/doctor_reference.md`

---

**Instructions for Future Iterations:**

1. Copy this checklist template for each new iteration
2. Update iteration-specific checks (section 10)
3. Mark checks as complete during iteration
4. Add new categories as system evolves
5. Archive completed checklists in `plan/archive/`
