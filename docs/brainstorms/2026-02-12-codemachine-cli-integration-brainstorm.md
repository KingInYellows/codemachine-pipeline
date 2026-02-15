# Brainstorm: CodeMachine-CLI Two-Way Integration

**Date:** 2026-02-12
**Status:** Draft
**Target Cycle:** Cycle 9 (dedicated)

## What We're Building

A two-way integration between `codemachine-pipeline` (this project) and [CodeMachine-CLI](https://github.com/moazbuilds/CodeMachine-CLI) (v0.8.0 Nova BETA) that:

1. **Feeds IN:** Linear issues, GitHub issues, prompts, and spec templates flow from our pipeline into CodeMachine-CLI workflows
2. **Feeds BACK:** Real-time execution status, intermediate artifacts, agent conversations, and final outputs stream back into our pipeline's queue/state/telemetry system
3. **Bundled dependency:** CodeMachine-CLI is installed as an npm package, not discovered via PATH

### Input Modes (all three supported)

| Mode | Trigger | What happens |
|------|---------|--------------|
| Issue-driven | `codepipe start --linear ISSUE-123` | Linear/GitHub issue content becomes the prompt/spec for a CodeMachine workflow |
| Pipeline-stage driven | Pipeline reaches "implement" phase | Task DAG items are dispatched to CodeMachine-CLI one at a time |
| Template-mapped | PRD/spec output matches a workflow template | Different issue types trigger different CodeMachine workflow templates |

### Output Flow (full state sync)

- Real-time status updates during execution
- Intermediate artifacts (generated code, test results)
- Agent conversations and decisions
- Final outputs and metrics
- All integrated with our existing telemetry, queue V2, and structured logging

### Engine Handling: Passthrough

Our pipeline does **not** specify which AI agent CodeMachine-CLI should use. We send "execute this task" and CodeMachine-CLI handles engine selection internally (Claude Code, Codex, Cursor, etc.).

## Why This Approach (Hybrid A+B)

We're combining two complementary strategies:

### Layer 1: Adapter Bridge (Approach A)

Replace the current `CodeMachineRunner` (`src/workflows/codeMachineRunner.ts`) — which spawns a bare `codemachine` binary via `child_process` — with a proper TypeScript adapter that:

- Imports CodeMachine-CLI as an npm dependency (bundled)
- Uses its programmatic API or wraps its CLI with proper argument mapping
- Streams structured NDJSON events back through our `StructuredLogger` and telemetry
- Fits into our existing `ExecutionStrategy` interface (minimal architectural change)

**Why:** Our `CLIExecutionEngine` already uses a strategy pattern. The adapter bridge slots in as a new strategy implementation without changing the engine, queue, or approval gate architecture.

### Layer 2: Workflow Template Mapping (Approach B)

Build a translation layer that converts our pipeline's outputs into CodeMachine-CLI workflow definitions:

- PRDs → workflow specs (using their Ali Workflow Builder format)
- Task DAG items → individual workflow steps
- Issue metadata → workflow context/parameters
- Different issue categories → different workflow templates

**Why:** CodeMachine-CLI's strongest feature is multi-agent workflow orchestration. By mapping our specs to their workflow format, we get access to their agent coordination, long-running execution, and context engineering without reinventing it.

## Current State Assessment

### What exists today

- `CodeMachineRunner` (`src/workflows/codeMachineRunner.ts`): Spawns `codemachine run -d <workspace> --spec <path> <engine> <prompt>` — expects a binary in PATH
- `CLIExecutionEngine` (`src/workflows/cliExecutionEngine.ts`): Strategy-based execution engine with queue management, retries, artifact capture
- `ExecutionStrategy` interface: Pluggable strategy pattern for different execution backends
- Linear adapter (`src/adapters/linear/`): GraphQL integration for fetching issues
- GitHub adapter (`src/adapters/github/`): PR automation, branch management
- Config: `codemachine_cli_path` defaults to `"codemachine"`, engine types limited to `claude | codex | openai`

### What doesn't work

- **No npm dependency** on CodeMachine-CLI — the binary is expected but never installed
- **CLI interface mismatch** — the command format `codemachine run -d ... --spec ... <engine> <prompt>` may not match CodeMachine-CLI v0.8.0's actual API
- **No workflow template support** — we pass raw prompts, not structured workflow definitions
- **Engine type mismatch** — we only support `claude | codex | openai`, CodeMachine-CLI also supports Cursor and others
- **No state streaming** — we only get stdout/stderr after completion, no real-time status

### What CodeMachine-CLI provides (v0.8.0)

- Multi-agent workflow orchestration (multiple agents on different tasks)
- Ali Workflow Builder (interactive → autonomous workflow creation)
- Long-running workflow support (hours/days with persistence)
- Context engineering (control what info each agent receives)
- Headless scripting modes for AI coding engines
- Agent-to-agent communication

## Key Decisions

1. **Bundled dependency** — CodeMachine-CLI installed via npm, not discovered via PATH
2. **Passthrough engine selection** — our pipeline doesn't dictate which AI agent to use
3. **Full state sync** — real-time NDJSON event streaming, not just exit code + stdout
4. **Strategy pattern preserved** — new adapter implements `ExecutionStrategy`, existing architecture unchanged
5. **Template mapping** — PRDs/specs translated to CodeMachine workflow definitions
6. **Cycle 9 scope** — dedicated cycle after Cycle 8 (documentation tooling) completes

## Open Questions

1. **CodeMachine-CLI programmatic API** — Does it expose a Node.js/TypeScript API, or only a CLI? If CLI-only, the adapter needs to handle structured output parsing from stdout.
2. **Bun vs Node.js** — CodeMachine-CLI uses Bun as its package manager. Will it work as an npm dependency in our Node.js project? May need to verify compatibility or use their CLI as a subprocess.
3. **Workflow schema stability** — The Ali Workflow Builder format is in v0.8.0 Beta. How stable is the schema? Should we version-pin and build a compatibility layer?
4. **Event streaming format** — What structured output does CodeMachine-CLI emit during execution? Need to map their output format to our `StructuredLogger` events.
5. **Authentication forwarding** — How do we pass API keys (Anthropic, OpenAI, etc.) to CodeMachine-CLI workflows securely? Our current `filterEnvironment()` allowlist approach may need extension.
6. **Upstream collaboration** — Should we coordinate with the moazbuilds/CodeMachine-CLI team? A shared interface spec would prevent breaking changes.

## Scope Boundaries (Cycle 9)

### In scope
- Replace `CodeMachineRunner` with proper adapter
- Add CodeMachine-CLI as npm dependency
- Implement workflow template mapping for at least 2 templates (code generation, testing)
- NDJSON event streaming integration
- Issue-driven and pipeline-stage-driven input modes
- Tests for the adapter layer

### Out of scope (future cycles)
- Custom workflow builder UI
- Template marketplace
- Multi-engine routing optimization
- CodeMachine-CLI version auto-update
- Bidirectional issue sync (our pipeline updating CodeMachine-CLI's state)

## Technical Notes

### Files to modify
- `src/workflows/codeMachineRunner.ts` — Major rewrite (adapter bridge)
- `src/workflows/cliExecutionEngine.ts` — Minor changes (passthrough engine config)
- `src/core/config/RepoConfig.ts` — Extend config for workflow templates
- `package.json` — Add CodeMachine-CLI dependency
- New: `src/adapters/codemachine/` — Adapter module with template mapping

### Integration points
- `ExecutionStrategy` interface — new `CodeMachineStrategy` implementation
- `StructuredLogger` — event streaming sink
- `ExecutionTelemetry` — metrics for CodeMachine workflow executions
- Linear/GitHub adapters — issue content extraction for workflow input
