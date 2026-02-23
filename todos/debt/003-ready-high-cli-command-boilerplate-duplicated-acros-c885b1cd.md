---
status: ready
priority: p2
issue_id: debt-003
category: duplication
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - duplication
  - high
linear_issue_id: CDMCH-127
---

# CLI command boilerplate duplicated across 16 commands

## Category
duplication

## Severity / Effort
high / medium (confidence: 0.95)

## Affected Files
- src/cli/commands/doctor.ts
- src/cli/commands/init.ts
- src/cli/commands/validate.ts
- src/cli/commands/plan.ts
- src/cli/commands/start.ts
- src/cli/commands/resume.ts
- src/cli/commands/pr/create.ts
- src/cli/commands/pr/status.ts
- src/cli/commands/pr/reviewers.ts
- src/cli/commands/pr/disable-auto-merge.ts
- src/cli/commands/rate-limits.ts
- src/cli/commands/status/index.ts

## Description
Every CLI command repeats 30-50 lines of identical telemetry lifecycle: JSON_OUTPUT env var, logger/metrics/traceManager/commandSpan initialization, oclif error re-throw guard, metrics recording, and flush. Also includes identical telemetry import blocks (6-8 lines) in every file.

## Suggested Remediation
Extract a shared TelemetryCommand base class that encapsulates telemetry init, metrics recording, flush lifecycle, and oclif error re-throw. Each command calls super.runWithTelemetry() or uses a template method.
