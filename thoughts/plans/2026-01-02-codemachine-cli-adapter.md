# CodeMachine CLI Execution Engine Adapter - Implementation Plan

**PRD Reference:** PRD-2026-001  
**Linear Project:** [CodeMachine CLI Execution Engine Adapter](https://linear.app/kinginyellow/project/codemachine-cli-execution-engine-adapter-de787c2af907)  
**Created:** 2026-01-02  
**Updated:** 2026-01-02 (Post-Review Revision)  
**Status:** Planned  
**Review Status:** Revised after architecture, simplicity, performance, and security reviews

---

## Plan Review Summary

This plan was reviewed by 4 specialized agents. Critical issues have been addressed:

| Issue                                 | Severity | Resolution                                     |
| ------------------------------------- | -------- | ---------------------------------------------- |
| Shell injection via `shell: true`     | Critical | Use `shell: false` with args array (Phase 1.2) |
| Path traversal in artifacts           | Critical | Add containment validation (Phase 3.3)         |
| Credential exposure via env           | Critical | Implement env var allowlist (Phase 1.2)        |
| Missing ExecutionStrategy abstraction | Critical | Added interface (Phase 2.2)                    |
| Incomplete credential redaction       | High     | Expanded patterns (Phase 1.4)                  |
| O(n²) queue processing                | High     | Documented as known limitation (v2 scope)      |

### v1 Scope Simplifications

To reduce complexity, the following are **deferred to v2**:

- Multi-engine support (v1 uses Claude only)
- Multiple workflow commands (v1 uses `codemachine start` only)
- Log file rotation
- Artifact capture (minimal implementation in v1)
- Parallel task execution

---

## Overview

This plan implements the CodeMachine CLI Execution Engine Adapter, which bridges the existing ai-feature pipeline infrastructure (queue, resume, telemetry) with CodeMachine CLI for autonomous task execution. The adapter translates `ExecutionTask` types into CodeMachine CLI invocations, manages process lifecycle, and updates queue state based on execution results.

## Current State Analysis

### Existing Infrastructure (Ready to Use)

| Component           | Location                                 | Status                                                                            |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Queue Store         | `src/workflows/queueStore.ts`            | Complete - `initializeQueue`, `appendToQueue`, `getNextTask`, `updateTaskInQueue` |
| ExecutionTask Model | `src/core/models/ExecutionTask.ts`       | Complete - Zod schema with types, status, retry logic                             |
| CLI Spawn Patterns  | `src/workflows/autoFixEngine.ts:527-620` | Reusable - `executeShellCommand` with timeout, SIGTERM/SIGKILL                    |
| Telemetry           | `src/telemetry/logWriters.ts`            | Complete - `taskStarted`, `taskCompleted`, `taskFailed` events                    |
| Run Directory       | `src/persistence/runDirectoryManager.ts` | Complete - `setLastError`, `setCurrentStep`, file locking                         |

### Gaps to Fill

| Gap                         | Solution                      | PRD Requirement                          |
| --------------------------- | ----------------------------- | ---------------------------------------- |
| No execution engine         | Create `CLIExecutionEngine`   | REQ-EXEC-003                             |
| No CodeMachine runner       | Create `CodeMachineRunner`    | REQ-EXEC-001                             |
| No task-to-workflow mapping | Create `TaskMapper`           | REQ-EXEC-002                             |
| No CLI output parsing       | Create `ResultNormalizer`     | REQ-EXEC-005                             |
| No `execution.*` config     | Extend `RepoConfig` schema    | REQ-EXEC-010, REQ-EXEC-012, REQ-EXEC-014 |
| Plan → Queue wiring missing | Add `initializeQueueFromPlan` | REQ-EXEC-004                             |

### Key Discoveries

1. **CLI Spawn Pattern** (`autoFixEngine.ts:547-600`): Two-stage termination (SIGTERM → 5s → SIGKILL), buffer chunk capture, exit code 124 for timeout.
2. **Queue Atomicity** (`queueStore.ts`): Uses `withLock()` for thread-safe operations, SHA-256 checksums for integrity.
3. **ExecutionTaskType Values**: `code_generation`, `testing`, `pr_creation`, `deployment`, `review`, `refactoring`, `documentation`, `other`.
4. **Task Retry Logic** (`ExecutionTask.ts:256-262`): `canRetry()` checks `status === 'failed'`, `retry_count < max_retries`, `last_error?.recoverable`.

## Desired End State

After implementation:

1. `ai-feature start <spec>` executes all queued tasks autonomously via CodeMachine CLI
2. Task status updates in real-time: `pending` → `running` → `completed`/`failed`
3. Failed tasks are resumable via `ai-feature resume` with retry logic
4. CLI output captured to `<runDir>/logs/<taskId>.log`
5. Telemetry events emitted for all task lifecycle transitions
6. `ai-feature doctor` validates CodeMachine CLI availability

### Verification Commands

```bash
# Type check
npm run build

# Unit tests
npm test -- --grep "CodeMachine"

# Integration test
npm run test:integration -- --grep "execution"

# Smoke test
./scripts/tooling/smoke_execution.sh
```

## What We're NOT Doing (v1)

- **CodeMachine CLI Installation**: Assumes pre-installed (EC-EXEC-001 handles missing CLI)
- **Custom Workflow Templates**: Uses CodeMachine defaults only
- **Multi-Repo Execution**: Single workspace per run
- **Real-Time Progress Streaming**: Post-execution log capture only
- **Distributed Execution**: Single-node only
- **Parallel Task Execution**: Sequential only (GUARD-PERF-001)
- **Multi-Engine Support**: v1 uses Claude engine only (deferred to v2)
- **Multiple Workflow Commands**: v1 uses `codemachine start` only (deferred to v2)
- **Log File Rotation**: Deferred to v2 (implement when telemetry shows need)
- **Full Artifact Capture**: Minimal implementation in v1 (deferred to v2)

## Known Limitations (Document for Users)

| Limitation                    | Impact                             | Mitigation                | v2 Fix                      |
| ----------------------------- | ---------------------------------- | ------------------------- | --------------------------- |
| O(n²) queue processing        | Latency grows with queue size      | Keep queues <100 tasks    | Incremental queue updates   |
| Single-threaded execution     | Throughput capped by task duration | Acceptable for v1 scope   | Parallel execution          |
| Queue file rebuild per update | 2x I/O per task                    | Acceptable for <100 tasks | Append-only with compaction |
| Single engine (Claude)        | No cost/quality optimization       | Use Claude for all tasks  | Multi-engine selection      |

## Implementation Approach

Five phases over ~3 weeks:

1. **Core Adapter** (Week 1, Days 1-3): CodeMachineRunner, TaskMapper, ResultNormalizer
2. **Queue Integration** (Week 1, Days 4-5): Plan→Queue wiring, CLIExecutionEngine
3. **Telemetry & Artifacts** (Week 2, Days 1-2): Log streaming, artifact capture, metrics
4. **Testing & Validation** (Week 2, Days 3-5): Unit, integration, smoke tests
5. **Documentation & Rollout** (Week 3): Docs, doctor check, changelog

---

## Phase 1: Core Adapter Components

**Implements:** REQ-EXEC-001, REQ-EXEC-002, REQ-EXEC-005, REQ-EXEC-010, REQ-EXEC-012, REQ-EXEC-013, REQ-EXEC-014

### Overview

Create the foundational adapter components that wrap CodeMachine CLI execution.

### Changes Required:

#### 1.1 Extend RepoConfig with Execution Settings

**File:** `src/core/config/RepoConfig.ts`

Add new `execution` section to schema:

```typescript
// After line ~150, add execution schema
const ExecutionConfigSchema = z.object({
  codemachine_cli_path: z.string().default('codemachine'),
  default_engine: z.enum(['claude', 'codex', 'openai']).default('claude'),
  workspace_dir: z.string().optional(), // Defaults to run directory
  task_timeout_ms: z.number().int().min(60000).default(1800000), // 30 min
  max_retries: z.number().int().min(0).max(10).default(3),
  retry_backoff_ms: z.number().int().min(1000).default(5000),
}).optional();

// Add to RepoConfigSchema object
execution: ExecutionConfigSchema,
```

Update `createDefaultConfig()` and `applyEnvironmentOverrides()` for:

- `AI_FEATURE_EXECUTION_CLI_PATH`
- `AI_FEATURE_EXECUTION_DEFAULT_ENGINE`
- `AI_FEATURE_EXECUTION_TIMEOUT_MS`

#### 1.2 Create CodeMachineRunner Utility

**File:** `src/workflows/codeMachineRunner.ts` (new)

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CodeMachineRunnerOptions {
  cliPath: string;
  engine: 'claude'; // v1: Claude only (multi-engine in v2)
  workspaceDir: string;
  specPath: string;
  timeoutMs: number;
  logPath: string;
}

export interface CodeMachineResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}

