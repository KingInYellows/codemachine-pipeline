# Core

Shared domain models, configuration, error types, and validation schemas.
Provides the foundational type system used across all other modules.

## Key Public Files

This module has no barrel `index.ts`. Consumers import files by direct path.

### Shared Types (`sharedTypes.ts`)

- `SerializedError` — structured error representation for logging/telemetry
- `ErrorType` — error taxonomy enum (TRANSIENT, PERMANENT, HUMAN_ACTION_REQUIRED)
- `Provider` — HTTP provider enum (GITHUB, LINEAR, GRAPHITE, CODEMACHINE, CUSTOM)
- `CommonLogContext` / `LogContext` — structured logging context types
- `isSerializedError` — type guard

### Errors (`errors.ts`)

- `HttpError` — core HTTP error class with error taxonomy, redaction, and serialization

### Models (`models/`)

Zod-validated domain model schemas, re-exported via 5 sub-barrels:

- `feature-types` — `Feature`, `RunArtifact`, `PlanArtifact`
- `task-types` — `ResearchTask`, `Specification`, `ExecutionTask`
- `artifact-types` — `ContextDocument`, `RateLimitEnvelope`, `ArtifactBundle`, `TraceLink`
- `deployment-types` — `ApprovalRecord`, `DeploymentRecord`, `BranchProtectionReport`, `PRMetadata`
- `integration-types` — `IntegrationCredential`, `AgentProviderCapability`, `NotificationEvent`

### Configuration (`config/`)

- `RepoConfig` — repository configuration loading and access
- `RepoConfigLoader` — config file discovery and parsing
- `RepoConfigSchema` — Zod schema definition
- `RepoConfigDefaults` — default configuration values
- `configConstants` — configuration constants

### Validation (`validation/`)

- `validationCommandConfig.ts` — validation command configuration

## Structure

- `sharedTypes.ts` — shared type definitions and enums
- `errors.ts` — core error classes
- `models/` — domain model schemas (5 sub-barrels)
- `config/` — repository configuration (schema, loader, defaults)
- `validation/` — validation command config

## Dependencies

Imports from: `utils`

Note: `core/validation/` is an internal subdirectory, not the top-level `src/validation/` module.

Depended on by: `adapters`, `cli`, `persistence`, `telemetry`, `workflows`
