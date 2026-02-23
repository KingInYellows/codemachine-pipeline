---
status: complete
priority: p3
issue_id: debt-041
category: duplication
severity: medium
effort: small
confidence: 0.88
tags:
  - technical-debt
  - duplication
  - medium
linear_issue_id: CDMCH-186
---

# Linear adapter GraphQL call pattern repeated 4x

## Category
duplication

## Severity / Effort
medium / small (confidence: 0.88)

## Affected Files
- src/adapters/linear/LinearAdapter.ts (lines 453-647)

## Description
fetchIssue, fetchComments, updateIssue, postComment all follow the same assertRateLimitHeadroom/recordRequest/post pattern.

## Suggested Remediation
Extract a private executeGraphQL<T>(operation, query, variables) method.
