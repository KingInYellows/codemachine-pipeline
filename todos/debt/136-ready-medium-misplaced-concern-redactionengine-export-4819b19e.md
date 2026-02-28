# Misplaced Concern RedactionEngine Exported from telemetry logger ts

**ID:** 136
**Status:** pending
**Severity:** medium
**Category:** architecture
**Effort:** small
**Confidence:** 0.85
**Scanner:** architecture-scanner

## Affected Files

- `src/telemetry/logger.ts` lines 97-222
- `src/workflows/contextSummarizer.ts` line 24
- `src/cli/commands/context/summarize.ts` line 15

## Description

RedactionEngine is defined and exported from src/telemetry/logger.ts. It is imported by src/workflows/contextSummarizer.ts and src/cli/commands/context/summarize.ts. Redaction is a security/data-handling concern orthogonal to structured logging; embedding it in the logger file causes the logger module to have two distinct responsibilities. It is also imported directly by the workflow layer, creating a workflow-to-telemetry coupling for a non-telemetry purpose.

## Suggested Remediation

Move RedactionEngine to src/utils/redaction.ts (a redaction.ts already exists in src/utils/ — verify it is distinct from the logger one). Update the two importers to use the utils path. Keep the logger focused on log formatting and emission.
