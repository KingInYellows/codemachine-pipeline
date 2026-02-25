# validateBranchName Allowlist Gaps Allow Shell Metacharacters

**ID:** 106
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.88
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/branchManager.ts` lines 175-196

## Description

The validateBranchName function does not reject double-quote characters ("), backticks (`), dollar signs ($), or parentheses. These characters can break out of a double-quoted shell argument. When branch names flow into exec() template-literal commands in branchManager.ts, the inadequate denylist is the last line of defense before shell execution. For example, a branchName of 'feature/foo" && id #' would pass validateBranchName and then inject the id command.

## Suggested Remediation

Switch the validator to an allowlist approach: only permit characters matching /^[a-zA-Z0-9._\/\-]+$/ which is sufficient for all valid git branch name formats. This is a defense-in-depth measure independent of the execFile migration.
