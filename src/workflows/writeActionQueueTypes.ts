/**
 * Write Action Queue Types
 *
 * Extracted from writeActionQueue.ts: enums, interfaces, and type aliases
 * for queue data types, configuration, and operation results.
 */

import { z } from 'zod';
import type { LoggerInterface } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';

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

export const WriteActionSchema = z.object({
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
}).passthrough();

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

/**
 * Write action payload structure
 */
export interface WriteActionPayload {
  target_number?: number;
  comment_body?: string;
  labels?: string[];
  reviewers?: string[];
  team_reviewers?: string[];
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
  action_id: string;
  action_type: WriteActionType;
  provider: string;
  owner: string;
  repo: string;
  payload: WriteActionPayload;
  /** Idempotency key for deduplication */
  idempotency_key: string;
  status: WriteActionStatus;
  retry_count: number;
  max_retries: number;
  last_error?: string;
  last_retry_at?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * Queue manifest metadata
 */
export interface WriteActionQueueManifest {
  schema_version: string;
  feature_id: string;
  total_actions: number;
  pending_count: number;
  in_progress_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  /** SHA-256 checksum of queue.jsonl */
  queue_checksum: string;
  updated_at: string;
  /** Concurrency limit (max actions in flight) */
  concurrency_limit: number;
}

/**
 * Queue configuration
 */
export interface WriteActionQueueConfig {
  runDir: string;
  featureId: string;
  provider?: string;
  logger?: LoggerInterface;
  metrics?: MetricsCollector;
  maxRetries?: number;
  /** Concurrency limit (max actions in flight) */
  concurrencyLimit?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

/**
 * Write action queue operation result (distinct from queue/QueueOperationResult
 * which counts tasksAffected; this one counts actionsAffected).
 */
export interface WriteActionOperationResult {
  success: boolean;
  message: string;
  actionsAffected?: number;
  errors?: string[];
}

/**
 * Action execution function
 */
export type ActionExecutor = (action: WriteAction) => Promise<void>;
