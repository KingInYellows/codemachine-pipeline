/**
 * Write Action Queue
 *
 * Manages throttled GitHub write operations (PR comments, labels, review requests)
 * to prevent secondary rate limits and abuse detection. Serialized write actions
 * with deduplication via idempotency keys, automatic cooldown on 429 responses,
 * and integration with RateLimitLedger for cooldown state management.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { createLogger, LogLevel, type LoggerInterface } from '../telemetry/logger';
import { getErrorMessage } from '../utils/errors.js';
import { isFileNotFound } from '../utils/safeJson.js';
import { RateLimitLedger } from '../telemetry/rateLimitLedger';
import type { MetricsCollector } from '../telemetry/metrics';
import { withLock } from '../persistence/runDirectoryManager';

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * Write action types supported by the queue
 */
export enum WriteActionType {
  PR_COMMENT = 'pr_comment',
  PR_LABEL = 'pr_label',
  PR_REVIEW_REQUEST = 'pr_review_request',
  PR_UPDATE = 'pr_update',
  ISSUE_COMMENT = 'issue_comment',
}

/**
 * Write action status
 */
export enum WriteActionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  /** Skipped due to deduplication */
  SKIPPED = 'skipped',
}

/**
 * Write action payload structure
 */
export interface WriteActionPayload {
  /** PR or issue number */
  target_number?: number;
  /** Comment body (for comment actions) */
  comment_body?: string;
  /** Labels to add (for label actions) */
  labels?: string[];
  /** Reviewer usernames (for review request actions) */
  reviewers?: string[];
  /** Team reviewer slugs (for review request actions) */
  team_reviewers?: string[];
  /** PR update fields (for update actions) */
  pr_updates?: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  };
}

/**
 * Write action entry
 */
export interface WriteAction {
  /** Unique action ID */
  action_id: string;
  /** Action type */
  action_type: WriteActionType;
  /** GitHub provider identifier */
  provider: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Action payload */
  payload: WriteActionPayload;
  /** Idempotency key for deduplication */
  idempotency_key: string;
  /** Current status */
  status: WriteActionStatus;
  /** Number of retry attempts */
  retry_count: number;
  /** Maximum retry attempts */
  max_retries: number;
  /** Last error message (if failed) */
  last_error?: string;
  /** Last retry timestamp */
  last_retry_at?: string;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Completion timestamp */
  completed_at?: string;
}

/**
 * Queue manifest metadata
 */
export interface WriteActionQueueManifest {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** Total actions in queue */
  total_actions: number;
  /** Pending actions */
  pending_count: number;
  /** In-progress actions */
  in_progress_count: number;
  /** Completed actions */
  completed_count: number;
  /** Failed actions */
  failed_count: number;
  /** Skipped actions */
  skipped_count: number;
  /** SHA-256 checksum of queue.jsonl */
  queue_checksum: string;
  /** Last updated timestamp */
  updated_at: string;
  /** Concurrency limit (max actions in flight) */
  concurrency_limit: number;
}

/**
 * Queue configuration
 */
export interface WriteActionQueueConfig {
  /** Run directory path */
  runDir: string;
  /** Feature ID */
  featureId: string;
  /** GitHub provider name */
  provider?: string;
  /** Logger instance */
  logger?: LoggerInterface;
  /** Metrics collector */
  metrics?: MetricsCollector;
  /** Maximum retry attempts per action */
  maxRetries?: number;
  /** Concurrency limit (max actions in flight) */
  concurrencyLimit?: number;
  /** Backoff base delay in milliseconds */
  backoffBaseMs?: number;
  /** Backoff max delay in milliseconds */
  backoffMaxMs?: number;
}

/**
 * Queue operation result
 */
export interface QueueOperationResult {
  success: boolean;
  message: string;
  actionsAffected?: number;
  errors?: string[];
}

/**
 * Action execution function
 */
