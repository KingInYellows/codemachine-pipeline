# discoverFiles Follows Symlinks Without Repository Boundary Check

**ID:** 116
**Status:** pending
**Severity:** low
**Category:** security
**Effort:** quick
**Confidence:** 0.78
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/contextAggregator.ts` lines 232-282

## Description

The discoverFiles function uses readdir with withFileTypes but does not check entry.isSymbolicLink(). On Linux/macOS, entry.isDirectory() and entry.isFile() return true for symlinks pointing to directories and files respectively (the check follows the symlink). A symlink within the repository pointing outside the repository root (e.g. /etc, /home/user/.ssh) would be followed during the recursive scan, and files from outside the boundary would be included in the context document sent to the agent.

## Suggested Remediation

Check entry.isSymbolicLink() before processing entries. For symlinks, resolve the real path using fs.realpath() and verify it is contained within repoRoot using the same isPathContained check used in cliExecutionEngine.ts. Skip any symlink whose resolved path falls outside the repository root.
