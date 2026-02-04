# ADR-7: Validation Policy (Zod Runtime Validation)

## Status

Accepted

## Context

The codemachine-pipeline processes structured data from multiple sources: user input via CLI, JSON configuration files on disk, API responses from GitHub and Linear, on-disk persistence artifacts for resumable runs, and AI-generated content (PRDs, specs, plans). TypeScript's compile-time type system provides no guarantees at runtime boundaries -- JSON parsed from disk or received from an API is typed as `unknown` until validated.

The project needed a consistent validation strategy that would:

- Catch malformed data at system boundaries before it propagates through the pipeline.
- Provide clear, actionable error messages for both human operators and AI agents.
- Compose well with TypeScript's type system so validated data carries correct types downstream.
- Scale across a growing number of domain models without duplicating type definitions.
- Support both strict validation (reject unknown fields in config) and loose validation (tolerate extra fields in API responses).

## Decision

All domain models and configuration schemas use **Zod** (v4) for runtime validation, with TypeScript types inferred from Zod schemas using `z.infer<>`. This is applied uniformly across the codebase.

### Schema-first model definitions

Each domain model is defined as a Zod schema. The corresponding TypeScript type is derived via `z.infer<typeof Schema>`, ensuring the runtime validation and compile-time types cannot drift apart. The following models use this pattern:

- `Feature`, `Specification`, `ResearchTask`, `ExecutionTask`
- `DeploymentRecord`, `ContextDocument`, `ApprovalRecord`
- `PlanArtifact`, `RunArtifact`, `TraceLink`
- `NotificationEvent`, `RateLimitEnvelope`
- `IntegrationCredential`, `AgentProviderCapability`, `ArtifactBundle`

### Validation at boundaries

Zod parsing is applied at every trust boundary where data enters the pipeline:

| Boundary                       | Validation mode          | Schema strictness           |
| ------------------------------ | ------------------------ | --------------------------- |
| CLI arguments                  | Parse and reject         | Strict                      |
| Config file (`RepoConfig`)     | Parse and reject         | Strict (`.strict()`)        |
| GitHub API responses           | Parse and warn           | Loose (`.passthrough()`)    |
| Linear API responses           | Parse and warn           | Loose (`.passthrough()`)    |
| Run directory state (resume)   | Parse and reject         | Strict                      |
| AI-generated content           | Parse, flag, allow override | Strict with fallback     |

Internal function-to-function calls within the pipeline trust already-validated types and do not re-validate.

### Schema composition

Complex models are built from smaller reusable schemas. For example, `StatusCheckSchema` and `ReviewRecordSchema` compose into `DeploymentRecordSchema`. Enums are defined as `z.enum()` values with their inferred types exported alongside, enabling both runtime checks and compile-time exhaustiveness checking.

Schemas use `.default()` for fields with sensible defaults and `.optional()` for truly optional fields, aligning with the specification's REQUIRED/OPTIONAL field annotations.

### Error reporting

Zod's structured error output (`ZodError`) provides:

- A human-readable summary of what failed.
- The path to the invalid field (e.g., `feature.repo.provider`).
- The expected vs. received value.

The `validationRegistry` and `validationCommandConfig` modules expose a CLI-accessible validation surface (`codepipe validate`) so operators can check data integrity on demand. Validation errors during config loading include the file path for context.

### Integration with adapters

The agent adapter (`src/adapters/agents/AgentAdapter.ts`) and its manifest loader (`src/adapters/agents/manifestLoader.ts`) use Zod to validate agent configuration files and provider capability declarations, ensuring that misconfigured agents fail fast with clear diagnostics.

## Consequences

**Positive:**

- **Single source of truth.** Type definitions and validation rules live in one place per model. Adding a field means updating only the Zod schema; the TypeScript type updates automatically. This has scaled well -- 21+ files reference this pattern across `src/core/models/`, `src/workflows/`, and `src/adapters/`.
- **Improved debugging.** Validation errors surface immediately at the boundary where bad data enters, with full path information. This significantly reduces time spent tracing data issues through the pipeline.
- **No duplicate types.** Unlike approaches that define interfaces separately and write manual validation functions, this policy eliminates an entire class of bugs where the type and the validator disagree.
- **Flexible strictness.** Strict mode for owned data (config, state) catches typos and unknown keys early. Loose mode for external data (API responses) prevents breakage when GitHub or Linear add new response fields.

**Negative:**

- **Runtime cost.** Zod validation adds a small overhead at trust boundaries. This is negligible for the pipeline's batch-oriented, CLI-driven workload.
- **Dependency on Zod.** The project takes a direct dependency on `zod` (currently v4.3.6). A major version change could require migration across all model files, though the adapter-based architecture limits blast radius.
- **Learning curve.** Contributors must understand Zod's schema API, though this is offset by not needing to write or maintain separate type definitions and validation functions.

## References

- Domain model schemas: `src/core/models/` (Feature.ts, Specification.ts, ResearchTask.ts, ExecutionTask.ts, DeploymentRecord.ts, ContextDocument.ts, ApprovalRecord.ts, PlanArtifact.ts, RunArtifact.ts, TraceLink.ts, NotificationEvent.ts, RateLimitEnvelope.ts, IntegrationCredential.ts, AgentProviderCapability.ts, ArtifactBundle.ts)
- Config validation: `src/core/config/RepoConfig.ts`, `src/core/config/validator.ts`
- Validation CLI surface: `src/core/validation/validationCommandConfig.ts`, `src/workflows/validationRegistry.ts`
- Agent manifest validation: `src/adapters/agents/AgentAdapter.ts`, `src/adapters/agents/manifestLoader.ts`
- Workflow consumers: `src/workflows/taskPlanner.ts`, `src/workflows/autoFixEngine.ts`, `src/workflows/traceabilityMapper.ts`
- Specification: `specification.md`, Section 3.0 (Data Models)
