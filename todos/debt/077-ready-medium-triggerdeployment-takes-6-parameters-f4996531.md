---
status: ready
priority: p3
issue_id: debt-077
category: complexity
severity: medium
effort: small
confidence: 0.80
tags:
  - technical-debt
  - complexity
  - medium
linear_issue_id: CDMCH-222
---

# triggerDeployment takes 6 parameters

## Category
complexity

## Severity / Effort
medium / small (confidence: 0.80)

## Affected Files
- src/workflows/deploymentTrigger.ts (lines 178-308)

## Description
triggerDeployment() accepts 6 parameters: runDirectory, featureId, config, githubAdapter, logger, options.

## Suggested Remediation
Bundle runDirectory, featureId, config, logger into DeploymentContext (which already exists).
