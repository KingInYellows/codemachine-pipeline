# contextAggregator repoRoot Resolved Without Git Boundary Check

**ID:** 115
**Status:** complete
**Severity:** low
**Category:** security
**Effort:** quick
**Confidence:** 0.72
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/contextAggregator.ts` lines 164-176

## Description

The repoRoot is derived by taking the dirname of a config file resolved relative to process.cwd(). If process.cwd() is not a git repository root (e.g. if the CLI is invoked from a subdirectory), the derived repoRoot may be incorrect but will still be used to scan the filesystem. There is no check that repoRoot is within the git repository boundary. On misconfiguration, the aggregator could scan directories outside the intended repository.

## Suggested Remediation

Derive repoRoot from git rev-parse --show-toplevel (using execFileAsync) rather than from the config file location. After resolving repoRoot, add an assertion that all discovered file paths are contained within repoRoot using path.relative() and checking for leading '..' segments.
