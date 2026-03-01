# Narrating Comments in approvalRegistry ts grantApproval Function

**ID:** 207
**Status:** complete
**Severity:** low
**Category:** ai-patterns
**Effort:** quick
**Confidence:** 0.82
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/workflows/approvalRegistry.ts` lines 175-250

## Description

approvalRegistry.ts contains inline comments that narrate sequential operations with no non-obvious logic: '// Validate artifact hash matches current artifact', '// Create new approval record', '// Append approval record'. Most of these comments restate the function call on the next line. The one exception is the withLock deadlock comment — that is a genuinely non-obvious constraint and should be kept.

## Suggested Remediation

Remove all narrating comments in grantApproval, denyApproval, and requestApproval except the deadlock avoidance note. The function names and variable names are self-documenting.
