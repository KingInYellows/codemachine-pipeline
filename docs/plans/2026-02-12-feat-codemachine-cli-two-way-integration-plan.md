---
title: "feat: CodeMachine-CLI Two-Way Integration"
type: feat
date: 2026-02-12
deepened: 2026-02-13
cycle: 9
brainstorm: docs/brainstorms/2026-02-12-codemachine-cli-integration-brainstorm.md
---

# feat: CodeMachine-CLI Two-Way Integration

## Enhancement Summary

**Deepened on:** 2026-02-13
**Sections enhanced:** 12
**Research agents used:** 11 (CodeMachine-CLI API, NDJSON Streaming, Process Management, Bun/npm Compatibility, Workflow Templates, Architecture Review, Security Review, Testing Patterns, Simplicity Review, Semver Compatibility, Adapter Patterns)

### Critical Corrections (from research)

1. **Package name is `codemachine`** (not `codemachine-cli`) — npm package confirmed at v0.8.0
2. **No NDJSON output** — CodeMachine-CLI outputs plain text with ANSI colors, not structured JSON. The entire NDJSON event classification system must be redesigned as stdout line parsing
3. **No programmatic API** — CLI-only tool; binary wrapper has `#!/usr/bin/env bun` shebang but binaries are self-contained (embed Bun runtime)
4. **Binary resolution required** — Must bypass the Bun-shebang wrapper and resolve platform binary directly from `node_modules/codemachine-<platform>-<arch>/codemachine`
5. **7 engines, not 3** — CodeMachine-CLI supports: `opencode`, `claude`, `codex`, `cursor`, `mistral`, `auggie`, `ccr`. Our core `ExecutionEngineType` (`claude | codex | openai`) should NOT be widened — define a separate `CodeMachineEngineType` in the adapter layer
6. **MCP router available** — `codemachine mcp router` provides programmatic integration via stdio (preferred over raw stdout parsing)
7. **Workflows are `.workflow.js` files** — JavaScript modules, not JSON definitions

### Key Simplification (from simplicity + technical reviews)

~65% of the original plan was speculative engineering against unknown interfaces. Phases collapsed from 5 → 3. Deferred: NDJSON event classification, sequence gap detection, replay buffers, idempotency framework, credential file delegation. These should be added only after basic execution works end-to-end.

**Implementation principle:** Prefer fixing existing files over creating parallel ones. The existing `codeMachineRunner.ts` (530 lines), `codeMachineStrategy.ts` (125 lines), and `taskMapper.ts` (592 lines) already handle most of the integration concerns — update their internals rather than building a duplicate layer.

### Technical Review Applied (2026-02-13)

**Review agents:** Architecture Strategist, Security Sentinel, Pattern Recognition, Code Simplicity, Comment Analyzer

**Applied fixes (24 findings across P1/P2/P3):**
- Corrected 3 factual errors (non-existent config field, "stub" mislabel, stale task type list)
- Fixed cross-layer type dependency (workflow types moved to `src/workflows/`)
- Replaced `startsWith` telemetry check with explicit Set
- Added path containment check for template traversal prevention
- Specified credential stdin protocol (JSON line + end)
- Added pre-existing security debt to risk table (shell injection, raw stdout, incomplete artifact path check)
- Removed state machine (YAGNI), removed duplicate buildCoordinationSyntax from adapter
- Added strategy registration order documentation, barrel export updates, binary path caching
- Documented `DEBUG` env var leak risk, env override validation gap

### Top Security Findings

- **Critical:** Use stdin piping for credential delegation (not temp files — crash leaves secrets on disk)
- **Critical:** Template injection risk — validate `task_type` against allowlist + `path.resolve()` containment before path interpolation
- **High:** Switch `validateCliPath()` from blocklist to allowlist regex
- **High:** `buildSequentialScript`/`buildParallelScript` in `taskMapper.ts:563-591` are vulnerable to shell injection (pre-existing)

---

## Overview

