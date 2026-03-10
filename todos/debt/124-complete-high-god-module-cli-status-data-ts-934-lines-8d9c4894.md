# God Module cli status data ts 934 Lines 15 Exports

**ID:** 124
**Status:** complete
**Severity:** high
**Category:** architecture
**Effort:** medium
**Confidence:** 0.90
**Scanner:** architecture-scanner

## Affected Files

- `src/cli/status/data.ts` lines 1-934

## Description

cli/status/data.ts contains 934 lines across 15 exported async functions, each loading a distinct status domain: manifest, traceability, plan, validation, branch protection, integrations, rate limits, research, summarization metadata, cost telemetry, and PR metadata. This single file is the entire data-access layer for the status command and imports from workflows, persistence, telemetry, adapters, and core simultaneously.

## Suggested Remediation

Group the load functions by domain into focused modules: src/cli/status/data/planData.ts, src/cli/status/data/researchData.ts, src/cli/status/data/telemetryData.ts, src/cli/status/data/branchData.ts, etc. Expose a single re-export barrel at src/cli/status/data/index.ts. Each module stays under 200 lines.
