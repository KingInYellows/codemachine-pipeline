/**
 * Cycle Orchestrator
 *
 * Runs each issue in a cycle sequentially through the PipelineOrchestrator.
 * Supports skip logic for terminal/in-review states, fail-fast mode,
 * plan-only mode, and progress callbacks.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createExecutionTelemetry } from '../telemetry/executionTelemetry.js';
import { createRunDirectory } from '../persistence/runLifecycle.js';
import { PipelineOrchestrator } from './pipelineOrchestrator.js';
import { formatLinearContext } from '../cli/startHelpers.js';
import { serializeError } from '../utils/errors.js';
import type { IssueSnapshot, LinearCycleIssue } from '../adapters/linear/LinearAdapterTypes.js';
import type {
  CycleOrchestratorConfig,
  CycleIssueResult,
  CycleResult,
} from './cycleTypes.js';

/**
 * Check if an issue should be skipped based on its workflow state.
 *
 * Skip conditions:
 * - state.type === 'completed' (Done)
 * - state.type === 'canceled' (Canceled)
 * - state.type === 'started' AND state.name contains 'review' (In Review)
 */
export function shouldSkipIssue(issue: LinearCycleIssue): { skip: boolean; reason?: string } {
  const { type, name } = issue.state;

  if (type === 'completed') {
    return { skip: true, reason: `Already done (state: ${name})` };
  }

  if (type === 'canceled') {
    return { skip: true, reason: `Canceled (state: ${name})` };
  }

  if (type === 'started' && name.toLowerCase().includes('review')) {
    return { skip: true, reason: `In review (state: ${name})` };
  }

  return { skip: false };
}

export class CycleOrchestrator {
  private readonly config: CycleOrchestratorConfig;

  constructor(config: CycleOrchestratorConfig) {
    this.config = config;
  }

  async run(issues: LinearCycleIssue[]): Promise<CycleResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const results: CycleIssueResult[] = [];
    const { logger, maxIssues } = this.config;

    const issuesToProcess = issues.slice(0, Math.max(0, maxIssues));
    const notifyIssueComplete = (result: CycleIssueResult): void => {
      try {
        this.config.onIssueComplete?.(result);
      } catch (error) {
        logger.warn('Issue completion callback failed', {
          identifier: result.identifier,
          error: serializeError(error),
        });
      }
    };

    logger.info('Cycle orchestrator starting', {
      cycleId: this.config.cycleId,
      cycleName: this.config.cycleName,
      totalIssues: issues.length,
      processing: issuesToProcess.length,
      failFast: this.config.failFast,
      planOnly: this.config.planOnly,
    });

    // Create cycle issues directory
    const issuesDir = path.join(this.config.cycleBaseDir, 'issues');
    await fs.mkdir(issuesDir, { recursive: true });

    for (const issue of issuesToProcess) {
      const issueStartTime = Date.now();

      // Check skip logic
      const skipCheck = shouldSkipIssue(issue);
      if (skipCheck.skip) {
        const result: CycleIssueResult = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'skipped',
          skipReason: skipCheck.reason,
          durationMs: 0,
        };
        results.push(result);
        notifyIssueComplete(result);

        logger.info('Skipping issue', {
          identifier: issue.identifier,
          reason: skipCheck.reason,
        });
        continue;
      }

      // Process the issue
      let runDir: string | undefined;
      try {
        runDir = await this.createIssueRunDirectory(issue, issuesDir);
        await this.processIssue(issue, runDir);

        const result: CycleIssueResult = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'completed',
          runDir,
          durationMs: Date.now() - issueStartTime,
        };
        results.push(result);
        notifyIssueComplete(result);

        logger.info('Issue completed', {
          identifier: issue.identifier,
          durationMs: result.durationMs,
        });
      } catch (error) {
        const result: CycleIssueResult = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'failed',
          runDir,
          durationMs: Date.now() - issueStartTime,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(result);
        notifyIssueComplete(result);

        logger.error('Issue failed', {
          identifier: issue.identifier,
          error: serializeError(error),
        });

        if (this.config.failFast) {
          logger.warn('Fail-fast enabled, stopping cycle execution');
          break;
        }
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    const stats = results.reduce(
      (acc, result) => {
        if (result.status === 'completed') {
          acc.completed += 1;
          acc.processed += 1;
        } else if (result.status === 'failed') {
          acc.failed += 1;
          acc.processed += 1;
        } else {
          acc.skipped += 1;
        }

        return acc;
      },
      { processed: 0, completed: 0, failed: 0, skipped: 0 }
    );

    const cycleResult: CycleResult = {
      cycleId: this.config.cycleId,
      cycleName: this.config.cycleName,
      startedAt,
      completedAt,
      cycleIssueCount: issues.length,
      totalIssues: results.length,
      processed: stats.processed,
      completed: stats.completed,
      failed: stats.failed,
      skipped: stats.skipped,
      issues: results,
      durationMs,
    };

    // Write report.json
    const reportPath = path.join(this.config.cycleBaseDir, 'report.json');
    try {
      await fs.writeFile(reportPath, JSON.stringify(cycleResult, null, 2), 'utf-8');
    } catch (error) {
      logger.warn('Failed to write cycle report.json', {
        reportPath,
        error: serializeError(error),
      });
    }

    logger.info('Cycle orchestrator finished', {
      cycleId: this.config.cycleId,
      completed: cycleResult.completed,
      failed: cycleResult.failed,
      skipped: cycleResult.skipped,
      durationMs,
    });

    return cycleResult;
  }

  private async createIssueRunDirectory(issue: LinearCycleIssue, issuesDir: string): Promise<string> {
    const { repoConfig } = this.config;

    return createRunDirectory(issuesDir, issue.identifier, {
      title: issue.title,
      source: `linear:${issue.identifier}`,
      repoUrl: repoConfig.project.repo_url,
      defaultBranch: repoConfig.project.default_branch,
    });
  }

  private async processIssue(issue: LinearCycleIssue, runDir: string): Promise<void> {
    const { logger, metrics, repoConfig } = this.config;

    // Build a synthetic IssueSnapshot for formatLinearContext
    const snapshot: IssueSnapshot = {
      issue,
      comments: [],
      metadata: {
        issueId: issue.id,
        retrieved_at: new Date().toISOString(),
        hash: '',
      },
    };

    const linearContextText = formatLinearContext(snapshot);

    // Create per-issue telemetry
    const executionTelemetry = createExecutionTelemetry({
      logger,
      metrics,
      runDir,
      runId: issue.identifier,
      component: 'cycle_orchestrator',
    });

    // Create pipeline orchestrator for this issue
    const pipeline = new PipelineOrchestrator({
      repoRoot: this.config.repoRoot,
      runDir,
      featureId: issue.identifier,
      featureTitle: issue.title,
      featureSource: `linear:${issue.identifier}`,
      repoConfig,
      logger,
      metrics,
      telemetry: executionTelemetry,
    });

    // Execute pipeline
    await pipeline.execute({
      linearContextText,
      skipExecution: this.config.planOnly,
      maxParallel: 1,
    });
  }
}
