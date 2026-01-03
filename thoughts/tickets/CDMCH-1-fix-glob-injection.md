# CDMCH-1: Fix HIGH severity glob command injection vulnerability

## Summary

Resolve GHSA-5j98-mcp5-4vw2 by updating or removing vulnerable dependency chain.

## Scope

- Identify patched version of @oclif/plugin-plugins or dependency path to glob.
- Update dependency versions or remove plugin if unused.
- Verify no regressions in CLI behavior.

## Steps

1. Inspect dependency tree for glob exposure.
2. Identify patched versions or alternatives.
3. Apply dependency update or replacement.
4. Validate build and tests.

## Acceptance Criteria

- Vulnerability resolved or mitigated.
- CI passes with updated dependency chain.

## Dependencies

- None.

## Estimate

- M (5)
