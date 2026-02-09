import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { Buffer } from 'node:buffer';
import { wrapError, getErrorMessage } from '../utils/errors.js';
import {
  createHashManifest,
  verifyHashManifest,
  saveHashManifest,
  loadHashManifest,
  type VerificationResult,
} from './hashManifest';

/**
 * Run Directory Manager
 *
 * Manages `.codepipe/<feature_id>/` directory lifecycle:
 * - Atomic directory provisioning
 * - File-based locking for concurrent access safety
 * - Manifest persistence and validation
 * - State tracking (last_step, last_error, approvals)
 * - Queue and telemetry storage
 *
 * Implements ADR-2 (State Persistence) and local-first execution model.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Run manifest schema
 */
export interface RunManifest {
  /** Schema version for future migrations */
  schema_version: string;
  /** Feature identifier (ULID/UUIDv7) */
  feature_id: string;
  /** Feature title or description */
  title?: string;
  /** Source of the feature (Linear issue, manual prompt, etc.) */
  source?: string;
  /** Repository metadata */
  repo: {
    url: string;
    default_branch: string;
  };
  /** Current run status */
  status: 'pending' | 'in_progress' | 'paused' | 'completed' | 'failed';
  /** Execution tracking */
  execution: {
    /** Last successfully completed step */
    last_step?: string;
    /** Last error encountered */
    last_error?: {
      step: string;
      message: string;
      timestamp: string;
      recoverable: boolean;
    };
    /** Current step being executed */
    current_step?: string;
    /** Total steps in plan */
    total_steps?: number;
    /** Completed steps count */
    completed_steps: number;
  };
  /** Timestamps */
  timestamps: {
    created_at: string;
    updated_at: string;
    started_at?: string | null;
    completed_at?: string | null;
  };
  /** Approval tracking */
  approvals: {
    /** Path to approvals.json file */
    approvals_file?: string;
    /** Required approvals pending */
    pending: string[];
    /** Completed approvals */
    completed: string[];
  };
  /** Queue metadata */
  queue: {
    /** Path to queue directory */
    queue_dir: string;
    /** Number of pending tasks */
    pending_count: number;
    /** Number of completed tasks */
    completed_count: number;
    /** Number of failed tasks */
    failed_count: number;
    /** Optional SQLite index references */
    sqlite_index?: {
      database: string;
      wal: string;
      shm: string;
    };
  };
  /** Artifact references */
  artifacts: {
    prd?: string;
    spec?: string;
    plan?: string;
    hash_manifest?: string;
  };
  /** Telemetry references */
  telemetry: {
    logs_dir: string;
    metrics_file?: string;
    traces_file?: string;
    costs_file?: string;
  };
  /** Rate limit tracking */
  rate_limits?: {
    rate_limits_file?: string;
  };
  /** Intentional: run manifest metadata is consumer-defined */
  metadata?: Record<string, unknown>;
}

/**
 * Lock file metadata
 */
interface LockFile {
  /** Process ID that acquired the lock */
  pid: number;
  /** Hostname where process is running */
  hostname: string;
  /** When the lock was acquired */
  acquired_at: string;
  /** Lock purpose or operation */
  operation?: string;
}

/**
 * Type guard ensuring value matches LockFile shape
 */
function isLockFilePayload(value: unknown): value is LockFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pid === 'number' &&
    typeof candidate.hostname === 'string' &&
    typeof candidate.acquired_at === 'string'
  );
}

/**
 * Run directory creation options
 */
export interface CreateRunDirectoryOptions {
  /** Feature title */
  title?: string;
  /** Feature source (Linear issue ID, manual prompt, etc.) */
  source?: string;
  /** Repository URL */
  repoUrl: string;
  /** Default branch */
  defaultBranch?: string;
  /** Intentional: run directory metadata varies by creation context */
  metadata?: Record<string, unknown>;
  /** Whether to seed SQLite WAL indexes (future enhancement) */
  seedSqlite?: boolean;
}

/**
 * Lock acquisition options
 */
export interface LockOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Poll interval in milliseconds */
  pollInterval?: number;
  /** Lock operation description */
  operation?: string;
}

/** Manifest update descriptor */
export type ManifestUpdate =
  | Partial<RunManifest>
  | ((manifest: RunManifest) => Partial<RunManifest> | null | undefined);

// ============================================================================
// Constants
// ============================================================================

