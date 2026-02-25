/**
 * Write Action Queue
 *
 * Manages throttled GitHub write operations (PR comments, labels, review requests)
 * to prevent secondary rate limits and abuse detection.
 *
 * Key features:
 * - Serialized write actions with deduplication via idempotency keys
 * - Automatic cooldown on secondary limit detection (429 responses)
 * - Backoff and retry logic with exponential delays
 * - Integration with RateLimitLedger for cooldown state management
 * - Telemetry emission for queue depth and action outcomes
 * - CLI-friendly status reporting
 */

import { appendFile, access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createLogger, LogLevel, type LoggerInterface } from '../telemetry/logger';
import { getErrorMessage } from '../utils/errors.js';
import { RateLimitLedger } from '../telemetry/rateLimitLedger';
import type { MetricsCollector } from '../telemetry/metrics';
import { withLock } from '../persistence';
import {
  WriteActionType,
  WriteActionStatus,
  WriteActionSchema,
  WriteActionQueueManifestSchema,
  type ActionExecutor,
  type WriteActionOperationResult,
  type WriteAction,
  type WriteActionPayload,
  type WriteActionQueueConfig,
  type WriteActionQueueManifest,
} from './writeActionQueueTypes.js';
import { validateOrThrow, validateOrResult } from '../validation/helpers.js';

export {
  WriteActionType,
  WriteActionStatus,
  type ActionExecutor,
  type WriteActionOperationResult,
  type WriteAction,
  type WriteActionPayload,
  type WriteActionQueueConfig,
  type WriteActionQueueManifest,
} from './writeActionQueueTypes.js';

// ============================================================================
// Constants
// ============================================================================

const QUEUE_SUBDIR = 'write_actions';
const QUEUE_FILE = 'queue.jsonl';
const MANIFEST_FILE = 'manifest.json';
const SCHEMA_VERSION = '1.0.0';

// Default configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_CONCURRENCY_LIMIT = 2; // Conservative limit to avoid secondary limits
const DEFAULT_BACKOFF_BASE_MS = 2000; // 2 seconds
const DEFAULT_BACKOFF_MAX_MS = 60000; // 60 seconds

// Rate limit thresholds
// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate action ID
 */
function generateActionId(): string {
  return `wa_${Date.now()}_${randomBytes(8).toString('hex')}`;
}

/**
 * Generate idempotency key from action payload
 */