Integrate [CodeMachine-CLI](https://github.com/moazbuilds/CodeMachine-CLI) (v0.8.0+) as a bundled npm dependency for two-way execution: our pipeline feeds Linear/GitHub issues, prompts, and spec templates INTO CodeMachine-CLI workflows, and CodeMachine-CLI streams execution state and outputs BACK into our pipeline's queue, telemetry, and PR automation.

This replaces the current `CodeMachineRunner` (530 lines of production code handling spawn, timeout, log rotation, and buffer management — which assumes a bare `codemachine` binary in PATH) with a proper adapter bridge and workflow template mapping layer.

## Problem Statement

The pipeline was designed to delegate code generation to an external `codemachine` CLI, but this integration **does not function today**:

1. **No dependency** — CodeMachine-CLI is not installed; config defaults to `"codemachine_cli_path": "codemachine"` and hopes it's in PATH
2. **CLI interface mismatch** — The expected command format (`codemachine run -d <workspace> --spec <path> <engine> <prompt>`) doesn't match CodeMachine-CLI v0.8.0's actual API
3. **No workflow templates** — We pass raw prompts, not structured workflow definitions; CodeMachine-CLI's Ali Workflow Builder is unused
4. **No state streaming** — We only capture stdout/stderr after completion; no real-time status updates
5. **Engine type mismatch** — We validate `claude | codex | openai`; CodeMachine-CLI supports 7 engines

### Research Insights: Actual CodeMachine-CLI v0.8.0 API

**The `run` command uses a coordination syntax, not the format we assumed:**
```bash
# Single agent
codemachine run "claude 'build a login page'"

# Multi-agent with options
codemachine run "claude[input:spec.md,tail:100] 'implement auth' && codex 'write tests'"

# Parallel execution with &
codemachine run "claude 'task A' & codex 'task B'"
```

**Key CLI commands:**
| Command | Purpose |
|---------|---------|
| `codemachine run "<coordination>"` | Execute agents with coordination syntax |
| `codemachine mcp router` | Start MCP stdio router (programmatic integration) |
| `codemachine workflow run <file>` | Execute `.workflow.js` file |
| `codemachine --version` | Version check |

**Workflow files are JavaScript modules** (`.workflow.js`), not JSON:
```javascript
// example.workflow.js
module.exports = {
  name: 'code-gen',
  steps: [
    { agent: 'claude', prompt: 'Implement feature', input: 'spec.md' },
    { agent: 'codex', prompt: 'Write tests', depends: ['step-0'] },
  ],
};
```

**MCP Router** (`codemachine mcp router`) provides the most robust programmatic integration path — structured JSON-RPC over stdio instead of parsing unstructured text output.

## Proposed Solution

**Hybrid Adapter Bridge + Workflow Template Mapping** (chosen in brainstorm):

- **Layer 1 (Adapter Bridge):** New `CodeMachineCLIAdapter` that wraps CodeMachine-CLI, implements `ExecutionStrategy`, resolves the platform binary directly (bypassing Bun shebang), and captures execution output
- **Layer 2 (Workflow Template Mapping):** Translation layer that converts PRDs, specs, and task DAG items into CodeMachine-CLI coordination syntax or `.workflow.js` files

### Research Insights: Architecture Corrections

**Placement:** `WorkflowTemplateMapper` belongs in `src/workflows/` (adjacent to existing `taskMapper.ts`), not in `src/adapters/codemachine/`. It maps pipeline concepts to workflow concepts — that's a workflow concern, not an adapter concern.

**Telemetry fix needed:** `cliExecutionEngine.ts` hardcodes `strategy.name === 'codemachine'` at lines 495 and 531. This must be changed to check against an explicit Set — `new Set(['codemachine', 'codemachine-cli']).has(strategy.name)` — to avoid breaking telemetry when the new strategy is registered. Avoid `startsWith('codemachine')` which could match unintended future strategies.

**canHandle() design:** Separate capability (`canHandle`) from availability. The strategy should always be *capable* of handling tasks; availability (binary exists, version compatible) should be checked at registration time and cached.

## Technical Approach

### Architecture

```
                    ┌─────────────────────────────┐
                    │     codepipe start           │
                    │  (Linear/GitHub/prompt)      │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │   CLIExecutionEngine         │
                    │   (unchanged orchestrator)   │
                    └─────────────┬───────────────┘
                                  │ strategy.execute(task, ctx)
                    ┌─────────────▼───────────────┐
                    │   CodeMachineCLIStrategy     │
                    │   (NEW - replaces old)       │
                    │                              │
                    │  ┌────────────────────────┐  │
                    │  │ WorkflowTemplateMapper │  │
                    │  │ (task → coordination   │  │
                    │  │  syntax or .workflow.js)│  │
                    │  └───────────┬────────────┘  │
                    │              │                │
                    │  ┌───────────▼────────────┐  │
                    │  │ CodeMachineCLIAdapter  │  │
                    │  │ (binary resolution +   │  │
                    │  │  spawn + output parse) │  │
                    │  └───────────┬────────────┘  │
                    └──────────────┼───────────────┘
                                   │ spawn (shell: false)
                    ┌──────────────▼───────────────┐
                    │   codemachine binary          │
                    │   (platform-specific, from    │
                    │    optionalDependencies)       │
                    └──────────────┬───────────────┘
                                   │ stdout/stderr (text)
                    ┌──────────────▼───────────────┐
                    │   StructuredLogger +          │
                    │   ExecutionTelemetry           │
                    └──────────────────────────────┘
```

**Key design decisions:**
- `CLIExecutionEngine` is **unchanged** — the new strategy slots into the existing `strategies[]` array
- Engine selection is **passthrough** — pipeline sends task type, not engine name; CodeMachine-CLI handles routing
- Existing security controls preserved: `shell: false`, environment allowlist, path validation, log rotation
- **Note:** Consider removing `DEBUG` from `filterEnvironment()` `alwaysAllowed` list (`codeMachineRunner.ts:206`) — `DEBUG=*` can cause verbose output that leaks internal state
- **Binary resolution** bypasses the `#!/usr/bin/env bun` wrapper — we locate the platform-specific binary directly

### Research Insights: Binary Resolution Pattern

CodeMachine-CLI uses the same optionalDependencies pattern as esbuild/turbo:

```
codemachine (wrapper package, 95 KB)
  bin/codemachine.js       ← #!/usr/bin/env bun (DO NOT USE)
  optionalDependencies:
    codemachine-linux-x64    ← compiled Bun binary for Linux x64
    codemachine-darwin-arm64 ← compiled Bun binary for macOS ARM
    codemachine-darwin-x64   ← compiled Bun binary for macOS x64
    codemachine-windows-x64  ← compiled Bun binary for Windows x64
    codemachine-linux-arm64  ← compiled Bun binary for Linux ARM
```

**Resolution strategy (in order):**
1. `CODEMACHINE_BIN_PATH` env var (user override)
2. Platform binary from `node_modules/codemachine-<platform>-<arch>/codemachine`
3. Global `codemachine` in PATH (fallback)
4. Graceful skip — `canHandle()` returns `false`, pipeline uses next strategy

```typescript
// Binary resolution logic (~20 lines)
const platformMap: Record<string, { pkg: string; bin: string }> = {
  'linux-x64': { pkg: 'codemachine-linux-x64', bin: 'codemachine' },
  'darwin-arm64': { pkg: 'codemachine-darwin-arm64', bin: 'codemachine' },
  'darwin-x64': { pkg: 'codemachine-darwin-x64', bin: 'codemachine' },
  'win32-x64': { pkg: 'codemachine-windows-x64', bin: 'codemachine.exe' },
  'linux-arm64': { pkg: 'codemachine-linux-arm64', bin: 'codemachine' },
};
```

**The binary is self-contained** — it embeds the Bun runtime. No Bun installation needed on the host.

### Implementation Phases

#### Phase 1: Foundation + Adapter Bridge (Core Execution)

**Goal:** Add CodeMachine-CLI as a dependency, resolve the binary, spawn it correctly, and capture output. Get a single `codepipe start --prompt "..."` working end-to-end.

**Tasks:**

- [x] Add `codemachine` to `package.json` dependencies (pin to `^0.8.0`)
  - `package.json`
  - Note: package name is `codemachine`, NOT `codemachine-cli`
- [x] Implement binary resolution in `src/adapters/codemachine/binaryResolver.ts`:
  - Platform detection via `process.platform` + `process.arch`
  - Resolve from optionalDependencies package path (bypassing Bun wrapper)
  - Fallback chain: env var → optionalDep → PATH → not found
  - `CODEMACHINE_BIN_PATH` env var support for override (must pass `validateCliPath()`)
  - Cache resolved binary path after first successful resolution (avoid redundant fs access)
- [x] Extend `ExecutionConfigSchema` in `src/core/config/RepoConfig.ts`:
  - Add `codemachine_cli_version` (string, optional — minimum version enforcement)
  - Add `codemachine_workflow_dir` (string, optional — path to workflow template overrides)
  - Make engine field optional when using CodeMachine-CLI strategy (engine selection is passthrough — CodeMachine-CLI handles routing internally)
  - Add env var overrides following `CODEPIPE_EXECUTION_*` convention
  - **Security:** Ensure `CODEPIPE_EXECUTION_CLI_PATH` env override runs through `validateCliPath()` — currently `applyEnvironmentOverrides()` in `RepoConfig.ts` bypasses path validation
- [x] Implement `CodeMachineCLIAdapter` in `src/adapters/codemachine/CodeMachineCLIAdapter.ts`:
  - Constructor takes config + logger (dependency injection)
  - `validateAvailability()` — binary resolution + `--version` check + semver minimum enforcement
  - `execute(command, args)` — spawn binary with `shell: false`, capture stdout/stderr, return result
  - **No** `buildCoordinationSyntax` here — that belongs in `WorkflowTemplateMapper` (single responsibility; adapter only spawns + captures)
  - Timeout: SIGTERM → 5s grace → SIGKILL (reuse existing pattern from `codeMachineRunner.ts`)
  - Use a simple `executing: boolean` guard to prevent double-execute (no state machine — YAGNI)
- [x] Implement `CodeMachineCLIStrategy` in `src/workflows/codeMachineCLIStrategy.ts`:
  - Implements `ExecutionStrategy` interface
  - `name = 'codemachine-cli'` (distinct from old `'codemachine'`)
  - `canHandle()` — returns true when binary is available (checked at registration)
  - `execute()` — delegates to adapter, maps result to `ExecutionStrategyResult`
- [x] Fix telemetry name-check in `src/workflows/cliExecutionEngine.ts` (lines 495, 531):
  - Replace `strategy.name === 'codemachine'` with `CODEMACHINE_STRATEGY_NAMES.has(strategy.name)`
  - Define `const CODEMACHINE_STRATEGY_NAMES = new Set(['codemachine', 'codemachine-cli'])` at module level
  - Do NOT use `startsWith('codemachine')` — could match unintended strategies
- [x] Wire strategy into `CLIExecutionEngine`:
  - Register `CodeMachineCLIStrategy` **before** old `CodeMachineStrategy` in the strategies array (first match wins in `canHandle()` iteration)
  - New strategy returns `canHandle() = true` only when binary is available; old strategy remains as fallback
  - Add inline comment documenting registration order dependency
- [x] Version check in `codepipe doctor`:
  - Use `semver` package for version comparison
  - Extract version from `codemachine --version` output
  - Report: available/not-available, version, minimum version met
- [x] **Security:** Switch `validateCliPath()` in `codeMachineRunner.ts:111-129` from blocklist to allowlist:
  - Replace individual character checks with allowlist regex: `/^[a-zA-Z0-9_\-./]+$/`
  - This fixes a bypass where `$()`, backticks, or Unicode homoglyphs evade the current blocklist
  - Both old and new code paths use this function — fix benefits all strategies
- [x] Write ADR-8: CodeMachine-CLI Integration Strategy
  - `docs/adr/ADR-8-codemachine-cli-integration.md`
  - Reference ADR-6 (external integration pattern) and ADR-7 (Zod validation)

**Files:**
- `package.json` (add dependency)
- `src/adapters/codemachine/binaryResolver.ts` (new)
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts` (new)
- `src/adapters/codemachine/index.ts` (new, barrel — re-exports from workflows/codemachineTypes.ts)
- `src/workflows/codeMachineCLIStrategy.ts` (new)
- `src/core/config/RepoConfig.ts` (extend schema)
- `src/workflows/codemachineTypes.ts` (new — workflow-layer types for coordination syntax + workflow definitions)
- `src/workflows/cliExecutionEngine.ts` (fix telemetry name-check)
- `src/adapters/index.ts` (add codemachine barrel export)
- `src/cli/commands/doctor.ts` (version check)
- `docs/adr/ADR-8-codemachine-cli-integration.md` (new)

**Success criteria:**
- `npm install` installs `codemachine` + correct platform binary
- Binary resolves correctly without Bun installed
- `codepipe start --prompt "add a login page"` dispatches to CodeMachine-CLI and captures output
- `codepipe doctor` reports CodeMachine-CLI version and compatibility
- Graceful fallback when CodeMachine-CLI is not installed

#### Phase 2: Workflow Template Mapping + Issue Integration

**Goal:** Build translation layer from pipeline tasks to CodeMachine-CLI coordination syntax and `.workflow.js` files. Enable issue-driven execution.

**Tasks:**

- [x] Implement `WorkflowTemplateMapper` in `src/workflows/workflowTemplateMapper.ts`:
  - `mapTaskToCoordination(task: ExecutionTask)` → coordination syntax string
  - `mapTaskToWorkflowFile(task: ExecutionTask)` → path to generated `.workflow.js`
  - Default mappings:
    - `code_generation` → `"claude[input:<spec>] '<prompt>'"`
    - `testing` → `"codex 'write tests for <target>'"`
    - Unknown types → generic prompt passthrough
  - Template override directory: read from `codemachine_workflow_dir` config
  - Custom template loading: `.codepipe/workflows/<task_type>.workflow.js` files
  - **Security:** Validate `task_type` against allowlist before path interpolation (prevent traversal)
- [x] Define workflow types in `src/workflows/codemachineTypes.ts` (NOT in adapters — these are workflow-layer concepts):
  - `CoordinationSyntax` type (branded string with validation)
  - `WorkflowDefinition` interface matching `.workflow.js` module format
  - Zod schemas for validation at trust boundary (per ADR-7)
  - Re-export from `src/adapters/codemachine/index.ts` for adapter consumption
- [ ] Issue-driven input mode:
  - Extend `taskMapper.ts` to include Linear/GitHub issue metadata in task context
  - Pass issue title, description, labels, and acceptance criteria as workflow parameters
  - Map issue labels to template selection (e.g., `bug` → debug coordination, `feature` → code coordination)
- [ ] Template validation:
  - Before execution, verify `.workflow.js` file exists and exports valid structure
  - Clear error messages with remediation when template not found

**Files:**
- `src/workflows/workflowTemplateMapper.ts` (new — in workflows/, NOT adapters/)
- `src/workflows/codemachineTypes.ts` (workflow type additions — lives in workflows layer, not adapters)
- `src/workflows/taskMapper.ts` (issue metadata passthrough; also remove deprecated `mapTaskToCommand()` if no longer referenced)
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts` (accept coordination syntax)

**Success criteria:**
- `codepipe start --linear ISSUE-123` maps Linear issue to appropriate CodeMachine coordination
- Different task types trigger different coordination patterns
- Custom workflow overrides in `.codepipe/workflows/` are loaded and used
- Missing templates produce clear error messages with remediation
- `task_type` validated against allowlist (no path traversal)

#### Phase 3: Testing, Resilience & Documentation

**Goal:** Comprehensive test coverage, basic resilience, and operational documentation.

**Tasks:**

- [x] Unit tests in `tests/unit/`:
  - `binaryResolver.test.ts` — platform detection, resolution fallback chain, env var override
  - `codeMachineCLIAdapter.test.ts` — mock spawn, output capture, timeout handling, version check
  - `workflowTemplateMapper.test.ts` — task type mappings, custom templates, missing templates, path traversal rejection
  - `codeMachineCLIStrategy.test.ts` — strategy selection, telemetry integration
  - Test pattern: use `vi.mock('node:child_process')` with PassThrough streams for spawn mocking
- [ ] Integration test:
  - `codeMachineCLIIntegration.test.ts` — test with fake CLI script
  - Create `tests/fixtures/fake-codemachine` — shell script that accepts coordination syntax and outputs scripted text
- [x] PID tracking (minimal):
  - Write spawned process PID to `context.runDir/codemachine.pid`
  - Check liveness on resume via `kill -0 <pid>`
  - Atomic write: temp file → rename (prevent partial reads)
- [x] Credential delegation via stdin:
  - **Protocol:** Write a single JSON line (`{"ANTHROPIC_API_KEY":"sk-...","OPENAI_API_KEY":"sk-..."}\n`) to child stdin, then immediately call `stdin.end()`
  - **Error handling:** If stdin write fails (broken pipe), log warning and continue — CodeMachine-CLI may not consume stdin for all operations
  - **Cleanup:** `stdin.end()` on process spawn error, timeout, or SIGTERM to prevent fd leak
  - **Do NOT** write credentials to temp files (crash leaves secrets on disk)
  - Config: `env_credential_keys` allowlist for keys to delegate
- [x] Update `codepipe doctor` with version compatibility:
  - Use `semver` package (add as dependency)
  - Warn on 0.x minor version mismatch (breaking per SemVer spec)
- [ ] Ops documentation (if requested):
  - Installation and configuration
  - Workflow template authoring guide
  - Troubleshooting common failures

**Files:**
- `tests/unit/binaryResolver.test.ts` (new)
- `tests/unit/codeMachineCLIAdapter.test.ts` (new)
- `tests/unit/workflowTemplateMapper.test.ts` (new)
- `tests/unit/codeMachineCLIStrategy.test.ts` (new)
- `tests/fixtures/fake-codemachine` (new, shell script)
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts` (PID tracking, stdin credentials)

**Success criteria:**
- All new code has unit test coverage
- Integration test exercises: prompt → template mapping → CLI execution → output capture
- Pipeline crash + restart identifies orphaned process via PID file
- API keys piped via stdin, not visible in process args or on disk

### Deferred to Future Phases (YAGNI)

These items were in the original plan but should only be built when needed:

| Item | Why Deferred |
|------|-------------|
| NDJSON event classification/schemas | CodeMachine-CLI doesn't output NDJSON — would need upstream support or MCP router |
| Sequence number gap detection | Premature — no structured events to sequence |
| Replay buffer (100 events in memory) | No structured events to replay |
| Idempotency framework (`idempotency_key` field) | Over-engineering for initial integration |
| `codemachine list-workflows` capability query | Verify if this command exists first |
| MCP router integration | Most promising path for structured output, but adds complexity — evaluate after basic execution works |
| Event stream force-flush | No structured stream to flush |

## Alternative Approaches Considered

1. **Fork CodeMachine-CLI and merge** — Absorb their code directly. Rejected: creates maintenance burden, loses upstream improvements, and doubles codebase size.
2. **MCP Router integration** — Use `codemachine mcp router` for JSON-RPC over stdio. **Most promising long-term path** but deferred: adds protocol complexity; basic spawn + capture is simpler for Phase 1.
3. **CLI-only integration (current approach)** — Just fix the PATH issue. Rejected: no template support, no version management.
4. **Shared event protocol (JSON-RPC)** — Maximum decoupling. Rejected for Cycle 9: overlaps with MCP router approach.

### Research Insights: MCP Router Evaluation

CodeMachine-CLI's `codemachine mcp router` command starts an MCP server over stdio. This could provide structured JSON-RPC communication instead of parsing unstructured text. **Recommended as Phase 4 (future cycle)** once basic execution is proven:

```bash
# Start MCP router
codemachine mcp router
# Communicates via JSON-RPC over stdin/stdout
```

Benefits: typed requests/responses, progress callbacks, error codes. Risk: MCP router is in v0.8.0 Beta — API stability unknown.

## Acceptance Criteria

### Functional Requirements

- [ ] `codepipe start --prompt "..."` executes via CodeMachine-CLI and captures output
- [ ] `codepipe start --linear ISSUE-123` maps Linear issue to CodeMachine coordination syntax
- [x] Different task types (`code_generation`, `testing`) trigger different coordination patterns
- [x] Custom workflow templates loadable from `.codepipe/workflows/`
- [x] `codepipe resume` detects orphaned CodeMachine processes via PID file
- [x] `codepipe doctor` reports CodeMachine-CLI version and compatibility

### Non-Functional Requirements

- [x] No regression in existing pipeline behavior when CodeMachine-CLI is unavailable (graceful fallback)
- [x] API keys piped via stdin, not visible in process arguments, environment, or temp files
- [ ] All external data (CLI output, workflow templates) validated via Zod schemas
- [x] Binary resolution works on Linux x64, macOS ARM, macOS x64 without Bun installed

### Quality Gates

- [x] Unit test coverage for all new modules
- [ ] Integration test with fake CLI script
- [x] `npm run build` succeeds with no new type errors
- [x] `npm run lint` passes
- [x] `npm run deps:check` shows no new circular dependencies
- [x] ADR-8 reviewed and approved

## Dependencies & Prerequisites

- **`codemachine` v0.8.0** is published on npm (confirmed via research — 95 KB wrapper + platform binaries)
- **Bun NOT required** — platform binaries are self-contained compiled executables
- **`semver` package** — add as dependency for version comparison
- **Cycle 8 completion** — this is scoped for Cycle 9 (after documentation tooling)

## Risk Analysis & Mitigation

| Risk | Severity | Status | Mitigation |
|------|----------|--------|------------|
| CodeMachine-CLI not on npm | ~~High~~ | **Resolved** | Confirmed on npm as `codemachine@0.8.0` with platform binaries |
| Bun vs Node.js runtime conflicts | ~~Medium~~ | **Resolved** | Platform binaries embed Bun runtime; bypass wrapper, resolve binary directly |
| CLI API changes between 0.8.0 and 0.9.0 | High | Open | Pin to `^0.8.0`, use `semver` for minimum version enforcement, 0.x minor = breaking |
| Plain text output (no NDJSON) | Medium | Open | Parse stdout for status patterns; evaluate MCP router for structured output in future phase |
| Credential file persistence after crash | ~~Critical~~ | **Mitigated** | Use stdin piping instead of temp files |
| Template injection via task_type | Critical | Open | Validate task_type against allowlist before path interpolation |
| PID reuse race condition | Medium | Open | Atomic PID file writes via temp-then-rename; store PID + start timestamp |
| State desync on crash | Medium | Open | PID tracking + liveness check on resume |
| `validateCliPath` blocklist bypass | High | Open | Switch to allowlist regex: `/^[a-zA-Z0-9_\-./]+$/` |
| `buildSequentialScript`/`buildParallelScript` shell injection | High | Pre-existing | `taskMapper.ts:563-591` concatenates prompts into shell strings with `&&`/`&` — must switch to array-based spawn or shell-escape inputs |
| `extractSummary()` uses raw stdout pre-redaction | Medium | Pre-existing | `resultNormalizer.ts:195` passes unredacted stdout to summary — must use redacted output |
| `isValidArtifactPath` incomplete dangerous path check | Medium | Pre-existing | `resultNormalizer.ts` missing `/proc/`, `/sys/`, `/dev/` from dangerous paths |
| Credential redaction for new engine key formats | Low | Open | Current redaction regex only covers Anthropic/OpenAI key patterns — new engines (Mistral, etc.) have different formats |

### Research Insights: Security Recommendations

**Credential delegation (Critical):**
```typescript
// RECOMMENDED: Pipe credentials via stdin
const child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.write(JSON.stringify({ ANTHROPIC_API_KEY: key }));
child.stdin.end();

// DO NOT: Write temp .env file (crash leaves secrets on disk)
// DO NOT: Pass as env vars (visible to sibling processes on some OSes)
// DO NOT: Pass as CLI args (visible in `ps aux`)
```

**Path validation (High):**
```typescript
// RECOMMENDED: Allowlist regex
const SAFE_PATH = /^[a-zA-Z0-9_\-./]+$/;
if (!SAFE_PATH.test(cliPath)) {
  return { valid: false, error: 'CLI path contains invalid characters' };
}

// CURRENT (blocklist — bypassable): checks for '..', ';', '|', '&'
```

**Template path traversal (Critical):**
```typescript
// ALWAYS validate task_type before using in path
// Must match ExecutionTaskTypeSchema in src/core/models/ExecutionTask.ts
const ALLOWED_TASK_TYPES = new Set([
  'code_generation', 'testing', 'pr_creation', 'deployment',
  'review', 'refactoring', 'documentation', 'other',
]);
if (!ALLOWED_TASK_TYPES.has(task.type)) {
  throw new Error(`Unknown task type: ${task.type}`);
}
const templatePath = path.join(workflowDir, `${task.type}.workflow.js`);
// ALSO verify resolved path is still within workflowDir (prevent traversal)
const resolvedTemplate = path.resolve(workflowDir, `${task.type}.workflow.js`);
if (!resolvedTemplate.startsWith(path.resolve(workflowDir))) {
  throw new Error(`Template path escapes workflow directory: ${task.type}`);
}
```

## Future Considerations

- **MCP Router integration** — Use `codemachine mcp router` for typed JSON-RPC communication (highest-priority future improvement)
- **Structured output support** — If CodeMachine-CLI adds NDJSON or structured output in future versions, add event classification
- **Multi-engine routing** — Pipeline intelligently selects engine based on task complexity
- **Template marketplace** — Share workflow templates across projects
- **Bidirectional issue sync** — Pipeline updates Linear/GitHub issues with CodeMachine execution status
- **Container isolation** — Run CodeMachine-CLI in Docker for filesystem sandboxing

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-12-codemachine-cli-integration-brainstorm.md`
- ExecutionStrategy interface: `src/workflows/executionStrategy.ts`
- Current CodeMachine integration: `src/workflows/codeMachineRunner.ts`, `src/workflows/codeMachineStrategy.ts`
- Execution engine: `src/workflows/cliExecutionEngine.ts`
- Task mapper: `src/workflows/taskMapper.ts` (existing 8 task type mappings)
- Linear adapter (reference pattern): `src/adapters/linear/LinearAdapter.ts`
- Config schema: `src/core/config/RepoConfig.ts:232-260`
- ADR-6 (external integration): `docs/adr/ADR-6-linear-integration.md`
- ADR-7 (Zod validation): `docs/adr/ADR-7-validation-policy.md`

### External References

- CodeMachine-CLI repository: https://github.com/moazbuilds/CodeMachine-CLI
- npm package: https://www.npmjs.com/package/codemachine
- Binary distribution pattern (same as esbuild/turbo): optionalDependencies + platform packages
- npm `semver` package: https://www.npmjs.com/package/semver

### Research Documents (from deepen-plan)

- `docs/research/cli-adapter-patterns-research.md` — Adapter architecture patterns (1,476 lines)
- `docs/research/cli-adapter-implementation-guide.md` — Copy-paste ready implementation (1,155 lines)
- `docs/research/cli-adapter-alternatives-analysis.md` — Architecture decision framework (750 lines)
- `docs/research/semver_compatibility_checking.md` — Version check patterns (25 KB)
- `docs/research/version-check-implementation.ts` — Ready-to-copy version check code (23 KB)

### Related Work

- Cycle 5: v1.0.0 release (established execution engine architecture)
- Cycle 6: Schema validation foundation (Zod patterns for trust boundary validation)
- Cycle 7: CLI integration tests (testing patterns for CLI command workflows)
