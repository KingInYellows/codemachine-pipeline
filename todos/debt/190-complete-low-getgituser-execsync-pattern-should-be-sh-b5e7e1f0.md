# getGitUser execSync Pattern Should Be Shared Utility Not Private to Approve

**ID:** 190
**Status:** complete
**Severity:** low
**Category:** duplication
**Effort:** quick
**Confidence:** 0.80
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/approve.ts` lines 427-437

## Description

The getGitUser() private method in approve.ts is a utility that could reasonably appear in other commands needing the git user identity. The startHelpers.ts already has findGitRoot() as a shared utility — getGitUser() should be there too rather than private to Approve.

## Suggested Remediation

Move getGitUser() to src/cli/startHelpers.ts (or a new src/cli/utils/gitUtils.ts) as an exported function. Import it in approve.ts.
