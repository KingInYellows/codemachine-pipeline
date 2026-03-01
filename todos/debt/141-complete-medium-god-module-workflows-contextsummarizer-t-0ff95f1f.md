# God Module workflows contextSummarizer ts 765 Lines 12 Exports

**ID:** 141
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.78
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/contextSummarizer.ts` lines 1-765

## Description

contextSummarizer.ts is 765 lines with 12 exports, handling token estimation, summarization client orchestration, cost tracking integration, persistence, and redaction via RedactionEngine imported from telemetry. The summarizerClients/ subdirectory was partially extracted but only contains one file (localSummarizerClient.ts), leaving the bulk of summarization logic in the main file.

## Suggested Remediation

Extract the context truncation and token budget logic to src/workflows/contextBudget.ts, and the persistence read/write logic to src/workflows/summaryStore.ts. The SummarizerClient interface and related types should move to src/workflows/summarizerClients/types.ts. Target contextSummarizer.ts at under 300 lines.
