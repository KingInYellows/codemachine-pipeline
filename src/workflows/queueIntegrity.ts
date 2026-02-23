/**
 * Queue Integrity Verification
 *
 * Validates queue data integrity by checking snapshot checksums,
 * WAL entry checksums, and sequence number continuity.
 * Extracted from queueStore.ts for single-responsibility (CDMCH-69/55).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readManifest } from '../persistence/runDirectoryManager';
import { loadSnapshot } from './queueSnapshotManager.js';
import { readOperationsWithStats } from './queueOperationsLog.js';
import { QUEUE_SNAPSHOT_FILE } from './queueTypes.js';
import type { QueueIntegrityMode } from './queueTypes.js';
import { QueueIntegrityError } from './queueTypes.js';
import { getErrorMessage } from '../utils/errors.js';

// Integrity State

/** Set of runDirs whose integrity has already been verified this process. */
export const integrityVerifiedDirs = new Set<string>();

/**
 * Invalidate only the integrity verification flag for a run directory.
 *
 * Note: Cache invalidation lives in `queueCache.invalidateV2Cache`. We keep this separate
 * to avoid changing public `invalidateV2Cache` semantics (cache-only) across import paths.
 */
export function invalidateIntegrityVerification(runDir: string): void {
  integrityVerifiedDirs.delete(runDir);
}

// Integrity Mode

/** Read the integrity mode from environment, defaulting to fail-fast. */
export function getQueueIntegrityMode(): QueueIntegrityMode {
  const env = process.env.QUEUE_INTEGRITY_MODE;
  if (env === 'warn-only') return 'warn-only';
  return 'fail-fast';
}

// Integrity Result

/** Result of queue integrity verification. */
export interface QueueIntegrityResult {
  valid: boolean;
  snapshotValid: boolean | null; // null if no snapshot
  walEntriesChecked: number;
  walChecksumFailures: number;
  sequenceGaps: number[];
  errors: string[];
}

// Integrity Verification

/**
 * Verify queue integrity by checking snapshot checksum and WAL sequence continuity.
 *
 * Validates checksums on both snapshot and individual WAL entries, and checks
 * for sequence number gaps. In fail-fast mode, throws QueueIntegrityError on
 * the first critical failure. In warn-only mode, logs warnings and continues.
 *
 * @param runDir - Path to the run directory
 * @param mode - Integrity mode override (defaults to env/fail-fast)
 * @returns Integrity verification result
 */
