# Approval Gates Reference

## Overview

Approval gates are checkpoints in the AI Feature Pipeline where human review and authorization are required before proceeding to the next phase. Each gate validates that the work product meets quality, security, and business requirements before autonomous agents continue execution.

**Implements:**
- ADR-5 (Approval Workflow): Human-in-the-loop enforcement
- Blueprint Rulebook: Gate transitions and accountability

---

## Gate Definitions

### 1. PRD Gate

**Transition:** Research → Specification

**Artifact:** `artifacts/prd.md`

**Purpose:** Validate that the product requirements document accurately captures:
- Problem statement and business justification
- Goals and non-goals
- Success criteria and acceptance criteria
- Risks and mitigation strategies
- Open questions requiring research

**Review Checklist:**
- [ ] Problem statement is clear and addresses a real need
- [ ] Goals are specific, measurable, and achievable
- [ ] Acceptance criteria are testable
- [ ] Risks are identified with reasonable mitigations
- [ ] No security or privacy concerns
- [ ] Scope is appropriate for the team's capacity

**Approval Command:**
```bash
codepipe approve prd --signer "<your-email>" --comment "LGTM"
```

**Typical Turnaround:** 24 hours

---

### 2. Spec Gate

**Transition:** PRD → Planning

**Artifact:** `artifacts/spec.md`

**Purpose:** Approve the technical specification including:
- System architecture and component design
- API contracts and data models
- Technology stack and dependencies
- Performance and scalability considerations
- Testing strategy

**Review Checklist:**
- [ ] Architecture aligns with system constraints
- [ ] API contracts are well-defined
- [ ] Security controls are appropriate
- [ ] Performance targets are realistic
- [ ] Testing strategy is comprehensive
- [ ] Dependencies are acceptable

**Approval Command:**
```bash
codepipe approve spec --signer "<your-email>" --comment "Architecture approved"
```

**Typical Turnaround:** 48 hours

---

### 3. Plan Gate

**Transition:** Spec → Code

**Artifact:** `artifacts/plan.json`

**Purpose:** Review the execution plan including:
- Task breakdown and dependencies
- Resource allocation
- Estimated effort and timeline
- Risk mitigation steps

**Review Checklist:**
- [ ] Tasks are properly scoped and sequenced
- [ ] Dependencies are correctly identified
- [ ] Resource allocation is realistic
- [ ] Timeline is achievable
- [ ] Rollback plan exists

**Approval Command:**
```bash
codepipe approve plan --signer "<your-email>"
```

**Typical Turnaround:** 12 hours

---

### 4. Code Gate

**Transition:** Plan → PR

**Artifact:** Generated code, tests, documentation

**Purpose:** Validate code quality, security, and spec adherence:
- Code follows project conventions
- Security best practices applied
- Tests provide adequate coverage
- Documentation is complete

**Review Checklist:**
- [ ] Code is readable and maintainable
- [ ] No security vulnerabilities (SQL injection, XSS, etc.)
- [ ] Test coverage meets requirements
- [ ] Error handling is robust
- [ ] Performance is acceptable
- [ ] Documentation is accurate

**Approval Command:**
```bash
codepipe approve code --signer "<your-email>" --comment "Code review passed"
```

**Typical Turnaround:** 4 hours

---

### 5. PR Gate

**Transition:** Code → Deploy

**Artifact:** Pull request in GitHub

**Purpose:** Authorize merge to target branch:
- CI/CD checks pass
- Code review approved
- Branch protection requirements met
- Conflicts resolved

**Review Checklist:**
- [ ] All CI/CD checks are green
- [ ] Code review approved by required reviewers
- [ ] No merge conflicts
- [ ] Commit messages are clear
- [ ] Changelog updated (if required)

**Approval Command:**
```bash
codepipe approve pr --signer "<your-email>"
```

**Typical Turnaround:** 2 hours

---

### 6. Deploy Gate

**Transition:** PR → Production

**Artifact:** Deployment manifest, rollout plan

**Purpose:** Authorize production deployment:
- Deployment plan is sound
- Rollback procedure is documented
- Monitoring is configured
- Stakeholders are notified

**Review Checklist:**
- [ ] Deployment plan is safe and tested
- [ ] Rollback procedure is documented and tested
- [ ] Monitoring and alerts are configured
- [ ] Database migrations are reversible (if applicable)
- [ ] Stakeholders are informed
- [ ] Deployment window is appropriate

**Approval Command:**
```bash
codepipe approve deploy --signer "<your-email>" --comment "Approved for production"
```

**Typical Turnaround:** 1 hour

---

## Gate Enforcement Rules

### Mandatory Gates

By default, all gates are **mandatory** and must receive explicit approval before the pipeline proceeds. This ensures human oversight at every critical transition.

To disable specific gates, edit `.codepipe/config.json`:

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
    }
  }
}
```

### Sequential Enforcement

Gates must be completed **in order**. You cannot approve the Spec gate before the PRD gate is approved.

### Artifact Integrity

Each approval is tied to the **SHA-256 hash** of the artifact. If the artifact is modified after approval, the approval becomes invalid and must be re-requested.

---

## Approval Best Practices

### 1. Review Promptly

Delayed approvals block the entire pipeline. Aim to review within the typical turnaround time for each gate.

### 2. Provide Constructive Feedback

When denying approval, include **specific, actionable feedback**:

```bash
codepipe approve prd --deny --signer "reviewer@example.com" \
  --comment "Missing acceptance criteria for error cases. Please add criteria for invalid input, network failures, and timeout scenarios."
```

### 3. Verify Artifact Hash

The CLI automatically validates artifact hashes, but you can manually verify:

```bash
sha256sum .codepipe/runs/<feature-id>/artifacts/prd.md
```

### 4. Use Version Control for Approvals

Approval records are stored in `approvals/approvals.json`. Commit this file to version control for audit trails.

### 5. Delegate When Appropriate

For routine approvals, consider automation:

```bash
# CI bot approves PRD if validation passes
./scripts/auto-approve-prd.sh <feature-id>
```

---

## Troubleshooting

### "No pending approval for gate prd"

**Cause:** Approval already completed or not yet requested.

**Resolution:**
```bash
codepipe status --feature <feature-id>
```

### "Artifact hash mismatch"

**Cause:** Artifact modified after approval request.

**Resolution:**
1. Review changes
2. Re-request approval if changes are valid
3. Revert changes if they were accidental

### "Gate spec cannot be approved before prd"

**Cause:** Gates must be completed sequentially.

**Resolution:** Approve prd gate first.

---

## Related Documentation

- [Approval Playbook](./approval_playbook.md) - Detailed workflows and examples
- [ADR-5: Approval Workflow](../adr/005-approval-workflow.md) - Design decisions
- [Init Playbook](./init_playbook.md) - Configuration setup

---

**Version:** 1.0.0
**Last Updated:** 2025-01-15
