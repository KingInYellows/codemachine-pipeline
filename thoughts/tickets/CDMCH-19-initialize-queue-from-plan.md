# CDMCH-19: initializeQueueFromPlan

## Summary

Wire TaskPlan into execution queue with proper task schema mapping.

## Scope

- Initialize queue per feature_id.
- Transform plan tasks into ExecutionTask list.
- Append to queue and handle empty plans.

## Steps

1. Add initializeQueueFromPlan to queue store.
2. Map TaskPlan tasks to ExecutionTask.
3. Update queue and handle empty plan case.

## Acceptance Criteria

- Queue initializes and appends tasks correctly.
- Empty plan handled gracefully.

## Dependencies

- CDMCH-15 (execution config).

## Estimate

- S (2)
