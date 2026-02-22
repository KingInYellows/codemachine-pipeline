/**
 * Deployment Trigger Types
 *
 * Type definitions, interfaces, and Zod schemas for the deployment trigger module.
 * Extracted from deploymentTrigger.ts for module size management.
 */

import { z } from 'zod';
import type { BranchProtectionReport } from './branchProtectionReporter';
import type { PRMetadata } from '../core/models/index.js';
import type { LoggerInterface } from '../telemetry/logger';
import type { RunManifest } from '../persistence/runDirectoryManager';

// ============================================================================
// Constants
// ============================================================================

export const DEPLOYMENT_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Deployment strategy options
 */
export enum DeploymentStrategy {
  /** Enable auto-merge and let GitHub handle the merge */
  AUTO_MERGE = 'AUTO_MERGE',
  /** Merge PR directly via API */
  MANUAL_MERGE = 'MANUAL_MERGE',
  /** Trigger GitHub Actions workflow dispatch */
  WORKFLOW_DISPATCH = 'WORKFLOW_DISPATCH',
  /** Deployment blocked due to unmet requirements */
  BLOCKED = 'BLOCKED',
}

/**
 * Blocker information
 */
export interface Blocker {
  /** Blocker type for categorization */
  type:
    | 'status_checks'
    | 'reviews'
    | 'branch_stale'
    | 'conflicts'
    | 'draft'
    | 'closed'
    | 'config'
    | 'protection'
    | 'approvals';
  /** Human-readable blocker message */
  message: string;
  /** Recommended action to resolve blocker */
  recommended_action: string;
  /** Intentional: blocker metadata varies by blocker type (config, protection, approvals, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * Merge readiness assessment result
 */
export interface MergeReadiness {
  /** Whether PR is ready to merge */
  eligible: boolean;
  /** List of blockers preventing merge */
  blockers: Blocker[];
  /** Additional context about readiness state */
  context: {
    pr_state: string;
    mergeable: boolean | null;
    mergeable_state: string | null;
    checks_passing: boolean;
    reviews_satisfied: boolean;
    branch_up_to_date: boolean;
    pending_approvals: string[];
    deploy_approval_required: boolean;
    deploy_approval_granted: boolean;
  };
}

/**
 * Deployment configuration from RepoConfig
 */
export interface WorkflowDispatchConfig {
  /** Workflow ID or filename */
  workflow_id: string;
  /** Workflow inputs */
  inputs?: Record<string, string>;
}

/**
 * Deployment configuration from RepoConfig
 */
export interface DeploymentConfig {
  /** Whether auto-merge is enabled */
  enable_auto_merge: boolean;
  /** Whether deployment triggers are enabled */
  enable_deployment_triggers: boolean;
  /** Workflow dispatch configuration */
  workflow_dispatch?: WorkflowDispatchConfig;
  /** Merge method preference */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** Whether to respect branch protection rules */
  respect_branch_protection: boolean;
  /** Prevent auto-merge even if eligible */
  prevent_auto_merge: boolean;
  /** Whether deploy approval gate is required */
  require_deploy_approval: boolean;
}

/**
 * Approval status snapshot
 */
export interface ApprovalState {
  /** Pending approval gate identifiers */
  pending: string[];
  /** Completed approval gate identifiers */
  completed: string[];
  /** Whether deploy approval gate is required by governance */
  deployApprovalRequired: boolean;
  /** Whether deploy approval is granted */
  deployApprovalGranted: boolean;
  /** Hash of approvals index for audit */
  approvalsHash?: string;
}

/**
 * Deployment context - all inputs needed for deployment orchestration
 */
export interface DeploymentContext {
  /** Pull request metadata */
  pr: PRMetadata;
  /** Branch protection compliance report */
  branchProtection: BranchProtectionReport | null;
  /** Hash of branch protection report for audit trail */
  branchProtectionHash?: string;
  /** Deployment configuration */
  config: DeploymentConfig;
  /** Run manifest loaded from run directory */
  manifest: RunManifest;
  /** Approval status snapshot */
  approvals: ApprovalState;
  /** Run directory path */
  runDirectory: string;
  /** Feature ID */
  featureId: string;
  /** Logger instance */
  logger: LoggerInterface;
}

/**
 * Deployment outcome schema for persistence
 */
export const DeploymentOutcomeSchema = z.object({
  schema_version: z.string().default('1.0.0'),
  feature_id: z.string(),
  timestamp: z.string(),
  strategy: z.nativeEnum(DeploymentStrategy),
  action: z.enum(['auto-merge', 'merge', 'workflow-dispatch', 'none']),
  success: z.boolean(),
  pr_number: z.number(),
  head_sha: z.string().optional(),
  base_sha: z.string().optional(),
  merge_sha: z.string().optional(),
  workflow_run_id: z.string().optional(),
  workflow_url: z.string().optional(),
  github_response: z.record(z.string(), z.unknown()).optional(),
  blockers: z.array(
    z.object({
      type: z.string(),
      message: z.string(),
      recommended_action: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  metadata: z.object({
    approvals_hash: z.string().optional(),
    protection_report_hash: z.string().optional(),
    pr_url: z.string().optional(),
    checks_passing: z.boolean(),
    reviews_satisfied: z.boolean(),
    branch_up_to_date: z.boolean(),
    pending_approvals: z.array(z.string()).optional(),
    deploy_approval_granted: z.boolean().optional(),
    deploy_approval_required: z.boolean().optional(),
  }),
  error: z
    .object({
      message: z.string(),
      type: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
});

export type DeploymentOutcome = z.infer<typeof DeploymentOutcomeSchema>;

/**
 * Deployment history - tracks all deployment attempts for a feature
 */
export const DeploymentHistorySchema = z.object({
  schema_version: z.string().default('1.0.0'),
  feature_id: z.string(),
  outcomes: z.array(DeploymentOutcomeSchema),
  last_updated: z.string(),
});

export type DeploymentHistory = z.infer<typeof DeploymentHistorySchema>;

/**
 * Options for deployment trigger
 */
export interface DeploymentOptions {
  /** Force deployment even if blockers exist (admin override) */
  force?: boolean;
  /** Dry run - assess readiness but don't execute */
  dry_run?: boolean;
  /** Custom merge method */
  merge_method?: 'merge' | 'squash' | 'rebase';
  /** Custom workflow dispatch inputs */
  workflow_inputs?: Record<string, string>;
}
