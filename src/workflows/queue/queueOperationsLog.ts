/**
 * Queue Operations Log (Write-Ahead Log)
 *
 * Write-Ahead Log (WAL) for queue operations with O(1) appends.
 * Uses NDJSON format where each line is a QueueOperation with monotonically
 * increasing sequence numbers and checksum validation for integrity.
 */

import { QueueOperation, isQueueOperation } from './queueTypes';
import { access, appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withLock } from '../../persistence';
import { getErrorMessage } from '../../utils/errors.js';
import { isFileNotFound } from '../../utils/safeJson.js';

// ============================================================================
// Constants
// ============================================================================

/** WAL file name within queue directory */
const OPERATIONS_LOG_FILENAME = 'queue_operations.log';

/** Sequence counter file for fast sequence lookup */
const SEQUENCE_COUNTER_FILENAME = 'queue_sequence.txt';

// ============================================================================
// Checksum Computation
// ============================================================================

/**
 * Compute CRC32-like checksum for operation validation.
 * Uses SHA-256 truncated to 8 hex characters for compact representation.
 *
 * @param op - Operation without checksum field
 * @returns 8-character hex checksum
 */
export function computeOperationChecksum(op: Omit<QueueOperation, 'checksum'>): string {
  // Create deterministic JSON representation (sorted keys)
  const payload = JSON.stringify({
    op: op.op,
    seq: op.seq,
    ts: op.ts,
    taskId: op.taskId,
    ...(op.patch !== undefined ? { patch: op.patch } : {}),
    ...(op.task !== undefined ? { task: op.task } : {}),
  });

  // SHA-256 truncated to 8 hex chars (32 bits) for compact checksum
  return createHash('sha256').update(payload).digest('hex').slice(0, 8);
}

/**
 * Verify operation checksum integrity.
 *
 * @param op - Operation to verify
 * @returns True if checksum is valid
 */
export function verifyOperationChecksum(op: QueueOperation): boolean {
  const { checksum, ...opWithoutChecksum } = op;
  const computed = computeOperationChecksum(opWithoutChecksum);
  return computed === checksum;
}

// ============================================================================
// File Path Helpers
// ============================================================================

/**
 * Get the full path to the WAL file.
 */
function getOperationsLogPath(queueDir: string): string {
  return join(queueDir, OPERATIONS_LOG_FILENAME);
}

/**
 * Get the full path to the sequence counter file.
 */
function getSequenceCounterPath(queueDir: string): string {
  return join(queueDir, SEQUENCE_COUNTER_FILENAME);
}

// ============================================================================
// Sequence Number Management
// ============================================================================

/**
 * Read the current sequence number from the counter file.
 * Falls back to scanning WAL if counter file is missing.
 *
 * @param queueDir - Queue directory path
 * @returns Last sequence number, or 0 if empty
 */
async function readSequenceCounter(queueDir: string): Promise<number> {
  const counterPath = getSequenceCounterPath(queueDir);

  try {
    const content = await readFile(counterPath, 'utf-8');
    const seq = parseInt(content.trim(), 10);
    if (!isNaN(seq) && seq >= 0) {
      return seq;
    }
  } catch (error) {
    // Counter file doesn't exist or is corrupted
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      const message =
        error instanceof Error ? error.message : (JSON.stringify(error) ?? 'Unknown error');
      console.warn(`[WAL] Failed to read sequence counter: ${message}`);
    }
  }

  // Fall back to scanning WAL
  return await scanLastSequence(queueDir);
}

/**
 * Write the sequence counter to disk.
 *
 * @param queueDir - Queue directory path
 * @param seq - Sequence number to write
 */
async function writeSequenceCounter(queueDir: string, seq: number): Promise<void> {
  const counterPath = getSequenceCounterPath(queueDir);
  await writeFile(counterPath, seq.toString(), 'utf-8');
}

/**
 * Scan the WAL file to find the last sequence number.
 * Used as fallback when sequence counter is missing.
 *
 * @param queueDir - Queue directory path
 * @returns Last sequence number, or 0 if empty/missing
 */
async function scanLastSequence(queueDir: string): Promise<number> {
  const logPath = getOperationsLogPath(queueDir);

  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return 0;
    }

    // Scan from end to find valid operation with highest seq
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed: unknown = JSON.parse(lines[i]);
        if (isQueueOperation(parsed)) {
          return parsed.seq;
        }
      } catch {
        // Skip corrupted lines
      }
    }

    return 0;
  } catch (error) {
    if (isFileNotFound(error)) {
      return 0;
    }
    throw error;
  }
}

// ============================================================================
// Core WAL Operations
// ============================================================================

/**
 * Append a single operation to the WAL (O(1)).
 *
 * Atomically assigns sequence number, computes checksum, and appends to log.
 * Uses file locking to prevent concurrent write corruption.
 *
 * @param queueDir - Queue directory path
 * @param op - Operation without seq/checksum (assigned automatically)
 * @returns Complete operation with assigned seq and checksum
 */
