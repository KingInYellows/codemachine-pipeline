# CLI

oclif-based command-line interface for codemachine-pipeline. Defines all user-facing
commands, status rendering, PR workflows, and CLI-specific utilities.

## Key Exports

The barrel (`index.ts`) re-exports only `run` from `@oclif/core`. Individual
commands are loaded by oclif's convention-based discovery, not barrel-exported.

## Structure

### Commands (`commands/`)

oclif command classes discovered by convention:

- `init.ts` — initialize a new pipeline run
- `start.ts` — execute the pipeline (exit codes: 0=success, 1=failed, 30=approval required)
- `resume.ts` — resume an interrupted run
- `approve.ts` — approve a pending gate
- `status.ts` — show run status (supports `--json` for machine-readable output)
- `doctor.ts` — diagnostic health checks
- `pr/` — PR-related subcommands
- `research/` — research subcommands
- `context/` — context management subcommands
- `status/` — status subcommands

### Status (`status/`)

Status dashboard rendering and data loading:

- `types.ts` — `StatusPayload` and sub-payload interfaces (machine-readable API contract)
- `renderers.ts` — human-readable status output formatting
- `data/` — data-loading functions that populate status payloads:
  - `planData.ts`, `branchData.ts`, `telemetryData.ts`, `validationData.ts`,
    `integrationsData.ts`, `rateLimitsData.ts`, `prMetadataData.ts`,
    `researchData.ts`, `branchRefreshData.ts`
  - `types.ts` — shared types (`DataLogger` interface)
  - `index.ts` — barrel re-exports

### PR (`pr/`)

Pull request workflow helpers.

### Utilities

- `startHelpers.ts` — start command helper functions
- `startOutput.ts` — start command output formatting
- `resumePayloadBuilder.ts` — builds resume payloads
- `resumeOutput.ts` — resume output formatting
- `resumeTypes.ts` — resume-specific types
- `telemetryCommand.ts` — base command class with telemetry
- `diagnostics.ts` — diagnostic utilities
- `utils/` — shared CLI utilities

## Dependencies

Imports from: `core`, `adapters`, `persistence`, `telemetry`, `workflows`, `utils`

Depended on by: (top layer — nothing imports `cli`)
