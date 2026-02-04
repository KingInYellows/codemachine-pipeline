---
date: 2026-01-02T14:37:00-06:00
topic: 'Codemachine execution engine vs codemachine-pipeline'
query: 'this project was intended to use "codemachine" an existing github project as the execution engine. Is that how this works? Can you investigate codemanchine, help me understand this repositories structure, and output a research reports on your thoughts here. Is this repository functional? Can I use my native claude-code and codex-cli subscription auth like I can with codemachine? Is this documented?'
sources:
  internal: 12
  external: 4
tags: [research, codemachine, execution-engine, cli, agents]
---

# Codemachine execution engine vs codemachine-pipeline

## Executive Summary

This repository (codemachine-pipeline / codemachine-pipeline) documents an execution engine, but the core runtime engine is explicitly marked as future work and is not implemented as a dedicated module. CodeMachine is referenced in architecture artifacts as an optional external automation/telemetry consumer and as a provider name in shared HTTP/rate-limit plumbing, not as an integrated execution backend. The separate CodeMachine CLI project (moazbuilds/CodeMachine-CLI) does support Claude Code and Codex CLI engines and documents that capability; this repo does not document native Claude Code/Codex CLI auth integration.

## Original Query

> this project was intended to use "codemachine" an existing github project as the execution engine. Is that how this works? Can you investigate codemanchine, help me understand this repositories structure, and output a research reports on your thoughts here. Is this repository functional? Can I use my native claude-code and codex-cli subscription auth like I can with codemachine? Is this documented?

## Codebase Findings

### Existing Patterns

- `docs/requirements/execution_flow.md` describes the execution engine and flow, but explicitly marks the engine as future work ("Execution Engine (Future: `src/execution/executionEngine.ts`)"), indicating the runtime engine is not implemented in code.
- `src/workflows/taskPlanner.ts`, `src/workflows/queueStore.ts`, and `src/workflows/resumeCoordinator.ts` implement planning, queue persistence, and resume logic that would be composed by a future engine.
- `src/workflows/autoFixEngine.ts` and `src/workflows/validationRegistry.ts` implement a validation/auto-fix sub-engine referenced as an execution engine consumer.
- `src/adapters/http/client.ts` includes a `Provider.CODEMACHINE` enum and the docs mention codemachine in rate-limit envelopes; this is plumbing for optional external providers.

### Integration Points

- Architecture artifacts in `.codemachine/artifacts/architecture/*.md` describe CodeMachine as an optional external system that can ingest exports/telemetry, not as the execution engine inside this repo.
  - `.codemachine/artifacts/architecture/02_System_Structure_and_Data.md`
  - `.codemachine/artifacts/architecture/04_Operational_Architecture.md`
- The agent provider system is described via manifest-driven adapters, intended for OpenAI/Anthropic-style HTTP providers rather than CLI tools.
  - `docs/ops/agent_manifest_guide.md`
  - `docs/requirements/agent_capability_contract.md`

### Gaps Identified

- No `src/execution/` implementation exists for the documented execution engine.
- No adapter or workflow wiring indicates CodeMachine CLI is used as a runtime execution backend.
- No documentation in this repo describing Claude Code or Codex CLI subscription auth usage.

## External Research

### Official Documentation

- CodeMachine CLI documentation describes the project as a CLI-native orchestration platform and lists supported AI engines including Codex CLI and Claude Code.
  - Source: https://docs.codemachine.co/latest/
- CodeMachine CLI GitHub README also lists supported engines and states the project is early development.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI

### Best Practices / Notes from Releases

- CodeMachine CLI releases mention OpenCode CLI integration and auth-related fixes in later versions.
  - Source: https://github.com/moazbuilds/CodeMachine-CLI/releases

### Real-World Examples

- Public documentation is oriented around CodeMachine CLI usage; no direct examples of codemachine-pipeline using CodeMachine as an execution engine were found in this repo.
  - Internal evidence: `.codemachine/artifacts/architecture/*` and `docs/requirements/execution_flow.md`

### Common Pitfalls

1. **Assuming execution engine exists**: This repo documents the engine but does not implement it. Expect missing runtime wiring for execution tasks.
2. **Assuming CLI engine auth**: This repo uses provider manifests and HTTP APIs; no CLI engine auth integration is documented.

## Implementation Recommendations

### Recommended Approach

1. Treat this repo as the orchestrator with a planned execution engine, not a CodeMachine CLI wrapper.
2. If you want CodeMachine CLI as the execution engine, you will need a dedicated adapter that can invoke `codemachine` and translate tasks/results into the pipeline’s ExecutionTask model and queue state.
3. If your goal is to use Claude Code/Codex CLI auth, use CodeMachine CLI directly (per its docs) or add a new provider adapter in this repo that shells out to those CLIs.

### Code Patterns to Follow

- Provider adapters are manifest-driven and expect HTTP-based providers; a CLI-based engine integration would be an exception and likely require a new adapter type and richer execution logs.
  - `src/adapters/agents/AgentAdapter.ts`
  - `docs/requirements/agent_capability_contract.md`

### Things to Avoid

- Building on undocumented assumptions that `src/execution` exists.
- Mixing CLI-based engines into the HTTP provider adapter without clear separation or telemetry hooks.

## Open Questions

- Do you want to adopt CodeMachine CLI as the execution runtime (new adapter), or implement the documented execution engine within this repo?
- Do you want to keep using HTTP provider manifests (OpenAI/Anthropic) or pivot to CLI engines (Codex/Claude Code) for execution?

## Sources

- `docs/requirements/execution_flow.md`
- `src/workflows/taskPlanner.ts`
- `src/workflows/queueStore.ts`
- `src/workflows/resumeCoordinator.ts`
- `src/workflows/autoFixEngine.ts`
- `src/workflows/validationRegistry.ts`
- `src/adapters/http/client.ts`
- `docs/ops/agent_manifest_guide.md`
- `docs/requirements/agent_capability_contract.md`
- `.codemachine/artifacts/architecture/02_System_Structure_and_Data.md`
- `.codemachine/artifacts/architecture/04_Operational_Architecture.md`
- https://docs.codemachine.co/latest/
- https://github.com/moazbuilds/CodeMachine-CLI
- https://github.com/moazbuilds/CodeMachine-CLI/releases
