---
status: complete
priority: p3
issue_id: debt-051
category: security
severity: medium
effort: medium
confidence: 0.85
tags:
  - technical-debt
  - security
  - medium
linear_issue_id: CDMCH-196
---

# No rate limiting on agent endpoint requests

## Category

security

## Severity / Effort

medium / medium (confidence: 0.85)

## Affected Files

- src/core/config/RepoConfig.ts (line 224)
- src/adapters/agents/AgentAdapter.ts (lines 334-360)

## Description

agent_requests_per_hour config value is defined in schema but never enforced at runtime. LinearAdapter has rate limiting but AgentAdapter does not.

## Suggested Remediation

Implement client-side rate limiting similar to LinearAdapter's sliding window approach.
