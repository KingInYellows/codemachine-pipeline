# Research Coordinator Initialization Block Duplicated Across 3 Call Sites

**ID:** 180
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.88
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/research/create.ts` lines 105-113
- `src/cli/commands/research/list.ts` lines 88-96
- `src/cli/status/data.ts` lines 606-614

## Description

The coordinator construction pattern appears identically in research/create.ts, research/list.ts, and status/data.ts: createResearchCoordinator({ repoRoot: process.cwd(), runDir, featureId }, logger, metrics). In all three locations the arguments are identical in structure.

## Suggested Remediation

Add a createCoordinatorForRun(runDir, featureId, logger, metrics) convenience factory in researchCoordinator.ts that defaults repoRoot to process.cwd(). All three call sites use this factory.
