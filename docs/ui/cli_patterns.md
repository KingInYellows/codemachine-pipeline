# CLI Patterns and Output Formats

<!-- anchor: cli-patterns-overview -->

This document describes the CLI command surface, output formats, JSON schemas, and UI/UX patterns for the AI Feature Pipeline commands. It ensures deterministic, automation-friendly outputs while maintaining human-readable displays.

**Version:** 1.0.0
**Last Updated:** 2025-12-17
**Related Documents:**
- [Execution Flow](../requirements/execution_flow.md)
- [Approval Playbook](../ops/approval_playbook.md)
- [Resume Playbook](../requirements/resume_playbook.md)

---

## Overview

The CLI provides four primary commands for pipeline observability and control:

1. **`ai-feature status`** - Display current pipeline state
2. **`ai-feature plan`** - Show execution plan DAG and task summaries
3. **`ai-feature resume`** - Resume failed/paused execution with safety checks
4. **`ai-feature validate`** - Validate queue integrity and plan consistency

All commands support:
- **JSON mode** (`--json`) for automation and scripting
- **Verbose mode** (`-v`) for detailed diagnostics
- **Deterministic output** with stable field ordering for CI/CD integration
- **ANSI color tokens** for terminal display (automatically disabled in JSON mode)

---

<!-- anchor: cli-status-command -->

## Command: `ai-feature status`

**Purpose:** Display current state of a feature pipeline including manifest, queue, approvals, context, traceability, plan, and validation states.

### Usage

```bash
ai-feature status [--feature <id>] [--json] [--verbose] [--show-costs]
```

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--feature` / `-f` | string | Feature ID to query (defaults to current/latest) |
| `--json` | boolean | Output results in JSON format |
| `--verbose` / `-v` | boolean | Show detailed execution logs and task breakdown |
| `--show-costs` | boolean | Include token usage and cost estimates |

### JSON Output Schema

<!-- anchor: status-json-schema -->

```typescript
interface StatusPayload {
  feature_id: string | null;
  title?: string;
  source?: string;
  status: 'draft' | 'in_progress' | 'completed' | 'failed' | 'unknown';
  manifest_path: string;
  manifest_schema_doc: string;
  manifest_template: string;
  last_step: string | null;
  last_error: {
    step: string;
    message: string;
    timestamp: string;
    recoverable: boolean;
  } | null;
  queue: {
    pending_count: number;
    completed_count: number;
    failed_count: number;
    sqlite_index?: {
      database: string;
    };
  } | null;
  approvals: {
    pending: string[];
    completed: string[];
  } | null;
  telemetry: {
    costs_file?: string;
  } | null;
  timestamps: {
    created_at: string;
    started_at?: string;
    completed_at?: string;
  } | null;
  config_reference: string;
  config_errors: string[];
  config_warnings: string[];
  notes: string[];
  manifest_error?: string;
  context?: {
    files?: number;
    total_tokens?: number;
    summaries?: number;
    summaries_preview?: Array<{
      file_path: string;
      chunk_id: string;
      generated_at: string;
      summary: string;
    }>;
    summarization?: {
      updated_at?: string;
      chunks_generated?: number;
      chunks_cached?: number;
      tokens_used?: {
        prompt?: number;
        completion?: number;
        total?: number;
      };
      cost_usd?: number;
    };
    warnings?: string[];
    budget_warnings?: string[];
    error?: string;
  };
  traceability?: {
    trace_path: string;
    total_links: number;
    prd_goals_mapped: number;
    spec_requirements_mapped: number;
    execution_tasks_mapped: number;
    last_updated: string;
    outstanding_gaps: number;
  };
  plan?: {
    plan_path: string;
    plan_exists: boolean;
    total_tasks?: number;
    entry_tasks?: number;
    blocked_tasks?: number;
    task_type_breakdown?: Record<string, number>;
    dag_metadata?: {
      parallel_paths?: number;
      critical_path_depth?: number;
      generated_at: string;
    };
    checksum?: string;
    last_updated?: string;
  };
  validation?: {
    has_validation_data: boolean;
    queue_valid?: boolean;
    plan_valid?: boolean;
    integrity_warnings?: string[];
  };
  integrations?: {
    github?: {
      enabled: boolean;
      rate_limit?: {
        remaining: number;
        reset_at: string;
        in_cooldown: boolean;
      };
      pr_status?: {
        number: number;
        state: string;
        mergeable: boolean | null;
        url: string;
      };
      warnings: string[];
    };
    linear?: {
      enabled: boolean;
      rate_limit?: {
        remaining: number;
        reset_at: string;
        in_cooldown: boolean;
      };
      issue_status?: {
        identifier: string;
        state: string;
        url: string;
      };
      warnings: string[];
    };
  };
  rate_limits?: {
    providers: Record<string, {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
      manual_ack_required: boolean;
      recent_hit_count: number;
    }>;
    summary: {
      any_in_cooldown: boolean;
      any_requires_ack: boolean;
      providers_in_cooldown: number;
    };
    warnings: string[];
  };
  research?: {
    total_tasks: number;
    pending_tasks: number;
    in_progress_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    cached_tasks: number;
    stale_tasks: number;
    research_dir: string;
    tasks_file: string;
    warnings: string[];
  };
}
```

### Human-Readable Output

```
Feature: feature-auth-123
Title: Add OAuth2 authentication
Source: linear
Manifest: /runs/feature-auth-123/manifest.json
Status: in_progress
Last step: code_generation

