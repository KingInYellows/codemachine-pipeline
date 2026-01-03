# CDMCH-17: TaskMapper for ExecutionTaskType

## Summary

Map ExecutionTaskType to CodeMachine workflows or native engine execution.

## Scope

- Implement mapping function and engine support utilities.
- Ensure complete coverage of task types.

## Steps

1. Define mapping table for task types.
2. Implement mapTaskToWorkflow and engine helpers.
3. Add unit tests for mapping coverage.

## Acceptance Criteria

- All task types map deterministically.
- Unsupported engines are rejected.

## Dependencies

- CDMCH-15 (execution config).

## Estimate

- S/M (3)
