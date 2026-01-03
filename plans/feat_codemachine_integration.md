# Plan: CodeMachine CLI Adapter Integration (2025-01-02)

## Overview

Implement a CodeMachine CLI adapter to run CodeMachine as an execution engine inside codemachine-pipeline. This includes feasibility validation, adapter design, queue/task lifecycle integration, and a step-by-step implementation plan. It also defines Linear project/issue structure and acceptance criteria.

## Problem Statement / Motivation

The pipeline contains planning, queue, resume, and telemetry infrastructure but lacks a concrete execution engine. CodeMachine CLI is intended to be the execution engine and already supports Claude Code/Codex CLI auth through its own CLI. Integrating CodeMachine can unblock end-to-end execution while keeping existing queue/telemetry semantics.

## Proposed Solution

Build a CLI-based execution adapter that:

- Maps planned ExecutionTasks to CodeMachine workflows/steps.
- Invokes `codemachine` as a child process with controlled env and logging.
- Updates queue/task status using `queueStore` + run manifest helpers.
- Emits execution telemetry and stores artifacts.

## Technical Considerations

- **Architecture**: Add a new workflow/adapter layer rather than modifying existing adapters. Follow `Config -> class -> create*` pattern as in `src/adapters/*`.
- **Process Management**: Prefer `execa` or `child_process.spawn` with array args (avoid shell injection). Use streaming logs with bounded buffers.
- **Error Taxonomy**: Map CodeMachine exit codes to Transient/Permanent/HumanActionRequired.
- **Resume Compatibility**: Ensure queue updates and hash manifests align with `resumeCoordinator`.
- **Security**: Avoid shell string concatenation; validate paths/args.

## SpecFlow Analysis (Edge Cases)

- Missing `codemachine` binary at runtime.
- Non-zero exit code with partial outputs.
- CLI emits no structured output; parsing fails.
- Retryable failures (rate limits) vs permanent (bad spec).
- Interrupted run: queue state must remain consistent for resume.

## Implementation Detail Level

Use **MORE (Standard Issue)** for all issues. Each issue should include Overview, Problem Statement, Proposed Solution, Technical Considerations, Acceptance Criteria, Dependencies/Risks.

## Issue Breakdown (Linear)

### ✨ feat: add CodeMachine CLI runner

**Overview**: Introduce a runner to invoke `codemachine` CLI with controlled env, timeouts, and log streaming.

**Acceptance Criteria**

- [ ] Runner accepts `cwd`, `env`, `timeout`, `engine`, `model`, and `command` args.
- [ ] Uses array args (no shell injection) for all invocations.
- [ ] Captures stdout/stderr with bounded buffers and timestamps.
- [ ] Returns exit code, duration, and normalized log output.
- [ ] Fails fast with clear error if `codemachine` is missing.

**Notes / References**

- `src/workflows/autoFixEngine.ts`
- `src/workflows/contextAggregator.ts`

### ✨ feat: plan-to-queue bridge for CodeMachine tasks

**Overview**: Bridge plan output into queue initialization for CodeMachine tasks.

**Acceptance Criteria**

- [ ] Tasks are created via `createExecutionTask` and appended with `appendToQueue`.
- [ ] Queue manifests update correctly after enqueue.
- [ ] Plan metadata links to queued tasks for traceability.
- [ ] Queue validation passes (`validateQueue`).

**Notes / References**

- `src/workflows/taskPlanner.ts`
- `src/workflows/queueStore.ts`

### ✨ feat: CodeMachine execution workflow

**Overview**: Add a workflow that executes CodeMachine and updates ExecutionTask lifecycle.

**Acceptance Criteria**

- [ ] Starts tasks with telemetry hooks (`taskStarted`).
- [ ] Updates status via `updateTaskInQueue` on success/failure.
- [ ] Uses `setLastError` / `clearLastError` for recoverable errors.
- [ ] Stores logs/artifacts in run directory.
- [ ] Emits queue depth and task lifecycle metrics.

**Notes / References**

- `src/telemetry/executionMetrics.ts`
- `src/telemetry/logWriters.ts`
- `src/persistence/runDirectoryManager.ts`

### ♻️ refactor: adapter interface for CLI engines

**Overview**: Define a minimal interface for CLI-based engines to allow future expansion.

**Acceptance Criteria**

- [ ] Interface covers run/step commands and output normalization.
- [ ] Adapter instantiation follows `create*Adapter` pattern.
- [ ] Errors use existing taxonomy helpers.

**Notes / References**

- `src/adapters/index.ts`

### 📚 docs: CodeMachine integration guide

**Overview**: Document how to configure and run CodeMachine CLI integration.

**Acceptance Criteria**

- [ ] Config fields for engine selection documented.
- [ ] Setup steps include `codemachine` install and auth.
- [ ] Known limitations and output format expectations documented.

**Notes / References**

- `docs/requirements/execution_flow.md`
- `research/2026-01-02-codemachine-cli-adapter.md`

## Dependencies & Risks

- CodeMachine CLI output format is not guaranteed to be structured; parsing may be fragile.
- CLI auth is managed outside this repo; errors must be surfaced as HumanActionRequired.
- Integration requires consensus on whether CodeMachine runs as a single task or per-step.

## Pseudo Code Examples

```ts
// src/workflows/codemachineRunner.ts
export async function runCodeMachine(
  options: CodeMachineRunnerOptions
): Promise<CodeMachineResult> {
  return executeCli('codemachine', ['start', '--engine', options.engine], {
    cwd: options.workspaceDir,
    env: { ...process.env, CODEMACHINE_PLAIN_LOGS: '1' },
    timeoutMs: options.timeoutMs,
  });
}
```

```ts
// src/workflows/cliExecutionEngine.ts
const task = await getNextTask(runDir);
await telemetry.taskStarted(task.task_id, task.task_type, { provider: 'codemachine' });
const result = await runCodeMachine({ workspaceDir, engine, model, timeoutMs });
await updateTaskInQueue(runDir, task.task_id, { status: mapExitCode(result) });
```

## References

- `src/core/models/ExecutionTask.ts`
- `src/workflows/queueStore.ts`
- `src/workflows/resumeCoordinator.ts`
- `src/persistence/runDirectoryManager.ts`
- `src/telemetry/executionMetrics.ts`
- `src/telemetry/logWriters.ts`
- `research/2026-01-02-codemachine-cli-adapter.md`
- https://github.com/moazbuilds/CodeMachine-CLI
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/cli-reference.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/architecture.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/customizing-workflows.md
- https://github.com/moazbuilds/CodeMachine-CLI/blob/main/docs/specification-schema.md
