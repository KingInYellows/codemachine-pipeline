# CDMCH-18: ResultNormalizer implementation

## Summary

Normalize CLI execution results with exit code mapping and credential redaction.

## Scope

- Normalize exit codes to structured status.
- Extract summaries from output.
- Redact credentials using pattern set.

## Steps

1. Implement NormalizedResult model and normalizeResult.
2. Add redaction utilities and tests.
3. Add summary extraction helper.

## Acceptance Criteria

- Exit codes mapped correctly.
- Secret patterns redacted consistently.

## Dependencies

- CDMCH-15 (execution config).

## Estimate

- M (5)
