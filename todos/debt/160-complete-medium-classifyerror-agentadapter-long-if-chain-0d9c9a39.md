# classifyError AgentAdapter Long If-Chain on Lowercased Error Messages

**ID:** 160
**Status:** complete
**Severity:** medium
**Category:** complexity
**Effort:** small
**Confidence:** 0.82
**Scanner:** complexity-scanner

## Affected Files

- `src/adapters/agents/AgentAdapter.ts` lines 491-523

## Description

The classifyError method uses 6 ||-chained string includes for the transient category and 4 for the humanAction category. There is no separation between HTTP status codes (numeric strings '503', '429') and natural-language error substrings. This pattern is fragile and will grow as more error patterns are discovered.

## Suggested Remediation

Define TRANSIENT_PATTERNS: RegExp and HUMAN_ACTION_PATTERNS: RegExp as module-level constants. The method body becomes two pattern.test(message) checks. HTTP status codes should be extracted from a structured error property rather than parsed from message strings.
