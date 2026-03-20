/**
 * Cycle Orchestrator Types
 *
 * Shared interfaces for the cycle orchestration workflow.
 */

import type { StructuredLogger } from '../telemetry/logger.js';
import type { MetricsCollector } from '../telemetry/metrics.js';
import type { RepoConfig } from '../core/config/RepoConfig.js';
import type { IssueSnapshot } from '../adapters/linear/LinearAdapterTypes.js';

export interface CycleOrchestratorConfig {
  repoRoot: string;
  cycleBaseDir: string;
  cycleId: string;
  cycleName: string;
  repoConfig: RepoConfig;
  logger: StructuredLogger;
  metrics: MetricsCollector;
  failFast: boolean;
  planOnly: boolean;
  maxIssues: number;
  /** Format an IssueSnapshot into context text for the pipeline. Injected by CLI layer. */
  formatContext: (snapshot: IssueSnapshot) => string;
  onIssueComplete?: (result: CycleIssueResult) => void;
}

interface CycleIssueResultBase {
  issueId: string;
  identifier: string;
  title: string;
  durationMs: number;
}

export interface CycleIssueCompleted extends CycleIssueResultBase {
  status: 'completed';
  runDir: string;
}

export interface CycleIssueFailed extends CycleIssueResultBase {
  status: 'failed';
  error: string;
}

export interface CycleIssueSkipped extends CycleIssueResultBase {
  status: 'skipped';
  skipReason: string;
}

export type CycleIssueResult = CycleIssueCompleted | CycleIssueFailed | CycleIssueSkipped;

export interface CycleResult {
  cycleId: string;
  cycleName: string;
  startedAt: string;
  completedAt: string;
  totalIssues: number;
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  issues: CycleIssueResult[];
  durationMs: number;
}