export async function appendOperation(
  queueDir: string,
  op: Omit<QueueOperation, 'seq' | 'checksum'>
): Promise<QueueOperation> {
  // Read current sequence and increment
  const lastSeq = await readSequenceCounter(queueDir);
  const newSeq = lastSeq + 1;

  // Build complete operation
  const opWithSeq: Omit<QueueOperation, 'checksum'> = {
    ...op,
    seq: newSeq,
  };

  const checksum = computeOperationChecksum(opWithSeq);
  const completeOp: QueueOperation = {
    ...opWithSeq,
    checksum,
  };

  // Serialize to NDJSON line (single line with newline terminator)
  const line = `${JSON.stringify(completeOp)}\n`;

  // Append to log file (O(1) operation)
  const logPath = getOperationsLogPath(queueDir);
  await appendFile(logPath, line, 'utf-8');

  // Update sequence counter
  await writeSequenceCounter(queueDir, newSeq);

  return completeOp;
}

/**
 * Append operation with file locking for concurrent access safety.
 *
 * @param runDir - Run directory path (for lock coordination)
 * @param queueDir - Queue directory path
 * @param op - Operation without seq/checksum
 * @returns Complete operation with assigned seq and checksum
 */
export function appendOperationLocked(
  runDir: string,
  queueDir: string,
  op: Omit<QueueOperation, 'seq' | 'checksum'>
): Promise<QueueOperation> {
  return withLock(runDir, async () => appendOperation(queueDir, op), { operation: 'wal_append' });
}

/** Result of reading WAL operations, including corruption metrics. */
export interface ReadOperationsResult {
  operations: QueueOperation[];
  checksumFailures: number;
  parseErrors: number;
}

/**
 * Read all operations from the WAL, returning corruption metrics.
 *
 * Gracefully handles corrupted entries by logging warnings and skipping them.
 * Returns both valid operations and counts of failures for integrity reporting.
 *
 * @param queueDir - Queue directory path
 * @param afterSeq - Only return operations with seq > afterSeq (for incremental replay)
 * @returns Operations and failure counts
 */
export async function readOperationsWithStats(
  queueDir: string,
  afterSeq?: number
): Promise<ReadOperationsResult> {
  const logPath = getOperationsLogPath(queueDir);
  const operations: QueueOperation[] = [];
  const seqFilter = afterSeq ?? -1;
  let checksumFailures = 0;
  let parseErrors = 0;

  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (line.length === 0) {
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(line);

        if (!isQueueOperation(parsed)) {
          console.warn(`[WAL] Line ${lineNum + 1}: Invalid operation structure, skipping`);
          parseErrors++;
          continue;
        }

        // Verify checksum
        if (!verifyOperationChecksum(parsed)) {
          console.warn(
            `[WAL] Line ${lineNum + 1}: Checksum mismatch for seq ${parsed.seq}, skipping`
          );
          checksumFailures++;
          continue;
        }

        // Apply sequence filter
        if (parsed.seq > seqFilter) {
          operations.push(parsed);
        }
      } catch (parseError) {
        console.warn(
          `[WAL] Line ${lineNum + 1}: JSON parse error, skipping - ${getErrorMessage(parseError)}`
        );
        parseErrors++;
      }
    }

    // Sort by sequence number (should already be ordered, but ensure consistency)
    operations.sort((a, b) => a.seq - b.seq);

    return { operations, checksumFailures, parseErrors };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { operations: [], checksumFailures: 0, parseErrors: 0 };
    }
    throw error;
  }
}

/**
 * Read all operations from the WAL.
 *
 * Gracefully handles corrupted entries by logging warnings and skipping them.
 * Optionally filters to operations after a given sequence number.
 *
 * @param queueDir - Queue directory path
 * @param afterSeq - Only return operations with seq > afterSeq (for incremental replay)
 * @returns Array of valid operations, ordered by sequence number
 */
export async function readOperations(
  queueDir: string,
  afterSeq?: number
): Promise<QueueOperation[]> {
  const result = await readOperationsWithStats(queueDir, afterSeq);
  return result.operations;
}

/**
 * Get the last sequence number in the WAL.
 *
 * Efficient lookup via sequence counter file.
 *
 * @param queueDir - Queue directory path
 * @returns Last seq number, or 0 if WAL is empty/doesn't exist
 */
export async function getLastSequence(queueDir: string): Promise<number> {
  return readSequenceCounter(queueDir);
}

/**
 * Truncate the WAL (called after compaction).
 *
 * Removes all entries from the WAL and resets sequence counter.
 * Should only be called after successful snapshot creation.
 *
 * @param queueDir - Queue directory path
 */
