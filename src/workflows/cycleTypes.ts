/**
 * Cycle Orchestrator Types
 *
 * Shared interfaces for the cycle orchestration workflow.
 */

import type { StructuredLogger } from '../telemetry/logger.js';
import type { MetricsCollector } from '../telemetry/metrics.js';
import type { RepoConfig } from '../core/config/RepoConfig.js';

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
  onIssueComplete?: (result: CycleIssueResult) => void;
}

export interface CycleIssueResult {
  issueId: string;
  identifier: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped';
  skipReason?: string | undefined;
  runDir?: string | undefined;
  durationMs: number;
  error?: string | undefined;
}

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
