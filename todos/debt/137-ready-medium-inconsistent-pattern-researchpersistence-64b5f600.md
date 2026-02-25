# Inconsistent Pattern researchPersistence ts in workflows Instead of persistence

**ID:** 137
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.88
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/researchPersistence.ts` lines 1-162

## Description

src/workflows/researchPersistence.ts is a pure persistence module (file I/O for research task artifacts: save, load, list, cache lookup). Its 162 lines contain no workflow orchestration logic — only filesystem operations. All other persistence modules live in src/persistence/. Placing this file in workflows/ violates the established layer convention and makes it non-discoverable from the persistence barrel.

## Suggested Remediation

Move src/workflows/researchPersistence.ts to src/persistence/researchStore.ts. Update all importers (researchCoordinator.ts is the primary consumer). Add a re-export from src/persistence/index.ts. The persistence barrel then becomes the single authoritative index for all storage-layer code.