export async function runCodeMachine(options: CodeMachineRunnerOptions): Promise<CodeMachineResult>;
export async function validateCliAvailability(
  cliPath: string
): Promise<{ available: boolean; version?: string; error?: string }>;
export function validateCliPath(cliPath: string): { valid: boolean; error?: string };
```

**SECURITY: Shell Injection Prevention (CRITICAL)**

```typescript
// WRONG - vulnerable to shell injection:
// spawn(command, { shell: true })

// CORRECT - use shell: false with args array:
const args = ['start', '--spec', options.specPath, '--engine', options.engine];
const childProcess = spawn(options.cliPath, args, {
  cwd: options.workspaceDir,
  env: sanitizeEnvironment(process.env), // Allowlist only
  shell: false, // CRITICAL: Prevents shell injection
  timeout: options.timeoutMs,
});
```

**SECURITY: CLI Path Validation**

```typescript
export function validateCliPath(cliPath: string): { valid: boolean; error?: string } {
  // Must be absolute path or simple command name (no path traversal)
  if (cliPath.includes('..') || cliPath.includes(';') || cliPath.includes('|')) {
    return { valid: false, error: 'CLI path contains invalid characters' };
  }
  // If absolute path, verify it exists and is executable
  if (path.isAbsolute(cliPath)) {
    // Check file exists and has executable permission
  }
  return { valid: true };
}
```

**SECURITY: Environment Variable Allowlist (CRITICAL)**

```typescript
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'NO_COLOR',
  'FORCE_COLOR',
  // CodeMachine-specific (no credentials!)
  'CODEMACHINE_LOG_LEVEL',
  'CODEMACHINE_WORKSPACE',
];

function sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (env[key]) {
      sanitized[key] = env[key]!;
    }
  }
  return sanitized;
}
```

**Implementation notes:**

- Reuse spawn pattern from `autoFixEngine.ts:547-600`
- **CRITICAL**: Use `shell: false` to prevent command injection
- **CRITICAL**: Use environment allowlist, never pass credentials
- Validate CLI path before spawning
- Two-stage termination: SIGTERM → 10s grace → SIGKILL (per EC-EXEC-006)
- Stream stdout/stderr to `options.logPath` file with 0600 permissions
- Return exit code 124 for timeout (per AC-17)

#### 1.3 Create TaskMapper

**File:** `src/workflows/taskMapper.ts` (new)

```typescript
import { ExecutionTaskType } from '../core/models/ExecutionTask.js';

export interface WorkflowMapping {
  workflow: string;
  command: 'start' | 'run' | 'step';
  useNativeEngine: boolean; // true = skip CodeMachine, use existing engine
}

export function mapTaskToWorkflow(taskType: ExecutionTaskType): WorkflowMapping;
export function getSupportedEngines(): string[];
export function isEngineSupported(engine: string): boolean;
```

**Mappings (per AC-05 through AC-08):**

| ExecutionTaskType | CodeMachine Command      | Notes                       |
| ----------------- | ------------------------ | --------------------------- |
| `code_generation` | `codemachine start`      | Primary generation workflow |
| `testing`         | Native `AutoFixEngine`   | Use existing validation     |
| `pr_creation`     | `codemachine run pr`     | PR automation workflow      |
| `deployment`      | Native (future)          | Out of scope                |
| `review`          | `codemachine run review` | Code review workflow        |
| `refactoring`     | `codemachine start`      | Uses generation workflow    |
| `documentation`   | `codemachine run docs`   | Documentation workflow      |
| `other`           | `codemachine start`      | Fallback to generation      |

#### 1.4 Create ResultNormalizer

**File:** `src/workflows/resultNormalizer.ts` (new)

```typescript
export interface NormalizedResult {
  success: boolean;
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  summary: string;
  errorMessage?: string;
  recoverable: boolean;
  artifacts: string[];
}

