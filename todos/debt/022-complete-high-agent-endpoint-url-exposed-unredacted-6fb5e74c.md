---
status: complete
priority: p2
issue_id: debt-022
category: security
severity: high
effort: small
confidence: 0.85
tags:
  - technical-debt
  - security
  - high
linear_issue_id: CDMCH-184
---

# Agent endpoint URL exposed unredacted

## Category
security

## Severity / Effort
high / small (confidence: 0.85)

## Affected Files
- src/core/config/validator.ts (lines 338-345)

## Description
validateEnvironmentVariables correctly redacts GitHub tokens and Linear API keys but returns the AGENT_ENDPOINT URL in plaintext, revealing internal infrastructure URLs.

## Suggested Remediation
Redact or mask the agent endpoint value. Show only hostname or replace with '***REDACTED***'.
