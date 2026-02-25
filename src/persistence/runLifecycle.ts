import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { wrapError } from '../utils/errors.js';
import { isFileNotFound } from '../utils/safeJson';
import {
  createHashManifest,
  verifyHashManifest,
  saveHashManifest,
  loadHashManifest,
  type VerificationResult,
} from './hashManifest.js';
import {
  writeManifest,
  updateManifest,
  readManifest,
  type RunManifest,
} from './manifestManager.js';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_FILE_NAME = 'manifest.json';
const HASH_MANIFEST_FILE_NAME = 'hash_manifest.json';
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
// Path resolution
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
  if (isAbsolute(featureId)) {
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
  return resolve(baseDir, featureId);
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
  return join(runDir, subdir);
}

// ============================================================================
// Internal helpers
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

type SqliteIndexReference = NonNullable<RunManifest['queue']['sqlite_index']>;

/**
 * Seed SQLite WAL indexes used by queue observers
 *
 * @param runDir - Run directory path
 * @returns Relative paths to seeded SQLite artifacts
 */
async function seedSqliteIndexes(runDir: string): Promise<SqliteIndexReference> {
  const sqliteDir = join(runDir, SQLITE_DIR_NAME);
  await mkdir(sqliteDir, { recursive: true });

  const dbAbsolutePath = join(sqliteDir, SQLITE_DB_NAME);
  const walAbsolutePath = `${dbAbsolutePath}-wal`;
  const shmAbsolutePath = `${dbAbsolutePath}-shm`;

  const headerBuffer = Buffer.alloc(100);
  headerBuffer.write('SQLite format 3\u0000', 'utf-8');

  await writeFile(dbAbsolutePath, headerBuffer);
  await writeFile(walAbsolutePath, Buffer.alloc(0));
  await writeFile(shmAbsolutePath, Buffer.alloc(0));

  const database = posix.join(SQLITE_DIR_NAME, SQLITE_DB_NAME);

  return {
    database,
    wal: `${database}-wal`,
    shm: `${database}-shm`,
  };
}

/**
 * Collect all artifact file paths in a run directory
 */
async function collectArtifactPaths(runDir: string): Promise<string[]> {
  const paths: string[] = [];

  // Collect from standard subdirectories (plus optional sqlite indexes)
  const subdirsToScan = [...STANDARD_SUBDIRS, SQLITE_DIR_NAME];

  for (const subdir of subdirsToScan) {
    const subdirPath = join(runDir, subdir);

    try {
      const entries = await readdir(subdirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          paths.push(join(subdirPath, entry.name));
        }
      }
    } catch {
      // Skip missing subdirectories
    }
  }

  // Add manifest itself
  const manifestPath = join(runDir, MANIFEST_FILE_NAME);
  if (existsSync(manifestPath)) {
    paths.push(manifestPath);
  }

  return paths;
}

// ============================================================================
// Public API — Directory lifecycle
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
  await mkdir(runDir, { recursive: true });

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
    const subdirPath = join(runDir, subdir);
    await mkdir(subdirPath, { recursive: true });
  }
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
    const stats = await stat(runDir);
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
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isFileNotFound(error)) {
      return [];
    }
    throw wrapError(error, `list run directories in ${baseDir}`);
  }
}

// ============================================================================
// Public API — Hash manifest integration
// ============================================================================

/**
 * Generate and save hash manifest for run directory artifacts
 *
 * @param runDir - Run directory path
 * @param filePaths - Specific files to include (relative to runDir)
 */
export async function generateHashManifest(runDir: string, filePaths?: string[]): Promise<void> {
  const absolutePaths = filePaths
    ? filePaths.map((p) => resolve(runDir, p))
    : await collectArtifactPaths(runDir);

  const { manifest: hashManifest } = await createHashManifest(absolutePaths);
  const hashManifestPath = join(runDir, HASH_MANIFEST_FILE_NAME);

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
  const hashManifestPath = join(runDir, HASH_MANIFEST_FILE_NAME);
  const hashManifest = await loadHashManifest(hashManifestPath);

  return verifyHashManifest(hashManifest, runDir);
}

// ============================================================================
// Public API — Cleanup hooks
// ============================================================================

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