export function normalizeResult(
  exitCode: number,
  stdout: string,
  stderr: string,
  timedOut: boolean,
  killed: boolean
): NormalizedResult;

export function redactCredentials(text: string): string;
export function extractSummary(stdout: string): string;
```

**Exit code mapping (per AC-17):**

- `0` → success, completed
- `1` → failure, recoverable
- `124` → timeout, recoverable
- `137` (SIGKILL) → killed, recoverable
- Other → failure, recoverable (with warning log per EC-EXEC-009)

**Credential redaction patterns (GUARD-SEC-002) - EXPANDED:**

```typescript
const CREDENTIAL_PATTERNS = [
  // API Keys (generic 32+ char strings in sensitive contexts)
  /(?:api[_-]?key|apikey|secret|token|password|credential)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{32,})/gi,

  // Bearer tokens
  /Bearer\s+[A-Za-z0-9_.-]+/gi,

  // GitHub tokens (all formats)
  /gh[pousr]_[A-Za-z0-9_]{36,}/g, // ghp_, gho_, ghu_, ghs_, ghr_

  // AWS credentials
  /AKIA[A-Z0-9]{16}/g, // Access Key ID
  /(?:aws[_-]?secret|secret[_-]?access)[^=]*=\s*["']?[A-Za-z0-9/+=]{40}/gi,

  // JWT tokens
  /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,

  // Private keys
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/g,

  // Connection strings
  /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,

  // OpenAI/Anthropic keys
  /sk-[A-Za-z0-9]{48,}/g, // OpenAI
  /sk-ant-[A-Za-z0-9-]{90,}/g, // Anthropic

  // Known environment variable values
  /(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|LINEAR_API_KEY)=["']?[^\s"']+/gi,
];
```

**Log file permissions (SECURITY):**

```typescript
// Create log files with restrictive permissions
await fs.writeFile(logPath, '', { mode: 0o600 }); // Owner read/write only
```

### Success Criteria:

#### Automated Verification:

- [ ] `npm run build` passes with no type errors
- [ ] `npm test -- --grep "CodeMachineRunner"` all pass
- [ ] `npm test -- --grep "TaskMapper"` all pass
- [ ] `npm test -- --grep "ResultNormalizer"` all pass
- [ ] New config fields validate correctly

#### Manual Verification:

- [ ] `codemachine --version` check works in runner
- [ ] Log file streaming captures output correctly
- [ ] Credential redaction removes test secrets

---

## Phase 2: Queue Integration

**Implements:** REQ-EXEC-003, REQ-EXEC-004, REQ-EXEC-006, REQ-EXEC-009, REQ-EXEC-011

### Overview

Wire the plan output to queue initialization and implement the main execution loop.

### Changes Required:

#### 2.1 Add initializeQueueFromPlan

**File:** `src/workflows/queueStore.ts`

```typescript
import { TaskPlan } from '../core/models/TaskPlan.js';

export async function initializeQueueFromPlan(
  runDir: string,
  plan: TaskPlan
): Promise<QueueOperationResult>;
```

**Implementation:**

- Call existing `initializeQueue(runDir, plan.feature_id)`
- Transform `plan.tasks` to `ExecutionTask[]` with proper schema
- Call `appendToQueue(runDir, tasks)`
- Handle empty plan (EC-EXEC-011): log and return success

#### 2.2 Create CLIExecutionEngine with ExecutionStrategy Pattern

**File:** `src/workflows/executionStrategy.ts` (new) - **ARCHITECTURE FIX**

```typescript
import { ExecutionTask } from '../core/models/ExecutionTask.js';

/**
 * ExecutionStrategy interface - decouples CLIExecutionEngine from concrete implementations.
 * Addresses ARCH-001: Missing ExecutionStrategy Abstraction.
 */
export interface ExecutionStrategy {
  readonly name: string;
  canHandle(task: ExecutionTask): boolean;
  execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult>;
}

export interface ExecutionContext {
  runDir: string;
  workspaceDir: string;
  logPath: string;
  timeoutMs: number;
}

export interface ExecutionStrategyResult {
  success: boolean;
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  summary: string;
  errorMessage?: string;
  recoverable: boolean;
  durationMs: number;
}
```

**File:** `src/workflows/codeMachineStrategy.ts` (new)

```typescript
import {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy.js';
import { ExecutionTask } from '../core/models/ExecutionTask.js';
import { runCodeMachine } from './codeMachineRunner.js';
import { normalizeResult } from './resultNormalizer.js';

export class CodeMachineStrategy implements ExecutionStrategy {
  readonly name = 'codemachine';

  canHandle(task: ExecutionTask): boolean {
    // v1: Handle all task types except 'testing' (native engine)
    return task.task_type !== 'testing';
  }

  async execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult> {
    const result = await runCodeMachine({
      cliPath: this.cliPath,
      engine: 'claude', // v1: Claude only
      workspaceDir: context.workspaceDir,
      specPath: this.buildSpecPath(task),
      timeoutMs: context.timeoutMs,
      logPath: context.logPath,
    });
    return normalizeResult(
      result.exitCode,
      result.stdout,
      result.stderr,
      result.timedOut,
      result.killed
    );
  }
}
```

**File:** `src/workflows/cliExecutionEngine.ts` (new)

```typescript
import { ExecutionTask } from '../core/models/ExecutionTask.js';
import { RepoConfig } from '../core/config/RepoConfig.js';
import { ExecutionStrategy } from './executionStrategy.js';

export interface ExecutionEngineOptions {
  runDir: string;
  config: RepoConfig;
  strategies: ExecutionStrategy[]; // Inject strategies
  dryRun?: boolean;
}

export interface ExecutionResult {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  permanentlyFailedTasks: number;
  skippedTasks: number;
}

export class CLIExecutionEngine {
  private strategies: ExecutionStrategy[];

  constructor(options: ExecutionEngineOptions) {
    this.strategies = options.strategies;
  }

  async validatePrerequisites(): Promise<{ valid: boolean; errors: string[] }>;
  async execute(): Promise<ExecutionResult>;
  async executeTask(task: ExecutionTask): Promise<void>;
  stop(): void;

  private findStrategy(task: ExecutionTask): ExecutionStrategy | undefined {
    return this.strategies.find((s) => s.canHandle(task));
  }
}
```

**Execution loop:**

1. `validatePrerequisites()`: Check CLI availability (REQ-EXEC-011), workspace exists (EC-EXEC-008)
2. Loop: `getNextTask()` → `executeTask()` → `updateTaskInQueue()` until queue empty
3. For each task:
   - Mark `running` via `updateTaskInQueue()`
   - Find appropriate strategy via `findStrategy(task)`
   - Execute via `strategy.execute(task, context)`
   - Update task status with result
   - **Error boundary**: If queue update fails, log and retry (ARCH-004 fix)
4. Handle retry logic:
   - If failed and `canRetry()`, increment `retry_count`, keep in queue
   - If retry limit exceeded (EC-EXEC-005), mark `PERMANENTLY_FAILED`, halt

**Retry backoff (REQ-EXEC-009):**

```typescript
const backoffMs = config.execution.retry_backoff_ms * Math.pow(2, task.retry_count);
await sleep(Math.min(backoffMs, 60000)); // Cap at 1 minute
```

#### 2.3 Wire to Start Command

**File:** `src/cli/commands/start.ts`

After plan generation, add:

```typescript
// After taskPlanner completes
await initializeQueueFromPlan(runDir, plan);

const engine = new CLIExecutionEngine({ runDir, config });
const prereqResult = await engine.validatePrerequisites();
if (!prereqResult.valid) {
  this.error(`Prerequisites not met: ${prereqResult.errors.join(', ')}`);
}

const result = await engine.execute();
```

### Success Criteria:

#### Automated Verification:

- [ ] `npm run build` passes
- [ ] `npm test -- --grep "CLIExecutionEngine"` all pass
- [ ] `npm test -- --grep "initializeQueueFromPlan"` all pass
- [ ] Integration test: plan → queue → execution passes

#### Manual Verification:

- [ ] `ai-feature start` executes tasks end-to-end
- [ ] Failed tasks remain in queue with correct retry count
- [ ] `ai-feature resume` re-executes failed tasks

---

## Phase 3: Telemetry & Artifacts

**Implements:** REQ-EXEC-007, REQ-EXEC-008, REQ-EXEC-015, NFR-OBS-001, NFR-SEC-001

### Overview

Add comprehensive telemetry and artifact capture.

### Changes Required:

#### 3.1 Emit Telemetry Events

**File:** `src/workflows/cliExecutionEngine.ts`

Integrate `ExecutionLogWriter` from `src/telemetry/logWriters.ts`:

```typescript
// In executeTask():
this.logWriter.taskStarted(task.task_id, task.task_type, { engine: mapping.workflow });

// On success:
this.logWriter.taskCompleted(task.task_id, task.task_type, durationMs, {
  exitCode: result.exitCode,
});

// On failure:
this.logWriter.taskFailed(task.task_id, task.task_type, result.errorMessage, durationMs, {
  exitCode: result.exitCode,
  timedOut: result.timedOut,
  retryCount: task.retry_count,
});
```

#### 3.2 Implement Log File Streaming

**File:** `src/workflows/codeMachineRunner.ts`

Update to stream logs in real-time:

```typescript
const logStream = fs.createWriteStream(options.logPath, { flags: 'a' });

childProcess.stdout?.on('data', (chunk) => {
  logStream.write(chunk);
  stdoutChunks.push(chunk);
});

childProcess.stderr?.on('data', (chunk) => {
  logStream.write(chunk);
  stderrChunks.push(chunk);
});

// Handle large output (EC-EXEC-012)
let totalBytes = 0;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

childProcess.stdout?.on('data', (chunk) => {
  totalBytes += chunk.length;
  if (totalBytes > MAX_BUFFER) {
    logger.warn('Large output detected, streaming to file only');
    // Continue streaming to file, stop buffering
  }
});
```

#### 3.3 Add Artifact Capture (Minimal v1 Implementation)

**File:** `src/workflows/cliExecutionEngine.ts`

**SECURITY: Path Traversal Prevention (CRITICAL)**

```typescript
const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/; // Safe characters only

function validateTaskId(taskId: string): boolean {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`Invalid task ID format: ${taskId}`);
  }
  if (taskId.includes('..')) {
    throw new Error(`Path traversal attempt detected in task ID: ${taskId}`);
  }
  return true;
}

