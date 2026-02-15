# Parallel Execution Guide

## Overview

The parallel execution system enables concurrent task execution with dependency-aware scheduling, achieving 2-4x throughput improvement for independent tasks while maintaining safety guarantees for dependent workflows.

## Architecture

### Core Components

**1. Worker Pool Manager**

- Tracks in-flight tasks via Map structure
- Enforces concurrency limits (1-10 tasks)
- Manages worker capacity and availability

**2. Dependency Graph Analyzer**

- Detects task dependencies from execution plan
- Ensures prerequisites complete before dependent tasks
- Prevents circular dependencies

**3. Task Scheduler**

- Selects ready tasks (dependencies met, resources available)
- Dispatches tasks to available workers
- Handles task completion and failure

**4. Coordination Layer**

- Synchronizes queue updates across workers
- Prevents race conditions on shared state
- Maintains ACID guarantees for task transitions

## Configuration

### RepoConfig Settings

Configure parallel execution in `.codepipe/config.json`:

```json
{
  "execution": {
    "max_parallel_tasks": 1,
    "task_timeout_ms": 300000,
    "enable_parallel_execution": true
  }
}
```

**Parameters:**

- `max_parallel_tasks`: Maximum concurrent tasks (range: 1-10, default: 1)
- `task_timeout_ms`: Per-task timeout in milliseconds (default: 300000)
- `enable_parallel_execution`: Feature flag to enable/disable (default: true)

### Environment Variables

Override config values with environment variables:

```bash
# Set maximum concurrent tasks
export CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=4

# Set task timeout (5 minutes)
export CODEPIPE_EXECUTION_TIMEOUT_MS=300000
```

> **Note:** The `CODEPIPE_MAX_PARALLEL_TASKS`, `CODEPIPE_TASK_TIMEOUT_MS`, and `CODEPIPE_ENABLE_PARALLEL_EXECUTION` names shown in earlier drafts of this guide are not implemented. Use `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` and `CODEPIPE_EXECUTION_TIMEOUT_MS` instead, or set the values in the `execution` section of `.codepipe/config.json`.

### Runtime Override

Override parallelism at command execution:

```bash
# Force sequential execution
CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=1 codepipe resume

# Enable high parallelism
CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=8 codepipe resume
```

## How It Works

### Task Scheduling Algorithm

```typescript
// Pseudocode for parallel execution
while (hasRemainingTasks()) {
  // Get all tasks ready for execution
  const readyTasks = queue.filter(
    (task) => task.status === 'pending' && areDependenciesCompleted(task)
  );

  // Calculate available worker capacity
  const availableWorkers = maxParallelTasks - inFlightTasks.size;

  // Schedule up to available capacity
  const tasksToSchedule = readyTasks.slice(0, availableWorkers);

  for (const task of tasksToSchedule) {
    // Mark in-flight
    inFlightTasks.set(task.task_id, task);

    // Execute asynchronously
    executeTask(task)
      .then((result) => handleCompletion(task, result))
      .catch((error) => handleFailure(task, error))
      .finally(() => inFlightTasks.delete(task.task_id));
  }

  // Wait for at least one task to complete
  await Promise.race(inFlightTasks.values());
}
```

### Dependency Resolution

**Dependency Detection:**

```typescript
// Task A depends on Task B if:
// 1. Task A explicitly lists Task B in dependencies array
// 2. Task A modifies files produced by Task B
// 3. Task A is sequenced after Task B in execution plan

function areDependenciesCompleted(task: ExecutionTask): boolean {
  for (const depId of task.dependencies) {
    const depTask = queue.getTask(depId);
    if (depTask.status !== 'completed') {
      return false;
    }
  }
  return true;
}
```

**Dependency Chain Example:**

```
Task Graph:
  research-001 (no dependencies)
  spec-002 (depends on research-001)
  code-003 (depends on spec-002)
  test-004 (depends on code-003)
  code-005 (no dependencies, independent)

Execution with max_parallel_tasks=2:
  t=0s:  research-001, code-005 (parallel)
  t=10s: spec-002 (waiting for research-001)
  t=15s: code-003 (waiting for spec-002)
  t=20s: test-004 (waiting for code-003)
```

### Worker Pool Management

**Worker Lifecycle:**

1. **Idle**: Worker available, waiting for task assignment
2. **Running**: Worker executing task, in-flight
3. **Completing**: Task finished, cleanup in progress
4. **Failed**: Task failed, retry or move to next task

**Capacity Management:**

```typescript
// Track in-flight tasks
const inFlightTasks = new Map<string, Promise<RunnerResult>>();

// Enforce concurrency limit
if (inFlightTasks.size >= maxParallelTasks) {
  // Wait for capacity
  await Promise.race(inFlightTasks.values());
}

// Dispatch task to available worker
const promise = executionStrategy.execute(context, task);
inFlightTasks.set(task.task_id, promise);
```

