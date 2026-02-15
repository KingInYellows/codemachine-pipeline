# PRD Authoring & Approval Playbook

**Version:** 1.0.0
**Last Updated:** 2024-01-15
**Owner:** AI Feature Pipeline Team

## Overview

This playbook documents the end-to-end workflow for creating, reviewing, editing, and approving Product Requirements Documents (PRDs) within the AI Feature Pipeline. It covers both automated processes and human operator responsibilities at approval gates.

## Table of Contents

1. [Workflow Overview](#workflow-overview)
2. [PRD Generation Process](#prd-generation-process)
3. [Review and Editing](#review-and-editing)
4. [Approval Workflow](#approval-workflow)
5. [Revision Requests](#revision-requests)
6. [Traceability and Governance](#traceability-and-governance)
7. [Troubleshooting](#troubleshooting)
8. [Reference](#reference)

---

## Workflow Overview

The PRD authoring workflow follows these sequential stages:

```
Context Gathering → Research Planning → PRD Drafting → Review → Approval → Spec Generation
                                           ↑______________|
                                           (Revision Loop)
```

### Key Principles

- **Human-in-the-Loop:** PRD approval gates require explicit human sign-off before downstream work proceeds.
- **Deterministic Hashing:** All PRD approvals reference immutable SHA-256 hashes of the approved content.
- **Traceability:** Every PRD goal is mapped to trace IDs that link to specs, tasks, and tests.
- **Resumability:** If approval is rejected or changes are requested, the pipeline can resume from the PRD editing stage.

---

## PRD Generation Process

### Automated Generation

When you run `codepipe start`, the system automatically:

1. **Gathers Context:** Collects repository files, README, docs, and git history based on configured globs.
2. **Runs Research Tasks:** Identifies unknowns (TODO/TBD markers, open questions) and queues research tasks.
3. **Drafts PRD:** Uses the PRD template (`docs/templates/prd_template.md`) to generate `artifacts/prd.md` in the run directory.

**PRD Generation Steps:**

```typescript
// Invoked by CLI during `codepipe start`
const result = await draftPRD({
  repoRoot: '/path/to/repo',
  runDir: '.codepipe/FEAT-12345',
  feature: featureMetadata,
  contextDocument: contextDoc,
  researchTasks: completedTasks,
  repoConfig: config,
}, logger, metrics);
```

**Output Artifacts:**

- `.codepipe/<feature_id>/artifacts/prd.md` - Generated PRD markdown
- `.codepipe/<feature_id>/artifacts/prd_metadata.json` - PRD metadata with hash and approval status
- `.codepipe/<feature_id>/approvals/` - Directory for approval records

When the CLI detects that PRD approval is required (per RepoConfig governance), `codepipe start` pauses after authoring `prd.md`, prints review instructions, and exits with code `30` to signal human action is needed before downstream stages can continue.

### Template Structure

The PRD template includes the following sections (all required):

| Section | Purpose | Example Content |
|---------|---------|-----------------|
| **Problem Statement** | Describes the problem being solved | "Users cannot export analytics data..." |
| **Goals** | Primary objectives (SMART format) | "Enable CSV export with <2s latency" |
| **Non-Goals** | Explicit scope boundaries | "Real-time streaming export (deferred)" |
| **Acceptance Criteria** | Measurable success criteria | "95% of exports complete within 2s" |
| **Risks & Mitigations** | Potential risks and mitigation strategies | "Risk: Large exports timeout. Mitigation: Chunked processing" |
| **Open Questions** | Unresolved questions requiring research | "Which CSV encoding should we use?" |

### Context and Research Citations

The PRD automatically includes:

- **Context Sources:** Top 10 files from context aggregation (by token count)
- **Research Tasks:** Completed research tasks with confidence scores and source counts
- **Traceability Links:** Trace ID for downstream requirement mapping

---

## Review and Editing

### Reviewing the PRD

After PRD generation, reviewers should:

1. **Locate the PRD:**
   ```bash
   cd .codepipe/<feature_id>/docs
   cat prd.md
   ```

2. **Check for Completeness:**
   - Verify all sections are filled (no `_TODO:` markers remaining)
   - Ensure goals are specific, measurable, and achievable
   - Validate that acceptance criteria are testable
   - Confirm risks are identified with mitigation strategies

3. **Validate Citations:**
   - Check that context files are relevant
   - Verify research tasks have been completed
   - Ensure no pending research blockers

4. **Review Metadata:**
   ```bash
   cat prd_metadata.json
   ```
   - Verify `prdHash` matches the current file
   - Check `approvalStatus` is `pending`

### Editing the PRD

If changes are needed, you can edit the PRD directly:

```bash
# Open PRD in your editor
vim .codepipe/<feature_id>/artifacts/prd.md

# After editing, update metadata to reflect changes
# (This will be automated in future iterations)
```

**Important:** After editing, the `prdHash` in `prd_metadata.json` will become stale. You must either:

- **Option 1:** Regenerate metadata using CLI (future feature)
- **Option 2:** Manually update the hash:
  ```bash
  sha256sum .codepipe/<feature_id>/artifacts/prd.md
  # Copy hash to prd_metadata.json -> prdHash field
  ```

---

## Approval Workflow

### Prerequisites for Approval

Before approving a PRD, ensure:

- ✅ All required sections are complete (no TODO markers except in "Open Questions")
- ✅ All research tasks referenced are completed (`status: 'completed'`)
- ✅ Goals are clear, measurable, and aligned with product strategy
- ✅ Acceptance criteria are testable and specific
- ✅ Risks are identified with reasonable mitigation strategies
- ✅ Context and research citations are relevant and sufficient

### Approval Process

**Step 1: Verify Current State**

```bash
# Check PRD status
codepipe status --feature <feature_id>

# Review PRD content
cat .codepipe/<feature_id>/artifacts/prd.md
```

**Step 2: Record Approval**

```bash
# Approve the PRD
codepipe approve prd \
  --feature <feature_id> \
  --signer "jane.doe@example.com" \
  --signer-name "Jane Doe" \
  --rationale "PRD is complete and aligns with Q4 roadmap goals"
```

**Step 3: Verify Approval Recorded**

```bash
# Check updated status
codepipe status --feature <feature_id>

# View approval record
cat .codepipe/<feature_id>/approvals/APR-*.json
```

### Approval Record Structure

Approval records are immutable JSON files:

```json
{
  "schema_version": "1.0.0",
  "approval_id": "APR-1234567890-abc123",
  "feature_id": "FEAT-12345",
  "gate_type": "prd",
  "verdict": "approved",
  "signer": "jane.doe@example.com",
  "signer_name": "Jane Doe",
  "approved_at": "2024-01-15T10:30:00Z",
  "artifact_hash": "a3f2b1c4d5e6...",
  "artifact_path": "artifacts/prd.md",
  "rationale": "PRD is complete and aligns with Q4 roadmap goals"
}
```

**Hash Integrity:**

The `artifact_hash` field contains the SHA-256 hash of `prd.md` at the time of approval. This ensures:

- **Immutability:** Any changes to the PRD after approval invalidate the approval
- **Auditability:** We can verify which version of the PRD was approved
- **Resumability:** If PRD is edited post-approval, the system detects the mismatch and requires re-approval

---

## Revision Requests

### Requesting Changes

If the PRD needs revisions:

```bash
# Reject with requested changes
codepipe approve prd \
  --feature <feature_id> \
  --signer "jane.doe@example.com" \
  --verdict "requested_changes" \
  --rationale "Goals section needs more specificity. Acceptance criteria for performance are missing."
```

### Revision Loop

1. **Operator edits PRD:**
   ```bash
   vim .codepipe/<feature_id>/artifacts/prd.md
   ```

2. **Update metadata hash:**
   ```bash
   # Compute new hash
   NEW_HASH=$(sha256sum .codepipe/<feature_id>/artifacts/prd.md | awk '{print $1}')

   # Update prd_metadata.json manually or regenerate
   # (Automated tooling for this is planned)
   ```

3. **Re-submit for approval:**
   ```bash
   codepipe approve prd --feature <feature_id> --signer "jane.doe@example.com"
   ```

### Rejection

If the PRD is fundamentally misaligned:

```bash
codepipe approve prd \
  --feature <feature_id> \
  --signer "jane.doe@example.com" \
  --verdict "rejected" \
  --rationale "Feature does not align with current product strategy. Defer to Q2 2025."
```

**Effect:** The feature status transitions to `failed`, and downstream spec/plan generation is blocked.

---

## Traceability and Governance

### Trace IDs

Every PRD is assigned a unique **Trace ID** (e.g., `TRACE-1234567890-abc123`) that:

- Maps PRD goals to specification requirements
- Links requirements to execution tasks
- Enables bidirectional traceability from tests back to goals

**Example Trace Link:**

```
PRD Goal: "Enable CSV export with <2s latency"
  ↓ (Trace ID: TRACE-1234567890-abc123)
Spec Requirement: "Implement streaming CSV serializer with chunking"
  ↓
Execution Task: "Write CsvSerializer class with stream API"
  ↓
Test: "test_csv_export_latency_under_2s"
```

### Governance Artifacts

All PRD-related artifacts are stored in the run directory:

```
.codepipe/<feature_id>/
├── artifacts/
│   ├── prd.md                      # Generated PRD markdown
│   └── prd_metadata.json           # Metadata with hash and approvals
├── approvals/
│   ├── APR-12345-abc.json          # Approval record 1
│   └── APR-67890-def.json          # Approval record 2
├── context/
│   └── summary.json                # Context document used for PRD
├── research/
│   └── tasks/                      # Research tasks cited in PRD
└── feature.json                    # Feature metadata
```

### Audit Trail

To audit PRD changes and approvals:

```bash
# View all approvals for a feature
cat .codepipe/<feature_id>/approvals/*.json | jq '.gate_type, .verdict, .signer, .approved_at'

# Check PRD hash history
git log --follow .codepipe/<feature_id>/artifacts/prd.md

# Verify current hash matches approval
sha256sum .codepipe/<feature_id>/artifacts/prd.md
cat .codepipe/<feature_id>/artifacts/prd_metadata.json | jq '.prdHash'
```

---

## Troubleshooting

### Error: "PRD content has changed since metadata was last updated"

**Cause:** The `prd.md` file hash doesn't match the `prdHash` in `prd_metadata.json`.

**Solution:**

1. Regenerate metadata:
   ```bash
   # (Automated tooling planned - manual for now)
   NEW_HASH=$(sha256sum .codepipe/<feature_id>/artifacts/prd.md | awk '{print $1}')
   # Update prd_metadata.json -> prdHash with NEW_HASH
   ```

2. Or revert changes to PRD:
   ```bash
   git checkout .codepipe/<feature_id>/artifacts/prd.md
   ```

### Error: "Some research tasks are not yet completed"

**Cause:** The PRD references research tasks that are still `pending` or `in_progress`.

**Solution:**

1. Check research task status:
   ```bash
   codepipe research list --feature <feature_id>
   ```

2. Wait for research tasks to complete or manually resolve unknowns.

3. Regenerate PRD once research is done:
   ```bash
   codepipe prd regenerate --feature <feature_id>
   ```

### Warning: "Sections contain TODO markers"

**Cause:** PRD sections still have placeholder `_TODO:` text.

**Solution:**

1. Edit PRD to replace placeholders with actual content.
2. Update hash in metadata.
3. Re-submit for approval.

---

## Reference

### CLI Commands

| Command | Description |
|---------|-------------|
| `codepipe start` | Generates PRD as part of feature initialization |
| `codepipe status --feature <id>` | Shows PRD approval status |
| `codepipe approve prd --feature <id>` | Records PRD approval |
| `codepipe prd regenerate --feature <id>` | Regenerates PRD (future) |

### Files and Artifacts

| Path | Purpose |
|------|---------|
| `docs/templates/prd_template.md` | PRD markdown template |
| `artifacts/prd.md` | Generated PRD for a feature |
| `artifacts/prd_metadata.json` | PRD metadata (hash, approvals, trace ID) |
| `approvals/<approval_id>.json` | Individual approval records |
| `approvals.json` | Aggregated approval index |

### Related Documentation

- [PRD Template](../templates/prd_template.md)
- [Approval Record Schema](../requirements/data_model_dictionary.md#approval-record)
- [Traceability Map](../requirements/traceability_map.md)
- [Init Playbook](./init_playbook.md)

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-01-15 | Initial playbook for Iteration I2 |

---

**Questions or Issues?**

If you encounter issues not covered in this playbook:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Init Playbook](./init_playbook.md) for context setup issues
3. Consult the architecture docs in `docs/architecture/`
4. File an issue in the project tracker
