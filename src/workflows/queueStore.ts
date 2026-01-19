import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  type ExecutionTask,
  parseExecutionTask,
  serializeExecutionTask,
  canRetry,
  areDependenciesCompleted,
} from '../core/models/ExecutionTask';
import { readManifest, writeManifest, withLock } from '../persistence/runDirectoryManager';

/**
 * Queue Store
 *
 * Manages persistent task queue storage with JSONL snapshots,
 * integrity checksums, and safe resume capabilities.
 *
 * Implements:
 * - FR-2 (Run Directory): Queue persistence in `queue/` subdirectory
 * - FR-3 (Resumability): Queue snapshots with checksums for crash recovery
 * - ADR-2 (State Persistence): Monotonic queue files with integrity validation
 *
 * Queue Format:
 * - queue.jsonl: One ExecutionTask per line (append-only during execution)
 * - queue_snapshot.json: Periodic snapshots for fast recovery
 * - queue_manifest.json: Metadata (task counts, checksums, timestamps)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Queue manifest metadata
 */
export interface QueueManifest {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** Total tasks in queue */
  total_tasks: number;
  /** Pending tasks */
  pending_count: number;
  /** Running tasks */
  running_count: number;
  /** Completed tasks */
  completed_count: number;
  /** Failed tasks */
  failed_count: number;
  /** Skipped tasks */
  skipped_count: number;
  /** Cancelled tasks */
  cancelled_count: number;
  /** SHA-256 checksum of queue.jsonl */
  queue_checksum: string;
  /** Timestamp of last update */
  updated_at: string;
  /** Timestamp of last snapshot */
  last_snapshot_at?: string;
}

/**
 * Queue snapshot for fast recovery
 */
export interface QueueSnapshot {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** All tasks indexed by task_id */
  tasks: Record<string, ExecutionTask>;
  /** Task dependency graph (task_id -> dependent task_ids) */
  dependency_graph: Record<string, string[]>;
  /** Snapshot timestamp */
  timestamp: string;
  /** Checksum of snapshot data */
  checksum: string;
}

/**
 * Queue operation result
 */
export interface QueueOperationResult {
  success: boolean;
  message: string;
  tasksAffected?: number;
  errors?: string[];
}

/**
 * Queue validation result
 */
export interface QueueValidationResult {
  valid: boolean;
  errors: Array<{
    taskId: string;
    line: number;
    message: string;
  }>;
  warnings: Array<{
    taskId: string;
    message: string;
  }>;
  totalTasks: number;
  corruptedTasks: number;
}

// ============================================================================
// Constants
// ============================================================================

const QUEUE_FILE = 'queue.jsonl';
const QUEUE_UPDATES_FILE = 'queue_updates.jsonl';
const QUEUE_MANIFEST_FILE = 'queue_manifest.json';
const QUEUE_SNAPSHOT_FILE = 'queue_snapshot.json';
const QUEUE_COMPACTION_MAX_UPDATES = 1000;
const QUEUE_COMPACTION_MAX_BYTES = 5 * 1024 * 1024;

interface QueueCounts {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

interface QueueCache {
  tasks: Map<string, ExecutionTask>;
  queuePath: string;
  updatesPath: string;
  queueSize: number;
  queueMtimeMs: number;
  updatesOffset: number;
  updatesCount: number;
  counts: QueueCounts;
}

const queueCache = new Map<string, QueueCache>();

// ============================================================================
// Queue Initialization
// ============================================================================

/**
 * Initialize queue storage in run directory
 *
 * @param runDir - Run directory path
 * @param featureId - Feature ID
 * @returns Queue directory path
 */
export async function initializeQueue(runDir: string, featureId: string): Promise<string> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);

  // Ensure queue directory exists
  await fs.mkdir(queueDir, { recursive: true });

  // Create initial queue manifest
  const queueManifest: QueueManifest = {
    schema_version: '1.0.0',
    feature_id: featureId,
    total_tasks: 0,
    pending_count: 0,
    running_count: 0,
    completed_count: 0,
    failed_count: 0,
    skipped_count: 0,
    cancelled_count: 0,
    queue_checksum: computeEmptyQueueChecksum(),
    updated_at: new Date().toISOString(),
  };

  await writeQueueManifest(queueDir, queueManifest);

  return queueDir;
}

