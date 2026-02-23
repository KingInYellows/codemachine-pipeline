---
status: complete
priority: p3
issue_id: debt-061
category: architecture
severity: medium
effort: small
confidence: 0.80
tags:
  - technical-debt
  - architecture
  - medium
linear_issue_id: CDMCH-206
---

# Inconsistent adapter type file patterns

## Category
architecture

## Severity / Effort
medium / small (confidence: 0.80)

## Affected Files
- src/adapters/github/GitHubAdapterTypes.ts (220 lines)
- src/adapters/linear/LinearAdapter.ts (types inline)
- src/adapters/agents/AgentAdapter.ts (types inline)

## Description
GitHub adapter has dedicated types file but Linear and Agent adapters embed types inline. Inconsistent organization.

## Suggested Remediation
Create LinearAdapterTypes.ts and AgentAdapterTypes.ts following the GitHubAdapterTypes.ts pattern.
