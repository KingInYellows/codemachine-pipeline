/**
 * Write Action Queue Reporter for CLI
 *
 * Provides CLI-friendly formatting and status reporting for the write action queue.
 * Integrates with status and observe commands to surface queue metrics.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WriteActionQueueManifest } from '../../workflows/writeActionQueue';

// ============================================================================
// Types
// ============================================================================

/**
 * Queue status report for CLI output
 */
export interface WriteActionQueueReport {
  /** Feature ID */
  featureId: string;
  /** Queue directory path */
  queueDir: string;
  /** Total actions ever enqueued */
  totalActions: number;
  /** Pending actions */
  pendingCount: number;
  /** In-progress actions */
  inProgressCount: number;
  /** Completed actions */
  completedCount: number;
  /** Failed actions */
  failedCount: number;
  /** Skipped actions */
  skippedCount: number;
  /** Concurrency limit */
  concurrencyLimit: number;
  /** Queue backlog (pending + in_progress) */
  backlog: number;
  /** Queue utilization percentage (in_progress / concurrency_limit * 100) */
  utilizationPercent: number;
  /** Whether queue has failures requiring attention */
  hasFailures: boolean;
  /** Whether queue has pending actions */
  hasPending: boolean;
  /** Last updated timestamp */
  updatedAt: string;
  /** Health status */
  health: 'healthy' | 'warning' | 'critical';
  /** Health reasons */
  healthReasons: string[];
}

/**
 * CLI output options
 */
