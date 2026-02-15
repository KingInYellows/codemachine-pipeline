# CLI Surface Requirements

<!-- anchor: cli-surface-overview -->

This document defines the command-line interface requirements for AI Feature Pipeline commands, including integration status reporting, rate-limit warnings, and automation-friendly output formats.

**Version:** 1.0.0
**Last Updated:** 2025-12-17
**Related Documents:**
- [CLI Patterns](../ui/cli_patterns.md)
- [GitHub Adapter Requirements](github_adapter.md)
- [Linear Adapter Requirements](linear_adapter.md)
- [Resume Playbook](resume_playbook.md)

---

## Overview

The CLI surface provides deterministic, automation-friendly outputs for observing pipeline state, integration health, and rate-limit budgets. All commands must support:

1. **JSON Mode** (`--json`) - Machine-readable output for CI/CD and automation
2. **Human-Readable Mode** - Operator-friendly terminal output with warnings and actionable guidance
3. **Stable Schema** - Backward-compatible field additions, never breaking changes
4. **Offline Operation** - Commands read persisted artifacts, no live API calls

---

<!-- anchor: cli-status-requirements -->

## Command: `codepipe status`

### Purpose

Display comprehensive pipeline state including:
- Manifest metadata (feature ID, title, source, status)
- Queue, approvals, and execution progress
- Context summaries and traceability links
- Plan DAG and task breakdown
- **Integration status** (GitHub/Linear connectivity, PR state, issue tracking)
- **Rate-limit ledger** (remaining requests, cooldowns, manual acknowledgement flags)
- **Research task diagnostics** (pending objectives, cached results, staleness)
- Branch protection compliance and reviewer requirements

### Integration Status Section

#### GitHub Integration

**Enabled:** Flag indicating GitHub adapter is active
**Rate Limit:**
- `remaining`: Requests remaining in current window (integer)
- `reset_at`: ISO 8601 timestamp when rate limit resets (string)
- `in_cooldown`: Boolean indicating cooldown state (boolean)

**PR Status:**
- `number`: Pull request number (integer)
- `state`: PR state (e.g., `open`, `closed`, `merged`) (string)
- `mergeable`: Whether PR can be merged (`true`, `false`, `null` for unknown) (boolean | null)
- `url`: GitHub PR URL (string)

**Warnings:** Array of human-readable warnings (string[])

**Example JSON:**
```json
{
  "integrations": {
    "github": {
      "enabled": true,
      "rate_limit": {
        "remaining": 4850,
        "reset_at": "2025-12-17T12:30:00Z",
        "in_cooldown": false
      },
      "pr_status": {
        "number": 123,
        "state": "open",
        "mergeable": true,
        "url": "https://github.com/org/repo/pull/123"
      },
      "warnings": []
    }
  }
}
```

#### Linear Integration

**Enabled:** Flag indicating Linear adapter is active
**Rate Limit:**
- `remaining`: Requests remaining in 1-hour window (integer, max 1500)
- `reset_at`: ISO 8601 timestamp when rate limit resets (string)
- `in_cooldown`: Boolean indicating cooldown state (boolean)

**Issue Status:**
- `identifier`: Linear issue identifier (e.g., `ENG-123`) (string)
- `state`: Issue state (e.g., `tracked`, `in_progress`, `done`) (string)
- `url`: Linear issue URL (string)

**Warnings:** Array of human-readable warnings (string[])

**Example JSON:**
```json
{
  "integrations": {
    "linear": {
      "enabled": true,
      "rate_limit": {
        "remaining": 1420,
        "reset_at": "2025-12-17T11:45:00Z",
        "in_cooldown": false
      },
      "issue_status": {
        "identifier": "ENG-456",
        "state": "tracked",
        "url": "https://linear.app/workspace/issue/ENG-456"
      },
      "warnings": []
    }
  }
}
```

### Rate Limits Section (API Ledger Block)

Per-provider rate-limit state read from `rate_limits.json` artifact.

