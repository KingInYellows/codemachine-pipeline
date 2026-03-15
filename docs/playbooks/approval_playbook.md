# Approval Playbook

## Overview

This playbook documents the approval governance workflow for the AI Feature Pipeline. Approvals enforce human-in-the-loop gates at critical transitions (PRD→Spec→Code→PR→Deploy), ensuring that autonomous agents never modify production code without explicit human authorization.

**Implements:**

- ADR-5 (Approval Workflow): Gate enforcement and signature capture
- Section 4 (Directives): Approval gates and audit trail requirements
- Blueprint Rulebook: Human-in-the-loop enforcement

---

## Table of Contents

1. [Approval Gate Transitions](#approval-gate-transitions)
2. [Interactive Approval Workflow](#interactive-approval-workflow)
3. [Automation-Friendly Approval Flow](#automation-friendly-approval-flow)
4. [Offline Editing Guidance](#offline-editing-guidance)
5. [Timeout Handling & Escalation](#timeout-handling--escalation)
6. [Security & Identity Verification](#security--identity-verification)
7. [Troubleshooting](#troubleshooting)
8. [Exit Codes](#exit-codes)

---

## Approval Gate Transitions

The pipeline enforces **five mandatory approval gates** that align with the feature development lifecycle:

| Gate Type  | Transition               | Artifact              | Purpose                                                                              |
| ---------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| **PRD**    | Research → Specification | `artifacts/prd.md`    | Validate problem statement, goals, and acceptance criteria before detailed design    |
| **Spec**   | PRD → Planning           | `artifacts/spec.md`   | Approve technical specification, architecture decisions, and implementation approach |
| **Plan**   | Spec → Code              | `artifacts/plan.json` | Review execution tasks, dependencies, and resource allocation before code generation |
| **Code**   | Plan → PR                | Code diffs, tests     | Approve generated code for quality, security, and adherence to spec                  |
| **PR**     | Code → Deploy            | Pull request          | Authorize merge to target branch after CI/CD validation                              |
| **Deploy** | PR → Production          | Deployment manifest   | Approve production release and rollout strategy                                      |

### Default Turnaround Targets

The following are **recommended** (not enforced) turnaround times for approvals:

- **PRD**: 24 hours (allows stakeholder review)
- **Spec**: 48 hours (technical review and architectural discussion)
- **Plan**: 12 hours (task validation)
- **Code**: 4 hours (code review bandwidth)
- **PR**: 2 hours (CI/CD + review)
- **Deploy**: 1 hour (production approval)

⚠ **Note**: These are guidance only. The system does not enforce timeouts by default. See [Timeout Handling](#timeout-handling--escalation) for automation strategies.

---

## Interactive Approval Workflow

### Step 1: Pipeline Requests Approval

When a workflow step completes (e.g., PRD authoring), the CLI pauses and displays:

```
✅ PRD draft created. Approval required before continuing.
Review the document at artifacts/prd.md, then run:
  codepipe approve prd --signer "<your-email>"
Need edits? Request revisions via: codepipe prd edit --request "<details>"
```

**What happens:**

- Pipeline status changes to `paused`
- Approval gate added to `manifest.json` pending approvals
- Artifact hash computed and stored in `approvals/approvals.json`

### Step 2: Review Artifact

Navigate to the artifact location and review:

```bash
# Example: Review PRD
cat .codepipe/runs/FEAT-abc123/artifacts/prd.md

# Or open in editor
vim .codepipe/runs/FEAT-abc123/artifacts/prd.md
```

**Review checklist:**

- [ ] All required sections completed
- [ ] Goals are clear and measurable
- [ ] Acceptance criteria are testable
- [ ] Risks and mitigations are reasonable
- [ ] No security concerns or sensitive data exposure

### Step 3: Grant or Deny Approval

#### Grant Approval

```bash
codepipe approve prd --signer "user@example.com" --comment "LGTM"
```

**Output:**

```
✅ Approval granted for PRD gate
Feature: FEAT-abc123
Signer: user@example.com
Artifact: artifacts/prd.md
Hash: a3f5e8b...
Timestamp: 2025-01-15T14:32:10Z

Next steps:
  • PRD approved. Continue to specification authoring with: codepipe spec
  • Or resume the pipeline with: codepipe resume
```

#### Deny Approval

```bash
codepipe approve prd --deny --signer "reviewer@example.com" \
  --comment "Missing acceptance criteria for edge cases"
```

**Output:**

```
❌ Approval denied for PRD gate
Feature: FEAT-abc123
Signer: reviewer@example.com
Artifact: artifacts/prd.md
Rationale: Missing acceptance criteria for edge cases
Timestamp: 2025-01-15T14:35:22Z

Next steps:
  • PRD rejected. Address feedback and request approval again.
  • Update the artifact and re-run the relevant command (e.g., codepipe prd)
  • Then request approval using this command again.
```

### Step 4: Resume Pipeline (After Approval)

Once approved, continue the pipeline:

```bash
codepipe resume
```

The resume command validates that all pending approvals are completed before proceeding.

---

## Automation-Friendly Approval Flow

For CI/CD pipelines and automation, use `--json` output for machine-readable responses.

### Automated Approval with Pre-Signed Bundles

**Scenario:** CI bot approves PRD if validation checks pass.

```bash
#!/bin/bash
# ci-approve-prd.sh

FEATURE_ID="FEAT-abc123"
GATE="prd"
SIGNER="ci-bot@example.com"

# Check status
STATUS=$(codepipe status --feature "$FEATURE_ID" --json)
PENDING=$(echo "$STATUS" | jq -r '.approvals.pending[]' | grep "$GATE" || echo "")

if [ -z "$PENDING" ]; then
  echo "No pending approval for $GATE"
  exit 0
fi

# Run validation checks
./scripts/validate-prd.sh "$FEATURE_ID"
VALIDATION_EXIT_CODE=$?

if [ "$VALIDATION_EXIT_CODE" -eq 0 ]; then
  # Approve
  RESULT=$(codepipe approve "$GATE" \
    --feature "$FEATURE_ID" \
    --signer "$SIGNER" \
    --approve \
    --comment "Automated validation passed" \
    --json)

  echo "$RESULT" | jq '.'
  exit 0
else
  # Deny
  RESULT=$(codepipe approve "$GATE" \
    --feature "$FEATURE_ID" \
    --signer "$SIGNER" \
    --deny \
    --comment "Automated validation failed: exit code $VALIDATION_EXIT_CODE" \
    --json)

  echo "$RESULT" | jq '.'
  exit 30  # Human action required
fi
```

### JSON Output Schema

```json
{
  "feature_id": "FEAT-abc123",
  "gate_type": "prd",
  "verdict": "approved",
  "signer": "user@example.com",
  "signer_name": "Jane Doe",
  "artifact_path": "artifacts/prd.md",
  "artifact_hash": "a3f5e8b9c2d1...",
  "approved_at": "2025-01-15T14:32:10Z",
  "rationale": "LGTM",
  "next_steps": [
    "PRD approved. Continue to specification authoring with: codepipe spec",
    "Or resume the pipeline with: codepipe resume"
  ]
}
```

---

## Offline Editing Guidance

For advanced users who need to manually edit approval records (e.g., bulk imports, migrations):

### Approvals File Location

```
.codepipe/runs/<feature_id>/approvals/approvals.json
```

### Schema

```json
{
  "schema_version": "1.0.0",
  "feature_id": "FEAT-abc123",
  "approvals": [
    {
      "schema_version": "1.0.0",
      "approval_id": "prd-a1b2c3d4",
      "feature_id": "FEAT-abc123",
      "gate_type": "prd",
      "verdict": "approved",
      "signer": "user@example.com",
      "signer_name": "Jane Doe",
      "approved_at": "2025-01-15T14:32:10Z",
      "artifact_hash": "a3f5e8b9c2d1f4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9",
      "artifact_path": "artifacts/prd.md",
      "rationale": "LGTM",
      "metadata": {
        "git_user": "user@example.com",
        "hostname": "workstation-01",
        "approved_at": "2025-01-15T14:32:10Z",
        "status": "approved"
      }
    }
  ],
  "metadata": {
    "updated_at": "2025-01-15T14:32:10Z",
    "total_approvals": 1
  }
}
```

### Manual Approval Record Creation

⚠ **Use with extreme caution.** Manual edits bypass hash validation and audit controls.

1. **Compute artifact hash:**

   ```bash
   sha256sum .codepipe/runs/FEAT-abc123/artifacts/prd.md
   ```

2. **Edit approvals.json:**
   - Add new approval object to `approvals` array
   - Use valid ISO 8601 timestamp for `approved_at`
   - Ensure `artifact_hash` matches computed hash
   - Update `metadata.updated_at` and `metadata.total_approvals`

3. **Update manifest pending/completed arrays:**

   ```bash
   # Edit manifest.json
   vim .codepipe/runs/FEAT-abc123/manifest.json

   # Move gate from approvals.pending to approvals.completed
   # Example:
   # "pending": []
   # "completed": ["prd"]
   ```

4. **Validate:**
   ```bash
   codepipe status --feature FEAT-abc123
   ```

---

## Timeout Handling & Escalation

By default, the pipeline **does not enforce approval timeouts**. Runs remain in `paused` state indefinitely until approved or manually failed.

### Notification Stub Integration (Future)

In later iterations, the Notification subsystem will support:

- **Slack/Email alerts** when approvals exceed turnaround targets
- **Escalation chains** for overdue approvals
- **Auto-denial** after configured timeout (disabled by default)

**Placeholder configuration** (not yet implemented):

```json
{
  "governance": {
    "approval_workflow": {
      "timeout_notifications": {
        "enabled": false,
        "prd_timeout_hours": 24,
        "spec_timeout_hours": 48,
        "escalation_targets": ["team-lead@example.com"]
      }
    }
  }
}
```

### Manual Timeout Handling

To manually expire stale approvals:

```bash
# 1. Check run age
codepipe status --feature FEAT-abc123

# 2. If overdue, deny approval
codepipe approve prd --deny --signer "timeout-bot@example.com" \
  --comment "Approval timed out after 72 hours"

# 3. Update status to failed
# (Requires manual manifest edit or future `codepipe fail` command)
```

---

## Security & Identity Verification

### Signer Identity

The `--signer` flag captures the approver's identity. Best practices:

- **Use email addresses** from Git config or SSO
- **Match Git commit author** for traceability
- **Avoid generic identities** like "admin" or "bot"

**Retrieve Git user:**

```bash
git config user.email
# Output: user@example.com

codepipe approve prd --signer "$(git config user.email)"
```

### Hash Integrity

Artifact hashes prevent approval tampering:

1. **Request approval:** Pipeline computes SHA-256 of artifact
2. **Grant approval:** CLI recomputes hash and validates match
3. **Hash mismatch:** Approval fails with exit code 30

**Example mismatch error:**

```
❌ Artifact modified after approval request:
Artifact hash mismatch: expected a3f5e8b9... but got c1d2e3f4...
The artifact may have been modified since approval was requested.

The artifact has been changed since the approval was requested.
Please review the updated artifact and request approval again.
```

### Bypass Hash Check (Emergency Use Only)

⚠ **Dangerous:** Only use when hash validation incorrectly fails (e.g., line-ending changes).

```bash
codepipe approve prd --signer "user@example.com" --skip-hash-check
```

**Warning logged to telemetry:**

```
WARN: Artifact hash validation skipped for prd gate
```

---

## Troubleshooting

### Error: "No pending approval for gate prd"

**Symptom:**

```
No pending approval for gate prd. Current pending approvals: spec
```

**Cause:** Approval already completed or not yet requested.

**Resolution:**

```bash
# Check approval status
codepipe status --feature FEAT-abc123

# If prd already approved, continue to next gate
codepipe resume
```

---

### Error: "Gate prd has already been approved"

**Symptom:**

```
Gate prd has already been approved. No pending approval required.
```

**Cause:** Attempting to re-approve a completed gate.

**Resolution:** No action needed. Proceed to next gate.

---

### Error: "Artifact hash mismatch"

**Symptom:**

```
Artifact hash mismatch: expected a3f5e8b9... but got c1d2e3f4...
```

**Cause:** Artifact modified after approval request.

**Resolution:**

1. Review changes to artifact
2. If changes are intentional, request new approval:
   ```bash
   codepipe prd  # Re-generate PRD
   codepipe approve prd --signer "user@example.com"
   ```
3. If changes are unintentional, revert artifact and approve

---

### Error: "No artifact found for gate type code"

**Symptom:**

```
No artifact found for gate type code. The artifact may not have been created yet.
```

**Cause:** Attempting to approve a gate before its artifact is created.

**Resolution:** Run the workflow step that creates the artifact first.

---

## Exit Codes

The `approve` command uses standardized exit codes:

| Exit Code | Meaning               | Description                                                         | Remediation                                           |
| --------- | --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| `0`       | Success               | Approval granted or denied successfully                             | None                                                  |
| `1`       | General Error         | Unexpected error during approval                                    | Check logs; contact support if persistent             |
| `10`      | Validation Error      | Invalid gate type, feature not found, or approval already completed | Review error message; validate inputs                 |
| `30`      | Human Action Required | Artifact modified after approval request; hash mismatch             | Review artifact changes; re-request approval if valid |

---

## Related Documentation

- [Approval Gates](./approval_gates.md) - Gate definitions and operational guidance
- [Init Playbook](./init_playbook.md) - Initialization and approval-related setup flow

---

## Version History

| Version | Date       | Changes                                                   |
| ------- | ---------- | --------------------------------------------------------- |
| 1.0.0   | 2025-01-15 | Initial approval playbook for I2.T6 (approval UX charter) |

---

## Quick Reference

### Grant Approval

```bash
codepipe approve <gate> --signer "<email>" [--comment "<text>"]
```

### Deny Approval

```bash
codepipe approve <gate> --deny --signer "<email>" --comment "<reason>"
```

### Check Status

```bash
codepipe status [--feature <id>]
```

### Resume After Approval

```bash
codepipe resume [--feature <id>]
```

### JSON Output (Automation)

```bash
codepipe approve <gate> --signer "<email>" --json
```

---

**End of Approval Playbook**