function generateIdempotencyKey(
  actionType: WriteActionType,
  owner: string,
  repo: string,
  payload: WriteActionPayload
): string {
  const data = JSON.stringify({
    actionType,
    owner,
    repo,
    payload,
  });
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute checksum of queue file
 */
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

/**
 * Check if error is file not found
 */
function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Create console logger using StructuredLogger (includes redaction)
 */
function createConsoleLogger(): LoggerInterface {
  return createLogger({
    component: 'write-action-queue',
    minLevel: LogLevel.DEBUG,
    mirrorToStderr: true,
  });
}

// ============================================================================
// Write Action Queue Class
// ============================================================================

/**
 * Write action queue for throttled GitHub write operations
 */
export class WriteActionQueue {
  private readonly runDir: string;
  private readonly featureId: string;
  private readonly provider: string;
  private readonly queueDir: string;
  private readonly queuePath: string;
  private readonly manifestPath: string;
  private readonly logger: LoggerInterface;
  private readonly metrics: MetricsCollector | undefined;
  private readonly maxRetries: number;
  private readonly concurrencyLimit: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly rateLimitLedger: RateLimitLedger;

  constructor(config: WriteActionQueueConfig) {
    this.runDir = config.runDir;
    this.featureId = config.featureId;
    this.provider = config.provider ?? 'github';
    this.queueDir = join(this.runDir, QUEUE_SUBDIR);
    this.queuePath = join(this.queueDir, QUEUE_FILE);
    this.manifestPath = join(this.queueDir, MANIFEST_FILE);
    this.logger = config.logger ?? createConsoleLogger();
    this.metrics = config.metrics;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.concurrencyLimit = config.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;

    // Initialize rate limit ledger
    this.rateLimitLedger = new RateLimitLedger(this.runDir, this.provider, this.logger);
  }

  /**
   * Initialize queue directory and manifest
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing write action queue', {
      queueDir: this.queueDir,
      featureId: this.featureId,
    });

    // Create queue directory
    await mkdir(this.queueDir, { recursive: true });

    // Create initial manifest if it doesn't exist
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

    this.logger.info('Write action queue initialized');
  }

  /**
   * Enqueue a write action
   */
  async enqueue(
    actionType: WriteActionType,
    owner: string,
    repo: string,
    payload: WriteActionPayload
  ): Promise<WriteAction> {
    return withLock(
      this.runDir,
      async () => {
        // Generate idempotency key
        const idempotencyKey = generateIdempotencyKey(actionType, owner, repo, payload);

        // Check for existing action with same idempotency key
        const existingAction = await this.findByIdempotencyKey(idempotencyKey);
        if (existingAction) {
          this.logger.info('Action already exists, skipping enqueue', {
            action_id: existingAction.action_id,
            idempotency_key: idempotencyKey,
          });

          // Update metrics
          this.metrics?.increment(
            'write_action_queue_deduped',
            { provider: this.provider, action_type: actionType },
            1,
            'Write actions deduped by idempotency key'
          );

          return existingAction;
        }

        // Create new action
        const action: WriteAction = {
          action_id: generateActionId(),
          action_type: actionType,
          provider: this.provider,
          owner,
          repo,
          payload,
          idempotency_key: idempotencyKey,
          status: WriteActionStatus.PENDING,
          retry_count: 0,
          max_retries: this.maxRetries,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Append to queue file
        const line = JSON.stringify(action) + '\n';
        await appendFile(this.queuePath, line, 'utf-8');

        this.logger.info('Action enqueued', {
          action_id: action.action_id,
          action_type: actionType,
          idempotency_key: idempotencyKey,
        });

        // Update manifest (totalDelta=1, pendingDelta=1)
        await this.updateManifestCounts(1, 1, 0, 0, 0);

        // Update metrics
        if (this.metrics) {
          this.metrics.increment(
            'write_action_queue_enqueued',
            { provider: this.provider, action_type: actionType },
            1,
            'Write actions enqueued'
          );

          await this.updateQueueDepthMetrics();
        }

        return action;
      },
      { operation: 'enqueue_write_action' }
    );
  }

  /**
   * Dequeue and execute pending actions
   */
  async drain(executor: ActionExecutor): Promise<WriteActionOperationResult> {
    this.logger.info('Draining write action queue');

    try {
      // Check for rate limit cooldown
      const inCooldown = await this.rateLimitLedger.isInCooldown(this.provider);
      if (inCooldown) {
        const requiresAck = await this.rateLimitLedger.requiresManualAcknowledgement(this.provider);

        if (requiresAck) {
          this.logger.warn('Rate limit cooldown requires manual acknowledgement', {
            provider: this.provider,
          });

          return {
            success: false,
            message:
              'Queue draining paused: manual acknowledgement required due to repeated rate limits',
            actionsAffected: 0,
          };
        }

        this.logger.warn('Rate limit cooldown active, pausing queue drain', {
          provider: this.provider,
        });

        return {
          success: true,
          message: 'Queue draining paused: waiting for rate limit cooldown to expire',
          actionsAffected: 0,
        };
      }

      // Load all actions
      const actions = await this.loadQueue();

      // Get pending actions
      const pendingActions = Array.from(actions.values())
        .filter((a) => a.status === WriteActionStatus.PENDING)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      if (pendingActions.length === 0) {
        this.logger.info('No pending actions to drain');
        return {
          success: true,
          message: 'No pending actions',
          actionsAffected: 0,
        };
      }

      // Get current in-progress count
      const inProgressCount = Array.from(actions.values()).filter(
        (a) => a.status === WriteActionStatus.IN_PROGRESS
      ).length;

      // Calculate how many actions we can execute
      const availableSlots = Math.max(0, this.concurrencyLimit - inProgressCount);
      const actionsToExecute = pendingActions.slice(0, availableSlots);

      this.logger.info('Executing actions', {
        pending: pendingActions.length,
        in_progress: inProgressCount,
        available_slots: availableSlots,
        to_execute: actionsToExecute.length,
      });

      let successCount = 0;
      let failureCount = 0;
      const errors: string[] = [];

      // Execute actions
      for (const action of actionsToExecute) {
        try {
          await this.executeAction(action, executor);
          successCount++;
        } catch (error) {
          failureCount++;
          const errorMessage = getErrorMessage(error);
          errors.push(`${action.action_id}: ${errorMessage}`);
        }
      }

      const result: WriteActionOperationResult = {
        success: failureCount === 0,
        message: `Executed ${successCount} action(s), ${failureCount} failed`,
        actionsAffected: successCount + failureCount,
      };

      if (errors.length > 0) {
        result.errors = errors;
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to drain queue', {
        error: getErrorMessage(error),
      });

      return {
        success: false,
        message: getErrorMessage(error),
        actionsAffected: 0,
        errors: [error instanceof Error && error.stack ? error.stack : getErrorMessage(error)],
      };
    }
  }

  /**
   * Execute a single action with retry logic
   */
  private async executeAction(action: WriteAction, executor: ActionExecutor): Promise<void> {
    return withLock(
      this.runDir,
      async () => {
        try {
          // Mark as in-progress
          await this.updateActionStatus(action.action_id, WriteActionStatus.IN_PROGRESS);

          this.logger.info('Executing action', {
            action_id: action.action_id,
            action_type: action.action_type,
            retry_count: action.retry_count,
          });

          // Execute the action
          await executor(action);

          // Mark as completed
          await this.updateActionStatus(
            action.action_id,
            WriteActionStatus.COMPLETED,
            undefined,
            new Date().toISOString()
          );

          this.logger.info('Action completed successfully', {
            action_id: action.action_id,
          });

          // Update metrics
          this.metrics?.increment(
            'write_action_queue_completed',
            { provider: this.provider, action_type: action.action_type },
            1,
            'Write actions completed successfully'
          );
        } catch (error) {
          const errorMessage = getErrorMessage(error);

          this.logger.error('Action execution failed', {
            action_id: action.action_id,
            error: errorMessage,
            retry_count: action.retry_count,
          });

          // Check if we should retry
          if (action.retry_count < action.max_retries) {
            // Calculate backoff delay
            const backoffDelay = Math.min(
              this.backoffBaseMs * Math.pow(2, action.retry_count),
              this.backoffMaxMs
            );

            this.logger.info('Scheduling action retry', {
              action_id: action.action_id,
              retry_count: action.retry_count + 1,
              backoff_ms: backoffDelay,
            });

            // Wait for backoff
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));

            // Update retry count and mark as pending again
            await this.updateActionRetry(action.action_id, errorMessage);

            // Update metrics
            this.metrics?.increment(
              'write_action_queue_retried',
              { provider: this.provider, action_type: action.action_type },
              1,
              'Write actions retried after failure'
            );
          } else {
            // Max retries exceeded, mark as failed
            await this.updateActionStatus(action.action_id, WriteActionStatus.FAILED, errorMessage);

            this.logger.error('Action failed after max retries', {
              action_id: action.action_id,
              max_retries: action.max_retries,
            });

            // Update metrics
            this.metrics?.increment(
              'write_action_queue_failed',
              { provider: this.provider, action_type: action.action_type },
              1,
              'Write actions failed after retries'
            );

            throw error;
          }
        } finally {
          // Update queue depth metrics
          if (this.metrics) {
            await this.updateQueueDepthMetrics();
          }
        }
      },
      { operation: 'execute_write_action' }
    );
  }

  /**
   * Update action status
   */
  private async updateActionStatus(
    actionId: string,
    status: WriteActionStatus,
    lastError?: string,
    completedAt?: string
  ): Promise<void> {
    const actions = await this.loadQueue();
    const action = actions.get(actionId);

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    const oldStatus = action.status;
    action.status = status;
    action.updated_at = new Date().toISOString();

    if (lastError) {
      action.last_error = lastError;
    }

    if (completedAt) {
      action.completed_at = completedAt;
    }

    await this.saveQueue(actions);

    // Update manifest counts
    const pendingDelta =
      status === WriteActionStatus.PENDING ? 1 : oldStatus === WriteActionStatus.PENDING ? -1 : 0;
    const inProgressDelta =
      status === WriteActionStatus.IN_PROGRESS
        ? 1
        : oldStatus === WriteActionStatus.IN_PROGRESS
          ? -1
          : 0;
    const completedDelta =
      status === WriteActionStatus.COMPLETED
        ? 1
        : oldStatus === WriteActionStatus.COMPLETED
          ? -1
          : 0;
    const failedDelta =
      status === WriteActionStatus.FAILED ? 1 : oldStatus === WriteActionStatus.FAILED ? -1 : 0;
    const skippedDelta =
      status === WriteActionStatus.SKIPPED ? 1 : oldStatus === WriteActionStatus.SKIPPED ? -1 : 0;

    await this.updateManifestCounts(
      0,
      pendingDelta,
      inProgressDelta,
      completedDelta,
      failedDelta,
      skippedDelta
    );
  }

  /**
   * Update action retry count
   */
  private async updateActionRetry(actionId: string, lastError: string): Promise<void> {
    const actions = await this.loadQueue();
    const action = actions.get(actionId);

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    const oldStatus = action.status;
    action.retry_count++;
    action.last_error = lastError;
    action.last_retry_at = new Date().toISOString();
    action.status = WriteActionStatus.PENDING;
    action.updated_at = new Date().toISOString();

    await this.saveQueue(actions);

    // Update manifest counts (transition from IN_PROGRESS back to PENDING)
    const pendingDelta = oldStatus !== WriteActionStatus.PENDING ? 1 : 0;
    const inProgressDelta = oldStatus === WriteActionStatus.IN_PROGRESS ? -1 : 0;
    await this.updateManifestCounts(0, pendingDelta, inProgressDelta, 0, 0);
  }

  /**
   * Load all actions from queue
   */
  private async loadQueue(): Promise<Map<string, WriteAction>> {
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
            this.logger.warn('Skipping queue entry that failed validation', {
              line_number: i + 1,
              error: result.error.message,
              line_preview: line.substring(0, 100),
            });
          }
        } catch (error) {
          // Skip corrupted lines (malformed JSON)
          this.logger.warn('Skipping corrupted queue line', {
            line_number: i + 1,
            error: error instanceof Error ? error.message : 'Unknown error',
            line_preview: line.substring(0, 100),
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

  /**
   * Save queue to disk
   */
  private async saveQueue(actions: Map<string, WriteAction>): Promise<void> {
    const lines =
      Array.from(actions.values())
        .map((action) => JSON.stringify(action))
        .join('\n') + '\n';

    await writeFile(this.queuePath, lines, 'utf-8');

    // Update checksum in manifest
    const checksum = await computeQueueChecksum(this.queuePath);
    const manifest = await this.loadManifest();
    manifest.queue_checksum = checksum;
    manifest.updated_at = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  /**
   * Find action by idempotency key
   */
  private async findByIdempotencyKey(idempotencyKey: string): Promise<WriteAction | undefined> {
    const actions = await this.loadQueue();

    for (const action of actions.values()) {
      if (action.idempotency_key === idempotencyKey) {
        return action;
      }
    }

    return undefined;
  }

  /**
   * Load manifest
   */
  private async loadManifest(): Promise<WriteActionQueueManifest> {
    try {
      const content = await readFile(this.manifestPath, 'utf-8');
      return validateOrThrow(
        WriteActionQueueManifestSchema,
        JSON.parse(content),
        'write action queue manifest'
      ) as WriteActionQueueManifest;
    } catch (error) {
      if (isFileNotFound(error)) {
        // Return default manifest
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

  /**
   * Write manifest
   */
  private async writeManifest(manifest: WriteActionQueueManifest): Promise<void> {
    const content = JSON.stringify(manifest, null, 2);
    await writeFile(this.manifestPath, content, 'utf-8');
  }

  /**
   * Update manifest counts
   */
  private async updateManifestCounts(
    totalDelta: number,
    pendingDelta: number,
    inProgressDelta: number = 0,
    completedDelta: number = 0,
    failedDelta: number = 0,
    skippedDelta: number = 0
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

  /**
   * Update queue depth metrics
   */
  private async updateQueueDepthMetrics(): Promise<void> {
    if (!this.metrics) {
      return;
    }

    const manifest = await this.loadManifest();

    this.metrics.gauge(
      'write_action_queue_depth',
      manifest.pending_count,
      { provider: this.provider, status: 'pending' },
      'Number of pending write actions in queue'
    );

    this.metrics.gauge(
      'write_action_queue_depth',
      manifest.in_progress_count,
      { provider: this.provider, status: 'in_progress' },
      'Number of in-progress write actions in queue'
    );

    this.metrics.gauge(
      'write_action_queue_depth',
      manifest.completed_count,
      { provider: this.provider, status: 'completed' },
      'Number of completed write actions in queue'
    );

    this.metrics.gauge(
      'write_action_queue_depth',
      manifest.failed_count,
      { provider: this.provider, status: 'failed' },
      'Number of failed write actions in queue'
    );
  }

  /**
   * Get queue status
   */
  async getStatus(): Promise<WriteActionQueueManifest> {
    return this.loadManifest();
  }

  /**
   * Clear completed and failed actions
   */
  async clearCompleted(): Promise<WriteActionOperationResult> {
    return withLock(
      this.runDir,
      async () => {
        try {
          const actions = await this.loadQueue();

          let removedCount = 0;
          for (const [actionId, action] of actions) {
            if (
              action.status === WriteActionStatus.COMPLETED ||
              action.status === WriteActionStatus.FAILED ||
              action.status === WriteActionStatus.SKIPPED
            ) {
              actions.delete(actionId);
              removedCount++;
            }
          }

          await this.saveQueue(actions);

          this.logger.info('Cleared completed actions', {
            removed_count: removedCount,
          });

          return {
            success: true,
            message: `Cleared ${removedCount} completed/failed/skipped action(s)`,
            actionsAffected: removedCount,
          };
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
            errors: [error instanceof Error ? error.stack || error.message : String(error)],
          };
        }
      },
      { operation: 'clear_completed_write_actions' }
    );
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create write action queue instance
 */
export function createWriteActionQueue(config: WriteActionQueueConfig): WriteActionQueue {
  return new WriteActionQueue(config);
}