export interface WriteActionQueueCLIOutputOptions {
  /** Whether to show verbose details */
  verbose?: boolean;
  /** Whether to show warnings */
  showWarnings?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const QUEUE_SUBDIR = 'write_actions';
const MANIFEST_FILE = 'manifest.json';

// Health thresholds
const BACKLOG_WARNING_THRESHOLD = 50;
const BACKLOG_CRITICAL_THRESHOLD = 200;
const FAILURE_WARNING_THRESHOLD = 5;
const FAILURE_CRITICAL_THRESHOLD = 20;

// ============================================================================
// Reporter Functions
// ============================================================================

/**
 * Generate write action queue report
 */
export async function generateWriteActionQueueReport(
  runDir: string
): Promise<WriteActionQueueReport | null> {
  const queueDir = path.join(runDir, QUEUE_SUBDIR);
  const manifestPath = path.join(queueDir, MANIFEST_FILE);

  try {
    // Check if queue exists
    await fs.access(queueDir);

    // Load manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as WriteActionQueueManifest;

    // Calculate derived metrics
    const backlog = manifest.pending_count + manifest.in_progress_count;
    const utilizationPercent = manifest.concurrency_limit > 0
      ? Math.round((manifest.in_progress_count / manifest.concurrency_limit) * 100)
      : 0;

    const hasFailures = manifest.failed_count > 0;
    const hasPending = manifest.pending_count > 0;

    // Determine health status
    const { health, reasons } = calculateHealth(manifest, backlog);

    return {
      featureId: manifest.feature_id,
      queueDir,
      totalActions: manifest.total_actions,
      pendingCount: manifest.pending_count,
      inProgressCount: manifest.in_progress_count,
      completedCount: manifest.completed_count,
      failedCount: manifest.failed_count,
      skippedCount: manifest.skipped_count,
      concurrencyLimit: manifest.concurrency_limit,
      backlog,
      utilizationPercent,
      hasFailures,
      hasPending,
      updatedAt: manifest.updated_at,
      health,
      healthReasons: reasons,
    };
  } catch (error) {
    // Queue doesn't exist or is uninitialized
    if (isFileNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Calculate queue health status
 */
function calculateHealth(
  manifest: WriteActionQueueManifest,
  backlog: number
): { health: 'healthy' | 'warning' | 'critical'; reasons: string[] } {
  const reasons: string[] = [];
  let severity = 0;
  const escalate = (level: 1 | 2): void => {
    if (severity < level) {
      severity = level;
    }
  };

  // Check backlog
  if (backlog >= BACKLOG_CRITICAL_THRESHOLD) {
    escalate(2);
    reasons.push(`Critical backlog: ${backlog} actions pending/in-progress (threshold: ${BACKLOG_CRITICAL_THRESHOLD})`);
  } else if (backlog >= BACKLOG_WARNING_THRESHOLD) {
    escalate(1);
    reasons.push(`High backlog: ${backlog} actions pending/in-progress (threshold: ${BACKLOG_WARNING_THRESHOLD})`);
  }

  // Check failures
  if (manifest.failed_count >= FAILURE_CRITICAL_THRESHOLD) {
    escalate(2);
    reasons.push(`Critical failures: ${manifest.failed_count} actions failed (threshold: ${FAILURE_CRITICAL_THRESHOLD})`);
  } else if (manifest.failed_count >= FAILURE_WARNING_THRESHOLD) {
    escalate(1);
    reasons.push(`Multiple failures: ${manifest.failed_count} actions failed (threshold: ${FAILURE_WARNING_THRESHOLD})`);
  }

  // Check utilization
  const utilizationPercent = manifest.concurrency_limit > 0
    ? Math.round((manifest.in_progress_count / manifest.concurrency_limit) * 100)
    : 0;

  if (utilizationPercent >= 100 && manifest.pending_count > 0) {
    escalate(1);
    reasons.push(`Queue at capacity: ${manifest.in_progress_count}/${manifest.concurrency_limit} slots used, ${manifest.pending_count} pending`);
  }

  const health: 'healthy' | 'warning' | 'critical' =
    severity >= 2 ? 'critical' : severity >= 1 ? 'warning' : 'healthy';

  if (health === 'healthy') {
    reasons.push('Queue operating normally');
  }

  return { health, reasons };
}

/**
 * Format queue report as CLI output
 */
export function formatWriteActionQueueCLIOutput(
  report: WriteActionQueueReport | null,
  options: WriteActionQueueCLIOutputOptions = {}
): string[] {
  const lines: string[] = [];
  const { verbose = false, showWarnings = true } = options;

  if (!report) {
    lines.push('Write Action Queue: Not initialized');
    return lines;
  }

  // Header
  lines.push('');
  lines.push(`Write Action Queue (${report.health})`);
  lines.push('');

  // Summary
  lines.push(`Total actions: ${report.totalActions}`);
  lines.push(`Backlog: ${report.backlog} (${report.pendingCount} pending + ${report.inProgressCount} in-progress)`);
  lines.push(`Completed: ${report.completedCount}`);

  if (report.failedCount > 0) {
    lines.push(`⚠ Failed: ${report.failedCount}`);
  }

  if (report.skippedCount > 0 && verbose) {
    lines.push(`Skipped (deduped): ${report.skippedCount}`);
  }

  lines.push('');

  // Concurrency & utilization
  lines.push(`Concurrency: ${report.inProgressCount}/${report.concurrencyLimit} (${report.utilizationPercent}% utilized)`);
  lines.push(`Last updated: ${report.updatedAt}`);
  lines.push('');

  // Health status
  if (showWarnings && report.health !== 'healthy') {
    lines.push('Health Status:');
    for (const reason of report.healthReasons) {
      const icon = report.health === 'critical' ? '⚠⚠' : '⚠';
      lines.push(`  ${icon} ${reason}`);
    }
    lines.push('');
  }

  // Recommendations
  if (showWarnings) {
    const recommendations = generateRecommendations(report);
    if (recommendations.length > 0) {
      lines.push('Recommendations:');
      for (const rec of recommendations) {
        lines.push(`  • ${rec}`);
      }
      lines.push('');
    }
  }

  return lines;
}

/**
 * Generate actionable recommendations based on queue state
 */
function generateRecommendations(report: WriteActionQueueReport): string[] {
  const recommendations: string[] = [];

  // High backlog
  if (report.backlog >= BACKLOG_WARNING_THRESHOLD) {
    recommendations.push('Consider increasing concurrency limit if no rate limits are active');
    recommendations.push('Check rate limit status: ai-feature rate-limits');
    recommendations.push('Drain queue: ai-feature resume (will process pending actions)');
  }

  // Many failures
  if (report.failedCount >= FAILURE_WARNING_THRESHOLD) {
    recommendations.push('Review failed actions in queue logs');
    recommendations.push('Check for auth errors or API permission issues');
    recommendations.push('Clear failed actions after resolving: ai-feature queue clear-failed (if implemented)');
  }

  // Queue at capacity
  if (report.utilizationPercent >= 100 && report.pendingCount > 0) {
    recommendations.push('Queue is at capacity - actions are waiting for slots');
    recommendations.push('Monitor drain progress or increase concurrency limit');
  }

  // Pending with no in-progress
  if (report.pendingCount > 0 && report.inProgressCount === 0) {
    recommendations.push('Pending actions not draining - check for rate limit cooldown');
    recommendations.push('Run: ai-feature rate-limits to inspect cooldown state');
  }

  return recommendations;
}

/**
 * Format queue report as JSON
 */
export function formatWriteActionQueueJSON(
  report: WriteActionQueueReport | null
): Record<string, unknown> {
  if (!report) {
    return {
      initialized: false,
      message: 'Write action queue not initialized',
    };
  }

  return {
    initialized: true,
    feature_id: report.featureId,
    queue_dir: report.queueDir,
    total_actions: report.totalActions,
    pending_count: report.pendingCount,
    in_progress_count: report.inProgressCount,
    completed_count: report.completedCount,
    failed_count: report.failedCount,
    skipped_count: report.skippedCount,
    concurrency_limit: report.concurrencyLimit,
    backlog: report.backlog,
    utilization_percent: report.utilizationPercent,
    has_failures: report.hasFailures,
    has_pending: report.hasPending,
    updated_at: report.updatedAt,
    health: {
      status: report.health,
      reasons: report.healthReasons,
    },
    recommendations: generateRecommendations(report),
  };
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

// ============================================================================
// Standalone Helper Functions
// ============================================================================

/**
 * Export helper for status command integration
 */
export async function getWriteActionQueueStatus(
  runDir: string
): Promise<WriteActionQueueReport | null> {
  return generateWriteActionQueueReport(runDir);
}

/**
 * Export helper for CLI output formatting
 */
export function formatQueueStatusForCLI(
  report: WriteActionQueueReport | null,
  verbose: boolean = false
): string[] {
  return formatWriteActionQueueCLIOutput(report, {
    verbose,
    showWarnings: true,
  });
}

/**
 * Export helper for JSON output
 */
export function formatQueueStatusAsJSON(
  report: WriteActionQueueReport | null
): Record<string, unknown> {
  return formatWriteActionQueueJSON(report);
}
