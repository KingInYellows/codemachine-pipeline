# Backward Compat Re-export Shims Left Indefinitely deploymentTrigger

**ID:** 134
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.90
**Scanner:** architecture-scanner

## Affected Files

- `src/workflows/deploymentTrigger.ts` lines 1-30
- `src/workflows/deploymentTriggerContext.ts` line 1
- `src/workflows/deploymentTriggerExecution.ts` line 1
- `src/workflows/deploymentTriggerTypes.ts` line 1

## Description

Four shim files at the workflows root exist solely to re-export from the src/workflows/deployment/ subdirectory for backward compatibility. The comment explicitly states 'New code should import directly from ./deployment'. Without a migration plan or deprecation deadline, these shims will persist indefinitely, confusing developers about where canonical imports should come from.

## Suggested Remediation

Audit all importers of the four shim files using grep. Update them to import from src/workflows/deployment/ directly. Once all importers are updated, delete the four shim files. Add a lint rule or CI check that blocks re-introducing imports from the deprecated paths.
