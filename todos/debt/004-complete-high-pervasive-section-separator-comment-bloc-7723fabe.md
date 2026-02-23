---
status: complete
priority: p2
issue_id: debt-004
category: ai-patterns
severity: high
effort: medium
confidence: 0.95
tags:
  - technical-debt
  - ai-patterns
  - high
linear_issue_id: CDMCH-131
---

# Pervasive section-separator comment blocks

## Category

ai-patterns

## Severity / Effort

high / medium (confidence: 0.95)

## Affected Files

- 622 instances across 71 source files
- Includes specific files: src/workflows/codemachineTypes.ts (54% comments), src/core/models/index.ts (barrel)

## Description

622 instances of ASCII box-drawing section separators (// ====...====) found across 71 files (~4.7 per file average). Pattern is repeated mechanically regardless of section size. Some sections contain only 2-3 lines of code between separators.

## Suggested Remediation

Remove separators from files under 300 lines where sections are self-evident. Keep only in large files where they genuinely aid navigation. This is scriptable.
