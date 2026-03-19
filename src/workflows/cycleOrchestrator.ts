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
import { serializeError } from '../utils/errors.js';
import type { LinearCycleIssue } from '../adapters/linear/LinearAdapterTypes.js';
import type { IssueSnapshot } from '../adapters/linear/LinearAdapterTypes.js';
import type {
  CycleOrchestratorConfig,
  CycleIssueResult,
  CycleIssueCompleted,
  CycleIssueFailed,
  CycleIssueSkipped,
  CycleResult,
} from './cycleTypes.js';

/**
 * Check if an issue should be skipped based on its workflow state.
 *
 * Skip conditions:
 * - state.type === 'completed' (Done)
 * - state.type === 'canceled' (Cancelled — note American spelling)
 * - state.type === 'started' AND state.name contains 'review' (In Review)
 */
export function shouldSkipIssue(issue: LinearCycleIssue): { skip: boolean; reason?: string } {
  const { type, name } = issue.state;

  if (type === 'completed') {
    return { skip: true, reason: `Already done (state: ${name})` };
  }

  if (type === 'canceled') {
    return { skip: true, reason: `Cancelled (state: ${name})` };
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

    const issuesToProcess = issues.slice(0, maxIssues);

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
        const result: CycleIssueSkipped = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'skipped',
          skipReason: skipCheck.reason ?? 'Unknown reason',
          durationMs: 0,
        };
        results.push(result);
        this.config.onIssueComplete?.(result);

        logger.info('Skipping issue', {
          identifier: issue.identifier,
          reason: skipCheck.reason,
        });
        continue;
      }

      // Process the issue
      try {
        const runDir = await this.processIssue(issue, issuesDir);

        const result: CycleIssueCompleted = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'completed',
          runDir,
          durationMs: Date.now() - issueStartTime,
        };
        results.push(result);
        this.config.onIssueComplete?.(result);

        logger.info('Issue completed', {
          identifier: issue.identifier,
          durationMs: result.durationMs,
        });
      } catch (error) {
        const result: CycleIssueFailed = {
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          status: 'failed',
          durationMs: Date.now() - issueStartTime,
          error: error instanceof Error ? error.message : String(error),
        };
        results.push(result);
        this.config.onIssueComplete?.(result);

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

    const cycleResult: CycleResult = {
      cycleId: this.config.cycleId,
      cycleName: this.config.cycleName,
      startedAt,
      completedAt,
      totalIssues: issues.length,
      processed: results.filter((r) => r.status !== 'skipped').length,
      completed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      issues: results,
      durationMs,
    };

    // Write report.json (best-effort — don't fail the whole cycle for a write error)
    try {
      const reportPath = path.join(this.config.cycleBaseDir, 'report.json');
      await fs.writeFile(reportPath, JSON.stringify(cycleResult, null, 2), 'utf-8');
    } catch (writeError) {
      logger.warn('Failed to write cycle report', {
        error: serializeError(writeError),
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

  private async processIssue(issue: LinearCycleIssue, issuesDir: string): Promise<string> {
    const { logger, metrics, repoConfig } = this.config;

    // Create per-issue run directory
    const runDir = await createRunDirectory(issuesDir, issue.identifier, {
      title: issue.title,
      source: `linear:${issue.identifier}`,
      repoUrl: repoConfig.project.repo_url,
      defaultBranch: repoConfig.project.default_branch,
    });

    // Build a synthetic IssueSnapshot for context formatting
    const snapshot: IssueSnapshot = {
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        priority: issue.priority,
        labels: issue.labels,
        assignee: issue.assignee,
        team: issue.team,
        project: issue.project,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        url: issue.url,
      },
      comments: [],
      metadata: {
        issueId: issue.id,
        retrieved_at: new Date().toISOString(),
        hash: '',
      },
    };

    const linearContextText = this.config.formatContext(snapshot);

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

    return runDir;
  }
}
