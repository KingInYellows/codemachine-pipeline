/**
 * Write Action Queue Types
 *
 * Extracted from writeActionQueue.ts: enums, interfaces, and type aliases
 * for queue data types, configuration, and operation results.
 */

import { z } from 'zod';
import type { LoggerInterface } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';

// ============================================================================
// Enums
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
  /** Failed after retries */
  FAILED = 'failed',
  /** Skipped due to deduplication */
  SKIPPED = 'skipped',
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const WriteActionSchema = z
  .object({
    action_id: z.string().min(1),
    action_type: z.nativeEnum(WriteActionType),
    provider: z.string(),
    owner: z.string(),
    repo: z.string(),
    payload: z.record(z.string(), z.unknown()),
    idempotency_key: z.string(),
    status: z.nativeEnum(WriteActionStatus),
    retry_count: z.number().nonnegative(),
    max_retries: z.number().nonnegative(),
    last_error: z.string().optional(),
    last_retry_at: z.string().datetime().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
  })
  .passthrough();

export const WriteActionQueueManifestSchema = z
  .object({
    schema_version: z.string(),
    feature_id: z.string(),
    total_actions: z.number().nonnegative(),
    pending_count: z.number().nonnegative(),
    in_progress_count: z.number().nonnegative(),
    completed_count: z.number().nonnegative(),
    failed_count: z.number().nonnegative(),
    skipped_count: z.number().nonnegative(),
    queue_checksum: z.string(),
    updated_at: z.string().datetime(),
    concurrency_limit: z.number().nonnegative(),
  })
  .passthrough();

// ============================================================================
// Interfaces
// ============================================================================

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
