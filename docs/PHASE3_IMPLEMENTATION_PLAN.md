# Phase 3 Implementation Plan: Integration & Enhancement
**Date**: 2026-01-20
**Status**: PENDING (Awaiting Phase 2 completion)
**Objective**: Feature integration, CLI wiring, operational documentation

---

## Phase 3 Overview

**Goals**:
1. Implement missing TaskMapper commands (`step`, `status`)
2. Wire CLIExecutionEngine into `ai-feature start/resume` commands
3. Create comprehensive operational documentation
4. Submit final Graphite stack with all enhancements

**Prerequisites**:
- ✅ Phase 1 Complete (9 issues verified, PRs #149-#150 submitted)
- ⏳ Phase 2 Complete (security fixed, tests expanded, dependencies updated)

---

## Phase 3.1: Implement TaskMapper `step` Command

### Current State
**File**: `src/workflows/taskMapper.ts`
**Implemented Commands**: `start`, `run`
**Implemented Subcommands**: `pr`, `review`, `docs`
**Missing**: `step` command

### Command Purpose
- **`codemachine step`**: Execute a single step within a workflow
- **Use Case**: Incremental execution, step-by-step debugging
- **Reference**: `research/2026-01-02-codemachine-cli-adapter.md:99`

### Implementation Plan

**1. Update ALLOWED_COMMANDS** (line 34):
```typescript
// Before:
export const ALLOWED_COMMANDS = ['start', 'run'] as const;

// After:
export const ALLOWED_COMMANDS = ['start', 'run', 'step'] as const;
```

**2. Add Task Type Mapping**:
```typescript
// Add to TASK_TYPE_TO_WORKFLOW (lines 72-116)
// Strategy: Map incremental/iterative tasks to 'step' command
const incrementalTasks = {
  // Example: If a task needs step-by-step execution
  code_refactoring_incremental: {
    workflow: 'codemachine step',
    command: 'step',
    useNativeEngine: false,
  },
};
```

**3. Update CommandStructure Interface** (if needed):
- Already supports arbitrary commands via `command: string`
- No changes required to interface

**4. Add Step Command Validation**:
```typescript
// In validateCommandStructure() function (line 175)
if (!ALLOWED_COMMANDS.includes(structure.command as AllowedCommand)) {
  throw new Error(`Invalid command: ${structure.command}`);
}
```

**5. Write Comprehensive Tests**:
```typescript
// tests/unit/taskMapper.spec.ts
describe('step command', () => {
  it('should generate step command structure');
  it('should validate step command as allowed');
  it('should reject invalid step subcommands');
  it('should map incremental tasks to step workflow');
});
```

### Acceptance Criteria
- ✅ `step` added to ALLOWED_COMMANDS
- ✅ At least one task type mapped to `step` workflow
- ✅ Validation accepts `step` as valid command
- ✅ Tests cover step command generation
- ✅ All existing tests still pass

---

## Phase 3.2: Implement TaskMapper `status` Command

### Current State
**Missing**: `status` command for workflow state queries

### Command Purpose
- **`codemachine status`**: Check workflow execution status
- **Use Case**: Query task/session state, monitor progress
- **Returns**: Status information (task states, progress, errors)

### Implementation Plan

**1. Update ALLOWED_COMMANDS** (line 34):
```typescript
export const ALLOWED_COMMANDS = ['start', 'run', 'step', 'status'] as const;
```

**2. Add Task Type Mapping**:
```typescript
// Status checks likely won't map to specific task types
// Instead, add utility function for on-demand status queries
export function createStatusCommand(): CommandStructure {
  return {
    executable: 'codemachine',
    command: 'status',
    args: [],
  };
}
```

**3. Integrate with Queue Monitoring**:
```typescript
// In CLIExecutionEngine or similar
async function checkExecutionStatus(runDir: string): Promise<StatusReport> {
  // Query queue for task states
  const tasks = await loadQueue(runDir);
  const counts = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
  };

  for (const task of tasks.values()) {
    counts[task.status]++;
  }

  return {
    totalTasks: tasks.size,
    counts,
    lastError: await getLastError(runDir),
  };
}
```

**4. Write Comprehensive Tests**:
```typescript
// tests/unit/taskMapper.spec.ts
describe('status command', () => {
  it('should generate status command structure');
  it('should validate status command as allowed');
  it('should create status command without args');
});

// tests/integration/cliExecutionEngine.spec.ts
describe('status queries', () => {
  it('should query queue status via status command');
  it('should report accurate task counts');
  it('should include last error in status');
});
```

### Acceptance Criteria
- ✅ `status` added to ALLOWED_COMMANDS
- ✅ `createStatusCommand()` utility function
- ✅ Status queries integrated with queue monitoring
- ✅ Tests cover status command generation and execution
- ✅ All existing tests still pass

---

## Phase 3.3: Wire CLIExecutionEngine into ai-feature Commands

### Current State
**Files to Modify**:
- `src/cli/commands/start.ts` - Add CLIExecutionEngine integration
- `src/cli/commands/resume.ts` (if exists) - Add resume support

### Integration Points

**1. Import CLIExecutionEngine** (start.ts line 1-30):
```typescript
import { CLIExecutionEngine } from '../../workflows/cliExecutionEngine';
import { loadQueue, updateTask } from '../../workflows/queueStore';
```

**2. Add Execution Phase** (after PRD authoring):
```typescript
// In run() method, after EXECUTION_STEPS.PRD
const EXECUTION_STEPS = {
  Context: 'context_aggregation',
  Research: 'research_detection',
  PRD: 'prd_authoring',
  Execution: 'task_execution',  // NEW
} as const;
```

**3. Initialize CLIExecutionEngine**:
```typescript
// After PRD completion
await setCurrentStep(runDir, EXECUTION_STEPS.Execution);
logger.info('Starting task execution via CLIExecutionEngine');

const executionEngine = new CLIExecutionEngine(
  runDir,
  repoConfig,
  {
    logger,
    metrics,
    traceManager,
  }
);

// Execute all pending tasks
const results = await executionEngine.executeQueue();

// Report results
logger.info('Execution complete', {
  totalTasks: results.totalTasks,
  completed: results.completedTasks,
  failed: results.failedTasks,
});
```

**4. Add CLI Flags**:
```typescript
static flags = {
  ...existingFlags,
  'max-parallel': Flags.integer({
    description: 'Maximum parallel tasks (1-10)',
    default: 1,
  }),
  'dry-run': Flags.boolean({
    description: 'Preview execution plan without running',
    default: false,
  }),
};
```

**5. Wire RepoConfig**:
```typescript
// Pass execution config to CLIExecutionEngine
const executionConfig = {
  max_parallel_tasks: flags['max-parallel'],
  operation_timeout_ms: repoConfig.execution?.operation_timeout_ms || 120000,
  max_retries: repoConfig.execution?.max_retries || 2,
  // ... other execution settings
};
```

### Resume Command Integration

**Create `src/cli/commands/resume.ts`** (if not exists):
```typescript
export default class Resume extends Command {
  static description = 'Resume a paused or failed execution';

  static flags = {
    'run-dir': Flags.string({
      description: 'Run directory to resume',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Resume);

    // Load existing run directory
    const runDir = flags['run-dir'];

    // Re-initialize CLIExecutionEngine
    const engine = new CLIExecutionEngine(runDir, repoConfig, telemetry);

    // Resume from last checkpoint
    await engine.resumeExecution();
  }
}
```

### Acceptance Criteria
- ✅ CLIExecutionEngine integrated into `start` command
- ✅ Resume command created (or existing resume wired up)
- ✅ CLI flags for parallel execution and dry-run
- ✅ Proper error handling and logging
- ✅ Integration tests verify E2E flow
- ✅ All existing start command tests still pass

---

## Phase 3.4: Create Operational Documentation

### Documentation Structure

**1. Queue V2 Operations** (`docs/operations/queue-v2-operations.md`):
```markdown
# Queue V2 Operational Guide

## Architecture Overview
- 8-layer V2 design (WAL, snapshot, index, compaction, etc.)
- O(1) operations, 150x-12,500x search improvement

## Monitoring
- Queue depth tracking
- Compaction triggers and thresholds
- Performance metrics

## Troubleshooting
- Common issues and solutions
- Migration rollback procedures
- Performance degradation debugging

## Maintenance
- Compaction configuration
- Snapshot management
- WAL log rotation
```

**2. Parallel Execution Guide** (`docs/operations/parallel-execution.md`):
```markdown
# Parallel Execution Guide

## Configuration
- max_parallel_tasks (1-10)
- Dependency graph analysis
- Resource allocation

## Best Practices
- Task independence verification
- Dependency management
- Resource limit tuning

## Monitoring
- In-flight task tracking
- Throughput metrics
- Bottleneck identification

## Troubleshooting
- Deadlock detection
- Resource contention
- Dependency resolution failures
```

**3. Log Rotation** (`docs/operations/log-rotation.md`):
```markdown
# Log Rotation Guide

## Configuration
- log_rotation_mb (default: 100MB)
- log_rotation_keep (default: 3 files)
- log_rotation_compress (default: false)

## Behavior
- Automatic rotation on threshold
- Numbered rotation scheme (.1, .2, .3)
- Optional gzip compression

## Monitoring
- Log file sizes
- Rotation events
- Disk usage

## Troubleshooting
- Rotation failures
- Disk space issues
- Compression errors
```

**4. Updated README** (`README.md`):
```markdown
# New Features (v3.0)

## Queue V2 Optimization
- O(1) task operations (was O(n²))
- 150x-12,500x faster search via HNSW indexing
- Automatic V1→V2 migration with rollback

## Parallel Execution
- Configurable concurrency (1-10 tasks)
- Dependency-aware scheduling
- 2-4x throughput improvement

## Enhanced Telemetry
- Execution metrics tracking
- Queue depth monitoring
- Performance profiling

## Operational Features
- Log rotation (100MB threshold)
- Secure CLI execution (no shell injection)
- Comprehensive test coverage (>90%)
```

### Acceptance Criteria
- ✅ All 3 operational guides created
- ✅ README updated with new features
- ✅ Documentation covers configuration, monitoring, troubleshooting
- ✅ Examples and best practices included

---

## Phase 3 Completion Criteria

### Deliverables
- [ ] TaskMapper `step` command implemented
- [ ] TaskMapper `status` command implemented
- [ ] CLIExecutionEngine wired into `ai-feature start`
- [ ] Resume command created/wired
- [ ] 3 operational guides created
- [ ] README updated

### Graphite Stack Structure
```
phase-2/queue-test-v2-compatibility (Phase 2 final branch)
└── phase-3/taskmapper-step-command
    └── phase-3/taskmapper-status-command
        └── phase-3/cli-integration
            └── phase-3/operational-docs
```

### Success Metrics
- ✅ All TaskMapper tests pass (including new step/status tests)
- ✅ CLIExecutionEngine integration tests pass
- ✅ Documentation complete and reviewed
- ✅ End-to-end execution flow works (start → execute → resume)

---

## Agent Deployment Plan

### Agents for Phase 3
| Agent Type | Task | Estimated Tokens | Model |
|------------|------|------------------|-------|
| coder | Implement step command | 15k | haiku |
| coder | Implement status command | 15k | haiku |
| coder | Wire CLIExecutionEngine | 25k | sonnet |
| api-docs | Create operational guides | 20k | sonnet |

**Total Estimated**: 75k tokens
**Timeline**: 2-3 hours (with parallel execution)

---

## Timeline & Dependencies

**Phase 3 Start**: Immediately after Phase 2 agents complete
**Estimated Duration**: 3-5 hours
**Dependencies**:
- Phase 2.1 complete (security fix merged)
- Phase 2.2 complete (tests expanded)
- Phase 2.4 complete (queue tests fixed)

**Critical Path**:
1. TaskMapper commands (step, status) - 1 hour
2. CLI integration - 2 hours
3. Documentation - 1-2 hours
4. Testing & validation - 1 hour

**Total Estimated**: 5-6 hours from Phase 2 completion

---

**Document Status**: READY FOR EXECUTION
**Awaiting**: Phase 2 agent completion notifications
**Next Action**: Launch Phase 3 agents upon Phase 2 completion
