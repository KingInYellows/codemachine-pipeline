---
status: ready
priority: p3
issue_id: debt-043
category: architecture
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-188
---

# Queue subsystem fragmentation 12 files

## Category
architecture

## Severity / Effort
medium / medium (confidence: 0.85)

## Affected Files
- src/workflows/queueTypes.ts, queueStore.ts, queueCache.ts, queueConstants.ts, queueIntegrity.ts
- src/workflows/queueMemoryIndex.ts, queueOperationsLog.ts, queueSnapshotManager.ts
- src/workflows/queueCompactionEngine.ts, queueTaskManager.ts, queueV2Api.ts, queueValidation.ts

## Description
12 queue files (3486 LOC) flat alongside unrelated workflow files. queueConstants.ts (10 lines, 3 exports) signals over-extraction. Missing architectural boundary.

## Suggested Remediation
Move 12 queue files into src/workflows/queue/ directory with its own index.ts. Merge queueConstants.ts back into queueTypes.ts.
