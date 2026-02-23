---
status: complete
priority: p3
issue_id: debt-028
category: duplication
severity: medium
effort: small
confidence: 0.93
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-155
---

# enableAutoMerge-disableAutoMerge near-identical

## Category
duplication

## Severity / Effort
medium / small (confidence: 0.93)

## Affected Files
- src/adapters/github/GitHubAdapter.ts (lines 455-581)

## Description
enableAutoMerge() and disableAutoMerge() share identical boilerplate (~65 lines each) with only the mutation string and log messages differing. The node_id extraction pattern is also duplicated.

## Suggested Remediation
Extract a private executeGraphQLMutation() method and a getPRNodeId() helper.
