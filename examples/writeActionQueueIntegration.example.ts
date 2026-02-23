/**
 * Write Action Queue Integration Example
 *
 * Demonstrates how to integrate the write action queue with GitHub adapter
 * for rate-limit safe PR comment, label, and review request operations.
 *
 * This is a reference implementation showing best practices.
 */

import {
  createWriteActionQueue,
  WriteActionType,
  type WriteAction,
  type ActionExecutor,
} from './writeActionQueue';
import { createGitHubAdapter, type GitHubAdapter } from '../adapters/github/GitHubAdapter';
import type { HttpClient } from '../adapters/http/client';
import type { LoggerInterface } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';

// ============================================================================
// GitHub Action Executor
// ============================================================================

/**
 * Create GitHub-specific action executor
 *
 * This function wraps the GitHub adapter to execute queued write actions.
 * It handles all supported action types and provides proper error handling.
 */
export function createGitHubActionExecutor(adapter: GitHubAdapter): ActionExecutor {
  return async (action: WriteAction): Promise<void> => {
    const { action_type, owner, repo, payload } = action;

    switch (action_type) {
      case WriteActionType.PR_COMMENT:
        if (!payload.target_number || !payload.comment_body) {
          throw new Error('PR comment requires target_number and comment_body');
        }
        // Note: This assumes GitHubAdapter has a createComment method
        // You would need to add this method to GitHubAdapter or use the REST API directly
        await createPRComment(adapter, owner, repo, payload.target_number, payload.comment_body);
        break;

      case WriteActionType.PR_LABEL:
        if (!payload.target_number || !payload.labels || payload.labels.length === 0) {
          throw new Error('PR label action requires target_number and labels');
        }
        await addPRLabels(adapter, owner, repo, payload.target_number, payload.labels);
        break;

      case WriteActionType.PR_REVIEW_REQUEST:
        if (!payload.target_number) {
          throw new Error('PR review request requires target_number');
        }
        await adapter.requestReviewers({
          pull_number: payload.target_number,
          ...(payload.reviewers ? { reviewers: payload.reviewers } : {}),
          ...(payload.team_reviewers ? { team_reviewers: payload.team_reviewers } : {}),
        });
        break;

      case WriteActionType.PR_UPDATE:
        if (!payload.target_number || !payload.pr_updates) {
          throw new Error('PR update requires target_number and pr_updates');
        }
        await updatePR(adapter, owner, repo, payload.target_number, payload.pr_updates);
        break;

      case WriteActionType.ISSUE_COMMENT:
        if (!payload.target_number || !payload.comment_body) {
          throw new Error('Issue comment requires target_number and comment_body');
        }
        await createIssueComment(adapter, owner, repo, payload.target_number, payload.comment_body);
        break;

      default:
        throw new Error('Unsupported action type');
    }
  };
}

/**
 * Helper to access the adapter HTTP client for custom write operations
 */
function getAdapterHttpClient(adapter: GitHubAdapter): HttpClient {
  const candidate = adapter as unknown as { client?: HttpClient };
  if (!candidate.client) {
    throw new Error('GitHub adapter HTTP client is unavailable');
  }
  return candidate.client;
}

/**
 * Helper: Create PR comment via GitHub API
 */
