# Boundary Violation utils errors ts Imports from adapters http client

**ID:** 125
**Status:** pending
**Severity:** high
**Category:** architecture
**Effort:** small
**Confidence:** 0.95
**Scanner:** architecture-scanner

## Affected Files

- `src/utils/errors.ts` line 1
- `src/adapters/http/client.ts` lines 60-113

## Description

src/utils/errors.ts imports HttpError directly from src/adapters/http/client.ts. The utils layer is a foundational layer that all other layers depend on; if utils imports from adapters, it creates a transitive dependency cycle risk and violates the principle that utilities should have no knowledge of higher-level infrastructure. HttpError is a cross-cutting concern that belongs in a shared errors module.

## Suggested Remediation

Move the HttpError class definition to src/core/sharedTypes.ts or a new src/core/errors.ts file. Update adapters/http/client.ts and utils/errors.ts to import from that shared location. This makes the error type accessible to all layers without requiring utils to reach up into adapters.
