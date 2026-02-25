# Approval Registry Loads ApprovalsFile Without Zod Validation

**ID:** 108
**Status:** pending
**Severity:** medium
**Category:** security
**Effort:** small
**Confidence:** 0.85
**Scanner:** security-debt-scanner

## Affected Files

- `src/workflows/approvalRegistry.ts` lines 415-438

## Description

The approvals system controls whether PRD and plan gates are considered approved for pipeline progression. The loadApprovalsFile function deserializes approval records from disk using an unsafe type cast. The only structural check is a schema_version string comparison. If approvals.json is corrupted or contains a crafted payload with schema_version set correctly but otherwise malformed approval data, downstream approval checks will operate on unvalidated data. Incorrect approval state can allow unauthorized pipeline progression through governance gates.

## Suggested Remediation

Define a Zod schema for ApprovalsFile (and its nested ApprovalRecord array) and use validateOrThrow() after JSON.parse. The existing ApprovalRecord Zod schemas in src/core/models/ApprovalRecord.ts can be referenced. The schema_version check can remain as a pre-validation fast path, but the full structure must also be validated.