export interface PlanTask {
  id: string;
  title: string;
  task_type: ExecutionTask['task_type'];
  dependency_ids?: string[];
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * TaskPlan interface for queue initialization
 *
 * Represents a plan with a feature ID and associated tasks.
 * This is a queue-specific DTO, distinct from PlanArtifact.
 */
export interface TaskPlan {
  /** Feature identifier for queue initialization */
  feature_id: string;
  /** Array of plan tasks to transform to ExecutionTasks */
  tasks: PlanTask[];
}

export async function initializeQueueFromPlan(
  runDir: string,
  plan: TaskPlan
): Promise<QueueOperationResult> {
  try {
    await initializeQueue(runDir, plan.feature_id);

    if (plan.tasks.length === 0) {
      return {
        success: true,
        message: 'Queue initialized with no tasks',
        tasksAffected: 0,
      };
    }

    const now = new Date().toISOString();
    const executionTasks: ExecutionTask[] = plan.tasks.map((planTask) => ({
      schema_version: '1.0.0',
      task_id: planTask.id,
      feature_id: plan.feature_id,
      title: planTask.title,
      task_type: planTask.task_type,
      status: 'pending' as const,
      dependency_ids: planTask.dependency_ids ?? [],
      retry_count: 0,
      max_retries: 3,
      created_at: now,
      updated_at: now,
      ...(planTask.config !== undefined ? { config: planTask.config } : {}),
      ...(planTask.metadata !== undefined ? { metadata: planTask.metadata } : {}),
    }));

    const result = await appendToQueue(runDir, executionTasks);

    if (!result.success) {
      return result;
    }

    return {
      success: true,
      message: `Queue initialized from plan with ${executionTasks.length} task(s)`,
      tasksAffected: executionTasks.length,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to initialize queue from plan',
      errors: [error instanceof Error ? (error.stack ?? error.message) : 'Unknown error'],
    };
  }
}

function computeEmptyQueueChecksum(): string {
  return crypto.createHash('sha256').update('').digest('hex');
}

function createEmptyCounts(): QueueCounts {
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

function countTasks(tasks: Map<string, ExecutionTask>): QueueCounts {
  const counts = createEmptyCounts();
  for (const task of tasks.values()) {
    counts.total += 1;
    switch (task.status) {
      case 'pending':
        counts.pending += 1;
        break;
      case 'running':
        counts.running += 1;
        break;
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

async function loadQueueCounts(
  queueDir: string,
  tasks: Map<string, ExecutionTask>
): Promise<QueueCounts> {
  const manifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as QueueManifest;
    const counts: QueueCounts = {
      total: manifest.total_tasks,
      pending: manifest.pending_count,
      running: manifest.running_count,
      completed: manifest.completed_count,
      failed: manifest.failed_count,
      skipped: manifest.skipped_count,
      cancelled: manifest.cancelled_count,
    };
    const values = Object.values(counts);
    if (values.every((value) => Number.isFinite(value) && value >= 0)) {
      return counts;
    }
  } catch (error) {
    // Fall back to computing counts from queue data
    console.warn(`Failed to load queue counts from manifest, falling back to re-counting. Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return countTasks(tasks);
}

function applyTaskUpdate(cache: QueueCache, updatedTask: ExecutionTask): void {
  const previous = cache.tasks.get(updatedTask.task_id);

  if (previous) {
    cache.counts.total -= 1;
    switch (previous.status) {
      case 'pending':
        cache.counts.pending -= 1;
        break;
      case 'running':
        cache.counts.running -= 1;
        break;
      case 'completed':
        cache.counts.completed -= 1;
        break;
      case 'failed':
        cache.counts.failed -= 1;
        break;
      case 'skipped':
        cache.counts.skipped -= 1;
        break;
      case 'cancelled':
        cache.counts.cancelled -= 1;
        break;
      default:
        break;
    }
  }

  cache.tasks.set(updatedTask.task_id, updatedTask);
  cache.counts.total += 1;
  switch (updatedTask.status) {
    case 'pending':
      cache.counts.pending += 1;
      break;
    case 'running':
      cache.counts.running += 1;
      break;
    case 'completed':
      cache.counts.completed += 1;
      break;
    case 'failed':
      cache.counts.failed += 1;
      break;
    case 'skipped':
      cache.counts.skipped += 1;
      break;
    case 'cancelled':
      cache.counts.cancelled += 1;
      break;
    default:
      break;
  }
}

async function loadQueueFromFile(queuePath: string): Promise<Map<string, ExecutionTask>> {
  const tasks = new Map<string, ExecutionTask>();

  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        const result = parseExecutionTask(parsed);

        if (result.success) {
          tasks.set(result.data.task_id, result.data);
        }
      } catch {
        // Skip corrupted lines (will be caught by validation)
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return tasks;
    }
    throw error;
  }

  return tasks;
}

async function applyQueueUpdates(cache: QueueCache): Promise<void> {
  let stats: { size: number } | null = null;
  try {
    stats = await fs.stat(cache.updatesPath);
  } catch {
    cache.updatesOffset = 0;
    return;
  }

  if (stats.size < cache.updatesOffset) {
    cache.updatesOffset = 0;
    cache.updatesCount = 0;
  }

  if (stats.size === cache.updatesOffset) {
    return;
  }

  const length = stats.size - cache.updatesOffset;
  const handle = await fs.open(cache.updatesPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, cache.updatesOffset);
  } finally {
    await handle.close();
  }

  const content = buffer.toString('utf-8');
  const lines = content.split('\n').filter((line) => line.length > 0);

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      const result = parseExecutionTask(parsed);
      if (result.success) {
        applyTaskUpdate(cache, result.data);
        cache.updatesCount += 1;
      }
    } catch {
      // Ignore malformed updates
    }
  }

  cache.updatesOffset = stats.size;
}

async function getQueueCache(runDir: string): Promise<QueueCache> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const queuePath = path.join(queueDir, QUEUE_FILE);
  const updatesPath = path.join(queueDir, QUEUE_UPDATES_FILE);

  const stats = await fs.stat(queuePath).catch(() => null);
  const queueSize = stats?.size ?? 0;
  const queueMtimeMs = stats?.mtimeMs ?? 0;

  const existing = queueCache.get(runDir);
  if (!existing || existing.queueSize !== queueSize || existing.queueMtimeMs !== queueMtimeMs) {
    const tasks = await loadQueueFromFile(queuePath);
    const counts = await loadQueueCounts(queueDir, tasks);
    const cache: QueueCache = {
      tasks,
      queuePath,
      updatesPath,
      queueSize,
      queueMtimeMs,
      updatesOffset: 0,
      updatesCount: 0,
      counts,
    };
    queueCache.set(runDir, cache);
  }

  const cache = queueCache.get(runDir)!;
  await applyQueueUpdates(cache);
  return cache;
}

async function updateQueueManifestFromCache(
  queueDir: string,
  cache: QueueCache,
  options?: { queueChecksum?: string; lastSnapshotAt?: string }
): Promise<void> {
  const manifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent) as QueueManifest;

  manifest.total_tasks = cache.counts.total;
  manifest.pending_count = cache.counts.pending;
  manifest.running_count = cache.counts.running;
  manifest.completed_count = cache.counts.completed;
  manifest.failed_count = cache.counts.failed;
  manifest.skipped_count = cache.counts.skipped;
  manifest.cancelled_count = cache.counts.cancelled;
  if (options?.queueChecksum) {
    manifest.queue_checksum = options.queueChecksum;
  }
  if (options?.lastSnapshotAt) {
    manifest.last_snapshot_at = options.lastSnapshotAt;
  }
  manifest.updated_at = new Date().toISOString();

  await writeQueueManifest(queueDir, manifest);
}

function getCompactionTasks(tasks: Map<string, ExecutionTask>): Map<string, ExecutionTask> {
  const requiredDependencies = new Set<string>();

  for (const task of tasks.values()) {
    if (task.status !== 'completed') {
      for (const dependencyId of task.dependency_ids) {
        requiredDependencies.add(dependencyId);
      }
    }
  }

  const compacted = new Map<string, ExecutionTask>();
  for (const [taskId, task] of tasks) {
    if (task.status !== 'completed' || requiredDependencies.has(taskId)) {
      compacted.set(taskId, task);
    }
  }

  return compacted;
}

function serializeTasksToJsonl(tasks: Iterable<ExecutionTask>): string {
  const lines: string[] = [];
  for (const task of tasks) {
    lines.push(serializeExecutionTask(task, false));
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function buildQueueSnapshot(featureId: string, tasks: Map<string, ExecutionTask>): QueueSnapshot {
  const dependencyGraph: Record<string, string[]> = {};
  const tasksObject: Record<string, ExecutionTask> = {};

  for (const [taskId, task] of tasks) {
    tasksObject[taskId] = task;
    if (task.dependency_ids.length > 0) {
      dependencyGraph[taskId] = task.dependency_ids;
    }
  }

  const dataToHash = JSON.stringify({
    tasks: tasksObject,
    dependency_graph: dependencyGraph,
  });
  const checksum = crypto.createHash('sha256').update(dataToHash).digest('hex');

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    tasks: tasksObject,
    dependency_graph: dependencyGraph,
    timestamp: new Date().toISOString(),
    checksum,
  };
}

async function writeQueueSnapshot(queueDir: string, snapshot: QueueSnapshot): Promise<void> {
  const snapshotPath = path.join(queueDir, QUEUE_SNAPSHOT_FILE);
  const content = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(snapshotPath, content, 'utf-8');
}

async function compactQueue(
  queueDir: string,
  featureId: string,
  cache: QueueCache
): Promise<void> {
  const compactedTasks = getCompactionTasks(cache.tasks);
  const content = serializeTasksToJsonl(compactedTasks.values());
  const checksum = crypto.createHash('sha256').update(content).digest('hex');

  await fs.writeFile(cache.queuePath, content, 'utf-8');

  const snapshot = buildQueueSnapshot(featureId, compactedTasks);
  await writeQueueSnapshot(queueDir, snapshot);

  await fs.writeFile(cache.updatesPath, '', 'utf-8');

  const stats = await fs.stat(cache.queuePath);
  cache.tasks = compactedTasks;
  cache.queueSize = stats.size;
  cache.queueMtimeMs = stats.mtimeMs;
  cache.updatesOffset = 0;
  cache.updatesCount = 0;

  await updateQueueManifestFromCache(queueDir, cache, {
    queueChecksum: checksum,
    lastSnapshotAt: snapshot.timestamp,
  });
}

async function maybeCompactQueue(
  queueDir: string,
  featureId: string,
  cache: QueueCache
): Promise<boolean> {
  if (
    cache.updatesCount < QUEUE_COMPACTION_MAX_UPDATES &&
    cache.updatesOffset < QUEUE_COMPACTION_MAX_BYTES
  ) {
    return false;
  }

  await compactQueue(queueDir, featureId, cache);
  return true;
}

// ============================================================================
// Queue Writing
// ============================================================================

/**
 * Append tasks to queue
 *
 * @param runDir - Run directory path
 * @param tasks - Tasks to append
 * @returns Operation result
 */
export async function appendToQueue(
  runDir: string,
  tasks: ExecutionTask[]
): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      try {
        const manifest = await readManifest(runDir);
        const queueDir = path.join(runDir, manifest.queue.queue_dir);
        const queuePath = path.join(queueDir, QUEUE_FILE);

        // Append tasks to JSONL file
        const lines = tasks.map((task) => serializeExecutionTask(task, false)).join('\n') + '\n';
        await fs.appendFile(queuePath, lines, 'utf-8');

        // Update queue manifest
        await updateQueueManifest(runDir, queueDir, tasks.length);

        // Update run manifest queue counts without acquiring nested locks
        const updatedManifest = {
          ...manifest,
          queue: {
            ...manifest.queue,
            pending_count: manifest.queue.pending_count + tasks.length,
          },
          timestamps: {
            ...manifest.timestamps,
            updated_at: new Date().toISOString(),
          },
        };

        await writeManifest(runDir, updatedManifest);

        return {
          success: true,
          message: `Successfully appended ${tasks.length} task(s) to queue`,
          tasksAffected: tasks.length,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          tasksAffected: 0,
          errors: [error instanceof Error ? error.stack || error.message : 'Unknown error'],
        };
      }
    },
    { operation: 'append_to_queue' }
  );
}

/**
 * Update queue manifest after modifications
 */
async function updateQueueManifest(
  runDir: string,
  queueDir: string,
  newTaskCount: number
): Promise<void> {
  const queuePath = path.join(queueDir, QUEUE_FILE);
  const manifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);

  // Compute current queue checksum
  const checksum = await computeFileChecksum(queuePath);

  // Load existing manifest or create new one
  let queueManifest: QueueManifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    queueManifest = JSON.parse(content) as QueueManifest;
  } catch {
    const manifest = await readManifest(runDir);
    queueManifest = {
      schema_version: '1.0.0',
      feature_id: manifest.feature_id,
      total_tasks: 0,
      pending_count: 0,
      running_count: 0,
      completed_count: 0,
      failed_count: 0,
      skipped_count: 0,
      cancelled_count: 0,
      queue_checksum: computeEmptyQueueChecksum(),
      updated_at: new Date().toISOString(),
    };
  }

  // Update counts
  queueManifest.total_tasks += newTaskCount;
  queueManifest.pending_count += newTaskCount;
  queueManifest.queue_checksum = checksum;
  queueManifest.updated_at = new Date().toISOString();

  await writeQueueManifest(queueDir, queueManifest);
}

/**
 * Write queue manifest to disk
 */
async function writeQueueManifest(queueDir: string, manifest: QueueManifest): Promise<void> {
  const manifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
  const content = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath, content, 'utf-8');
}

/**
 * Compute SHA-256 checksum of a file
 */
async function computeFileChecksum(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return computeEmptyQueueChecksum();
    }
    throw error;
  }
}

// ============================================================================
// Queue Reading
// ============================================================================

/**
 * Load all tasks from queue
 *
 * @param runDir - Run directory path
 * @returns Map of task_id to ExecutionTask
 */
export async function loadQueue(runDir: string): Promise<Map<string, ExecutionTask>> {
  const cache = await getQueueCache(runDir);
  return cache.tasks;
}

/**
 * Load queue from snapshot (faster than reading JSONL)
 *
 * @param runDir - Run directory path
 * @returns Queue snapshot or null if not available
 */
export async function loadQueueSnapshot(runDir: string): Promise<QueueSnapshot | null> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const snapshotPath = path.join(queueDir, QUEUE_SNAPSHOT_FILE);

  try {
    const content = await fs.readFile(snapshotPath, 'utf-8');
    const snapshot = JSON.parse(content) as QueueSnapshot;

    // Verify snapshot integrity
    const dataToHash = JSON.stringify({
      tasks: snapshot.tasks,
      dependency_graph: snapshot.dependency_graph,
    });
    const expectedChecksum = crypto.createHash('sha256').update(dataToHash).digest('hex');

    if (snapshot.checksum !== expectedChecksum) {
      console.warn('Queue snapshot checksum mismatch - falling back to JSONL');
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

// ============================================================================
// Queue Snapshots
// ============================================================================

/**
 * Create queue snapshot for fast recovery
 *
 * @param runDir - Run directory path
 * @returns Operation result
 */
export async function createQueueSnapshot(runDir: string): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      try {
        const manifest = await readManifest(runDir);
        const queueDir = path.join(runDir, manifest.queue.queue_dir);

        // Load all tasks
        const tasks = await loadQueue(runDir);
        const snapshot = buildQueueSnapshot(manifest.feature_id, tasks);
        const snapshotPath = path.join(queueDir, QUEUE_SNAPSHOT_FILE);
        await writeQueueSnapshot(snapshotPath, snapshot);

        // Update queue manifest
        const queueManifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
        const queueManifestContent = await fs.readFile(queueManifestPath, 'utf-8');
        const queueManifest = JSON.parse(queueManifestContent) as QueueManifest;
        queueManifest.last_snapshot_at = snapshot.timestamp;
        await writeQueueManifest(queueDir, queueManifest);

        return {
          success: true,
          message: `Snapshot created with ${tasks.size} task(s)`,
          tasksAffected: tasks.size,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          errors: [error instanceof Error ? error.stack || error.message : 'Unknown error'],
        };
      }
    },
    { operation: 'create_queue_snapshot' }
  );
}

// ============================================================================
// Queue Validation
// ============================================================================

/**
 * Validate queue integrity
 *
 * @param runDir - Run directory path
 * @returns Validation result
 */
export async function validateQueue(runDir: string): Promise<QueueValidationResult> {
  const manifest = await readManifest(runDir);
  const queueDir = path.join(runDir, manifest.queue.queue_dir);
  const queuePath = path.join(queueDir, QUEUE_FILE);

  const result: QueueValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    totalTasks: 0,
    corruptedTasks: 0,
  };

  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    result.totalTasks = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      try {
        const parsed: unknown = JSON.parse(line);
        const parseResult = parseExecutionTask(parsed);
        const parsedRecord =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        const parsedTaskId =
          parsedRecord && typeof parsedRecord['task_id'] === 'string'
            ? parsedRecord['task_id']
            : `line_${lineNumber}`;

        if (!parseResult.success) {
          result.valid = false;
          result.corruptedTasks++;
          result.errors.push({
            taskId: parsedTaskId,
            line: lineNumber,
            message: `Validation failed: ${parseResult.errors.map((e) => e.message).join(', ')}`,
          });
        }
      } catch (error) {
        result.valid = false;
        result.corruptedTasks++;
        result.errors.push({
          taskId: `line_${lineNumber}`,
          line: lineNumber,
          message: error instanceof Error ? error.message : 'JSON parse error',
        });
      }
    }

    // Verify checksum
    const queueManifestPath = path.join(queueDir, QUEUE_MANIFEST_FILE);
    try {
      const queueManifestContent = await fs.readFile(queueManifestPath, 'utf-8');
      const queueManifest = JSON.parse(queueManifestContent) as QueueManifest;

      const currentChecksum = await computeFileChecksum(queuePath);
      if (currentChecksum !== queueManifest.queue_checksum) {
        result.warnings.push({
          taskId: 'queue_manifest',
          message: 'Queue checksum mismatch - queue may have been modified externally',
        });
      }
    } catch {
      result.warnings.push({
        taskId: 'queue_manifest',
        message: 'Queue manifest not found or corrupted',
      });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      // Queue file doesn't exist yet
      result.totalTasks = 0;
    } else {
      result.valid = false;
      result.errors.push({
        taskId: 'queue_file',
        line: 0,
        message: error instanceof Error ? error.message : 'Failed to read queue file',
      });
    }
  }

  return result;
}

// ============================================================================
// Queue Task Management
// ============================================================================

/**
 * Get next executable task from queue
 *
 * @param runDir - Run directory path
 * @returns Next task to execute, or null if none available
 */
export async function getNextTask(runDir: string): Promise<ExecutionTask | null> {
  const tasks = await loadQueue(runDir);
  const seen = new Set<string>();

  // Retry tasks that were running when the crash occurred
  for (const [, task] of tasks) {
    if (task.status === 'running' && areDependenciesCompleted(task, tasks)) {
      if (!seen.has(task.task_id)) {
        return task;
      }
    }
  }

  // Next, pending tasks ready to run
  for (const [, task] of tasks) {
    if (task.status === 'pending' && areDependenciesCompleted(task, tasks)) {
      if (!seen.has(task.task_id)) {
        return task;
      }
    }
  }

  // Finally, retryable failures
  for (const [, task] of tasks) {
    if (canRetry(task) && areDependenciesCompleted(task, tasks)) {
      if (!seen.has(task.task_id)) {
        return task;
      }
    }
  }

  return null;
}

/**
 * Get all pending tasks
 *
 * @param runDir - Run directory path
 * @returns Array of pending tasks
 */
export async function getPendingTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  return Array.from(tasks.values()).filter((task) => task.status === 'pending');
}

/**
 * Get all failed tasks
 *
 * @param runDir - Run directory path
 * @returns Array of failed tasks
 */
export async function getFailedTasks(runDir: string): Promise<ExecutionTask[]> {
  const tasks = await loadQueue(runDir);
  return Array.from(tasks.values()).filter((task) => task.status === 'failed');
}

/**
 * Get task by ID
 *
 * @param runDir - Run directory path
 * @param taskId - Task ID
 * @returns Task or null if not found
 */
export async function getTaskById(runDir: string, taskId: string): Promise<ExecutionTask | null> {
  const tasks = await loadQueue(runDir);
  return tasks.get(taskId) || null;
}

/**
 * Update task status in queue
 *
 * Note: This is a simplified implementation. In production, you'd want to
 * implement proper JSONL updating or use SQLite for mutable operations.
 *
 * @param runDir - Run directory path
 * @param taskId - Task ID to update
 * @param updates - Partial task updates
 * @returns Operation result
 */
export async function updateTaskInQueue(
  runDir: string,
  taskId: string,
  updates: Partial<ExecutionTask>
): Promise<QueueOperationResult> {
  return withLock(
    runDir,
    async () => {
      try {
        const cache = await getQueueCache(runDir);
        const task = cache.tasks.get(taskId);

        if (!task) {
          return {
            success: false,
            message: `Task ${taskId} not found in queue`,
          };
        }

        // Create updated task
        const updatedTask: ExecutionTask = {
          ...task,
          ...updates,
          updated_at: new Date().toISOString(),
        };

        const manifest = await readManifest(runDir);
        const queueDir = path.join(runDir, manifest.queue.queue_dir);
        const updateLine = `${serializeExecutionTask(updatedTask, false)}\n`;

        await fs.appendFile(cache.updatesPath, updateLine, 'utf-8');
        cache.updatesOffset += Buffer.byteLength(updateLine);
        cache.updatesCount += 1;
        applyTaskUpdate(cache, updatedTask);

        const compacted = await maybeCompactQueue(queueDir, manifest.feature_id, cache);
        if (!compacted) {
          await updateQueueManifestFromCache(queueDir, cache);
        }

        // Update run manifest if needed
        if (updates.status) {
          const updatedManifest = {
            ...manifest,
            queue: {
              ...manifest.queue,
              pending_count: cache.counts.pending,
              completed_count: cache.counts.completed,
              failed_count: cache.counts.failed,
            },
            timestamps: {
              ...manifest.timestamps,
              updated_at: new Date().toISOString(),
            },
          };

          await writeManifest(runDir, updatedManifest);
        }

        return {
          success: true,
          message: `Task ${taskId} updated successfully`,
          tasksAffected: 1,
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          errors: [error instanceof Error ? error.stack || error.message : 'Unknown error'],
        };
      }
    },
    { operation: 'update_task_in_queue' }
  );
}
