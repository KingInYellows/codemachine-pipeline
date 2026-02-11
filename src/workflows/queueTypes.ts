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

// Re-export constants for modules that import from queueTypes
export { QUEUE_FILE, QUEUE_MANIFEST_FILE, QUEUE_SNAPSHOT_FILE } from './queueConstants.js';

// ============================================================================
// Queue Store Types (shared across companion modules)
// ============================================================================

/** Queue manifest metadata */
export interface QueueManifest {
  schema_version: string;
  feature_id: string;
  total_tasks: number;
  pending_count: number;
  running_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
  queue_checksum: string;
  updated_at: string;
  last_snapshot_at?: string;
}

/** Queue snapshot for fast recovery */
export interface QueueSnapshot {
  schema_version: string;
  feature_id: string;
  tasks: Record<string, ExecutionTask>;
  dependency_graph: Record<string, string[]>;
  timestamp: string;
  checksum: string;
}

/** Queue operation result */
export interface QueueOperationResult {
  success: boolean;
  message: string;
  tasksAffected?: number;
  errors?: string[];
}

/** Queue validation result */
export interface QueueValidationResult {
  valid: boolean;
  errors: Array<{ taskId: string; line: number; message: string }>;
  warnings: Array<{ taskId: string; message: string }>;
  totalTasks: number;
  corruptedTasks: number;
}

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

  const obj = value as {
    op?: unknown;
    seq?: unknown;
    ts?: unknown;
    taskId?: unknown;
    checksum?: unknown;
  };

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

  const obj = value as {
    schemaVersion?: unknown;
    featureId?: unknown;
    snapshotSeq?: unknown;
    tasks?: unknown;
    counts?: unknown;
    dependencyGraph?: unknown;
    timestamp?: unknown;
    checksum?: unknown;
  };

  return (
    obj.schemaVersion === '2.0.0' &&
    typeof obj.featureId === 'string' &&
    typeof obj.snapshotSeq === 'number' &&
    Number.isInteger(obj.snapshotSeq) &&
    obj.snapshotSeq >= 0 &&
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

// ============================================================================
// Queue Integrity Types (CDMCH-69)
// ============================================================================

/** Integrity check mode: fail-fast throws on corruption, warn-only logs and continues. */
export type QueueIntegrityMode = 'fail-fast' | 'warn-only';

/** Kind of integrity failure detected. */
export type QueueIntegrityErrorKind =
  | 'snapshot-checksum-mismatch'
  | 'wal-checksum-mismatch'
  | 'sequence-gap'
  | 'sequence-non-monotonic';

/**
 * Typed error thrown when queue integrity verification fails in fail-fast mode.
 * Includes structured fields for programmatic recovery decisions.
 */
export class QueueIntegrityError extends Error {
  readonly kind: QueueIntegrityErrorKind;
  readonly location: string;
  readonly sequenceRange?: { expected: number; actual: number };
  readonly recoveryGuidance: string;

  constructor(options: {
    kind: QueueIntegrityErrorKind;
    message: string;
    location: string;
    sequenceRange?: { expected: number; actual: number };
    recoveryGuidance: string;
  }) {
    super(options.message);
    this.name = 'QueueIntegrityError';
    this.kind = options.kind;
    this.location = options.location;
    if (options.sequenceRange) {
      this.sequenceRange = options.sequenceRange;
    }
    this.recoveryGuidance = options.recoveryGuidance;
  }
}
