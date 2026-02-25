# contextSummarizer ChunkMetadata Deserialized Without Schema Validation

**ID:** 112
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.75
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/contextSummarizer.ts` line 357

## Description

ChunkMetadata is loaded from a file in the run directory and used to drive context summarization decisions (which chunks to include, token counts, etc.). The type cast bypasses any structural validation. If the metadata file is malformed, incorrect token counts or chunk boundaries could cause the summarizer to exceed token budgets or produce incorrect summaries passed to the agent.

## Suggested Remediation

Define or reuse a Zod schema for ChunkMetadata and apply validateOrThrow after JSON.parse. At minimum, validate that required numeric fields (token counts, indices) are non-negative integers.