**Providers:** Map of provider names to rate-limit data
- `remaining`: Requests remaining (integer)
- `reset_at`: ISO 8601 reset timestamp (string)
- `in_cooldown`: Cooldown active (boolean)
- `manual_ack_required`: Manual acknowledgement required (boolean)
- `recent_hit_count`: Number of recent 429 responses (integer)

**Summary:**
- `any_in_cooldown`: Whether any provider is in cooldown (boolean)
- `any_requires_ack`: Whether any provider requires manual acknowledgement (boolean)
- `providers_in_cooldown`: Count of providers in cooldown (integer)

**Warnings:** Array of provider-specific warnings (string[])

**Example JSON:**
```json
{
  "rate_limits": {
    "providers": {
      "github": {
        "remaining": 4850,
        "reset_at": "2025-12-17T12:30:00Z",
        "in_cooldown": false,
        "manual_ack_required": false,
        "recent_hit_count": 0
      },
      "linear": {
        "remaining": 1420,
        "reset_at": "2025-12-17T11:45:00Z",
        "in_cooldown": false,
        "manual_ack_required": false,
        "recent_hit_count": 0
      }
    },
    "summary": {
      "any_in_cooldown": false,
      "any_requires_ack": false,
      "providers_in_cooldown": 0
    },
    "warnings": []
  }
}
```

### Research Tasks Section

Diagnostics from ResearchCoordinator summarizing task state.

**Fields:**
- `total_tasks`: Total research tasks queued (integer)
- `pending_tasks`: Tasks awaiting execution (integer)
- `in_progress_tasks`: Tasks currently executing (integer)
- `completed_tasks`: Tasks with successful results (integer)
- `failed_tasks`: Tasks that failed (integer)
- `cached_tasks`: Tasks with cached results (integer)
- `stale_tasks`: Tasks with stale cached results (integer)
- `research_dir`: Path to research directory (string)
- `tasks_file`: Path to tasks.jsonl file (string)
- `warnings`: Array of warnings/errors (string[])

**Example JSON:**
```json
{
  "research": {
    "total_tasks": 12,
    "pending_tasks": 2,
    "in_progress_tasks": 1,
    "completed_tasks": 8,
    "failed_tasks": 1,
    "cached_tasks": 8,
    "stale_tasks": 0,
    "research_dir": "/runs/feature-auth-123/research",
    "tasks_file": "/runs/feature-auth-123/research/tasks.jsonl",
    "warnings": []
  }
}
```

### Human-Readable Output

**Rate Limits (API Ledger Block):**
```
────────────────────────────────────────────────────────────
API Ledger (Rate Limits)
────────────────────────────────────────────────────────────

github:
  Remaining: 4850
  Reset: 2025-12-17T12:30:00Z
  In Cooldown: No

linear:
  Remaining: 1420
  Reset: 2025-12-17T11:45:00Z
  In Cooldown: No

────────────────────────────────────────────────────────────
```

**Integration Status:**
```
Integration Status:
  GitHub:
    Enabled: Yes
    Rate Limit: 4850 remaining
    PR #123: open
    Mergeable: Yes

  Linear:
    Enabled: Yes
    Rate Limit: 1420 remaining
    Issue: ENG-456 (tracked)
```

**Research Tasks:**
```
Research Tasks:
  Total: 12
  Pending: 2, In Progress: 1
  Completed: 8, Failed: 1
  Cached: 8, Stale: 0
```

---

<!-- anchor: cli-resume-requirements -->

## Command: `codepipe resume`

### Purpose

Resume failed or paused execution with safety checks, surfacing integration blockers and rate-limit warnings before resumption.

### Rate Limit Warnings Section

Array of providers with active cooldowns or manual acknowledgement requirements.

**Fields (per warning):**
- `provider`: Provider name (e.g., `github`, `linear`) (string)
- `in_cooldown`: Whether provider is in cooldown (boolean)
- `manual_ack_required`: Whether manual acknowledgement is required (boolean)
- `reset_at`: ISO 8601 reset timestamp (string)

**Example JSON:**
```json
{
  "rate_limit_warnings": [
    {
      "provider": "github",
      "in_cooldown": true,
      "manual_ack_required": false,
      "reset_at": "2025-12-17T12:30:00Z"
    }
  ]
}
```

