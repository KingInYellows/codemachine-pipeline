/**
 * Queue Validation
 *
 * Validates queue integrity by checking JSONL parsing, task schema validity,
 * and manifest checksum consistency.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { parseExecutionTask } from '../core/models/ExecutionTask';
import { readManifest } from '../persistence';
import { isFileNotFound } from '../utils/safeJson.js';

import { QUEUE_FILE, QUEUE_MANIFEST_FILE } from './queueTypes.js';
import type { QueueManifest, QueueValidationResult } from './queueTypes.js';

/**
 * Compute SHA-256 checksum of empty content.
 */
function computeEmptyQueueChecksum(): string {
  return crypto.createHash('sha256').update('').digest('hex');
}

/**
 * Compute SHA-256 checksum of a file
 */
async function computeFileChecksum(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (isFileNotFound(error)) {
      return computeEmptyQueueChecksum();
    }
    throw error;
  }
}

// Queue Validation

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
          typeof parsed === 'object' && parsed !== null ? (parsed as { task_id?: unknown }) : null;
        const parsedTaskId =
          parsedRecord && typeof parsedRecord.task_id === 'string'
            ? parsedRecord.task_id
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
    if (isFileNotFound(error)) {
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
