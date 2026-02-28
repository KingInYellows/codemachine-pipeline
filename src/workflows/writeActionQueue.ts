/**
 * Write Action Queue
 *
 * Orchestration layer that coordinates throttled GitHub write operations
 * (PR comments, labels, review requests) to prevent secondary rate limits.
 * Delegates persistence to WriteActionStore and rate-limit checks to
 * WriteActionRateLimiter.
 *
 * Key features:
 * - Serialized write actions with deduplication via idempotency keys
 * - Automatic cooldown on secondary limit detection (429 responses)
 * - Backoff and retry logic with exponential delays
 * - Telemetry emission for queue depth and action outcomes
 */

import { createLogger, LogLevel, type LoggerInterface } from '../telemetry/logger';
import { getErrorMessage } from '../utils/errors.js';
import type { MetricsCollector } from '../telemetry/metrics';
import { withLock } from '../persistence';
import {
  WriteActionType,
  WriteActionStatus,
  type ActionExecutor,
  type WriteActionOperationResult,
  type WriteAction,
  type WriteActionPayload,
  type WriteActionQueueConfig,
  type WriteActionQueueManifest,
} from './writeActionQueueTypes.js';
import {
  WriteActionStore,
  generateActionId,
  generateIdempotencyKey,
  DEFAULT_MAX_RETRIES,
  DEFAULT_CONCURRENCY_LIMIT,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
} from './writeActionStore.js';
import { WriteActionRateLimiter } from './writeActionRateLimiter.js';

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
// Helpers
// ============================================================================

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
  private readonly provider: string;
  private readonly logger: LoggerInterface;
  private readonly metrics: MetricsCollector | undefined;
  private readonly maxRetries: number;
  private readonly concurrencyLimit: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly store: WriteActionStore;
  private readonly rateLimiter: WriteActionRateLimiter;

  constructor(config: WriteActionQueueConfig) {
    this.runDir = config.runDir;
    this.provider = config.provider ?? 'github';
    this.logger = config.logger ?? createConsoleLogger();
    this.metrics = config.metrics;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.concurrencyLimit = config.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT;
    this.backoffBaseMs = config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;

    this.store = new WriteActionStore({
      runDir: config.runDir,
      featureId: config.featureId,
      concurrencyLimit: this.concurrencyLimit,
      logger: this.logger,
    });

    this.rateLimiter = new WriteActionRateLimiter(this.runDir, this.provider, this.logger);
  }

  /**
   * Initialize queue directory and manifest
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing write action queue', {
      queueDir: this.store.queueDir,
      featureId: this.store.queueDir,
    });

    await this.store.initialize();

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
        const idempotencyKey = generateIdempotencyKey(actionType, owner, repo, payload);

        const existingAction = await this.store.findByIdempotencyKey(idempotencyKey);
        if (existingAction) {
          this.logger.info('Action already exists, skipping enqueue', {
            action_id: existingAction.action_id,
            idempotency_key: idempotencyKey,
          });
          this.metrics?.increment(
            'write_action_queue_deduped',
            { provider: this.provider, action_type: actionType },
            1,
            'Write actions deduped by idempotency key'
          );
          return existingAction;
        }

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

        await this.store.appendAction(action);

        this.logger.info('Action enqueued', {
          action_id: action.action_id,
          action_type: actionType,
          idempotency_key: idempotencyKey,
        });

        await this.store.updateManifestCounts(1, 1, 0, 0, 0);

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
      const cooldown = await this.rateLimiter.checkCooldown();

      if (cooldown.inCooldown) {
        if (cooldown.requiresManualAck) {
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

      const actions = await this.store.loadQueue();
      const pendingActions = Array.from(actions.values())
        .filter((a) => a.status === WriteActionStatus.PENDING)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      if (pendingActions.length === 0) {
        this.logger.info('No pending actions to drain');
        return { success: true, message: 'No pending actions', actionsAffected: 0 };
      }

      const inProgressCount = Array.from(actions.values()).filter(
        (a) => a.status === WriteActionStatus.IN_PROGRESS
      ).length;

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

      for (const action of actionsToExecute) {
        try {
          await this.executeAction(action, executor);
          successCount++;
        } catch (error) {
          failureCount++;
          errors.push(`${action.action_id}: ${getErrorMessage(error)}`);
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
      this.logger.error('Failed to drain queue', { error: getErrorMessage(error) });
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
          await this.updateActionStatus(action.action_id, WriteActionStatus.IN_PROGRESS);

          this.logger.info('Executing action', {
            action_id: action.action_id,
            action_type: action.action_type,
            retry_count: action.retry_count,
          });

          await executor(action);

          await this.updateActionStatus(
            action.action_id,
            WriteActionStatus.COMPLETED,
            undefined,
            new Date().toISOString()
          );

          this.logger.info('Action completed successfully', { action_id: action.action_id });

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

          if (action.retry_count < action.max_retries) {
            const backoffDelay = Math.min(
              this.backoffBaseMs * Math.pow(2, action.retry_count),
              this.backoffMaxMs
            );

            this.logger.info('Scheduling action retry', {
              action_id: action.action_id,
              retry_count: action.retry_count + 1,
              backoff_ms: backoffDelay,
            });

            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            await this.updateActionRetry(action.action_id, errorMessage);

            this.metrics?.increment(
              'write_action_queue_retried',
              { provider: this.provider, action_type: action.action_type },
              1,
              'Write actions retried after failure'
            );
          } else {
            await this.updateActionStatus(action.action_id, WriteActionStatus.FAILED, errorMessage);

            this.logger.error('Action failed after max retries', {
              action_id: action.action_id,
              max_retries: action.max_retries,
            });

            this.metrics?.increment(
              'write_action_queue_failed',
              { provider: this.provider, action_type: action.action_type },
              1,
              'Write actions failed after retries'
            );

            throw error;
          }
        } finally {
          if (this.metrics) {
            await this.updateQueueDepthMetrics();
          }
        }
      },
      { operation: 'execute_write_action' }
    );
  }

  private async updateActionStatus(
    actionId: string,
    status: WriteActionStatus,
    lastError?: string,
    completedAt?: string
  ): Promise<void> {
    const actions = await this.store.loadQueue();
    const action = actions.get(actionId);

    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    const oldStatus = action.status;
    action.status = status;
    action.updated_at = new Date().toISOString();
    if (lastError) action.last_error = lastError;
    if (completedAt) action.completed_at = completedAt;

    await this.store.saveQueue(actions);

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

    await this.store.updateManifestCounts(
      0,
      pendingDelta,
      inProgressDelta,
      completedDelta,
      failedDelta,
      skippedDelta
    );
  }

  private async updateActionRetry(actionId: string, lastError: string): Promise<void> {
    const actions = await this.store.loadQueue();
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

    await this.store.saveQueue(actions);

    const pendingDelta = oldStatus !== WriteActionStatus.PENDING ? 1 : 0;
    const inProgressDelta = oldStatus === WriteActionStatus.IN_PROGRESS ? -1 : 0;
    await this.store.updateManifestCounts(0, pendingDelta, inProgressDelta, 0, 0);
  }

  private async updateQueueDepthMetrics(): Promise<void> {
    if (!this.metrics) return;

    const manifest = await this.store.loadManifest();

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
    return this.store.loadManifest();
  }

  /**
   * Clear completed and failed actions
   */
  async clearCompleted(): Promise<WriteActionOperationResult> {
    return withLock(
      this.runDir,
      async () => {
        try {
          const actions = await this.store.loadQueue();

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

          await this.store.saveQueue(actions);

          this.logger.info('Cleared completed actions', { removed_count: removedCount });

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
