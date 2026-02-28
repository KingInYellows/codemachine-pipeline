# writeActionQueue Skips Corrupted Lines Silently Without Logging

**ID:** 119
**Status:** pending
**Severity:** low
**Category:** security
**Effort:** quick
**Confidence:** 0.73
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/writeActionQueue.ts` lines 598-614

## Description

Corrupted lines in the JSONL queue file are silently dropped with no logging or metric increment. This means queue corruption (whether from disk errors, concurrent writes, or malicious tampering) is invisible to operators. A partially-corrupted queue could result in actions being silently lost without any observable signal, causing pipeline runs to complete without executing all required write actions.

## Suggested Remediation

Add a logger.warn() call in the catch block with the line number and a truncated snippet of the corrupted content. Increment a metric (e.g. queue_corrupted_lines_total) for observability. Consider adding an integrity check at load time: compare the number of loaded actions against the total_actions field in the queue manifest and emit a warning if they differ.