### Integration Blockers Section

Per-integration warnings that may block resumption.

**Fields:**
- `github`: Array of GitHub-specific blockers (string[])
- `linear`: Array of Linear-specific blockers (string[])

**Example JSON:**
```json
{
  "integration_blockers": {
    "github": [
      "Rate limit cooldown until 2025-12-17T12:30:00Z",
      "Manual acknowledgement required (3 consecutive hits)"
    ],
    "linear": []
  }
}
```

### Branch Protection Blockers Section

Surface blockers reported in `branch_protection.json` so operators see reviewer and status-check requirements before resuming.

**Fields:**
- `branch_protection_blockers`: Array describing each blocker (string[])

**Example JSON:**
```json
{
  "branch_protection_blockers": [
    "Missing required check: lint",
    "Awaiting second reviewer approval"
  ]
}
```

### Human-Readable Output

**Rate Limit Warnings:**
```
Rate Limit Warnings:
  github:
    ⚠ In cooldown until 2025-12-17T12:30:00Z
    ⚠ Manual acknowledgement required
       Use: codepipe rate-limits clear github
```

**Integration Blockers:**
```
Integration Blockers:
  GitHub:
    ⚠ Rate limit cooldown until 2025-12-17T12:30:00Z
    ⚠ Manual acknowledgement required (3 consecutive hits)
```

---

<!-- anchor: automation-ingestion -->

## Automation Ingestion

### Field Naming Conventions

- **snake_case** for all JSON field names (e.g., `rate_limit`, `reset_at`)
- **ISO 8601** for all timestamps (e.g., `2025-12-17T12:30:00Z`)
- **Booleans** for binary states (`true`, `false`, not strings)
- **Null** for unknown/unavailable values (e.g., `mergeable: null`)

### Schema Stability

- **Additive changes only:** New fields may be added in minor versions
- **No breaking changes:** Existing fields never change type or meaning
- **Optional fields:** All new fields must be optional to preserve backward compatibility
- **Deprecation policy:** Deprecated fields remain for at least 6 months with warnings

### CI/CD Usage Examples

**Check GitHub rate limit before triggering workflow:**
```bash
STATUS=$(codepipe status --feature "$FEATURE_ID" --json)
GITHUB_REMAINING=$(echo "$STATUS" | jq -r '.integrations.github.rate_limit.remaining // 5000')

if [ "$GITHUB_REMAINING" -lt 100 ]; then
  echo "GitHub rate limit low: $GITHUB_REMAINING remaining"
  exit 1
fi
```

**Verify resume eligibility with rate-limit checks:**
```bash
RESUME=$(codepipe resume --feature "$FEATURE_ID" --dry-run --json)
CAN_RESUME=$(echo "$RESUME" | jq -r '.can_resume')
HAS_RATE_WARNINGS=$(echo "$RESUME" | jq -r '.rate_limit_warnings | length > 0')

if [ "$CAN_RESUME" != "true" ] || [ "$HAS_RATE_WARNINGS" = "true" ]; then
  echo "Resume blocked or rate limits active"
  exit 1
fi
```

**Parse research task warnings:**
```bash
STATUS=$(codepipe status --feature "$FEATURE_ID" --json)
RESEARCH_WARNINGS=$(echo "$STATUS" | jq -r '.research.warnings | length')

if [ "$RESEARCH_WARNINGS" -gt 0 ]; then
  echo "Research tasks have warnings:"
  echo "$STATUS" | jq -r '.research.warnings[]'
fi
```

---

<!-- anchor: cli-reference-links -->

## Reference Links

- **[CLI Patterns](../ui/cli_patterns.md)** - Full JSON schemas and examples
- **[GitHub Adapter](github_adapter.md)** - GitHub API headers, rate limits, versioning
- **[Linear Adapter](linear_adapter.md)** - Linear API rate limits, developer-preview caveats
- **[Resume Playbook](resume_playbook.md)** - Crash recovery, checkpoint restoration

---

**End of Document**
