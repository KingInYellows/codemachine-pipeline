import { open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { wrapError, getErrorMessage } from '../utils/errors.js';
import { validateOrThrow } from '../validation/helpers';
import { withLock } from './lockManager.js';

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
 * Zod schema for RunManifest — validates persisted/deserialized data at the security boundary.
 */
export const RunManifestSchema = z.object({
  schema_version: z.string().min(1),
  feature_id: z.string().min(1),
  title: z.string().optional(),
  source: z.string().optional(),
  repo: z.object({
    url: z.string().min(1),
    default_branch: z.string().min(1),
  }),
  status: z.enum(['pending', 'in_progress', 'paused', 'completed', 'failed']),
  execution: z.object({
    last_step: z.string().optional(),
    last_error: z
      .object({
        step: z.string(),
        message: z.string(),
        timestamp: z.string(),
        recoverable: z.boolean(),
      })
      .optional(),
    current_step: z.string().optional(),
    total_steps: z.number().int().nonnegative().optional(),
    completed_steps: z.number().int().nonnegative(),
  }),
  timestamps: z.object({
    created_at: z.string(),
    updated_at: z.string(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
  }),
  approvals: z.object({
    approvals_file: z.string().optional(),
    pending: z.array(z.string()),
    completed: z.array(z.string()),
  }),
  queue: z.object({
    queue_dir: z.string(),
    pending_count: z.number().int().nonnegative(),
    completed_count: z.number().int().nonnegative(),
    failed_count: z.number().int().nonnegative(),
    sqlite_index: z
      .object({
        database: z.string(),
        wal: z.string(),
        shm: z.string(),
      })
      .optional(),
  }),
  artifacts: z.object({
    prd: z.string().optional(),
    spec: z.string().optional(),
    plan: z.string().optional(),
    hash_manifest: z.string().optional(),
  }),
  telemetry: z.object({
    logs_dir: z.string(),
    metrics_file: z.string().optional(),
    traces_file: z.string().optional(),
    costs_file: z.string().optional(),
  }),
  rate_limits: z
    .object({
      rate_limits_file: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Manifest update descriptor */
export type ManifestUpdate =
  | Partial<RunManifest>
  | ((manifest: RunManifest) => Partial<RunManifest> | null | undefined);

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_FILE_NAME = 'manifest.json';

// ============================================================================
// Internal helpers
// ============================================================================

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

// ============================================================================
// Public API
// ============================================================================

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
  const manifestPath = join(runDir, MANIFEST_FILE_NAME);
  const tempPath = `${manifestPath}.tmp.${randomBytes(8).toString('hex')}`;

  try {
    // Write to temp file with fsync for durability
    const content = JSON.stringify(manifest, null, 2);
    const handle = await open(tempPath, 'w');
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync(); // Ensure data is on disk before rename
    } finally {
      await handle.close();
    }

    // Atomic rename
    await rename(tempPath, manifestPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch (cleanupError) {
      // Log cleanup failure but don't mask the original error
      console.warn(
        `[manifestManager] Failed to clean up temp file ${tempPath}: ${getErrorMessage(cleanupError)}`
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
  const manifestPath = join(runDir, MANIFEST_FILE_NAME);

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    return validateOrThrow(RunManifestSchema, parsed, 'run manifest') as RunManifest;
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
  const exec = manifest.execution;

  return {
    status: manifest.status,
    completed_steps: exec.completed_steps,
    ...(exec.last_step !== undefined && { last_step: exec.last_step }),
    ...(exec.current_step !== undefined && { current_step: exec.current_step }),
    ...(exec.last_error !== undefined && { last_error: exec.last_error }),
    ...(exec.total_steps !== undefined && { total_steps: exec.total_steps }),
  };
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