export async function verifyQueueIntegrity(
  runDir: string,
  mode?: QueueIntegrityMode
): Promise<QueueIntegrityResult> {
  const integrityMode = mode ?? getQueueIntegrityMode();

  const result: QueueIntegrityResult = {
    valid: true,
    snapshotValid: null,
    walEntriesChecked: 0,
    walChecksumFailures: 0,
    sequenceGaps: [],
    errors: [],
  };

  try {
    const manifest = await readManifest(runDir);
    const queueDir = path.join(runDir, manifest.queue.queue_dir);

    // 1. Verify snapshot (loadSnapshot already validates checksum internally)
    const snapshot = await loadSnapshot(queueDir);
    if (snapshot) {
      result.snapshotValid = true; // loadSnapshot returns null on checksum mismatch
    } else {
      // null means no snapshot exists or it was invalid
      // We can distinguish by checking if the file exists
      try {
        await fs.access(path.join(queueDir, QUEUE_SNAPSHOT_FILE));
        // File exists but loadSnapshot returned null => invalid
        result.snapshotValid = false;
        result.valid = false;
        const errorMsg = 'Snapshot file exists but failed validation (schema or checksum)';
        result.errors.push(errorMsg);

        if (integrityMode === 'fail-fast') {
          throw new QueueIntegrityError({
            kind: 'snapshot-checksum-mismatch',
            message: errorMsg,
            location: path.join(queueDir, QUEUE_SNAPSHOT_FILE),
            recoveryGuidance:
              'Delete the snapshot file and replay from WAL, or restore from backup.',
          });
        }
      } catch (err) {
        if (err instanceof QueueIntegrityError) throw err;
        // Only ignore 'file not found' errors (ENOENT). Other filesystem errors
        // should be treated as integrity failures.
        if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
          throw err;
        }
        // File does not exist - that's fine, snapshotValid stays null
      }
    }

    // 2. Read and verify WAL operations with stats (counts checksum failures)
    const afterSeq = snapshot?.snapshotSeq ?? -1;
    const walResult = await readOperationsWithStats(queueDir, afterSeq);
    const operations = walResult.operations;
    result.walEntriesChecked = operations.length;
    result.walChecksumFailures = walResult.checksumFailures;

    if (walResult.checksumFailures > 0) {
      result.valid = false;
      const errorMsg = `${walResult.checksumFailures} WAL entry checksum failure(s) detected`;
      result.errors.push(errorMsg);

      if (integrityMode === 'fail-fast') {
        throw new QueueIntegrityError({
          kind: 'wal-checksum-mismatch',
          message: errorMsg,
          location: path.join(queueDir, 'queue_operations.log'),
          recoveryGuidance: 'Restore WAL from backup or re-snapshot from last known good state.',
        });
      }
    }

    // 3. Check sequence continuity
    if (operations.length > 0) {
      // First, verify snapshot-to-WAL continuity if snapshot exists
      if (snapshot) {
        const firstSeq = operations[0].seq;
        const expectedFirstSeq = snapshot.snapshotSeq + 1;
        if (firstSeq !== expectedFirstSeq) {
          result.valid = false;
          const errorMsg = `Gap between snapshot and WAL: snapshot ends at seq ${snapshot.snapshotSeq}, WAL starts at seq ${firstSeq}`;
          result.errors.push(errorMsg);
          for (let missingSeq = expectedFirstSeq; missingSeq < firstSeq; missingSeq++) {
            result.sequenceGaps.push(missingSeq);
          }

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-gap',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedFirstSeq, actual: firstSeq },
              recoveryGuidance:
                'Re-snapshot from current state or restore missing WAL entries from backup.',
            });
          }
        }
      }

      // Check WAL internal continuity
      let expectedSeq = operations[0].seq;
      for (let i = 1; i < operations.length; i++) {
        const nextSeq = operations[i].seq;
        if (nextSeq > expectedSeq + 1) {
          result.valid = false;
          const errorMsg = `Sequence gap: expected ${expectedSeq + 1}, got ${nextSeq}`;
          result.errors.push(errorMsg);
          for (let missingSeq = expectedSeq + 1; missingSeq < nextSeq; missingSeq++) {
            result.sequenceGaps.push(missingSeq);
          }

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-gap',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedSeq + 1, actual: nextSeq },
              recoveryGuidance:
                'Investigate missing WAL entries. Restore from backup or re-initialize queue.',
            });
          }
        } else if (nextSeq <= expectedSeq) {
          result.valid = false;
          const errorMsg = `Sequence not monotonic: expected > ${expectedSeq}, got ${nextSeq}`;
          result.errors.push(errorMsg);

          if (integrityMode === 'fail-fast') {
            throw new QueueIntegrityError({
              kind: 'sequence-non-monotonic',
              message: errorMsg,
              location: path.join(queueDir, 'queue_operations.log'),
              sequenceRange: { expected: expectedSeq + 1, actual: nextSeq },
              recoveryGuidance:
                'WAL is severely corrupted. Re-initialize queue from last valid snapshot.',
            });
          }
        }
        expectedSeq = nextSeq;
      }
    }

    return result;
  } catch (error) {
    if (error instanceof QueueIntegrityError) throw error;
    result.valid = false;
    result.errors.push(getErrorMessage(error));
    return result;
  }
}