function isPathContained(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}
```

After task completion:

```typescript
async captureArtifacts(task: ExecutionTask, workspaceDir: string): Promise<string[]> {
  // SECURITY: Validate task ID format
  validateTaskId(task.task_id);

  const artifactDir = path.join(this.runDir, 'artifacts', task.task_id);

  // SECURITY: Verify artifact dir is within run directory
  if (!isPathContained(this.runDir, artifactDir)) {
    throw new Error(`Artifact directory escapes run directory: ${artifactDir}`);
  }

  await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 });  // Restrictive permissions

  // v1: Minimal artifact capture - just summary.md if exists
  // Full artifact capture deferred to v2
  const summaryPath = path.join(workspaceDir, 'summary.md');
  try {
    if (await fs.stat(summaryPath).catch(() => null)) {
      const destPath = path.join(artifactDir, 'summary.md');
      // SECURITY: Verify destination is within artifact dir
      if (!isPathContained(artifactDir, destPath)) {
        throw new Error('Artifact path escapes artifact directory');
      }
      await fs.copyFile(summaryPath, destPath);
      return ['summary.md'];
    }
  } catch (err) {
    // EC-EXEC-010: Permission errors logged but don't crash
    this.logger.warn('Artifact capture failed', { error: err, taskId: task.task_id });
  }

  return [];
}
```

Handle permission errors gracefully (EC-EXEC-010).

#### 3.4 Add Execution Metrics

**File:** `src/telemetry/executionMetrics.ts`

Add new metrics:

- `codemachine_execution_total{engine, status}`
- `codemachine_execution_duration_ms{engine}`
- `codemachine_retry_total{engine}`

### Success Criteria:

#### Automated Verification:

- [ ] `npm run build` passes
- [ ] Log files created at `<runDir>/logs/<taskId>.log`
- [ ] Telemetry events emitted (check test assertions)

#### Manual Verification:

- [ ] Logs contain no credentials (manual audit)
- [ ] Artifacts captured to correct directory
- [ ] Large output (>10MB) handled without crash

---

## Phase 4: Testing & Validation

**Implements:** NFR-MAINT-001, EC-EXEC-001 through EC-EXEC-012

### Overview

Comprehensive test coverage for all components.

### Changes Required:

#### 4.1 Unit Tests for CodeMachineRunner

**File:** `tests/unit/codeMachineRunner.spec.ts` (new)

Test cases:

- Exit code 0 → success
- Exit code 1 → failure
- Timeout → exit code 124
- SIGTERM → SIGKILL escalation
- Missing CLI → clear error message
- Large stdout (>10MB) → streaming works

#### 4.2 Unit Tests for TaskMapper

**File:** `tests/unit/taskMapper.spec.ts` (new)

Test cases:

- All `ExecutionTaskType` values mapped
- `testing` → native engine
- `code_generation` → `codemachine start`
- Unsupported engine → error (EC-EXEC-007)

#### 4.3 Unit Tests for ResultNormalizer

**File:** `tests/unit/resultNormalizer.spec.ts` (new)

Test cases:

- Exit code normalization
- Summary extraction
- Credential redaction (API keys, tokens)
- Unknown exit code handling (EC-EXEC-009)

#### 4.4 Integration Tests

**File:** `tests/integration/cliExecutionEngine.spec.ts` (new)

Test scenarios:

- End-to-end execution with mock CodeMachine CLI
- Resume after failure
- Retry exhaustion → permanent failure
- Queue integrity validation on resume

#### 4.5 Update Smoke Test

**File:** `scripts/tooling/smoke_execution.sh`

Add execution smoke test:

```bash
# Test CodeMachine CLI availability
ai-feature doctor --check codemachine

