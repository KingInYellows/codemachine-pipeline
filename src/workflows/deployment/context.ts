/**
 * Deployment Trigger Context
 *
 * Data I/O layer for the deployment trigger module.
 * Handles loading deployment context from run directory artifacts
 * and persisting deployment outcomes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { BranchProtectionReport } from '../branchProtectionReporter';
import { loadReport as loadBranchProtectionReport } from '../../persistence/branchProtectionStore';
import type { RepoConfig } from '../../core/config/RepoConfig';
import type { PRMetadata } from '../../core/models/index.js';
import { PRMetadataSchema } from '../../core/models/prMetadata.js';
import { validateOrThrow } from '../../validation/helpers.js';
import type { LoggerInterface } from '../../telemetry/logger';
import { withLock } from '../../persistence/lockManager';
import { readManifest, type RunManifest } from '../../persistence/manifestManager';
import { computeContentHash } from '../approvalRegistry';
import { getErrorMessage } from '../../utils/errors.js';

import {
  DEPLOYMENT_SCHEMA_VERSION,
  DeploymentOutcomeSchema,
  DeploymentHistorySchema,
  type WorkflowDispatchConfig,
  type DeploymentConfig,
  type ApprovalState,
  type DeploymentContext,
  type DeploymentOutcome,
  type DeploymentHistory,
} from './types';

// Constants

const DEPLOYMENT_FILE = 'deployment.json';
const APPROVALS_FILE = path.join('approvals', 'approvals.json');

// Data Loading Layer

/**
 * Load deployment context from run directory artifacts
 *
 * Reads and validates:
 * - pr.json (required)
 * - status/branch_protection.json (optional, may not exist for unprotected branches)
 * - RepoConfig deployment settings
 *
 * @param runDirectory Run directory path
 * @param featureId Feature ID
 * @param config Repository configuration
 * @param logger Logger instance
 * @returns Deployment context
 * @throws Error if required artifacts are missing or invalid
 */
export async function loadDeploymentContext(
  runDirectory: string,
  featureId: string,
  config: RepoConfig,
  logger: LoggerInterface
): Promise<DeploymentContext> {
  logger.debug('Loading deployment context', { feature_id: featureId, run_dir: runDirectory });

  // Load manifest for approvals and audit context
  let manifest: RunManifest;
  try {
    manifest = await readManifest(runDirectory);
    logger.debug('Loaded run manifest', {
      approvals_pending: manifest.approvals.pending.length,
      approvals_completed: manifest.approvals.completed.length,
    });
  } catch (error) {
    logger.error('Failed to load run manifest', {
      path: path.join(runDirectory, 'manifest.json'),
      error: getErrorMessage(error),
    });
    throw new Error(
      `Run manifest not found. Ensure the feature run directory exists and is initialized (run directory: ${runDirectory})`,
      { cause: error }
    );
  }

  // Load PR metadata (required)
  const prJsonPath = path.join(runDirectory, 'pr.json');
  let pr: PRMetadata;
  try {
    const prContent = await fs.readFile(prJsonPath, 'utf-8');
    pr = validateOrThrow(PRMetadataSchema, JSON.parse(prContent), 'pr metadata') as PRMetadata;
    logger.debug('Loaded PR metadata', { pr_number: pr.pr_number, branch: pr.branch });
  } catch (error) {
    logger.error('Failed to load pr.json', {
      path: prJsonPath,
      error: getErrorMessage(error),
    });
    // Check if file exists to give a better error message
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      throw new Error(
        `PR metadata not found. Ensure PR has been created first (run directory: ${runDirectory})`,
        { cause: error }
      );
    } else {
      throw new Error(
        `PR metadata is invalid or corrupted. ${getErrorMessage(error)} (run directory: ${runDirectory})`,
        { cause: error }
      );
    }
  }

  // Load branch protection report (optional - may not exist for unprotected branches)
  let branchProtection: BranchProtectionReport | null = null;
  try {
    branchProtection = await loadBranchProtectionReport(runDirectory);
    if (branchProtection) {
      logger.debug('Loaded branch protection report', {
        protected: branchProtection.protected,
        compliant: branchProtection.compliant,
        blockers: branchProtection.blockers.length,
      });
    }
  } catch (error) {
    logger.warn('Branch protection report not found or invalid', {
      error: getErrorMessage(error),
    });
  }
  const branchProtectionHash = branchProtection
    ? computeContentHash(JSON.stringify(branchProtection))
    : undefined;

  // Extract deployment configuration from RepoConfig
  const deploymentSection = (
    config as RepoConfig & {
      deployment?: {
        workflow_dispatch?: WorkflowDispatchConfig;
      };
    }
  ).deployment;
  const deploymentConfig: DeploymentConfig = {
    enable_auto_merge: config.feature_flags?.enable_auto_merge ?? false,
    enable_deployment_triggers: config.feature_flags?.enable_deployment_triggers ?? false,
    merge_method: 'merge', // Default, can be overridden
    respect_branch_protection: config.github.branch_protection?.respect_status_checks ?? true,
    prevent_auto_merge: config.governance?.risk_controls?.prevent_auto_merge ?? true,
    require_deploy_approval:
      config.governance?.approval_workflow?.require_approval_for_deploy ?? true,
  };
  if (deploymentSection?.workflow_dispatch) {
    deploymentConfig.workflow_dispatch = deploymentSection.workflow_dispatch;
  }

  const approvalsHash = await computeApprovalsHash(runDirectory, logger);
  const deployApprovalRequired = deploymentConfig.require_deploy_approval;
  const deployApprovalGranted =
    !deployApprovalRequired || manifest.approvals.completed.includes('deploy');

  logger.debug('Deployment configuration loaded', { ...deploymentConfig });

  const approvalsState: ApprovalState = {
    pending: manifest.approvals.pending,
    completed: manifest.approvals.completed,
    deployApprovalRequired,
    deployApprovalGranted,
  };
  if (approvalsHash) {
    approvalsState.approvalsHash = approvalsHash;
  }

  const context: DeploymentContext = {
    pr,
    branchProtection,
    config: deploymentConfig,
    manifest,
    approvals: approvalsState,
    runDirectory,
    featureId,
    logger,
  };

  if (branchProtectionHash) {
    context.branchProtectionHash = branchProtectionHash;
  }

  return context;
}

