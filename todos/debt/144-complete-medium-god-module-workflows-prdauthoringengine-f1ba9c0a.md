# God Module workflows prdAuthoringEngine ts 681 Lines 12 Exports

**ID:** 144
**Status:** complete
**Severity:** medium
**Category:** architecture
**Effort:** medium
**Confidence:** 0.75
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/prdAuthoringEngine.ts` lines 1-681

## Description

prdAuthoringEngine.ts is 681 lines with 12 exports, covering PRD document drafting, metadata persistence, approval state checks, research task integration, and file I/O with locking. It conflates the authoring algorithm with persistence (loadPRDMetadata, isPRDApproved) and approval state management. specComposer.ts imports from prdAuthoringEngine.ts creating a cross-workflow dependency chain.

## Suggested Remediation

Extract PRD persistence and approval state (loadPRDMetadata, isPRDApproved) to src/workflows/prdStore.ts. Keep prdAuthoringEngine.ts focused on the AI-driven drafting algorithm (draftPRD) targeting under 300 lines. This also reduces the coupling into specComposer.ts.