Queue: pending=3 completed=5 failed=0
Approvals: pending=1 completed=2

⚠ Pending approvals required:
  • CODE - Review artifact and run: ai-feature approve code --signer "<your-email>"

Context: files=45 summaries=12 total_tokens=18500
Plan: 8 tasks (2 entry, 6 blocked)
DAG: parallel_paths=3 depth=4

Validation: queue=✓ plan=✓

Traceability: 24 links (3 PRD goals → 8 spec requirements → 8 tasks)
Last updated: 2025-12-17T10:30:00Z
Outstanding gaps: 0

• Manifest layout documented at docs/requirements/run_directory_schema.md
• Template manifest available at .ai-feature-pipeline/templates/run_manifest.json
```

---

<!-- anchor: cli-plan-command -->

## Command: `ai-feature plan`

**Purpose:** Display execution plan DAG, task summaries, and dependency graph.

### Usage

```bash
ai-feature plan [--feature <id>] [--json] [--verbose] [--show-diff]
```

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--feature` / `-f` | string | Feature ID to query (defaults to current/latest) |
| `--json` | boolean | Output results in JSON format |
| `--verbose` / `-v` | boolean | Show detailed task breakdown and dependency chains |
| `--show-diff` | boolean | Compare plan against spec hash to detect changes |

### JSON Output Schema

<!-- anchor: plan-json-schema -->

```typescript
interface PlanPayload {
  feature_id: string | null;
  plan_path: string;
  plan_exists: boolean;
  plan_summary?: {
    total_tasks: number;
    entry_tasks: string[];
    blocked_tasks: number;
    task_type_breakdown: Record<string, number>;
    dag_metadata?: {
      parallel_paths?: number;
      critical_path_depth?: number;
      generated_at: string;
    };
    checksum?: string;
    last_updated: string;
  };
  spec_metadata?: {
    spec_hash: string;
    approval_status: string;
  };
  plan_diff?: {
    has_changes: boolean;
    spec_hash_changed: boolean;
    previous_spec_hash?: string;
    current_spec_hash?: string;
    changed_fields: string[];
    recommendation?: string;
    analyzed_at: string;
  };
  notes: string[];
  error?: string;
}
```

### Human-Readable Output

