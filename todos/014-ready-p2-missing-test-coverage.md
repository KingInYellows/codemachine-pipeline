---
status: ready
priority: p2
issue_id: "014"
tags: [code-review, testing, pr-466]
dependencies: []
---

# Critical Test Coverage Gaps

## Problem Statement

Several important code paths lack test coverage:
1. `child.on('error')` event handler in CodeMachineCLIAdapter — untested
2. Timeout SIGTERM -> SIGKILL escalation — untested
3. Credential stdin write/failure — untested
4. `env_credential_keys` gathering — untested
5. PATH fallback success after npm resolution failure — untested

## Findings

- **Test Analyzer**: 3 critical gaps (error event, timeout, credentials), 2 important gaps
- **Silent Failure Hunter**: Credential failure path untested

## Proposed Solutions

### Option A: Add targeted tests for each gap (Recommended)
- Add test for spawn error event
- Add test for SIGTERM->SIGKILL timeout escalation
- Add test for credential stdin write and failure
- Add test for env_credential_keys population
- Add test for PATH fallback after npm failure
- **Effort**: Medium
- **Risk**: Low

## Technical Details

- **Affected files**: `tests/unit/codeMachineCLIAdapter.test.ts`

## Acceptance Criteria

- [ ] child.on('error') tested
- [ ] Timeout escalation SIGTERM->SIGKILL tested
- [ ] Credential stdin write success and failure tested
- [ ] env_credential_keys tested
- [ ] PATH fallback tested

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | — |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