export type ActionExecutor = (action: WriteAction) => Promise<void>;

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
  return `wa_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
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
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute checksum of queue file
 */
async function computeQueueChecksum(queuePath: string): Promise<string> {
  try {
    const content = await fs.readFile(queuePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error) {
    if (isFileNotFound(error)) {
      return crypto.createHash('sha256').update('').digest('hex');
    }
    throw error;
  }
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
    this.queueDir = path.join(this.runDir, QUEUE_SUBDIR);
    this.queuePath = path.join(this.queueDir, QUEUE_FILE);
    this.manifestPath = path.join(this.queueDir, MANIFEST_FILE);
    this.logger = config.logger ?? createLogger({ component: 'write-action-queue', minLevel: LogLevel.DEBUG, mirrorToStderr: true });
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
    await fs.mkdir(this.queueDir, { recursive: true });

    // Create initial manifest if it doesn't exist
    try {
      await fs.access(this.manifestPath);
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
        queue_checksum: crypto.createHash('sha256').update('').digest('hex'),
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
        await fs.appendFile(this.queuePath, line, 'utf-8');

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
  async drain(executor: ActionExecutor): Promise<QueueOperationResult> {
    this.logger.info('Draining write action queue');

    try {
      const cooldownResult = await this.checkRateLimitGuard();
      if (cooldownResult) return cooldownResult;

      const actions = await this.loadQueue();
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

      return await this.executeActionsSequentially(actionsToExecute, executor);
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
   * Guard that checks rate limit cooldown state before draining.
   * Returns a result to return immediately, or null to proceed.
   */
  private async checkRateLimitGuard(): Promise<QueueOperationResult | null> {
    const inCooldown = await this.rateLimitLedger.isInCooldown(this.provider);
    if (!inCooldown) return null;

    const requiresAck = await this.rateLimitLedger.requiresManualAcknowledgement(this.provider);
    if (requiresAck) {
      this.logger.warn('Rate limit cooldown requires manual acknowledgement', {
        provider: this.provider,
      });
      return {
        success: false,
        message: 'Queue draining paused: manual acknowledgement required due to repeated rate limits',
        actionsAffected: 0,
      };
    }

    this.logger.warn('Rate limit cooldown active, pausing queue drain', { provider: this.provider });
    return {
      success: true,
      message: 'Queue draining paused: waiting for rate limit cooldown to expire',
      actionsAffected: 0,
    };
  }

  /**
   * Execute a batch of actions sequentially, collecting results.
   */
  private async executeActionsSequentially(
    actionsToExecute: WriteAction[],
    executor: ActionExecutor
  ): Promise<QueueOperationResult> {
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

    const result: QueueOperationResult = {
      success: failureCount === 0,
      message: `Executed ${successCount} action(s), ${failureCount} failed`,
      actionsAffected: successCount + failureCount,
    };
    if (errors.length > 0) result.errors = errors;
    return result;
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

    // Update manifest counts: +1 for entering a status, -1 for leaving it
    const delta = (s: WriteActionStatus) => (status === s ? 1 : 0) - (oldStatus === s ? 1 : 0);
    await this.updateManifestCounts(
      0,
      delta(WriteActionStatus.PENDING),
      delta(WriteActionStatus.IN_PROGRESS),
      delta(WriteActionStatus.COMPLETED),
      delta(WriteActionStatus.FAILED),
      delta(WriteActionStatus.SKIPPED)
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
      const content = await fs.readFile(this.queuePath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      for (const line of lines) {
        try {
          const action = JSON.parse(line) as WriteAction;
          actions.set(action.action_id, action);
        } catch {
          // Skip corrupted lines
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

    await fs.writeFile(this.queuePath, lines, 'utf-8');

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
      const content = await fs.readFile(this.manifestPath, 'utf-8');
      return JSON.parse(content) as WriteActionQueueManifest;
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
          queue_checksum: crypto.createHash('sha256').update('').digest('hex'),
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
    await fs.writeFile(this.manifestPath, content, 'utf-8');
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
  async clearCompleted(): Promise<QueueOperationResult> {
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