```
Feature: feature-auth-123
Plan: /runs/feature-auth-123/plan.json
Plan exists: Yes

═══════════════════════════════════════════════════════════
  Execution Plan Summary
═══════════════════════════════════════════════════════════

Total tasks: 8
Entry tasks: 2 (can start immediately)
Blocked tasks: 6 (waiting on dependencies)

DAG Metadata:
  Parallel paths: 3
  Critical path depth: 4
  Generated at: 2025-12-17T09:00:00Z

Task Type Breakdown:
  • code_generation: 5
  • testing: 3

Entry Tasks (can start immediately):
  • I3-AUTH-CORE
  • I3-AUTH-MIDDLEWARE

Plan checksum: a3f7b92e1c8d...
Last updated: 2025-12-17T09:00:00Z

Specification:
  Hash: c4e9f8a2b3d1...
  Approval status: approved

═══════════════════════════════════════════════════════════
  Plan Diff Analysis
═══════════════════════════════════════════════════════════

✓ Plan is up-to-date with specification

• Plan DAG contains 8 tasks with 2 entry points
• See docs/requirements/execution_flow.md for DAG semantics and resume behavior
```

---

<!-- anchor: cli-resume-command -->

## Command: `ai-feature resume`

**Purpose:** Resume failed or paused execution with safety checks.

### Usage

```bash
ai-feature resume [--feature <id>] [--dry-run] [--force] [--skip-hash-verification] [--validate-queue] [--json] [--verbose]
```

### Flags

| Flag | Type | Description |
|------|------|-------------|
| `--feature` / `-f` | string | Feature ID to resume (defaults to current/latest) |
| `--dry-run` / `-d` | boolean | Analyze resume eligibility without executing |
| `--force` | boolean | Override blockers (integrity warnings) - use with caution |
| `--skip-hash-verification` | boolean | Skip artifact integrity checks (dangerous, for debugging only) |
| `--validate-queue` | boolean | Validate queue files before resuming (default: true) |
| `--json` | boolean | Output results in JSON format |
| `--verbose` / `-v` | boolean | Show detailed diagnostics |

### JSON Output Schema

<!-- anchor: resume-json-schema -->

```typescript
interface ResumePayload {
  feature_id: string;
  can_resume: boolean;
  status: string;
  last_step?: string;
  current_step?: string;
  last_error?: {
    step: string;
    message: string;
    timestamp: string;
    recoverable: boolean;
  } | null;
  queue_state: {
    pending: number;
    completed: number;
    failed: number;
  };
  pending_approvals: string[];
  integrity_check?: {
    valid: boolean;
    passed: number;
    failed: number;
    missing: number;
  };
  diagnostics: Array<{
    severity: 'info' | 'warning' | 'error' | 'blocker';
    message: string;
    code?: string;
  }>;
  recommendations: string[];
  queue_validation?: {
    valid: boolean;
    total_tasks: number;
    corrupted_tasks: number;
    errors: Array<{
      taskId: string;
      line: number;
      message: string;
    }>;
  };
  plan_summary?: {
    total_tasks: number;
    entry_tasks: number;
    next_tasks: string[];
  };
  resume_instructions?: {
    checkpoint?: string;
    next_step?: string;
    pending_approvals?: string[];
  };
  rate_limit_warnings?: Array<{
    provider: string;
    in_cooldown: boolean;
    manual_ack_required: boolean;
    reset_at: string;
  }>;
  integration_blockers?: {
    github?: string[];
    linear?: string[];
  };
  branch_protection_blockers?: string[];
  dry_run: boolean;
  playbook_reference: string;
}
```

### Human-Readable Output

```
═══════════════════════════════════════════════════════════
  Resume Analysis
═══════════════════════════════════════════════════════════

Feature: feature-auth-123
Status: in_progress
Can Resume: Yes

Queue State:
  Pending: 3
  Completed: 5
  Failed: 0

Last Step: code_generation
Current Step: testing

Integrity Check: ✓ PASSED (8/8 artifacts verified)

Resume Instructions:
  Last checkpoint: code_generation
  Next step: testing
  Pending approvals:
    • CODE - Run: ai-feature approve code

Queue Validation:
  ✓ Queue is valid (8 tasks)

Diagnostics:
  [INFO] Resume checkpoint located at 'code_generation'
  [WARNING] Pending approval required for 'code' gate

Recommendations:
  • Review generated code before proceeding
  • Run: ai-feature approve code --signer "<your-email>"
  • Then resume with: ai-feature resume

═══════════════════════════════════════════════════════════

ℹ️  This was a dry run. No changes were made.
   To execute resume, run without --dry-run flag.
```

