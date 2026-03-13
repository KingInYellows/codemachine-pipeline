# Traceability Playbook

**Version:** 1.0.1
**Last Updated:** 2024-05-27
**Owner:** CodeMachine Pipeline Team

---

## Table of Contents

1. [Overview](#overview)
2. [Traceability Requirements](#traceability-requirements)
3. [Trace Map Structure](#trace-map-structure)
4. [Mapping Conventions](#mapping-conventions)
5. [Generation Workflow](#generation-workflow)
6. [Update Process](#update-process)
7. [Validation and Quality Gates](#validation-and-quality-gates)
8. [CLI Integration](#cli-integration)
9. [Troubleshooting](#troubleshooting)
10. [References](#references)

---

## Overview

### Purpose

This playbook provides comprehensive guidance for generating, maintaining, and validating traceability maps that link **PRD goals → Spec requirements → ExecutionTasks** throughout the AI Feature Pipeline workflow. Traceability ensures auditability, completeness verification, and compliance with requirements tracking mandates.

### Scope

- **In Scope:**
  - Generating `trace.json` from approved PRD and Spec artifacts
  - Mapping conventions for linking entities across lifecycle stages
  - Update procedures when PRD/Spec/Plan artifacts change
  - Validation rules and duplicate prevention
  - CLI integration via `status --json` output

- **Out of Scope:**
  - Code diff traceability (deferred to execution phase)
  - Real-time tracing during agent execution
  - Multi-feature cross-references

### Key Stakeholders

- **Architects:** Define trace schema and relationship semantics
- **Implementers:** Generate and update trace maps via workflows
- **Auditors:** Consume `trace.json` for compliance verification
- **CLI Users:** View trace summaries via `codepipe status`

---

## Traceability Requirements

### Functional Requirements

**FR-9: Traceability**

Every architectural artifact must map inputs to outputs:

1. **PRD Goals** must link to **Spec Requirements**
2. **Spec Requirements** must link to **ExecutionTasks**
3. **ExecutionTasks** must eventually link to **Code Diffs** (post-execution)

**FR-10: Specification Authoring**

Specifications must maintain backward links to PRD goals and forward links to planned tasks to enable impact analysis when requirements change.

### Non-Functional Requirements

- **Determinism:** Trace generation must be reproducible given identical input artifacts
- **Atomicity:** `trace.json` updates must use file locks to prevent corruption
- **Completeness:** Gaps (unmapped goals/requirements/tasks) must be surfaced in diagnostics
- **Validation:** All trace links must pass Zod schema validation before persistence

### ADR References

- **ADR-2 (State Persistence):** Trace maps stored as deterministic JSON with SHA-256 hashes
- **ADR-5 (Approval Workflow):** Trace generation gated on PRD and Spec approval status
- **ADR-7 (Validation Policy):** TraceLink schema enforces semver, enum constraints, and required fields

---

## Trace Map Structure

### Schema Version

All `trace.json` files follow the schema version `1.0.0` defined in the `TraceDocument` interface.

### Document Format

```json
{
  "schema_version": "1.0.0",
  "feature_id": "feat-abc123",
  "trace_id": "TRACE-1702823456789",
  "links": [
    {
      "schema_version": "1.0.0",
      "link_id": "LINK-PRD-SPEC-GOAL-001-T-UNIT-001",
      "feature_id": "feat-abc123",
      "source_type": "prd_goal",
      "source_id": "GOAL-001",
      "target_type": "spec_requirement",
      "target_id": "T-UNIT-001",
      "relationship": "derived_from",
      "created_at": "2025-12-17T10:00:00Z",
      "metadata": {
        "prd_goal_content": "Implement user authentication...",
        "spec_requirement_content": "Verify constraint: Response time...",
        "trace_id": "TRACE-1702823456789"
      }
    }
  ],
  "created_at": "2025-12-17T10:00:00Z",
  "updated_at": "2025-12-17T10:00:00Z",
  "metadata": {
    "prd_hash": "abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234",
    "spec_hash": "ef567890abcdef567890abcdef567890abcdef567890abcdef567890abcdef56",
    "plan_hash": "optional-when-plan-exists",
    "generator": "traceability-mapper:v1.0.0"
  },
  "diagnostics": {
    "warnings": [],
    "gaps": []
  }
}
```

### TraceLink Fields

See [Data Model Dictionary](../reference/data_model_dictionary.md#tracelink) for complete field definitions.

**Key Fields:**

- `link_id`: Unique identifier (format: `LINK-{source_type}-{target_type}-{source_id}-{target_id}`)
- `source_type` / `target_type`: Enum values: `prd_goal`, `spec_requirement`, `execution_task`, `diff`, `other`
- `relationship`: Enum values: `implements`, `tests`, `depends_on`, `derived_from`, `validates`
- `metadata`: Extensible object for additional context (goal content, requirement summaries, etc.)

---

## Mapping Conventions

### PRD Goal → Spec Requirement Links

**Relationship Type:** `derived_from`

**Extraction Logic:**

1. Parse PRD markdown (`artifacts/prd.md`) for `## Goals` section
2. Extract bullet points (lines starting with `-` or `*`)
3. Filter out TODO markers and placeholder content
4. Assign sequential IDs: `GOAL-001`, `GOAL-002`, etc.
5. Link each PRD goal to **all** spec requirements (heuristic: comprehensive mapping)

**Example:**

- **PRD Goal:** `GOAL-001` - "Enable user authentication via OAuth"
- **Spec Requirement:** `T-UNIT-001` - "Verify OAuth token validation"
- **Link ID:** `LINK-PRD-SPEC-GOAL-001-T-UNIT-001`

### Spec Requirement → ExecutionTask Links

**Relationship Type:** `implements`

**Extraction Logic:**

1. Parse spec JSON (`artifacts/spec.json`) for `test_plan` array
2. Use `test_id` field as requirement ID
3. Parse plan JSON (`plan.json`) for `tasks` array (if exists)
4. Link each spec requirement to **all** execution tasks (heuristic: comprehensive mapping)

**Example:**

- **Spec Requirement:** `T-INT-002` - "Verify acceptance criterion: Successful login flow"
- **Execution Task:** `EXEC-TASK-123` - "Implement OAuth callback handler"
- **Link ID:** `LINK-SPEC-TASK-T-INT-002-EXEC-TASK-123`

### Future: ExecutionTask → Diff Links

**Relationship Type:** `validates`

_Deferred to execution phase._ When tasks complete, the execution engine will append links from task IDs to Git commit SHAs or patch file hashes.

---

## Generation Workflow

### Prerequisites

Before generating a trace map, ensure:

1. **PRD Approved:** `prd_metadata.json` has `approvalStatus: 'approved'`
2. **Spec Approved:** `spec_metadata.json` has `approvalStatus: 'approved'`
3. **Artifacts Present:** `prd.md`, `spec.json`, `prd_metadata.json`, `spec_metadata.json` exist

### Execution Steps

#### 1. Trigger Generation

**Automatic (Spec approval path):**

`codepipe approve spec --approve --signer <email>` now calls `updateTraceMapOnSpecChange()` immediately after the approval record is persisted. This ensures trace links exist before planning begins and ties every entry back to the approval gate that unlocked it (FR-9/FR-10).

**Manual / Programmatic (force regeneration):**

```typescript
import { generateTraceMap, updateTraceMapOnSpecChange } from '../workflows/traceabilityMapper';

// Normal operation (skips regeneration when trace.json already exists)
await generateTraceMap({ runDir: '/path/to/run', featureId: 'feat-abc123' }, logger, metrics);

// Force refresh when artifacts changed outside the approval command
await updateTraceMapOnSpecChange(
  { runDir: '/path/to/run', featureId: 'feat-abc123' },
  logger,
  metrics
);
```

#### 2. Extraction

The mapper reads:

- `artifacts/prd.md` → PRD goals
- `artifacts/spec.json` → Spec requirements (test plan)
- `plan.json` → Execution tasks (if available)

#### 3. Link Generation

- **PRD → Spec:** Create `derived_from` links
- **Spec → Task:** Create `implements` links

#### 4. Validation

- Run each link through `parseTraceLink()` for Zod schema validation
- Reject invalid links; log errors
- Deduplicate by `link_id`

#### 5. Persistence

- Build `TraceDocument` JSON
- Atomic write to `trace.json` under `withLock()`

#### 6. Telemetry

- Log statistics (total links, duplicates prevented, validation errors)
- Emit metric: `trace_maps_generated_total`

---

## Update Process

### When to Update

Regenerate `trace.json` when:

1. **PRD Changes:** After re-approving an edited PRD
2. **Spec Changes:** After re-approving an edited Spec
3. **Plan Generated:** When `plan.json` is created (adds Spec → Task links)
4. **Manual Request:** Invoke `updateTraceMapOnSpecChange()` (force mode) from automation when bypassing the CLI

### Update Procedure

1. **Verify Approvals:** Ensure PRD and Spec remain approved
2. **Compare Hashes:** Check if `prd_hash` / `spec_hash` in `trace.json` metadata matches current artifact hashes
3. **Regenerate:** Call `updateTraceMapOnSpecChange()` with `force: true`
4. **Audit Changes:** Compare old vs. new `trace.json` to identify added/removed links

**Example Workflow:**

```typescript
import { updateTraceMapOnSpecChange } from '../workflows/traceabilityMapper';

const result = await updateTraceMapOnSpecChange(
  { runDir, featureId, force: true },
  logger,
  metrics
);

console.log(`Updated trace map: ${result.statistics.totalLinks} links`);
```

### Change Log (Future Enhancement)

Consider appending a `change_log` array to `TraceDocument` to track regeneration history:

```json
{
  "change_log": [
    {
      "timestamp": "2025-12-17T11:00:00Z",
      "trigger": "spec_update",
      "links_added": 5,
      "links_removed": 2
    }
  ]
}
```

---

## Validation and Quality Gates

### Schema Validation

All links must pass `TraceLinkSchema.safeParse()`:

- **Required Fields:** `schema_version`, `link_id`, `feature_id`, `source_type`, `source_id`, `target_type`, `target_id`, `relationship`, `created_at`
- **Semver Format:** `schema_version` must match regex `/^[0-9]+\.[0-9]+\.[0-9]+$/`
- **Enum Constraints:** `source_type`, `target_type`, `relationship` must use allowed values

**Error Handling:**

```typescript
const { valid, errors } = validateLinks(links);

if (errors.length > 0) {
  logger.warn('Validation errors', { errors });
  // Optionally fail generation or exclude invalid links
}
```

### Duplicate Prevention

**Rule:** No two links may share the same `link_id`.

**Implementation:**

```typescript
const { unique, duplicates } = deduplicateLinks(allLinks);

logger.info(`Prevented ${duplicates} duplicate links`);
```

### Completeness Checks

**Gap Detection:**

- If `prdGoals.length === 0`: Warn "No goals extracted from PRD"
- If `specRequirements.length === 0`: Warn "No requirements extracted from spec"
- If `executionTasks.length === 0`: Note "Plan not yet generated" (not an error)

**Output:**

```json
{
  "diagnostics": {
    "gaps": [
      {
        "source": "PRD",
        "target": "Goals",
        "reason": "No goals extracted from PRD"
      }
    ]
  }
}
```

---

## CLI Integration

### Status Command Enhancement

The `codepipe status` command displays trace summary when `trace.json` exists.

**JSON Output:**

```bash
codepipe status --feature feat-abc123 --json
```

**Response (excerpt):**

```json
{
  "feature_id": "feat-abc123",
  "status": "in_progress",
  "traceability": {
    "trace_path": "/path/to/run/trace.json",
    "total_links": 42,
    "prd_goals_mapped": 5,
    "spec_requirements_mapped": 12,
    "execution_tasks_mapped": 8,
    "last_updated": "2025-12-17T10:00:00Z",
    "outstanding_gaps": 0
  }
}
```

**Human-Readable Output:**

```
Traceability: 42 links (5 PRD goals → 12 spec requirements → 8 tasks)
Last updated: 2025-12-17T10:00:00Z
Outstanding gaps: None
```

### Integration Code (status.ts)

`Status` augments the JSON payload with trace data via a dedicated helper, keeping CLI output deterministic:

```typescript
const traceInfo = featureId
  ? await this.loadTraceabilityStatus(settings.baseDir, featureId)
  : undefined;

const payload = this.buildStatusPayload(featureId, settings, manifestInfo, contextInfo, traceInfo);

if (traceSummary) {
  return {
    trace_path: traceSummary.tracePath,
    total_links: traceSummary.totalLinks,
    prd_goals_mapped: traceSummary.prdGoalsMapped,
    spec_requirements_mapped: traceSummary.specRequirementsMapped,
    execution_tasks_mapped: traceSummary.executionTasksMapped,
    last_updated: traceSummary.lastUpdated,
    outstanding_gaps: traceSummary.outstandingGaps,
  };
}
```

---

## Troubleshooting

### Issue: trace.json Not Generated

**Symptoms:**

- `codepipe approve spec --approve` completed but `trace.json` missing
- `status` output shows no traceability section

**Diagnosis:**

1. Check PRD approval: `cat <runDir>/artifacts/prd_metadata.json | jq .approvalStatus`
2. Check Spec approval: `cat <runDir>/artifacts/spec_metadata.json | jq .approvalStatus`
3. Verify file permissions on run directory

**Resolution:**

- Approve PRD/Spec if not yet approved
- Invoke `updateTraceMapOnSpecChange({ runDir, featureId }, logger, metrics)` (force mode) to regenerate the trace file

---

### Issue: Validation Errors

**Symptoms:**

- Logs show "N link(s) failed validation"
- `trace.json` contains fewer links than expected

**Diagnosis:**

1. Inspect logs for specific validation errors (path + message)
2. Check if `link_id` format matches conventions
3. Verify enum values for `source_type`, `target_type`, `relationship`

**Resolution:**

- Fix extraction logic if IDs are malformed
- Update schema version if using new enums
- Report schema bugs to architecture team

---

### Issue: Duplicate Links Detected

**Symptoms:**

- Logs show "Prevented N duplicate links"
- Total links lower than sum of PRD→Spec + Spec→Task

**Diagnosis:**

1. Check if PRD goals or spec requirements have duplicate IDs
2. Verify `link_id` construction logic for uniqueness

**Resolution:**

- Ensure goal/requirement extraction assigns unique sequential IDs
- If duplicates are valid (e.g., many-to-many), adjust `link_id` format to include index

---

### Issue: Outstanding Gaps

**Symptoms:**

- `status` output shows "Outstanding gaps: 1"
- `trace.json` diagnostics list gap reasons

**Diagnosis:**

1. Check if `plan.json` exists (`ls <runDir>/plan.json`)
2. Verify PRD has `## Goals` section with content
3. Verify `spec.json` has non-empty `test_plan` array

**Resolution:**

- Generate plan if missing: `codepipe plan`
- Edit PRD/spec to include goals/requirements
- Re-generate trace map after fixing artifacts

---

## References

### Functional Requirements

- [FR-9](#fr-9-traceability): Traceability requirement defined in this playbook's "Functional Requirements" section
- [FR-10](#fr-10-specification-authoring): Specification authoring requirement defined in this playbook's "Functional Requirements" section

### Architectural Decision Records

- **ADR-2:** State persistence policy referenced by this playbook
- **ADR-5:** Approval workflow referenced by this playbook
- **ADR-7:** [Validation Policy](../adr/ADR-7-validation-policy.md)

### Data Models

- **TraceLink Schema:** [Data Model Dictionary](../reference/data_model_dictionary.md#tracelink)
- **Feature Model:** [Data Model Dictionary](../reference/data_model_dictionary.md#feature)

### Workflow Modules

- **Traceability Mapper:** `src/workflows/traceabilityMapper.ts`
- **PRD Authoring Engine:** `src/workflows/prdAuthoringEngine.ts`
- **Spec Composer:** `src/workflows/specComposer.ts`

### CLI Commands

- **Trace Generation Trigger:** `codepipe approve spec --approve --signer <email>` (auto-generates `trace.json`)
- **Status:** `codepipe status [--feature <id>] [--json]`

---

## Version History

| Version | Date       | Author      | Changes                                       |
| ------- | ---------- | ----------- | --------------------------------------------- |
| 1.0.1   | 2024-05-27 | CodeMachine | Automated Spec approval trigger + CLI updates |
| 1.0.0   | 2025-12-17 | CodeMachine | Initial traceability playbook release         |

---

## Appendix: Example Trace Map

**Scenario:** PRD with 2 goals, Spec with 3 test requirements, Plan with 2 tasks.

**Expected Links:**

1. `GOAL-001` → `T-UNIT-001` (derived_from)
2. `GOAL-001` → `T-UNIT-002` (derived_from)
3. `GOAL-001` → `T-INT-001` (derived_from)
4. `GOAL-002` → `T-UNIT-001` (derived_from)
5. `GOAL-002` → `T-UNIT-002` (derived_from)
6. `GOAL-002` → `T-INT-001` (derived_from)
7. `TASK-001` → `T-UNIT-001` (implements)
8. `TASK-001` → `T-UNIT-002` (implements)
9. `TASK-001` → `T-INT-001` (implements)
10. `TASK-002` → `T-UNIT-001` (implements)
11. `TASK-002` → `T-UNIT-002` (implements)
12. `TASK-002` → `T-INT-001` (implements)

**Total:** 12 links (6 PRD→Spec + 6 Spec→Task)

**trace.json Size:** ~8KB (assuming 200-char metadata per link)

---

**End of Traceability Playbook**
