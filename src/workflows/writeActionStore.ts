/**
 * Write Action Store
 *
 * Persistence layer for the write-action queue: file I/O, manifest management,
 * queue reading/writing, and action lookup. Extracted from writeActionQueue.ts.
 */

import { appendFile, access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { LoggerInterface } from '../telemetry/logger';
import {
  WriteActionSchema,
  WriteActionQueueManifestSchema,
  type WriteAction,
  type WriteActionPayload,
  type WriteActionQueueManifest,
  type WriteActionType,
} from './writeActionQueueTypes.js';
import { validateOrThrow, validateOrResult } from '../validation/helpers.js';

// ============================================================================
// Constants
// ============================================================================

export const QUEUE_SUBDIR = 'write_actions';
export const QUEUE_FILE = 'queue.jsonl';
export const MANIFEST_FILE = 'manifest.json';
export const SCHEMA_VERSION = '1.0.0';

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_CONCURRENCY_LIMIT = 2;
export const DEFAULT_BACKOFF_BASE_MS = 2000;
export const DEFAULT_BACKOFF_MAX_MS = 60000;

// ============================================================================
// Helpers
// ============================================================================

export function generateActionId(): string {
  return `wa_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

export function generateIdempotencyKey(
  actionType: WriteActionType,
  owner: string,
  repo: string,
  payload: WriteActionPayload
): string {
  const data = JSON.stringify({ actionType, owner, repo, payload });
  return createHash('sha256').update(data).digest('hex');
}

export function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function computeQueueChecksum(queuePath: string): Promise<string> {
  try {
    const content = await readFile(queuePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (isFileNotFound(error)) {
      return createHash('sha256').update('').digest('hex');
    }
    throw error;
  }
}

// ============================================================================
// Write Action Store
// ============================================================================

export interface WriteActionStoreConfig {
  runDir: string;
  featureId: string;
  concurrencyLimit: number;
  logger: LoggerInterface;
}

/**
 * Persistence layer for write-action queue: reads/writes queue.jsonl and manifest.json
 */
export class WriteActionStore {
  readonly queueDir: string;
  readonly queuePath: string;
  readonly manifestPath: string;
  private readonly featureId: string;
  private readonly concurrencyLimit: number;
  private readonly logger: LoggerInterface;

  constructor(config: WriteActionStoreConfig) {
    this.queueDir = join(config.runDir, QUEUE_SUBDIR);
    this.queuePath = join(this.queueDir, QUEUE_FILE);
    this.manifestPath = join(this.queueDir, MANIFEST_FILE);
    this.featureId = config.featureId;
    this.concurrencyLimit = config.concurrencyLimit;
    this.logger = config.logger;
  }

  async initialize(): Promise<void> {
    await mkdir(this.queueDir, { recursive: true });

    try {
      await access(this.manifestPath);
    } catch {
      const manifest: WriteActionQueueManifest = {
        schema_version: SCHEMA_VERSION,
        feature_id: this.featureId,
        total_actions: 0,
        pending_count: 0,
        in_progress_count: 0,
        completed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        queue_checksum: createHash('sha256').update('').digest('hex'),
        updated_at: new Date().toISOString(),
        concurrency_limit: this.concurrencyLimit,
      };
      await this.writeManifest(manifest);
    }
  }

  async loadQueue(): Promise<Map<string, WriteAction>> {
    const actions = new Map<string, WriteAction>();

    try {
      const content = await readFile(this.queuePath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        try {
          const result = validateOrResult(WriteActionSchema, JSON.parse(line), 'write action');
          if (result.success) {
            actions.set(result.data.action_id, result.data as WriteAction);
          } else {
            this.logger.warn('Skipping invalid queue entry', {
              lineNumber: i + 1,
              error: result.error.message,
              preview: line.slice(0, 100),
            });
          }
        } catch {
          this.logger.warn('Skipping corrupted queue line', {
            lineNumber: i + 1,
            preview: line.slice(0, 100),
          });
        }
      }
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }

    return actions;
  }

  async saveQueue(actions: Map<string, WriteAction>): Promise<void> {
    const lines = Array.from(actions.values())
      .map((action) => JSON.stringify(action))
      .join('\n');
    const queueContent = `${lines}\n`;

    await writeFile(this.queuePath, queueContent, 'utf-8');

    const checksum = await computeQueueChecksum(this.queuePath);
    const manifest = await this.loadManifest();
    manifest.queue_checksum = checksum;
    manifest.updated_at = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  async appendAction(action: WriteAction): Promise<void> {
    const line = `${JSON.stringify(action)}\n`;
    await appendFile(this.queuePath, line, 'utf-8');
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WriteAction | undefined> {
    const actions = await this.loadQueue();
    for (const action of actions.values()) {
      if (action.idempotency_key === idempotencyKey) {
        return action;
      }
    }
    return undefined;
  }

  async loadManifest(): Promise<WriteActionQueueManifest> {
    try {
      const content = await readFile(this.manifestPath, 'utf-8');
      return validateOrThrow(
        WriteActionQueueManifestSchema,
        JSON.parse(content),
        'write action queue manifest'
      ) as WriteActionQueueManifest;
    } catch (error) {
      if (isFileNotFound(error)) {
        return {
          schema_version: SCHEMA_VERSION,
          feature_id: this.featureId,
          total_actions: 0,
          pending_count: 0,
          in_progress_count: 0,
          completed_count: 0,
          failed_count: 0,
          skipped_count: 0,
          queue_checksum: createHash('sha256').update('').digest('hex'),
          updated_at: new Date().toISOString(),
          concurrency_limit: this.concurrencyLimit,
        };
      }
      throw error;
    }
  }

  async writeManifest(manifest: WriteActionQueueManifest): Promise<void> {
    const content = JSON.stringify(manifest, null, 2);
    await writeFile(this.manifestPath, content, 'utf-8');
  }

  async updateManifestCounts(
    totalDelta: number,
    pendingDelta: number,
    inProgressDelta = 0,
    completedDelta = 0,
    failedDelta = 0,
    skippedDelta = 0
  ): Promise<void> {
    const manifest = await this.loadManifest();

    manifest.total_actions += totalDelta;
    manifest.pending_count = Math.max(0, manifest.pending_count + pendingDelta);
    manifest.in_progress_count = Math.max(0, manifest.in_progress_count + inProgressDelta);
    manifest.completed_count = Math.max(0, manifest.completed_count + completedDelta);
    manifest.failed_count = Math.max(0, manifest.failed_count + failedDelta);
    manifest.skipped_count = Math.max(0, manifest.skipped_count + skippedDelta);
    manifest.queue_checksum = await computeQueueChecksum(this.queuePath);
    manifest.updated_at = new Date().toISOString();

    await this.writeManifest(manifest);
  }
}
