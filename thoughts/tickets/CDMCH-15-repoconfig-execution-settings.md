# CDMCH-15: Add execution settings to RepoConfig schema

## Summary

Introduce optional execution config section and env overrides for CLI path, engine, and timeout.

## Scope

- Update RepoConfig schema and defaults.
- Add environment variable overrides.
- Validate config parsing.

## Steps

1. Extend RepoConfig schema with execution fields.
2. Update default config creation.
3. Add env overrides for CLI path, default engine, timeout.
4. Add/adjust tests if needed.

## Acceptance Criteria

- Config validates with execution section and defaults.
- Env overrides apply correctly.

## Dependencies

- None.

## Estimate

- S/M (3)
