# God Module workflows contextAggregator ts 678 Lines

**ID:** 142
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.75
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/contextAggregator.ts` lines 1-678

## Description

contextAggregator.ts is 678 lines handling file discovery, git history integration, context document assembly, exclusion filtering, and token budgeting. It imports from persistence, telemetry, and core models, making it a cross-cutting aggregation module that has grown beyond the 500-line threshold. contextRanking.ts was already extracted as a sibling, but the aggregator itself remains oversized.

## Suggested Remediation

Extract the file discovery and git-history walking logic to src/workflows/contextFileDiscovery.ts and the context document assembly logic to src/workflows/contextDocumentBuilder.ts. Keep contextAggregator.ts as the thin orchestrator that calls discovery, ranking (already separate), and assembly.