## Best Practices

### Starting Configuration

**Conservative Start:**

```json
{
  "execution": {
    "max_parallel_tasks": 1 // Sequential execution
  }
}
```

**Incremental Scaling:**

1. Start with `max_parallel_tasks=1` (sequential)
2. Monitor resource usage (CPU, memory, disk I/O)
3. Increase to 2-3 for moderate parallelism
4. Scale to 4-8 for high-throughput scenarios
5. Monitor for resource contention

### Task Design for Parallelism

**Independent Tasks (Parallel-Friendly):**

- Documentation generation
- Linting/formatting (read-only operations)
- Independent feature implementations
- Test suite partitions (different test files)

**Dependent Tasks (Sequential Required):**

- Code generation → Testing (tests depend on code)
- PRD → Spec → Plan (sequential phases)
- Database migration → Data seeding (order matters)
- Build → Deploy (deployment depends on build)

**Mixed Workloads:**

```json
// Execution plan with parallelism opportunities
{
  "tasks": [
    { "id": "research", "dependencies": [] },
    { "id": "spec", "dependencies": ["research"] },
    { "id": "lint-frontend", "dependencies": [] }, // Parallel with research
    { "id": "lint-backend", "dependencies": [] }, // Parallel with research
    { "id": "code-api", "dependencies": ["spec"] },
    { "id": "code-ui", "dependencies": ["spec"] }, // Parallel with code-api
    { "id": "test-api", "dependencies": ["code-api"] },
    { "id": "test-ui", "dependencies": ["code-ui"] }
  ]
}
```

### Resource Monitoring

**CPU Monitoring:**

```bash
# Monitor CPU usage during execution
top -b -n 1 | grep codepipe

# Expected: <80% CPU utilization per worker
# Alert: >90% sustained CPU (reduce parallelism)
```

**Memory Monitoring:**

```bash
# Monitor memory usage
ps aux | grep codepipe | awk '{print $6/1024 " MB"}'

# Expected: <500MB per worker
# Alert: >1GB per worker (check for leaks)
```

**Disk I/O Monitoring:**

```bash
# Monitor disk I/O during execution
iostat -x 1

# Expected: <50% disk utilization
# Alert: >80% disk utilization (I/O bottleneck)
```

### Optimal Parallelism Levels

| Scenario           | Recommended max_parallel_tasks | Rationale                    |
| ------------------ | ------------------------------ | ---------------------------- |
| Single-core VM     | 1                              | No CPU parallelism benefit   |
| 2-core VM          | 2                              | Matches core count           |
| 4-core VM          | 3-4                            | Leave headroom for OS        |
| 8-core VM          | 4-6                            | Diminishing returns beyond 6 |
| 16+ core server    | 8-10                           | Hit max limit, I/O bound     |
| I/O-heavy tasks    | 4-8                            | Parallel I/O benefits        |
| CPU-heavy tasks    | 2-4                            | Avoid CPU contention         |
| Memory-constrained | 1-2                            | Prevent OOM                  |

## Monitoring

### Execution Metrics

**Key Metrics:**

- **In-flight task count**: Real-time worker utilization
- **Task completion rate**: Tasks completed per minute
- **Throughput improvement**: (Parallel time / Sequential time)
- **Worker idle time**: % time workers waiting for tasks

**Telemetry Commands:**

```bash
# View real-time execution status
codepipe status --verbose

# Show worker utilization
grep "task_started" .codepipe/runs/*/logs/execution.ndjson | wc -l

# Calculate completion rate
grep "task_completed" .codepipe/runs/*/logs/execution.ndjson | \
  jq -r '.timestamp' | uniq -c
```

### Performance Profiling

**Measure Throughput Improvement:**

```bash
# Sequential baseline
# Note: CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS is the implemented env var name
time CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=1 codepipe resume

# Parallel execution
time CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=4 codepipe resume

# Calculate speedup
# Speedup = Sequential Time / Parallel Time
# Expected: 1.5-3x for mixed workloads
```

**Identify Bottlenecks:**

```bash
# Find long-running tasks
jq -s 'sort_by(.duration_ms) | reverse | .[0:5]' \
  .codepipe/runs/*/logs/execution.ndjson

# Check dependency chains
codepipe plan --verbose --show-diff
```

## Troubleshooting

### Resource Contention

**Symptom**: Parallel execution slower than sequential

**Common Causes:**

1. CPU over-subscription (too many workers for CPU cores)
2. Disk I/O bottleneck (workers waiting on filesystem)
3. Memory pressure (swapping, OOM)

**Resolution:**

```bash
# Step 1: Identify resource bottleneck
top -b -n 1  # Check CPU usage
free -m      # Check memory usage
iostat -x 1  # Check disk I/O

# Step 2: Reduce parallelism
export CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS=2
codepipe resume

# Step 3: Monitor improvement
codepipe status --verbose --show-costs
```