const LOCK_FILE_NAME = 'run.lock';
const MANIFEST_FILE_NAME = 'manifest.json';
const HASH_MANIFEST_FILE_NAME = 'hash_manifest.json';
const DEFAULT_LOCK_TIMEOUT = 30000; // 30 seconds
const DEFAULT_POLL_INTERVAL = 100; // 100ms

// Export for testing (CDMCH-71)
export const STALE_LOCK_THRESHOLD_MS = 60000; // 60 seconds - reduced for faster crash recovery in homelab use

const SQLITE_DIR_NAME = 'sqlite';
const SQLITE_DB_NAME = 'run_queue.db';

// Standard subdirectories
const STANDARD_SUBDIRS = [
  'artifacts',
  'logs',
  'queue',
  'telemetry',
  'approvals',
  'context',
] as const;

// ============================================================================
// Run Directory Resolution
// ============================================================================

/**
 * Validate that a feature ID is safe for use in file paths.
 * Prevents path traversal attacks by ensuring the ID contains no directory separators
 * and is not "." or "..".
 *
 * @param featureId - Feature identifier to validate
 * @throws Error if feature ID contains unsafe characters
 */
function validateFeatureId(featureId: string): void {
  // Reject absolute paths
  if (path.isAbsolute(featureId)) {
    throw new Error(
      `Invalid feature ID "${featureId}": must be a relative identifier, not an absolute path`
    );
  }

  // Reject paths with directory separators
  if (featureId.includes('/') || featureId.includes('\\')) {
    throw new Error(
      `Invalid feature ID "${featureId}": must not contain path separators (/ or \\)`
    );
  }

  // Reject empty, whitespace-only, or traversal IDs
  const trimmed = featureId.trim();
  if (!trimmed) {
    throw new Error('Invalid feature ID: must not be empty');
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`Invalid feature ID "${featureId}": must not be '.' or '..'`);
  }
}

/**
 * Get the absolute path to a run directory
 *
 * @param baseDir - Base pipeline directory (.codepipe/runs)
 * @param featureId - Feature identifier
 * @returns Absolute path to run directory
 * @throws Error if featureId contains path traversal sequences
 */
export function getRunDirectoryPath(baseDir: string, featureId: string): string {
  validateFeatureId(featureId);
  return path.resolve(baseDir, featureId);
}

/**
 * Get path to a subdirectory within a run directory
 *
 * @param runDir - Run directory path
 * @param subdir - Subdirectory name
 * @returns Absolute path to subdirectory
 */
export function getSubdirectoryPath(
  runDir: string,
  subdir: (typeof STANDARD_SUBDIRS)[number]
): string {
  return path.join(runDir, subdir);
}

// ============================================================================
// File Locking
// ============================================================================

/**
 * Acquire an exclusive lock on a run directory
 *
 * Uses file-based locking with stale lock detection.
 * Lock file contains process metadata for debugging.
 *
 * @param runDir - Run directory path
 * @param options - Lock acquisition options
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(runDir: string, options: LockOptions = {}): Promise<void> {
  const {
    timeout = DEFAULT_LOCK_TIMEOUT,
    pollInterval = DEFAULT_POLL_INTERVAL,
    operation = 'unknown',
  } = options;

  const lockPath = path.join(runDir, LOCK_FILE_NAME);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // Try to create lock file exclusively
      const lockData: LockFile = {
        pid: process.pid,
        hostname: os.hostname(),
        acquired_at: new Date().toISOString(),
        operation,
      };

      // Use wx flag for exclusive creation
      await fs.writeFile(lockPath, JSON.stringify(lockData, null, 2), {
        flag: 'wx',
        encoding: 'utf-8',
      });

      // Lock acquired successfully
      return;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        // Lock file exists, check if stale
        const isStale = await isLockStale(lockPath);

        if (isStale) {
          // Remove stale lock and retry
          try {
            await fs.unlink(lockPath);
            continue;
          } catch (unlinkError) {
            // If file doesn't exist (ENOENT), another process removed it - continue retry
            if (
              unlinkError &&
              typeof unlinkError === 'object' &&
              'code' in unlinkError &&
              unlinkError.code === 'ENOENT'
            ) {
              continue;
            }
            throw wrapError(unlinkError, 'remove stale lock');
          }
        }

        // Lock is valid, wait and retry
        await sleep(pollInterval);
        continue;
      }

      // Other error, propagate
      throw wrapError(error, `acquire lock for ${runDir}`);
    }
  }

  throw new Error(
    `Failed to acquire lock for ${runDir} within ${timeout}ms. ` +
      `Another process may be modifying this run directory.`
  );
}

/**
 * Release a lock on a run directory
 *
 * @param runDir - Run directory path
 */
