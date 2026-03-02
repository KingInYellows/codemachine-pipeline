# GitHub and Linear Integration Status Loading Duplicated in loadIntegrationsStatus

**ID:** 186
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.88
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/status/data.ts` lines 372-501

## Description

The loadIntegrationsStatus function in data.ts contains two near-identical 50-line blocks for the GitHub and Linear integrations. Both blocks: call RateLimitReporter.generateReport, extract provider data, build a rate_limit sub-object, check inCooldown and manualAckRequired to push warnings. The only real differences are the provider key string and additional PR/issue metadata loading.

## Suggested Remediation

Extract a buildProviderRateLimitStatus(providerReport, providerName) helper that returns the { rate_limit, warnings } sub-object. Call it for both github and linear. The additional PR/issue metadata loading remains provider-specific.