async function createPRComment(
  adapter: GitHubAdapter,
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<void> {
  // This is a placeholder - you would use adapter's HTTP client directly
  // or add a createComment method to GitHubAdapter
  const client = getAdapterHttpClient(adapter);
  await client.post(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { body },
    { metadata: { operation: 'createPRComment', pr_number: prNumber } }
  );
}

/**
 * Helper: Add labels to PR
 */
async function addPRLabels(
  adapter: GitHubAdapter,
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[]
): Promise<void> {
  const client = getAdapterHttpClient(adapter);
  await client.post(
    `/repos/${owner}/${repo}/issues/${prNumber}/labels`,
    { labels },
    { metadata: { operation: 'addPRLabels', pr_number: prNumber } }
  );
}

/**
 * Helper: Update PR title, body, or state
 */
async function updatePR(
  adapter: GitHubAdapter,
  owner: string,
  repo: string,
  prNumber: number,
  updates: { title?: string; body?: string; state?: 'open' | 'closed' }
): Promise<void> {
  const client = getAdapterHttpClient(adapter);
  await client.patch(`/repos/${owner}/${repo}/pulls/${prNumber}`, updates, {
    metadata: { operation: 'updatePR', pr_number: prNumber },
  });
}

/**
 * Helper: Create issue comment
 */
async function createIssueComment(
  adapter: GitHubAdapter,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const client = getAdapterHttpClient(adapter);
  await client.post(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { body },
    { metadata: { operation: 'createIssueComment', issue_number: issueNumber } }
  );
}

// ============================================================================
// Usage Example
// ============================================================================

/**
 * Example: Enqueue and drain write actions for a PR workflow
 */
export async function examplePRWorkflow(
  runDir: string,
  featureId: string,
  owner: string,
  repo: string,
  prNumber: number,
  logger?: LoggerInterface,
  metrics?: MetricsCollector
): Promise<void> {
  // 1. Initialize write action queue
  const queue = createWriteActionQueue({
    runDir,
    featureId,
    provider: 'github',
    ...(logger ? { logger } : {}),
    ...(metrics ? { metrics } : {}),
    maxRetries: 3,
    concurrencyLimit: 2,
    backoffBaseMs: 2000,
    backoffMaxMs: 60000,
  });

  await queue.initialize();

  // 2. Initialize GitHub adapter
  const adapter = createGitHubAdapter({
    owner,
    repo,
    token: process.env.GITHUB_TOKEN!,
    runDir,
    ...(logger ? { logger } : {}),
  });

  // 3. Enqueue write actions
  logger?.info('Enqueueing write actions for PR workflow', { pr_number: prNumber });

  // Add a comment about deployment readiness
  await queue.enqueue(WriteActionType.PR_COMMENT, owner, repo, {
    target_number: prNumber,
    comment_body: '✅ All checks passed! This PR is ready for review.',
  });

  // Add labels
  await queue.enqueue(WriteActionType.PR_LABEL, owner, repo, {
    target_number: prNumber,
    labels: ['ready-for-review', 'automated'],
  });

  // Request reviewers
  await queue.enqueue(WriteActionType.PR_REVIEW_REQUEST, owner, repo, {
    target_number: prNumber,
    reviewers: ['alice', 'bob'],
    team_reviewers: ['engineering'],
  });

  // 4. Drain the queue
  logger?.info('Draining write action queue');

  const executor = createGitHubActionExecutor(adapter);
  const result = await queue.drain(executor);

  if (result.success) {
    logger?.info('Write actions completed successfully', {
      actions_affected: result.actionsAffected,
    });
  } else {
    logger?.error('Write actions failed', {
      message: result.message,
      errors: result.errors,
    });

    if (result.message.includes('manual acknowledgement required')) {
      logger?.warn('Rate limit cooldown requires manual intervention');
      logger?.warn('Run: codepipe rate-limits clear github');
    }
  }

  // 5. Check queue status
  const status = await queue.getStatus();
  logger?.info('Queue status', {
    pending: status.pending_count,
    completed: status.completed_count,
    failed: status.failed_count,
  });
}

/**
 * Example: Resume draining after crash or cooldown
 */
export async function exampleResumeDrain(
  runDir: string,
  featureId: string,
  owner: string,
  repo: string,
  logger?: LoggerInterface
): Promise<void> {
  // Reinitialize queue from persisted state
  const queue = createWriteActionQueue({
    runDir,
    featureId,
    provider: 'github',
    ...(logger ? { logger } : {}),
  });

  await queue.initialize();

  // Check if there are pending actions
  const status = await queue.getStatus();
  if (status.pending_count === 0) {
    logger?.info('No pending actions to drain');
    return;
  }

  logger?.info('Resuming queue drain', {
    pending: status.pending_count,
    in_progress: status.in_progress_count,
  });

  // Reinitialize adapter and drain
  const adapter = createGitHubAdapter({
    owner,
    repo,
    token: process.env.GITHUB_TOKEN!,
    runDir,
    ...(logger ? { logger } : {}),
  });

  const executor = createGitHubActionExecutor(adapter);
  const result = await queue.drain(executor);

  logger?.info('Resume drain complete', {
    success: result.success,
    actions_affected: result.actionsAffected,
  });
}

/**
 * Example: Monitor queue health in a long-running process
 */
export async function exampleMonitorQueue(
  runDir: string,
  featureId: string,
  logger?: LoggerInterface,
  metrics?: MetricsCollector
): Promise<void> {
  const queue = createWriteActionQueue({
    runDir,
    featureId,
    provider: 'github',
    ...(logger ? { logger } : {}),
    ...(metrics ? { metrics } : {}),
  });

  await queue.initialize();

  // Periodic monitoring loop
  const monitorInterval = setInterval(() => {
    void (async () => {
      const status = await queue.getStatus();

      logger?.debug('Queue status', {
        backlog: status.pending_count + status.in_progress_count,
        pending: status.pending_count,
        in_progress: status.in_progress_count,
        failed: status.failed_count,
      });

      // Alert on high backlog
      if (status.pending_count > 50) {
        logger?.warn('High queue backlog detected', {
          pending: status.pending_count,
          recommendation: 'Consider increasing concurrency or checking for rate limits',
        });
      }

      // Alert on failures
      if (status.failed_count > 10) {
        logger?.error('Multiple failed actions detected', {
          failed_count: status.failed_count,
          recommendation: 'Review queue logs and clear failed actions',
        });
      }
    })();
  }, 60000); // Every 60 seconds

  // Clean up on exit
  process.on('SIGINT', () => {
    clearInterval(monitorInterval);
    logger?.info('Queue monitoring stopped');
  });
}