export async function releaseLock(runDir: string): Promise<void> {
  const lockPath = path.join(runDir, LOCK_FILE_NAME);

  try {
    await fs.unlink(lockPath);
  } catch (error) {
    // Ignore errors if lock file doesn't exist
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw wrapError(error, `release lock for ${runDir}`);
  }
}

/**
 * Check if a run directory is currently locked
 *
 * @param runDir - Run directory path
 * @returns True if locked, false otherwise
 */
export async function isLocked(runDir: string): Promise<boolean> {
  const lockPath = path.join(runDir, LOCK_FILE_NAME);

  try {
    await fs.access(lockPath);
    const isStale = await isLockStale(lockPath);
    return !isStale;
  } catch (error) {
    // If lock file doesn't exist (ENOENT), not locked
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw wrapError(error, `check lock status for ${runDir}`);
  }
}

/**
 * Check if a lock file is stale
 *
 * A lock is considered stale if:
 * 1. It's older than STALE_LOCK_THRESHOLD
 * 2. The process that created it no longer exists
 *
 * @param lockPath - Path to lock file
 * @returns True if stale, false otherwise
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isLockFilePayload(parsed)) {
      return true;
    }

    const lockData: LockFile = parsed;

    // Check age
    const acquiredAt = new Date(lockData.acquired_at).getTime();
    const now = Date.now();

    if (now - acquiredAt > STALE_LOCK_THRESHOLD_MS) {
      return true;
    }

    // Check if process still exists (Unix-like systems only)
    if (process.platform !== 'win32') {
      try {
        // Signal 0 checks if process exists without killing it
        process.kill(lockData.pid, 0);
        return false; // Process exists
      } catch (killError) {
        // ESRCH means process doesn't exist - lock is stale
        if (
          killError &&
          typeof killError === 'object' &&
          'code' in killError &&
          killError.code === 'ESRCH'
        ) {
          return true;
        }
        throw wrapError(killError, `check if lock process ${lockData.pid} exists`);
      }
    }

    return false;
  } catch {
    // Unreadable or malformed lock file should be treated as stale
    return true;
  }
}

/**
 * Execute a function while holding a lock
 *
 * @param runDir - Run directory path
 * @param fn - Function to execute
 * @param options - Lock options
 * @returns Result of function execution
 */
export async function withLock<T>(
  runDir: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  await acquireLock(runDir, options);

  try {
    return await fn();
  } finally {
    await releaseLock(runDir);
  }
}

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Create a new run directory with standard structure
 *
 * @param baseDir - Base pipeline directory
 * @param featureId - Feature identifier (ULID/UUIDv7)
 * @param options - Creation options
 * @returns Path to created run directory
 */
export async function createRunDirectory(
  baseDir: string,
  featureId: string,
  options: CreateRunDirectoryOptions
): Promise<string> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  // Create main directory
  await fs.mkdir(runDir, { recursive: true });

  // Create standard subdirectories
  await ensureSubdirectories(runDir);

  // Create initial manifest
  const manifest = createInitialManifest(featureId, options);

  if (options.seedSqlite) {
    const sqliteIndex = await seedSqliteIndexes(runDir);

    manifest.queue.sqlite_index = sqliteIndex;
    manifest.metadata = {
      ...(manifest.metadata ?? {}),
      sqlite_seeded: true,
    };
  }

  // Write manifest atomically
  await writeManifest(runDir, manifest);

  return runDir;
}

/**
 * Ensure all standard subdirectories exist
 *
 * @param runDir - Run directory path
 */
export async function ensureSubdirectories(runDir: string): Promise<void> {
  for (const subdir of STANDARD_SUBDIRS) {
    const subdirPath = path.join(runDir, subdir);
    await fs.mkdir(subdirPath, { recursive: true });
  }
}

type SqliteIndexReference = NonNullable<RunManifest['queue']['sqlite_index']>;

/**
 * Seed SQLite WAL indexes used by queue observers
 *
 * @param runDir - Run directory path
 * @returns Relative paths to seeded SQLite artifacts
 */
