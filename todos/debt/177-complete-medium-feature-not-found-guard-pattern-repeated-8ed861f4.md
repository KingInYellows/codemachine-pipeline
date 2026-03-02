# Feature-Not-Found Guard Pattern Repeated in 9 Commands After selectFeatureId

**ID:** 177
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.93
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/rate-limits.ts` lines 94-103
- `src/cli/commands/research/create.ts` lines 91-100
- `src/cli/commands/research/list.ts` lines 76-83
- `src/cli/commands/context/summarize.ts` lines 132-138
- `src/cli/commands/pr/create.ts` lines 106-116
- `src/cli/commands/pr/status.ts` lines 83-93
- `src/cli/commands/pr/reviewers.ts` lines 80-90
- `src/cli/commands/pr/disable-auto-merge.ts` lines 79-89

## Description

Nine commands contain two near-identical guard statements back to back after selectFeatureId: the 'No feature run directory found' error and the 'Feature run directory not found: X' error. The PR commands use PRExitCode.VALIDATION_ERROR (which equals 10) and the non-PR commands use exit code 10 directly, but the logic is otherwise identical.

## Suggested Remediation

Add a requireFeatureId helper to src/cli/utils/runDirectory.ts that wraps selectFeatureId with these two guards and throws/calls this.error appropriately. Commands call requireFeatureId instead of selectFeatureId + manual guards.
