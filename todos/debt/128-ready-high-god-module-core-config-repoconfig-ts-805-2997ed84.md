# God Module core config RepoConfig ts 805 Lines 23 Exports

**ID:** 128
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** small
**Confidence:** 0.85
**Scanner:** architecture-scanner

## Affected Files

- `src/core/config/RepoConfig.ts` lines 1-805

## Description

RepoConfig.ts is 805 lines with 23 exports. It contains Zod schema definitions, inferred TypeScript types, default value constants, and validation logic all in a single file. Mixing schema definitions with runtime defaults (RepoConfigDefaults.ts already exists as a separate file, suggesting an incomplete extraction) makes the config layer harder to test and navigate.

## Suggested Remediation

Separate schema definitions (Zod schemas) from TypeScript type exports into src/core/config/RepoConfigSchema.ts, keep defaults in the already-existing RepoConfigDefaults.ts, and create a thin src/core/config/RepoConfig.ts that re-exports all public types. Target each split file at under 300 lines.