# Test basic execution (with mock spec)
ai-feature start tests/fixtures/sample_spec.json --dry-run
```

### Success Criteria:

#### Automated Verification:

- [ ] `npm test` all pass
- [ ] `npm run test:integration` all pass
- [ ] Test coverage >80% for new files
- [ ] `./scripts/tooling/smoke_execution.sh` passes

#### Manual Verification:

- [ ] Edge cases manually tested per EC-EXEC-001 through EC-EXEC-012

---

## Phase 5: Documentation & Rollout

**Implements:** Documentation requirements from PRD

### Overview

Update documentation and add operational tooling.

### Changes Required:

#### 5.1 Update execution_flow.md

**File:** `docs/requirements/execution_flow.md`

Add sections:

- CodeMachine CLI Adapter architecture
- Task-to-workflow mapping table
- Configuration options
- Error handling and retry logic

#### 5.2 Create Adapter Guide

**File:** `docs/ops/codemachine_adapter_guide.md` (new)

Contents:

- Prerequisites (CodeMachine CLI installation)
- Configuration reference
- Troubleshooting common issues
- Engine selection guide

#### 5.3 Add Doctor Check

**File:** `src/cli/commands/doctor.ts`

Add check:

```typescript
{
  name: 'codemachine-cli',
  check: async () => {
    const result = await validateCliAvailability(config.execution?.codemachine_cli_path ?? 'codemachine');
    return {
      status: result.available ? 'pass' : 'fail',
      message: result.available ? `v${result.version}` : result.error,
    };
  },
}
```

#### 5.4 Update README and CHANGELOG

**Files:** `README.md`, `CHANGELOG.md`

- Add execution engine setup instructions
- Document new CLI flags
- Add changelog entry for new feature

### Success Criteria:

#### Automated Verification:

- [ ] `npm run build` passes
- [ ] `ai-feature doctor` includes codemachine check
- [ ] Documentation renders correctly

#### Manual Verification:

- [ ] README instructions are accurate
- [ ] Troubleshooting guide covers common issues

---

## Testing Strategy

### Unit Tests

| Component         | File                                   | Key Cases                                  |
| ----------------- | -------------------------------------- | ------------------------------------------ |
| CodeMachineRunner | `tests/unit/codeMachineRunner.spec.ts` | Exit codes, timeouts, signals, missing CLI |
| TaskMapper        | `tests/unit/taskMapper.spec.ts`        | All task types, engine validation          |
| ResultNormalizer  | `tests/unit/resultNormalizer.spec.ts`  | Parsing, redaction, error handling         |
| Config            | `tests/unit/repoConfig.spec.ts`        | Execution config validation                |

### Integration Tests

| Scenario         | File                                           | Description                       |
| ---------------- | ---------------------------------------------- | --------------------------------- |
| Full execution   | `tests/integration/cliExecutionEngine.spec.ts` | Plan → queue → execute → complete |
| Resume flow      | `tests/integration/cliExecutionEngine.spec.ts` | Fail → resume → complete          |
| Retry exhaustion | `tests/integration/cliExecutionEngine.spec.ts` | 3 failures → permanent failure    |

### Manual Testing Steps

1. Install CodeMachine CLI: `npm install -g codemachine`
2. Run `ai-feature doctor` - verify codemachine check passes
3. Run `ai-feature start` with sample spec - verify execution completes
4. Kill process mid-execution - verify `ai-feature resume` works
5. Trigger timeout - verify graceful termination and retry
6. Check logs for credential leakage - verify redaction works

---

## Performance Considerations

- **Single-threaded execution** (GUARD-PERF-001): Parallelism deferred to future iteration
- **Log file size limit** (GUARD-PERF-002): Rotate at 100MB, warn user
- **Queue update latency** (NFR-PERF-002): <100ms target via atomic writes
- **Timeout enforcement**: 30min default, configurable per task type

---

## Migration Notes

### For Existing Runs

- Existing runs without `execution` config will use defaults
- No queue schema changes - backward compatible
- New fields are optional with sensible defaults

### Upgrade Path

1. Update ai-feature CLI: `npm install -g @codemachine/ai-feature`
2. Install CodeMachine CLI: `npm install -g codemachine`
3. Run `ai-feature doctor` to verify setup
4. Update config.json with `execution` section if customization needed

---

## References

- **Original PRD:** `thoughts/prds/2026-01-02-codemachine-cli-adapter.md`
- **Research:** `research/2026-01-02-codemachine-cli-adapter.md`
- **Linear Project:** [CodeMachine CLI Execution Engine Adapter](https://linear.app/kinginyellow/project/codemachine-cli-execution-engine-adapter-de787c2af907)

### Key Files for Reference

- CLI spawn patterns: `src/workflows/autoFixEngine.ts:527-620`
- Queue operations: `src/workflows/queueStore.ts`
- ExecutionTask schema: `src/core/models/ExecutionTask.ts`
- Telemetry events: `src/telemetry/logWriters.ts`
- Config schema: `src/core/config/RepoConfig.ts`

---

## Requirement Traceability

| PRD Requirement | Plan Phase | Implementation                 |
| --------------- | ---------- | ------------------------------ |
| REQ-EXEC-001    | Phase 1.2  | `CodeMachineRunner`            |
| REQ-EXEC-002    | Phase 1.3  | `TaskMapper`                   |
| REQ-EXEC-003    | Phase 2.2  | `CLIExecutionEngine`           |
| REQ-EXEC-004    | Phase 2.1  | `initializeQueueFromPlan`      |
| REQ-EXEC-005    | Phase 1.4  | `ResultNormalizer`             |
| REQ-EXEC-006    | Phase 2.2  | Queue status updates           |
| REQ-EXEC-007    | Phase 3.1  | Telemetry integration          |
| REQ-EXEC-008    | Phase 3.2  | Log file streaming             |
| REQ-EXEC-009    | Phase 2.2  | Retry with backoff             |
| REQ-EXEC-010    | Phase 1.1  | Config `codemachine_cli_path`  |
| REQ-EXEC-011    | Phase 2.2  | `validatePrerequisites()`      |
| REQ-EXEC-012    | Phase 1.1  | Config `default_engine`        |
| REQ-EXEC-013    | Phase 1.2  | Timeout in `CodeMachineRunner` |
| REQ-EXEC-014    | Phase 1.1  | Config `workspace_dir`         |
| REQ-EXEC-015    | Phase 3.3  | `captureArtifacts()`           |
