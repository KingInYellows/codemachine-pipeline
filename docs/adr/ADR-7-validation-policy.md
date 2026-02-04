# ADR-7: Validation Policy

**Status:** Accepted
**Date:** 2025-12-15

## Context

The ai-feature-pipeline handles data from multiple external sources -- user prompts, Linear API responses, GitHub API responses, configuration files, and AI-generated content. Invalid or unexpected data at any boundary can cause silent failures, corrupt state, or security issues.

The project needs a consistent validation strategy that:

- Catches invalid data at system boundaries (API responses, config files, CLI input).
- Provides clear, actionable error messages for operators and AI agents.
- Works at both compile time (TypeScript types) and runtime (dynamic data).
- Composes well across the data models defined in the specification (Feature, RepoConfig, ResearchTask, Specification, ExecutionTask).

## Decision

### Zod as the Validation Library

The project uses **Zod** (`zod` v4) as the single validation library for all runtime schema validation. Zod was chosen because:

- It provides runtime validation with automatic TypeScript type inference, eliminating the need to maintain separate type definitions and validation logic.
- Schema composition (`.extend()`, `.merge()`, `.pick()`, `.omit()`) maps naturally to the layered data models in the specification.
- Error messages are structured and programmatically accessible, which is important for both CLI output and agent-consumable error reporting.
- It is already a project dependency.

### Compile-Time vs. Runtime Validation

- **TypeScript types** enforce structural contracts within the codebase at compile time. All data model interfaces are derived from Zod schemas using `z.infer<>`, ensuring a single source of truth.
- **Zod runtime validation** is applied at every system boundary where data enters the pipeline:
  - CLI argument parsing
  - Configuration file loading (`RepoConfig`)
  - External API responses (GitHub, Linear)
  - Feature state deserialization from run directories (resumability)
  - AI-generated content (PRD, spec, plan)

### Schema Composition Strategy

Schemas are organized by data model and composed hierarchically:

- **Base schemas** define the core models (`FeatureSchema`, `RepoConfigSchema`, etc.) matching the specification's data models.
- **Input schemas** use `.pick()` or `.partial()` to define what is required at creation time vs. what is populated later.
- **Strict mode** (`.strict()`) is used for configuration files to catch typos and unknown keys.
- **Loose parsing** (`.passthrough()`) is used for external API responses to tolerate additional fields from API evolution.

### Error Reporting

- Validation errors are transformed into structured `CliError` instances with:
  - A human-readable summary of what failed.
  - The path to the invalid field.
  - The expected vs. received value.
- For CLI users, errors are formatted as a readable list.
- For programmatic consumers, the raw Zod error object is available.
- Validation errors during config loading include the file path and line context where possible.

### Validation Boundaries

| Boundary | Validation Mode | Schema Strictness |
|---|---|---|
| CLI arguments | Parse and reject | Strict |
| Config file (`RepoConfig`) | Parse and reject | Strict (`.strict()`) |
| GitHub API responses | Parse and warn on unknown fields | Loose (`.passthrough()`) |
| Linear API responses | Parse and warn on unknown fields | Loose (`.passthrough()`) |
| Run directory state (resume) | Parse and reject with clear error | Strict |
| AI-generated content | Parse, flag issues, allow human override | Strict with fallback |

## Consequences

### Positive

- A single source of truth for types and validation eliminates drift between TypeScript interfaces and runtime checks.
- Structured errors improve debuggability for both human operators and AI agents processing pipeline output.
- Schema composition keeps validation DRY across related data models (e.g., Feature creation vs. Feature resumption).
- Strict config validation catches misconfiguration early, before API calls are attempted.
- Loose external API validation prevents breakage when GitHub or Linear add new response fields.

### Negative

- Zod adds a runtime dependency and a small performance cost to every boundary crossing. This is negligible for a CLI tool but worth noting.
- Developers must learn Zod's API for schema definition, though this is offset by not needing separate type definitions.
- Upgrading Zod major versions (e.g., v3 to v4) requires schema migration, though the API surface is largely stable.

### Risks

- If Zod is abandoned or diverges significantly, the validation layer would need to be rewritten. The adapter-based architecture (NFR-8) limits this risk to the validation module itself.
- Over-strict validation on external API responses could cause false rejections. The policy of using `.passthrough()` for external data mitigates this.