async function seedSqliteIndexes(runDir: string): Promise<SqliteIndexReference> {
  const sqliteDir = path.join(runDir, SQLITE_DIR_NAME);
  await fs.mkdir(sqliteDir, { recursive: true });

  const dbAbsolutePath = path.join(sqliteDir, SQLITE_DB_NAME);
  const walAbsolutePath = `${dbAbsolutePath}-wal`;
  const shmAbsolutePath = `${dbAbsolutePath}-shm`;

  const headerBuffer = Buffer.alloc(100);
  headerBuffer.write('SQLite format 3\u0000', 'utf-8');

  await fs.writeFile(dbAbsolutePath, headerBuffer);
  await fs.writeFile(walAbsolutePath, Buffer.alloc(0));
  await fs.writeFile(shmAbsolutePath, Buffer.alloc(0));

  const database = path.posix.join(SQLITE_DIR_NAME, SQLITE_DB_NAME);

  return {
    database,
    wal: `${database}-wal`,
    shm: `${database}-shm`,
  };
}

/**
 * Check if a run directory exists
 *
 * @param baseDir - Base pipeline directory
 * @param featureId - Feature identifier
 * @returns True if directory exists
 */
export async function runDirectoryExists(baseDir: string, featureId: string): Promise<boolean> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  try {
    const stats = await fs.stat(runDir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all run directories
 *
 * @param baseDir - Base pipeline directory
 * @returns Array of feature IDs
 */
export async function listRunDirectories(baseDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw wrapError(error, `list run directories in ${baseDir}`);
  }
}

// ============================================================================
// Manifest Management
// ============================================================================

/**
 * Create initial run manifest
 */
function createInitialManifest(featureId: string, options: CreateRunDirectoryOptions): RunManifest {
  const now = new Date().toISOString();

  const manifest: RunManifest = {
    schema_version: '1.0.0',
    feature_id: featureId,
    repo: {
      url: options.repoUrl,
      default_branch: options.defaultBranch || 'main',
    },
    status: 'pending',
    execution: {
      completed_steps: 0,
    },
    timestamps: {
      created_at: now,
      updated_at: now,
    },
    approvals: {
      approvals_file: 'approvals/approvals.json',
      pending: [],
      completed: [],
    },
    queue: {
      queue_dir: 'queue',
      pending_count: 0,
      completed_count: 0,
      failed_count: 0,
    },
    artifacts: {},
    telemetry: {
      logs_dir: 'logs',
    },
  };

  if (options.title) {
    manifest.title = options.title;
  }

  if (options.source) {
    manifest.source = options.source;
  }

  if (options.metadata) {
    manifest.metadata = options.metadata;
  }

  return manifest;
}

/**
 * Validate that a run directory path is safe.
 * Defense-in-depth check to prevent path traversal.
 *
 * @param runDir - Run directory path to validate
 * @throws Error if path appears unsafe
 */
function validateRunDirectory(runDir: string): void {
  const segments = runDir.split(/[\\/]+/).filter(Boolean);

  // Basic sanity checks for path traversal patterns in the provided path
  if (segments.includes('..')) {
    throw new Error(`Unsafe run directory path: ${runDir}`);
  }
}

/**
 * Write manifest to disk atomically
 *
 * Uses write-to-temp-then-rename pattern for atomicity
 *
 * @param runDir - Run directory path
 * @param manifest - Manifest to write
 */
export async function writeManifest(runDir: string, manifest: RunManifest): Promise<void> {
  validateRunDirectory(runDir);
  const manifestPath = path.join(runDir, MANIFEST_FILE_NAME);
  const tempPath = `${manifestPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

  try {
    // Write to temp file with fsync for durability
    const content = JSON.stringify(manifest, null, 2);
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync(); // Ensure data is on disk before rename
    } finally {
      await handle.close();
    }

    // Atomic rename
    await fs.rename(tempPath, manifestPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      // Log cleanup failure but don't mask the original error
      console.warn(
        `[runDirectoryManager] Failed to clean up temp file ${tempPath}: ${getErrorMessage(cleanupError)}`
      );
    }
    throw wrapError(error, `write manifest to ${runDir}`);
  }
}

/**
 * Read manifest from disk
 *
 * @param runDir - Run directory path
 * @returns Run manifest
 * @throws Error if manifest cannot be read or is invalid
 */
export async function readManifest(runDir: string): Promise<RunManifest> {
  const manifestPath = path.join(runDir, MANIFEST_FILE_NAME);

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as RunManifest;

    // Basic validation
    if (!manifest.schema_version || !manifest.feature_id) {
      throw new Error('Invalid manifest: missing required fields');
    }

    return manifest;
  } catch (error) {
    throw wrapError(error, 'Failed to read manifest');
  }
}

/**
 * Update manifest fields atomically
 *
 * @param runDir - Run directory path
 * @param updates - Partial manifest updates
 */
export async function updateManifest(runDir: string, updates: ManifestUpdate): Promise<void> {
  return withLock(runDir, async () => {
    const manifest = await readManifest(runDir);
    const patchCandidate = typeof updates === 'function' ? updates(manifest) : updates;

    if (!patchCandidate || Object.keys(patchCandidate).length === 0) {
      return;
    }

    const patch = patchCandidate;

    const updated: RunManifest = {
      ...manifest,
      ...patch,
      timestamps: {
        ...manifest.timestamps,
        ...(patch.timestamps ?? {}),
        updated_at: new Date().toISOString(),
      },
    };

    await writeManifest(runDir, updated);
  });
}

// ============================================================================
// State Tracking Helpers
// ============================================================================

/**
 * Update last_step in manifest
 *
 * @param runDir - Run directory path
 * @param step - Step identifier
 */
export async function setLastStep(runDir: string, step: string): Promise<void> {
  await updateManifest(runDir, (manifest) => {
    const updatedExecution = { ...manifest.execution, last_step: step };
    delete updatedExecution.current_step;

    return { execution: updatedExecution };
  });
}

/**
 * Update current_step in manifest
 *
 * @param runDir - Run directory path
 * @param step - Step identifier
 */
export async function setCurrentStep(runDir: string, step: string): Promise<void> {
  await updateManifest(runDir, (manifest) => ({
    execution: {
      ...manifest.execution,
      current_step: step,
    },
  }));
}

/**
 * Record an error in manifest
 *
 * @param runDir - Run directory path
 * @param step - Step where error occurred
 * @param message - Error message
 * @param recoverable - Whether error is recoverable
 */
export async function setLastError(
  runDir: string,
  step: string,
  message: string,
  recoverable = true
): Promise<void> {
  await updateManifest(runDir, (manifest) => ({
    status: recoverable ? 'paused' : 'failed',
    execution: {
      ...manifest.execution,
      last_error: {
        step,
        message,
        timestamp: new Date().toISOString(),
        recoverable,
      },
    },
  }));
}

/**
 * Clear last error from manifest
 *
 * @param runDir - Run directory path
 */
export async function clearLastError(runDir: string): Promise<void> {
  await updateManifest(runDir, (manifest) => {
    const updatedExecution = { ...manifest.execution };
    delete updatedExecution.last_error;

    return { execution: updatedExecution };
  });
}

/**
 * Get current run state
 *
 * @param runDir - Run directory path
 * @returns Run state snapshot
 */
export async function getRunState(runDir: string): Promise<{
  status: RunManifest['status'];
  last_step?: string;
  current_step?: string;
  last_error?: RunManifest['execution']['last_error'];
  completed_steps: number;
  total_steps?: number;
}> {
  const manifest = await readManifest(runDir);

  const state: {
    status: RunManifest['status'];
    last_step?: string;
    current_step?: string;
    last_error?: RunManifest['execution']['last_error'];
    completed_steps: number;
    total_steps?: number;
  } = {
    status: manifest.status,
    completed_steps: manifest.execution.completed_steps,
  };

  if (manifest.execution.last_step) {
    state.last_step = manifest.execution.last_step;
  }

  if (manifest.execution.current_step) {
    state.current_step = manifest.execution.current_step;
  }

  if (manifest.execution.last_error) {
    state.last_error = manifest.execution.last_error;
  }

  if (manifest.execution.total_steps) {
    state.total_steps = manifest.execution.total_steps;
  }

  return state;
}

/**
 * Mark approval as required
 *
 * @param runDir - Run directory path
 * @param approvalType - Type of approval needed
 */
export async function markApprovalRequired(runDir: string, approvalType: string): Promise<void> {
  await updateManifest(runDir, (manifest) => {
    if (manifest.approvals.pending.includes(approvalType)) {
      return null;
    }

    return {
      approvals: {
        ...manifest.approvals,
        pending: [...manifest.approvals.pending, approvalType],
      },
    };
  });
}

/**
 * Mark approval as completed
 *
 * @param runDir - Run directory path
 * @param approvalType - Type of approval completed
 */
export async function markApprovalCompleted(runDir: string, approvalType: string): Promise<void> {
  await updateManifest(runDir, (manifest) => {
    const pending = manifest.approvals.pending.filter((a) => a !== approvalType);
    const completedSet = new Set(manifest.approvals.completed);
    completedSet.add(approvalType);
    const completed = Array.from(completedSet);

    if (
      pending.length === manifest.approvals.pending.length &&
      completed.length === manifest.approvals.completed.length
    ) {
      return null;
    }

    return {
      approvals: {
        ...manifest.approvals,
        pending,
        completed,
      },
    };
  });
}

// ============================================================================
// Hash Manifest Integration
// ============================================================================

/**
 * Generate and save hash manifest for run directory artifacts
 *
 * @param runDir - Run directory path
 * @param filePaths - Specific files to include (relative to runDir)
 */
export async function generateHashManifest(runDir: string, filePaths?: string[]): Promise<void> {
  const absolutePaths = filePaths
    ? filePaths.map((p) => path.resolve(runDir, p))
    : await collectArtifactPaths(runDir);

  const { manifest: hashManifest } = await createHashManifest(absolutePaths);
  const hashManifestPath = path.join(runDir, HASH_MANIFEST_FILE_NAME);

  await saveHashManifest(hashManifest, hashManifestPath);

  // Update run manifest to reference hash manifest
  await updateManifest(runDir, (manifest) => ({
    artifacts: {
      ...manifest.artifacts,
      hash_manifest: HASH_MANIFEST_FILE_NAME,
    },
  }));
}

/**
 * Verify integrity of run directory using hash manifest
 *
 * @param runDir - Run directory path
 * @returns Verification result
 */
export async function verifyRunDirectoryIntegrity(runDir: string): Promise<VerificationResult> {
  const hashManifestPath = path.join(runDir, HASH_MANIFEST_FILE_NAME);
  const hashManifest = await loadHashManifest(hashManifestPath);

  return verifyHashManifest(hashManifest, runDir);
}

/**
 * Collect all artifact file paths in a run directory
 */
async function collectArtifactPaths(runDir: string): Promise<string[]> {
  const paths: string[] = [];

  // Collect from standard subdirectories (plus optional sqlite indexes)
  const subdirsToScan = [...STANDARD_SUBDIRS, SQLITE_DIR_NAME];

  for (const subdir of subdirsToScan) {
    const subdirPath = path.join(runDir, subdir);

    try {
      const entries = await fs.readdir(subdirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          paths.push(path.join(subdirPath, entry.name));
        }
      }
    } catch {
      // Skip missing subdirectories
    }
  }

  // Add manifest itself
  const manifestPath = path.join(runDir, MANIFEST_FILE_NAME);
  if (fsSync.existsSync(manifestPath)) {
    paths.push(manifestPath);
  }

  return paths;
}

// ============================================================================
// Cleanup Hooks
// ============================================================================

/**
 * Cleanup hook metadata
 */
export interface CleanupHook {
  /** When cleanup is eligible */
  eligibility: {
    /** Minimum age in days */
    min_age_days?: number;
    /** Required status */
    required_status?: RunManifest['status'][];
  };
  /** Actions to perform */
  actions: {
    /** Remove logs */
    remove_logs?: boolean;
    /** Remove telemetry */
    remove_telemetry?: boolean;
    /** Archive artifacts */
    archive_artifacts?: boolean;
    /** Remove entire directory */
    remove_directory?: boolean;
  };
}

/**
 * Register cleanup hook for a run directory
 *
 * @param runDir - Run directory path
 * @param hook - Cleanup hook configuration
 */
export async function registerCleanupHook(runDir: string, hook: CleanupHook): Promise<void> {
  await updateManifest(runDir, (manifest) => ({
    metadata: {
      ...(manifest.metadata ?? {}),
      cleanup_hook: hook,
    },
  }));
}

/**
 * Check if a run directory is eligible for cleanup
 *
 * @param runDir - Run directory path
 * @returns True if eligible for cleanup
 */
export async function isEligibleForCleanup(runDir: string): Promise<boolean> {
  const manifest = await readManifest(runDir);
  const hook = manifest.metadata?.cleanup_hook as CleanupHook | undefined;

  if (!hook) {
    return false;
  }

  // Check age
  if (hook.eligibility.min_age_days) {
    const createdAt = new Date(manifest.timestamps.created_at).getTime();
    const now = Date.now();
    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (ageDays < hook.eligibility.min_age_days) {
      return false;
    }
  }

  // Check status
  if (hook.eligibility.required_status) {
    if (!hook.eligibility.required_status.includes(manifest.status)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