**Prevention:**

- Match `max_parallel_tasks` to CPU cores
- Use SSD storage for better I/O parallelism
- Monitor resource usage before scaling

### Dependency Deadlocks

**Symptom**: Execution hangs with tasks in pending state

**Common Causes:**

1. Circular dependencies (A depends on B, B depends on A)
2. Missing dependency completion (prerequisite failed)
3. Incorrect dependency specification

**Resolution:**

```bash
# Step 1: Check dependency graph
codepipe plan --verbose

# Step 2: Identify stuck tasks
codepipe status --verbose | grep "pending"

# Step 3: Check for failed prerequisites
grep "task_failed" .codepipe/runs/*/logs/execution.ndjson

# Step 4: Manual intervention
# Edit execution plan to remove circular dependencies
# Resume execution
codepipe resume
```

**Prevention:**

- Validate dependency graph before execution
- Use topological sort to detect cycles
- Test execution plan with `--dry-run`

### Performance Degradation

**Symptom**: Parallel execution not improving throughput

**Common Causes:**

1. Tasks are dependent (sequential chain)
2. Tasks are too small (overhead dominates)
3. External API rate limiting

**Resolution:**

```bash
# Step 1: Analyze task dependencies
codepipe plan --verbose --show-diff

# Step 2: Check task durations
jq '.duration_ms' .codepipe/runs/*/logs/execution.ndjson | \
  awk '{sum+=$1; count++} END {print sum/count " ms average"}'

# Step 3: Profile external API calls
grep "rate_limit" .codepipe/runs/*/logs/execution.ndjson

# Step 4: Adjust strategy
# If tasks are dependent: Accept sequential execution
# If tasks are small: Batch small tasks together
# If rate limited: Reduce parallelism to avoid throttling
```

**Prevention:**

- Design tasks with parallelism in mind
- Batch small operations into larger tasks
- Implement backoff for rate-limited APIs

## Safety Guarantees

### Dependency Enforcement

**Guarantee**: Tasks with dependencies always wait for prerequisites

**Mechanism:**

```typescript
// Before scheduling task
if (!areDependenciesCompleted(task)) {
  // Skip task, will retry next iteration
  continue;
}

// After task completion
updateDependentTasks(task.task_id);
```

**Validation:**

```bash
# Verify dependency order
grep "task_completed" .codepipe/runs/*/logs/execution.ndjson | \
  jq -r '[.task_id, .timestamp] | @tsv'
```

### Failure Isolation

**Guarantee**: Failed prerequisite halts dependent tasks

**Mechanism:**

```typescript
// On task failure
if (task.status === 'failed') {
  // Mark all dependent tasks as blocked
  for (const depId of getDependentTasks(task.task_id)) {
    updateTaskStatus(depId, 'blocked', {
      reason: `Prerequisite ${task.task_id} failed`,
    });
  }
}
```

**Validation:**

```bash
# Check for blocked tasks
codepipe status --verbose | grep "blocked"
```

### Concurrency Limits

**Guarantee**: Never exceed `max_parallel_tasks` in-flight tasks

**Mechanism:**

```typescript
// Enforce hard limit
if (inFlightTasks.size >= maxParallelTasks) {
  // Wait for capacity before scheduling more
  await Promise.race(inFlightTasks.values());
}
```

**Validation:**

```bash
# Monitor in-flight tasks (should never exceed limit)
watch -n 1 "codepipe status --json | jq '.in_progress_count'"
```

### State Consistency

**Guarantee**: Queue state remains consistent across parallel updates

**Mechanism:**

- WAL-based updates (append-only, atomic)
- Lock-free concurrent reads
- Synchronous queue persistence

**Validation:**

```bash
# Verify queue integrity
codepipe resume --validate-queue --dry-run
```

## References

### Implementation Files

- **Execution Engine**: `src/workflows/cliExecutionEngine.ts:232-391`
- **Queue Store**: `src/workflows/queueStore.ts`
- **Execution Strategy**: `src/workflows/executionStrategy.ts`
- **Task Model**: `src/core/models/ExecutionTask.ts`

### Test Files

- **Integration Tests**: `tests/integration/cliExecutionEngine.spec.ts:343-446`
- **Unit Tests**: `tests/unit/executionStrategy.spec.ts`
- **Queue Tests**: `tests/integration/queueStore.spec.ts`

### Performance Benchmarks

- **Throughput**: 2-4x improvement for independent tasks
- **Overhead**: <10ms per task scheduling
- **Latency**: <100ms task startup time

### Related Documentation

- [Queue V2 Operations](./queue-v2-operations.md) - Queue performance and management
- [Execution Telemetry](./execution_telemetry.md) - Metrics and observability
- [CodeMachine Adapter Guide](./codemachine_adapter_guide.md) - Task execution details
