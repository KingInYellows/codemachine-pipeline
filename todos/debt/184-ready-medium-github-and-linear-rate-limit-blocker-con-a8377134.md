# GitHub and Linear Rate-Limit Blocker Construction Duplicated in resume ts

**ID:** 184
**Status:** complete
**Severity:** medium
**Category:** duplication
**Effort:** small
**Confidence:** 0.92
**Scanner:** duplication-scanner

## Affected Files

- `src/cli/commands/resume.ts` lines 572-598

## Description

In resume.ts the attachRateLimitWarnings method contains nearly identical 10-line blocks for 'github' and 'linear' providers. The two blocks are copy-pasted with only the provider key name changed.

## Suggested Remediation

Replace the two identical provider-blocker if-blocks with a single loop: for (const providerName of ['github', 'linear']) { ... } using a typed key access. Or extract an appendIntegrationBlockers(integrationBlockers, providerName, providerData) helper.
