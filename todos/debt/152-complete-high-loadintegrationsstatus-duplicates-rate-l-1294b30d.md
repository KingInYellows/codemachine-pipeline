# loadIntegrationsStatus Duplicates Rate-Limit Loading Logic for GitHub and Linear

**ID:** 152
**Status:** complete
**Severity:** high
**Category:** complexity
**Effort:** medium
**Confidence:** 0.91
**Scanner:** complexity-scanner

## Affected Files

- `src/cli/status/data.ts` lines 364-502

## Description

Lines 364-502 in data.ts contain two structurally identical blocks (GitHub and Linear integration loading) each ~60 lines. RateLimitReporter.generateReport(runDir) is called twice. The nesting depth reaches 4 levels inside the nested try-catch within the Linear block. The two blocks mirror each other exactly with only provider key names differing.

## Suggested Remediation

Extract a generic loadProviderIntegrationStatus(runDir, providerKey, logger) helper that loads rate-limit data for one provider key. Call it once for GitHub and once for Linear, eliminating the duplicated loop body and the double generateReport call.
