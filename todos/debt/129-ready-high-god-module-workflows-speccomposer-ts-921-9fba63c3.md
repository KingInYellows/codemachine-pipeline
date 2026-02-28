# God Module workflows specComposer ts 921 Lines

**ID:** 129
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** medium
**Confidence:** 0.85
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/specComposer.ts` lines 1-921

## Description

specComposer.ts is 921 lines. While the export count is modest, the file handles specification authoring, parsing, metadata loading, file I/O with locks, hash computation, and PRD integration. At 921 lines it significantly exceeds the 500-line threshold. Given that specParsing.ts was already extracted as a sibling, the pattern of incremental extraction is established but incomplete.

## Suggested Remediation

Extract spec file I/O operations (read/write with locking) to src/workflows/specStore.ts and spec metadata loading to src/workflows/specMetadata.ts. Keep specComposer.ts focused on the composition/authoring orchestration logic, targeting under 300 lines.
