---
status: complete
priority: p4
issue_id: debt-086
category: ai-patterns
severity: low
effort: medium
confidence: 0.70
tags:
  - technical-debt
  - ai-patterns
  - low
linear_issue_id: CDMCH-142
---

# Over-fragmented spec subsystem 4 files

## Category

ai-patterns

## Severity / Effort

low / medium (confidence: 0.70)

## Affected Files

- src/workflows/specComposer.ts, specGenerators.ts, specParsing.ts, specRendering.ts

## Description

Spec feature split across 4 files (1191 LOC). Generators (188) and rendering (191) are small enough to be sections of composer.

## Suggested Remediation

Consider merging specGenerators.ts and specRendering.ts into specComposer.ts.
