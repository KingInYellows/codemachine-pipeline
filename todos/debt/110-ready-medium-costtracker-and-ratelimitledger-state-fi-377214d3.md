# CostTracker and RateLimitLedger State Files Without Runtime Validation

**ID:** 110
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.80
**Scanner:** security-debt-scanner

## Affected Files

- `src/telemetry/costTracker.ts` lines 529-548
- `src/telemetry/rateLimitLedger.ts` lines 127-137

## Description

The cost tracker and rate limit ledger restore their internal state from JSON files using bare type casts. CostTrackerState contains financial data (total cost in USD, token counts, budget limits). If the persisted file contains manipulated values (inflated budget, zeroed cost totals, incorrect token counts), the tracker will operate with incorrect state for the entire pipeline run. Rate limit ledger tampering could cause the system to exceed API rate limits by believing it has more headroom than it does.

## Suggested Remediation

Define Zod schemas for CostTrackerState and RateLimitLedgerData and validate on load. For financial data in costTracker, add range checks: totalCostUsd must be >= 0, budget must be a positive number, token counts must be non-negative integers. Consider adding an HMAC or SHA-256 checksum of the state written at save time and verified on load to detect external tampering.
