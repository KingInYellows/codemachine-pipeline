# PR Metadata Loaded Without Schema Validation in Deployment Context

**ID:** 109
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.83
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/deployment/context.ts` lines 83-98

## Description

PR metadata (pr.json) is loaded from the run directory with a bare type cast and no structural validation. This metadata drives deployment and auto-merge decisions including PR number lookup, branch identification, and merge strategy selection. A malformed or externally-tampered pr.json could cause deployment operations to target the wrong PR or branch. The PRMetadata type is defined but no Zod schema is used at this load boundary.

## Suggested Remediation

Add a Zod schema for PRMetadata to src/core/models/prMetadata.ts and use validateOrThrow(PRMetadataSchema, JSON.parse(prContent), 'pr metadata') at this load site. At minimum, validate that pr_number is a positive integer and branch is a non-empty string before using these values in API calls.
