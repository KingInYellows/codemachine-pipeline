# Validation

Generic Zod schema validation utilities and CLI path validation. Provides
two validation modes: throw-on-failure for hard boundaries and result-union
for soft boundaries.

## Key Exports

This module has no barrel `index.ts` — consumers import files directly.

### From `helpers.ts`

- `validateOrThrow(schema, data)` — validates and throws `ValidationError` on failure
- `validateOrResult(schema, data)` — returns `ValidationSuccess<T>` or `ValidationFailure`
- `ValidationSuccess` / `ValidationFailure` / `ValidationResult` — discriminated union types

### From `errors.ts`

- `ValidationError` — structured error with CLI/JSON formatting
- `fromZodError(zodError)` — converts `ZodError` to `ValidationError`
- `ValidationIssue` — single validation issue with path and context

### From `cliPath.ts`

- `validateCliPath(path)` — validates filesystem paths for safe process spawning (prevents shell injection via metacharacters, path traversal)

## Structure

- `helpers.ts` — generic Zod validation wrappers
- `errors.ts` — validation error model with CLI output formatting
- `cliPath.ts` — CLI path safety validation

## Dependencies

Imports from: (none outside itself)

Depended on by: `core`, `persistence`, `telemetry`, `adapters`
