# Issue Resolution Plan

## Selected Issue
- ID: 31
- Title: Phase 3.4: Add CodeMachine execution metrics to telemetry
- Labels: Backend, Feature

## Source
```
## Overview

Add CodeMachine-specific metrics to ExecutionMetricsHelper.

## Implementation

**File:** `src/telemetry/executionMetrics.ts`

Add new metrics:

* `codemachine_execution_total{engine, status}` - Counter
* `codemachine_execution_duration_ms{engine}` - Histogram
* `codemachine_retry_total{engine}` - Counter

```typescript
recordCodeMachineExecution(
  engine: string,
  status: 'success' | 'failure' | 'timeout',
  durationMs: number,
): void;

recordCodeMachineRetry(engine: string): void;
```

## PRD Requirements

Implements: NFR-OBS-001, success metrics from PRD

## Acceptance Criteria

- [ ] Metrics emitted for each execution
- [ ] Duration histogram populated
- [ ] Retry counter incremented
- [ ] Metrics exposed via existing telemetry system
```

## Stack Plan
- Status: PLANNED
- Stack Strategy:
```json
{
  "issue_id": 31,
  "estimated_complexity": "LOW",
  "stack_strategy": [
    {
      "order": 1,
      "branch": "codemachine-metrics",
      "intent": "feat: add codemachine execution metrics instrumentation",
      "changes": [
        "Add CodeMachine metric names to ExecutionMetrics",
        "Add recordCodeMachineExecution and recordCodeMachineRetry helpers"
      ]
    },
    {
      "order": 2,
      "branch": "codemachine-metrics-tests",
      "intent": "test: cover codemachine metrics emission",
      "changes": [
        "Add unit tests for new CodeMachine metrics in executionMetrics.spec.ts"
      ],
      "depends_on": "codemachine-metrics"
    }
  ]
}
```

## Progress
- [x] Phase 1: Stack planning complete
- [ ] Phase 2: Stack implementation in progress
- [ ] Phase 3: Submission complete
- [ ] Phase 4: Final verification complete

## Stack Execution
- [x] Layer 1: codemachine-metrics
- [ ] Layer 2: codemachine-metrics-tests