---

<!-- anchor: cli-validate-command -->

## Command: `ai-feature validate`

**Purpose:** Validate queue integrity and plan consistency (future implementation).

### Usage

```bash
ai-feature validate [--feature <id>] [--json] [--verbose]
```

---

<!-- anchor: ansi-tokens -->

## ANSI Color Tokens

The CLI uses consistent ANSI color codes for terminal output:

| Token Type | Color Code | Usage |
|------------|------------|-------|
| Success | `\x1b[32m` (Green) | Checkmarks (✓), success messages |
| Warning | `\x1b[33m` (Yellow) | Warnings (⚠), pending states |
| Error | `\x1b[31m` (Red) | Errors (✗), failures |
| Info | `\x1b[36m` (Cyan) | Informational messages (ℹ️) |
| Emphasis | `\x1b[1m` (Bold) | Headers, important fields |
| Reset | `\x1b[0m` | Reset to default |

ANSI codes are automatically disabled when:
- `--json` flag is set
- Output is redirected (not a TTY)
- `NO_COLOR` environment variable is set

---

<!-- anchor: json-mode-guarantees -->

## JSON Mode Guarantees

When `--json` is specified:

1. **Deterministic field ordering**: Fields appear in a stable, documented order
2. **No ANSI codes**: Color codes are stripped from all output
3. **Single JSON object**: Exactly one JSON object is printed to stdout
4. **Stderr suppression**: Telemetry logs mirror to stderr is disabled
5. **Schema versioning**: Schema version is implied by CLI version
6. **Parseable errors**: Errors are embedded in JSON payload when possible

### Exit Codes

| Code | Meaning | Commands |
|------|---------|----------|
| 0 | Success | All |
| 1 | General error | All |
| 10 | Validation error (feature not found, resume blocked) | `status`, `resume` |
| 20 | Integrity check failed (without --force) | `resume` |
| 30 | Queue validation failed | `resume` |

---

<!-- anchor: automation-integration -->

## Automation Integration

### CI/CD Usage Example

```bash
#!/bin/bash
# CI pipeline script

# Check status in JSON mode
STATUS=$(ai-feature status --feature "$FEATURE_ID" --json)

# Parse queue state
PENDING=$(echo "$STATUS" | jq -r '.queue.pending_count')
FAILED=$(echo "$STATUS" | jq -r '.queue.failed_count')

if [ "$FAILED" -gt 0 ]; then
  echo "Queue has failed tasks, attempting resume..."
  ai-feature resume --feature "$FEATURE_ID" --dry-run --json
  exit 1
fi

# Check plan validity
PLAN_VALID=$(echo "$STATUS" | jq -r '.validation.plan_valid // true')
if [ "$PLAN_VALID" != "true" ]; then
  echo "Plan validation failed"
  exit 1
fi

echo "Pipeline healthy: $PENDING tasks pending"
```

### Scripting Best Practices

1. **Always use `--json`** for programmatic access
2. **Check exit codes** before parsing JSON
3. **Use `jq` or equivalent** for JSON parsing
4. **Handle optional fields** (use `// default` in jq)
5. **Capture stderr** separately for telemetry logs

---

<!-- anchor: cli-reference-links -->

## Reference Links

- **[Execution Flow](../requirements/execution_flow.md)** - DAG semantics, dependency resolution, resume behavior
- **[Approval Playbook](../ops/approval_playbook.md)** - Gate enforcement, interactive guidance
- **[Run Directory Schema](../requirements/run_directory_schema.md)** - Manifest structure, artifact layout
- **[Resume Playbook](../requirements/resume_playbook.md)** - Crash recovery, checkpoint restoration

---

**End of Document**
