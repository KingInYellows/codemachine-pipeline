/**
 * Queue WAL Type Definitions
 *
 * Write-Ahead Log (WAL) based queue types for optimized task queue operations.
 * Provides interfaces for atomic operations, snapshots, and migration support.
 *
 * Implements:
 * - Issue #45: Queue WAL Optimization Layer 1
 * - FR-3 (Resumability): Enhanced crash recovery via WAL
 * - ADR-2 (State Persistence): Monotonic sequence-based operations
 */

import type { ExecutionTask } from '../core/models/ExecutionTask';

// ============================================================================
// Core Data Type (Task without readonly)
// ============================================================================

/**
 * Mutable version of ExecutionTask for storage operations.
 * ExecutionTask is Readonly<>, but we need mutable data for patches.
 */
export type ExecutionTaskData = {
  -readonly [K in keyof ExecutionTask]: ExecutionTask[K];
};

// ============================================================================
// Queue Operation Types (WAL Entries)
// ============================================================================

/** WAL operation type discriminator */
export type QueueOperationType = 'create' | 'update' | 'delete';

/**
 * Single WAL operation entry.
 * Represents an atomic change to the queue state.
 */
export interface QueueOperation {
  /** Operation type discriminator */
  op: QueueOperationType;
  /** Monotonically increasing sequence number */
  seq: number;
  /** ISO 8601 timestamp of operation */
  ts: string;
  /** Target task identifier */
  taskId: string;
  /** Partial task data for updates */
  patch?: Partial<ExecutionTaskData>;
  /** Full task data for creates */
  task?: ExecutionTaskData;
  /** CRC32 checksum of operation payload */
  checksum: string;
}

// ============================================================================
// Queue Counts
// ============================================================================

/**
 * Task count breakdown by status.
 * Used for quick status queries without full queue scan.
 */
export interface QueueCounts {
  /** Total number of tasks */
  total: number;
  /** Tasks awaiting execution */
  pending: number;
  /** Tasks currently executing */
  running: number;
  /** Successfully finished tasks */
  completed: number;
  /** Tasks that failed execution */
  failed: number;
  /** Tasks skipped due to dependency failures */
  skipped: number;
  /** Tasks cancelled by user or system */
  cancelled: number;
}

// ============================================================================
// Queue Snapshot V2 (Enhanced Format)
// ============================================================================

/**
 * Enhanced queue snapshot with WAL integration.
 * Provides fast recovery point with sequence watermark.
 */
export interface QueueSnapshotV2 {
  /** Schema version identifier */
  schemaVersion: '2.0.0';
  /** Feature identifier for this queue */
  featureId: string;
  /** Sequence number watermark (all ops <= this are in snapshot) */
  snapshotSeq: number;
  /** All tasks indexed by task_id */
  tasks: Record<string, ExecutionTaskData>;
  /** Aggregated task counts by status */
  counts: QueueCounts;
  /** Task dependency graph (taskId -> dependency taskIds) */
  dependencyGraph: Record<string, string[]>;
  /** ISO 8601 snapshot creation timestamp */
  timestamp: string;
  /** SHA-256 checksum of snapshot content */
  checksum: string;
}

// ============================================================================
// In-Memory Index State
// ============================================================================

/**
 * In-memory queue state for fast operations.
 * Rebuilt from snapshot + WAL replay on load.
 */
export interface QueueIndexState {
  /** Task lookup by task_id */
  tasks: Map<string, ExecutionTaskData>;
  /** Current task counts */
  counts: QueueCounts;
  /** Last applied WAL sequence number */
  lastSeq: number;
  /** Sequence number of last snapshot */
  snapshotSeq: number;
  /** True if state has uncommitted changes */
  dirty: boolean;
}

// ============================================================================
// Compaction Configuration
// ============================================================================

/**
 * WAL compaction settings.
 * Controls when WAL is merged into snapshot.
 */
export interface CompactionConfig {
  /** Maximum WAL entries before compaction (default: 1000) */
  maxUpdates: number;
  /** Maximum WAL file size in bytes before compaction (default: 5MB) */
  maxBytes: number;
  /** Remove completed tasks older than retention period during compaction */
  pruneCompleted: boolean;
}

// ============================================================================
// Migration Types
// ============================================================================

/**
 * Result of queue format migration.
 * Tracks conversion details and backup location.
 */
export interface MigrationResult {
  /** Whether migration completed successfully */
  success: boolean;
  /** Source schema version */
  fromVersion: string;
  /** Target schema version */
  toVersion: string;
  /** Number of tasks converted */
  tasksConverted: number;
  /** Path to pre-migration backup (if created) */
  backupPath?: string;
  /** Error message if migration failed */
  error?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for QueueOperation.
 * Validates required fields and operation type.
 */
export function isQueueOperation(value: unknown): value is QueueOperation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.op === 'string' &&
    ['create', 'update', 'delete'].includes(obj.op) &&
    typeof obj.seq === 'number' &&
    Number.isInteger(obj.seq) &&
    obj.seq >= 0 &&
    typeof obj.ts === 'string' &&
    typeof obj.taskId === 'string' &&
    typeof obj.checksum === 'string'
  );
}

/**
 * Type guard for QueueSnapshotV2.
 * Validates schema version and required fields.
 */
export function isQueueSnapshotV2(value: unknown): value is QueueSnapshotV2 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    obj.schemaVersion === '2.0.0' &&
    typeof obj.featureId === 'string' &&
    typeof obj.snapshotSeq === 'number' &&
    Number.isInteger(obj.snapshotSeq) &&
    typeof obj.tasks === 'object' &&
    obj.tasks !== null &&
    typeof obj.counts === 'object' &&
    obj.counts !== null &&
    typeof obj.dependencyGraph === 'object' &&
    obj.dependencyGraph !== null &&
    typeof obj.timestamp === 'string' &&
    typeof obj.checksum === 'string'
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create empty QueueCounts object.
 * @returns Zero-initialized counts
 */
export function createEmptyQueueCounts(): QueueCounts {
  return {
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
}

/**
 * Create default CompactionConfig.
 * @returns Default compaction settings
 */
export function createDefaultCompactionConfig(): CompactionConfig {
  return {
    maxUpdates: 1000,
    maxBytes: 5 * 1024 * 1024, // 5MB
    pruneCompleted: false,
  };
}

/**
 * Create empty QueueIndexState.
 * @returns Empty initialized index state
 */
export function createEmptyIndexState(): QueueIndexState {
  return {
    tasks: new Map(),
    counts: createEmptyQueueCounts(),
    lastSeq: 0,
    snapshotSeq: 0,
    dirty: false,
  };
}
