# DAG Metadata Payload Construction Duplicated Between plan ts and status data ts

**ID:** 185
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** quick
**Confidence:** 0.88
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/plan.ts` lines 288-298
- `src/cli/status/data.ts` lines 217-227

## Description

The block that constructs dag_metadata from planSummary.dag is copy-pasted between plan.ts buildPlanPayload and status/data.ts loadPlanStatus. Both files do this identical spread construction.

## Suggested Remediation

Extract a buildDagMetadata(dag: PlanSummary['dag']) function into taskPlanner.ts or a shared plan utilities module. Both plan.ts and status/data.ts call this function.
