# PR Command Feature-ID Validation Preamble Duplicated Across Four PR Subcommands

**ID:** 176
**Status:** complete
**Severity:** high
**Category:** duplication
**Effort:** small
**Confidence:** 0.96
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/pr/create.ts` lines 102-119
- `src/cli/commands/pr/status.ts` lines 80-97
- `src/cli/commands/pr/reviewers.ts` lines 77-94
- `src/cli/commands/pr/disable-auto-merge.ts` lines 76-94

## Description

The following 10-line block is copy-pasted verbatim in all four PR subcommands: resolveRunDirectorySettings(), selectFeatureId, feature-ID validation guards, and loadPRContext. This pattern appears in all four PR subcommands with no variation.

## Suggested Remediation

Add a resolveFeatureAndPRContext helper to src/cli/pr/shared.ts that performs the settings resolution, feature ID selection, validation errors, and loadPRContext call, returning the context. All four commands call this helper.
