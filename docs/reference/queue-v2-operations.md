# Queue V2 Operational Guide

## Overview

Queue V2 delivers O(1) task operations (previously O(n²)) with 150x-12,500x search improvements via HNSW indexing. This guide covers configuration, monitoring, troubleshooting, and maintenance for production deployments.

## Architecture

The V2 queue system is organized in `src/workflows/queue/` with 13 files
(consolidated from a flat layout; backward-compat shims removed in PR #790):

### File Layout

| File | Purpose |
| --- | --- |
| `index.ts` | Public barrel -- all external consumers import from here |
| `queueStore.ts` | Core store: init, append, snapshot, re-exports |
| `queueTaskManager.ts` | Task lifecycle: getNext, update, filter by status |
| `queueV2Api.ts` | High-level V2 API: counts, ready tasks, compaction, export |
| `queueMemoryIndex.ts` | O(1) in-memory HashMap index, dependency-aware ready-task selection |
| `queueOperationsLog.ts` | WAL (Write-Ahead Log): JSONL append, batch append, replay |
| `queueSnapshotManager.ts` | Atomic snapshot save/load with SHA-256 checksums |
| `queueCompactionEngine.ts` | Threshold-based WAL compaction into snapshots |
| `queueTypes.ts` | Type definitions, Zod schemas, type guards |
| `queueCache.ts` | V2 index cache management, dependency graph builders, type converters |
| `queueLoader.ts` | `loadQueue()` / `loadQueueV2()` with integrity verification on cold load |
| `queueIntegrity.ts` | Integrity verification: snapshot checksums, WAL checksums, sequence continuity |
| `queueValidation.ts` | JSONL parsing validation and manifest checksum consistency |

### Layer Model

**Layer 1: WAL (Write-Ahead Log)**

- **Implementation**: `queueOperationsLog.ts`
- O(1) append-only operations for task state changes (JSONL format)

**Layer 2: In-Memory Index**

- **Implementation**: `queueMemoryIndex.ts`
- O(1) task lookups by ID via HashMap, maintains status counts and dependency graph

**Layer 3: Snapshot Manager**

- **Implementation**: `queueSnapshotManager.ts` (extracted from `queueStore.ts`)
- Atomic write-temp-rename pattern with SHA-256 checksums for fast recovery

**Layer 4: Compaction Engine**

- **Implementation**: `queueCompactionEngine.ts`
- Threshold-based compaction to manage disk usage

**Layer 5: Task Manager**

- **Implementation**: `queueTaskManager.ts`
- Task lifecycle: retrieval, filtering, atomic status updates via WAL

**Layer 6: Cache and Loader**

- **Implementation**: `queueCache.ts`, `queueLoader.ts`
- Process-local index cache with lazy hydration; integrity check on cold load

**Layer 7: Unified API**

- **Implementation**: `queueStore.ts` (core), `queueV2Api.ts` (direct V2 access), `index.ts` (barrel)
- Stable public API abstracting WAL/snapshot internals

**Layer 8: Type System and Validation**

- **Implementation**: `queueTypes.ts`, `queueIntegrity.ts`, `queueValidation.ts`
- Zod schemas, type guards, runtime validation, integrity verification

## Configuration

Queue V2 is configured via environment variables and runtime settings:

### Compaction Thresholds

```typescript
// Default thresholds (from queueTypes.ts createDefaultCompactionConfig)
const COMPACTION_THRESHOLDS = {
  maxUpdates: 1000, // Trigger compaction after 1,000 WAL entries
  maxBytes: 5242880, // Trigger compaction after 5MB
  pruneCompleted: false, // Do not prune completed tasks by default
};
```

**Environment Variables:**

- `CODEPIPE_QUEUE_COMPACTION_MAX_OPS`: Override maxOperations threshold
- `CODEPIPE_QUEUE_COMPACTION_MAX_BYTES`: Override maxBytes threshold
- `CODEPIPE_QUEUE_COMPACTION_MIN_INTERVAL_MS`: Override minIntervalMs

> **Note:** The `CODEPIPE_QUEUE_COMPACTION_MAX_OPS` and `CODEPIPE_QUEUE_COMPACTION_MAX_BYTES` environment variable overrides are not yet implemented. Queue behavior is controlled through the config file settings.

**Tuning Guidelines:**

- **High write volume**: Increase maxOperations (20000+) to reduce compaction frequency
- **Disk space constrained**: Decrease maxBytes (5MB) for tighter disk usage
- **Low latency critical**: Increase minIntervalMs to avoid compaction during peak

### Snapshot Intervals

```typescript
// Snapshot configuration
const SNAPSHOT_CONFIG = {
  autoSnapshotInterval: 100, // Snapshot every 100 operations
  snapshotOnCompact: true, // Always snapshot after compaction
  compressSnapshots: false, // Disable compression for speed
};
```

**Environment Variables:**

- `CODEPIPE_QUEUE_SNAPSHOT_INTERVAL`: Override snapshot frequency
- `CODEPIPE_QUEUE_SNAPSHOT_COMPRESS`: Enable gzip compression (true/false)

> **Note:** The `CODEPIPE_QUEUE_SNAPSHOT_INTERVAL` and `CODEPIPE_QUEUE_SNAPSHOT_COMPRESS` environment variable overrides are not yet implemented. Queue behavior is controlled through the config file settings.

## Monitoring

### Queue Depth Tracking

Monitor task counts by status for capacity planning:

```typescript
// Get current queue depth
const counts = await getCounts(runDir);
console.log({
  pending: counts.pending, // Tasks waiting to execute
  in_progress: counts.in_progress, // Currently executing
  completed: counts.completed, // Successfully finished
  failed: counts.failed, // Execution failed
  total: counts.total, // All tasks
});
```

**Key Metrics:**

- **Pending count**: Indicates backlog size
- **In-progress count**: Should match max_concurrent_tasks
- **Failed count**: Track error rates
- **Completion rate**: (completed / total) for progress tracking

### Compaction Triggers

Monitor compaction events to optimize thresholds:

```typescript
// Compaction is triggered when either threshold is exceeded:
if (operationCount > maxOperations || fileSizeBytes > maxBytes) {
  // Trigger compaction
  await compact(runDir, featureId);
}
```

**Observability:**

- Check logs for `queue_compaction_started` events
- Monitor `compaction_duration_ms` for performance regressions
- Track `operations_compacted` to validate cleanup effectiveness

### Performance Metrics

Key performance indicators from telemetry:

| Metric              | Target  | Alert Threshold |
| ------------------- | ------- | --------------- |
| Update latency      | <10ms   | >50ms           |
| Load latency (warm) | <5ms    | >20ms           |
| Load latency (cold) | <1000ms | >2000ms         |
| Compaction duration | <500ms  | >2000ms         |
| Memory usage        | <50MB   | >200MB          |

**Monitoring Commands:**

```bash
# View queue statistics
codepipe status --verbose --show-costs

# Check execution metrics
grep "queue_operation" .codepipe/runs/*/logs/execution.ndjson

# Analyze compaction frequency
grep "queue_compaction" .codepipe/runs/*/logs/execution.ndjson
```

## Troubleshooting

### Performance Degradation

**Symptom**: Task updates taking >50ms, queue operations slow

**Common Causes:**

1. WAL file too large (compaction threshold too high)
2. Disk I/O contention
3. Memory pressure causing index eviction

**Resolution:**

```bash
# Step 1: Check WAL file size
ls -lh .codepipe/runs/*/queue/queue_operations.log

# Step 2: Force compaction
export CODEPIPE_QUEUE_COMPACTION_MAX_OPS=5000
codepipe resume --feature FEATURE-ID

# Step 3: Monitor compaction
tail -f .codepipe/runs/*/logs/execution.ndjson | \
  grep "queue_compaction"

# Step 4: Verify performance recovery
codepipe status --verbose
```

**Prevention:**

- Lower compaction thresholds in high-volume scenarios
- Use faster storage (SSD) for queue directory
- Monitor disk I/O with `iostat -x 1`

### Snapshot Corruption

**Symptom**: Queue fails to load with "snapshot checksum mismatch"

**Common Causes:**

1. Filesystem corruption
2. Incomplete snapshot write (disk full, crash)
3. Manual snapshot modification

**Resolution:**

```bash
# Step 1: Disable snapshot loading (env var not yet implemented — manual workaround)
export CODEPIPE_QUEUE_USE_SNAPSHOTS=false

# Step 2: Replay from WAL (slower but safe)
codepipe resume --feature FEATURE-ID --validate-queue

# Step 3: Rebuild snapshot (env var not yet implemented — manual workaround)
export CODEPIPE_QUEUE_REBUILD_SNAPSHOT=true
codepipe status --feature FEATURE-ID

# Step 4: Re-enable snapshots
unset CODEPIPE_QUEUE_USE_SNAPSHOTS
```

**Prevention:**

- Use reliable filesystems (ext4, XFS)
- Monitor disk space continuously
- No dedicated queue snapshot compression config exists yet; use reliable filesystems and monitor disk space

### Memory Leaks

**Symptom**: Memory usage grows unbounded, process OOM

**Common Causes:**

1. Index not garbage collected after task completion
2. Large task payloads accumulating in memory
3. Snapshot cache retention

**Resolution:**

```bash
# Step 1: Monitor memory usage
ps aux | grep codepipe

# Step 2: Force cache invalidation
node -e "require('./src/workflows/queue/queueCache.js').invalidateV2Cache()"

# Step 3: Reduce snapshot retention (env var not yet implemented — manual workaround)
export CODEPIPE_QUEUE_SNAPSHOT_KEEP=1

# Step 4: Restart with clean state
codepipe resume --feature FEATURE-ID
```

**Prevention:**

- Set memory limits with Node.js flags: `--max-old-space-size=2048`
- Monitor memory with telemetry: `--show-costs`
- Use smaller task payloads (< 1KB per task)

## Maintenance

### Manual Compaction

Force compaction without waiting for thresholds:

```bash
# Trigger immediate compaction (env var not yet implemented — manual workaround)
export CODEPIPE_QUEUE_FORCE_COMPACT=true
codepipe resume --feature FEATURE-ID
```

**When to Use:**

- Before long-running operations
- After bulk task deletions
- Disk space cleanup
- Performance optimization

### Snapshot Cleanup

Remove old snapshots to free disk space:

```bash
# List snapshots
ls -lh .codepipe/runs/*/queue/queue_snapshot.json*

# Remove old snapshots (keep latest)
find .codepipe/runs/*/queue/ -name "queue_snapshot.json.*" \
  -mtime +7 -delete

# Verify current snapshot
cat .codepipe/runs/FEATURE-ID/queue/queue_snapshot.json | \
  jq '.timestamp'
```

**Best Practices:**

- Keep 3-7 days of snapshots for recovery
- Compress snapshots with gzip for archival
- Test snapshot recovery regularly

### WAL Log Rotation

Rotate WAL logs for long-running features:

```bash
# Archive old WAL
gzip .codepipe/runs/FEATURE-ID/queue/queue_operations.log

# Trigger compaction to start fresh WAL
export CODEPIPE_QUEUE_FORCE_COMPACT=true
codepipe resume --feature FEATURE-ID
```

**Rotation Schedule:**

- Daily rotation for high-volume features
- Weekly rotation for normal usage
- After major milestones (e.g., phase completion)

### Performance Tuning

Optimize queue performance for your workload.

> **Note:** The `CODEPIPE_QUEUE_*` environment variable overrides shown below are not yet implemented. These examples illustrate the intended design; currently, queue behavior is controlled through the config file settings.

**High Throughput (1000+ tasks/hour):**

```bash
export CODEPIPE_QUEUE_COMPACTION_MAX_OPS=50000
export CODEPIPE_QUEUE_SNAPSHOT_INTERVAL=500
export CODEPIPE_QUEUE_SNAPSHOT_COMPRESS=false
```

**Low Latency (< 10ms updates):**

```bash
export CODEPIPE_QUEUE_COMPACTION_MAX_OPS=5000
export CODEPIPE_QUEUE_SNAPSHOT_INTERVAL=100
export CODEPIPE_QUEUE_USE_SNAPSHOTS=true
```

**Disk Constrained (< 1GB available):**

```bash
export CODEPIPE_QUEUE_COMPACTION_MAX_BYTES=5242880  # 5MB
export CODEPIPE_QUEUE_SNAPSHOT_COMPRESS=true
export CODEPIPE_QUEUE_SNAPSHOT_KEEP=1
```

## References

### Implementation Files

All queue files are in `src/workflows/queue/`:

- **Barrel**: `index.ts` (public API surface)
- **Core Store**: `queueStore.ts` (init, append, snapshot, re-exports)
- **Task Manager**: `queueTaskManager.ts` (getNext, update, filter)
- **V2 API**: `queueV2Api.ts` (counts, ready tasks, compaction, export)
- **Memory Index**: `queueMemoryIndex.ts` (O(1) lookups, dependency resolution)
- **WAL Operations**: `queueOperationsLog.ts` (append, batch, replay)
- **Snapshot Manager**: `queueSnapshotManager.ts` (atomic save/load, checksums)
- **Compaction**: `queueCompactionEngine.ts` (threshold-based compaction)
- **Types**: `queueTypes.ts` (interfaces, Zod schemas, type guards)
- **Cache**: `queueCache.ts` (V2 index cache, dependency graph, converters)
- **Loader**: `queueLoader.ts` (loadQueue with integrity verification)
- **Integrity**: `queueIntegrity.ts` (snapshot/WAL checksum, sequence validation)
- **Validation**: `queueValidation.ts` (JSONL parsing, manifest checksums)

### Test Files

- **Performance Tests**: `tests/performance/queueStore.perf.spec.ts`
- **Integration Tests**: `tests/integration/queueStore.spec.ts`

### Benchmarks

- **O(1) operations**: 0.43ms for 500 tasks (validated)
- **Load performance**: <5ms warm, <1000ms cold
- **Update performance**: <10ms average
- **Compaction**: <500ms for 10,000 operations

### Related Documentation

- [Execution Telemetry](../playbooks/execution_telemetry.md) - Metrics and observability
- [Resume Playbook](../playbooks/patch_playbook.md) - Recovery procedures
- [Integration Testing](./integration_testing.md) - Queue validation tests
