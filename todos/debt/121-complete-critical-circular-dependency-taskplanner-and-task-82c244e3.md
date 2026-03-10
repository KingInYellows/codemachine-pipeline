# Circular Dependency taskPlanner and taskPlannerGraph

**ID:** 121
**Status:** complete
**Severity:** critical
**Category:** architecture
**Effort:** medium
**Confidence:** 1.0
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/taskPlanner.ts` line 34
- `src/workflows/taskPlannerGraph.ts` line 10

## Description

workflows/taskPlanner.ts imports from workflows/taskPlannerGraph.ts (buildDependencyGraph, computeTopologicalOrder, etc.) and taskPlannerGraph.ts imports the PlanSummary type from workflows/taskPlanner.ts, creating a confirmed circular dependency detected by madge. taskPlannerGraph was extracted from taskPlanner to reduce size, but the type import back into taskPlannerGraph re-closes the cycle.

## Suggested Remediation

Extract PlanSummary (and any other shared types) from taskPlanner.ts into a new src/workflows/taskPlannerTypes.ts file. Update both taskPlanner.ts and taskPlannerGraph.ts to import from that shared file. Run 'npm run deps:check' to confirm the cycle is resolved.
