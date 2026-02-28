# Shell Injection patchManager getCurrentGitRef Uses Shell Pipeline

**ID:** 103
**Status:** pending
**Severity:** high
**Category:** security
**Effort:** small
**Confidence:** 0.87
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/patchManager.ts` lines 332-341

## Description

execAsync (wrapping Node.js exec()) is called with a shell pipeline operator (||) to fall back from git symbolic-ref to git rev-parse. While the command string is a static literal, this establishes a shell-usage precedent in a module where all other git operations use execFileAsync. If this pattern is later extended with variable interpolation, it becomes an injection vector. The shell adds unnecessary attack surface.

## Suggested Remediation

Replace with two sequential execFileAsync calls: first try git symbolic-ref -q HEAD; if it throws, call git rev-parse HEAD as the fallback. This eliminates shell dependency and follows the pattern used everywhere else in patchManager.
