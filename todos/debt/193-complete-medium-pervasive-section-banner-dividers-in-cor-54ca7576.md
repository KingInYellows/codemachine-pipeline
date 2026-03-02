# Pervasive Section-Banner Dividers in Core Config and Telemetry Files

**ID:** 193
**Status:** complete
**Severity:** medium
**Category:** ai-patterns
**Effort:** small
**Confidence:** 0.95
**Scanner:** ai-patterns-scanner

## Affected Files

- `src/core/config/RepoConfig.ts` lines 1-500
- `src/persistence/runDirectoryManager.ts` lines 1-1144
- `src/core/models/Feature.ts` lines 1-304
- `src/telemetry/traces.ts` lines 1-400
- `src/telemetry/rateLimitLedger.ts` lines 1-350

## Description

RepoConfig.ts has 28 section-banner dividers — the highest count in the codebase. runDirectoryManager.ts, Feature.ts, traces.ts, and rateLimitLedger.ts each have 12-20 banners. The banner density across 56 files totals 527 occurrences (averaging nearly 10 per file), indicating a systemwide pattern applied by code generation rather than intentional human choice.

## Suggested Remediation

Establish a linting rule or team convention: no section-banner dividers inside files. Navigation belongs to the file system, not ASCII art. Do a single-pass removal across all 56 affected files.