export async function truncateOperationsLog(queueDir: string): Promise<void> {
  const logPath = getOperationsLogPath(queueDir);
  const counterPath = getSequenceCounterPath(queueDir);

  // Truncate WAL file (create empty file)
  await writeFile(logPath, '', 'utf-8');

  // Reset sequence counter to 0
  await writeFile(counterPath, '0', 'utf-8');
}

/**
 * Truncate the WAL while preserving a specific sequence watermark.
 *
 * Used after snapshot creation to keep sequence numbers monotonic.
 *
 * @param queueDir - Queue directory path
 * @param snapshotSeq - Sequence number to persist after truncation
 */
export async function truncateOperationsLogToSeq(
  queueDir: string,
  snapshotSeq: number
): Promise<void> {
  const logPath = getOperationsLogPath(queueDir);
  const counterPath = getSequenceCounterPath(queueDir);

  await writeFile(logPath, '', 'utf-8');
  await writeFile(counterPath, `${snapshotSeq}`, 'utf-8');
}

/**
 * Truncate WAL with file locking.
 *
 * @param runDir - Run directory path (for lock coordination)
 * @param queueDir - Queue directory path
 */
export function truncateOperationsLogLocked(runDir: string, queueDir: string): Promise<void> {
  return withLock(runDir, async () => truncateOperationsLog(queueDir), {
    operation: 'wal_truncate',
  });
}

/**
 * Get WAL file statistics.
 *
 * Used for compaction threshold checks to determine when to create snapshot.
 *
 * @param queueDir - Queue directory path
 * @returns Stats including existence, size, and operation count
 */
export async function getOperationsLogStats(queueDir: string): Promise<{
  exists: boolean;
  sizeBytes: number;
  operationCount: number;
}> {
  const logPath = getOperationsLogPath(queueDir);

  try {
    const stats = await stat(logPath);

    // Count operations by counting non-empty lines
    const content = await readFile(logPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    return {
      exists: true,
      sizeBytes: stats.size,
      operationCount: lines.length,
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return {
        exists: false,
        sizeBytes: 0,
        operationCount: 0,
      };
    }
    throw error;
  }
}

// ============================================================================
// WAL Initialization
// ============================================================================

/**
 * Initialize WAL files if they don't exist.
 *
 * Creates empty WAL and sequence counter files.
 *
 * @param queueDir - Queue directory path
 */
export async function initializeOperationsLog(queueDir: string): Promise<void> {
  const logPath = getOperationsLogPath(queueDir);
  const counterPath = getSequenceCounterPath(queueDir);

  // Ensure queue directory exists
  await mkdir(queueDir, { recursive: true });

  // Create WAL file if it doesn't exist
  try {
    await access(logPath);
  } catch {
    await writeFile(logPath, '', 'utf-8');
  }

  // Create sequence counter if it doesn't exist
  try {
    await access(counterPath);
  } catch {
    await writeFile(counterPath, '0', 'utf-8');
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Append multiple operations atomically.
 *
 * More efficient than individual appends for bulk operations.
 * All operations are written in a single file write.
 *
 * @param queueDir - Queue directory path
 * @param ops - Array of operations without seq/checksum
 * @returns Array of complete operations with assigned seq and checksum
 */
export async function appendOperationsBatch(
  queueDir: string,
  ops: Array<Omit<QueueOperation, 'seq' | 'checksum'>>
): Promise<QueueOperation[]> {
  if (ops.length === 0) {
    return [];
  }

  // Read current sequence
  let seq = await readSequenceCounter(queueDir);
  const completeOps: QueueOperation[] = [];
  const lines: string[] = [];

  for (const op of ops) {
    seq += 1;

    const opWithSeq: Omit<QueueOperation, 'checksum'> = {
      ...op,
      seq,
    };

    const checksum = computeOperationChecksum(opWithSeq);
    const completeOp: QueueOperation = {
      ...opWithSeq,
      checksum,
    };

    completeOps.push(completeOp);
    lines.push(JSON.stringify(completeOp));
  }

  // Append all lines in single write
  const logPath = getOperationsLogPath(queueDir);
  await appendFile(logPath, `${lines.join('\n')}\n`, 'utf-8');

  // Update sequence counter
  await writeSequenceCounter(queueDir, seq);

  return completeOps;
}

/**
 * Append batch with file locking.
 *
 * @param runDir - Run directory path (for lock coordination)
 * @param queueDir - Queue directory path
 * @param ops - Array of operations without seq/checksum
 * @returns Array of complete operations
 */
export function appendOperationsBatchLocked(
  runDir: string,
  queueDir: string,
  ops: Array<Omit<QueueOperation, 'seq' | 'checksum'>>
): Promise<QueueOperation[]> {
  return withLock(runDir, async () => appendOperationsBatch(queueDir, ops), {
    operation: 'wal_append_batch',
  });
}