async function computeApprovalsHash(
  runDirectory: string,
  logger: LoggerInterface
): Promise<string | undefined> {
  const approvalsPath = path.join(runDirectory, APPROVALS_FILE);

  try {
    const content = await fs.readFile(approvalsPath, 'utf-8');
    return computeContentHash(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to compute approvals hash', {
        path: approvalsPath,
        error: getErrorMessage(error),
      });
    }
    return undefined;
  }
}

// State Persistence

/**
 * Persist deployment outcome to deployment.json
 *
 * Appends outcome to deployment history for audit trail.
 * Supports multiple deployment attempts (e.g., blocked -> resolved -> success).
 * Uses file locking to prevent race conditions during concurrent deployments.
 *
 * @param outcome Deployment outcome
 * @param runDirectory Run directory path
 */
export async function persistDeploymentOutcome(
  outcome: DeploymentOutcome,
  runDirectory: string
): Promise<void> {
  await withLock(runDirectory, async () => {
    const deploymentPath = path.join(runDirectory, DEPLOYMENT_FILE);
    // Use unpredictable temp file path to prevent symlink attacks
    const tempPath = `${deploymentPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

    try {
      // Load existing deployment history if it exists
      let history: DeploymentHistory;
      try {
        const content = await fs.readFile(deploymentPath, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        history = DeploymentHistorySchema.parse(parsed);
      } catch {
        // deployment.json doesn't exist or is invalid - create new
        history = {
          schema_version: DEPLOYMENT_SCHEMA_VERSION,
          feature_id: outcome.feature_id,
          outcomes: [],
          last_updated: new Date().toISOString(),
        };
      }

      // Validate outcome
      const validatedOutcome = DeploymentOutcomeSchema.parse(outcome);

      // Append outcome to history
      history.outcomes.push(validatedOutcome);
      history.last_updated = new Date().toISOString();

      // Write atomically with fsync for durability
      const handle = await fs.open(tempPath, 'w');
      try {
        await handle.writeFile(JSON.stringify(history, null, 2), 'utf-8');
        await handle.sync(); // Ensure data is on disk before rename
      } finally {
        await handle.close();
      }

      await fs.rename(tempPath, deploymentPath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  });
}
