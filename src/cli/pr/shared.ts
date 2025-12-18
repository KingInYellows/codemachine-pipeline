/**
 * Shared utilities for PR automation commands
 *
 * Implements:
 * - FR-15: PR automation
 * - Section 2: Communication Patterns (PR orchestration)
 * - ADR-3: Integration Layer design
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  getRunDirectoryPath,
  readManifest,
  type RunManifest,
} from '../../persistence/runDirectoryManager';
import { createGitHubAdapter, GitHubAdapter } from '../../adapters/github/GitHubAdapter';
import { createCliLogger, LogLevel, type StructuredLogger } from '../../telemetry/logger';
import type { RepoConfig } from '../../core/config/RepoConfig';

/**
 * Pull request metadata (persisted to pr.json)
 */
export interface PRMetadata {
  pr_number: number;
  url: string;
  branch: string;
  base_branch: string;
  created_at: string;
  reviewers_requested: string[];
  auto_merge_enabled: boolean;
  status_checks?: Array<{
    context: string;
    state: string;
    conclusion: string | null;
  }>;
  merge_ready?: boolean;
  blockers?: string[];
  last_updated: string;
}

/**
 * PR command context loaded from run directory
 */
export interface PRContext {
  runDir: string;
  featureId: string;
  manifest: RunManifest;
  config: RepoConfig;
  prMetadata?: PRMetadata;
  logger: StructuredLogger;
}

/**
 * PR command exit codes
 */
export enum PRExitCode {
  SUCCESS = 0,
  ERROR = 1,
  VALIDATION_ERROR = 10,
  HUMAN_ACTION_REQUIRED = 30,
}

/**
 * Load PR command context from run directory
 *
 * Performs preflight validation:
 * - Run directory exists
 * - Manifest is readable
 * - RepoConfig is valid
 * - GitHub integration is enabled
 *
 * @param baseDir Base runs directory
 * @param featureId Feature ID
 * @param config Repository configuration
 * @param verbose Enable verbose logging
 * @returns PR context
 * @throws Error if validation fails
 */
export async function loadPRContext(
  baseDir: string,
  featureId: string,
  config: RepoConfig,
  verbose = false
): Promise<PRContext> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  // Initialize logger
  const logger = createCliLogger('pr', featureId, runDir, {
    minLevel: verbose ? LogLevel.DEBUG : LogLevel.INFO,
    mirrorToStderr: !process.env.JSON_OUTPUT,
  });

  logger.debug('Loading PR context', { feature_id: featureId, run_dir: runDir });

  // Read manifest
  let manifest: RunManifest;
  try {
    manifest = await readManifest(runDir);
  } catch (error) {
    logger.error('Failed to read manifest', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to read manifest for feature ${featureId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate GitHub integration is enabled
  if (!config.github.enabled) {
    logger.error('GitHub integration disabled', { config_path: '.ai-feature-pipeline/config.json' });
    throw new Error('GitHub integration is disabled. Enable it in .ai-feature-pipeline/config.json');
  }

  // Load existing PR metadata if available
  let prMetadata: PRMetadata | undefined;
  const prJsonPath = path.join(runDir, 'pr.json');
  try {
    const prContent = await fs.readFile(prJsonPath, 'utf-8');
    prMetadata = JSON.parse(prContent) as PRMetadata;
    logger.debug('Loaded existing PR metadata', {
      pr_number: prMetadata.pr_number,
      url: prMetadata.url,
    });
  } catch {
    // pr.json doesn't exist yet - that's ok
    logger.debug('No existing PR metadata found');
  }

  const context: PRContext = {
    runDir,
    featureId,
    manifest,
    config,
    logger,
  };

  if (prMetadata) {
    context.prMetadata = prMetadata;
  }

  return context;
}

/**
 * Create GitHub adapter instance from context
 *
 * @param context PR command context
 * @returns Configured GitHub adapter
 * @throws Error if GitHub token is not available
 */
export function getPRAdapter(context: PRContext): GitHubAdapter {
  const { config, runDir, logger } = context;

  // Get GitHub token from environment
  const token = process.env[config.github.token_env_var];
  if (!token) {
    throw new Error(
      `GitHub token not found. Set ${config.github.token_env_var} environment variable`
    );
  }

  // Extract owner and repo from repo_url
  const repoUrl = config.project.repo_url;
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) {
    throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
  }

  const [, owner, repo] = match;

  logger.debug('Creating GitHub adapter', {
    owner,
    repo,
    base_url: config.github.api_base_url,
  });

  return createGitHubAdapter({
    owner,
    repo,
    token,
    baseUrl: config.github.api_base_url,
    runDir,
    logger,
  });
}

/**
 * Persist PR metadata to pr.json with atomic write
 *
 * @param context PR command context
 * @param prMetadata PR metadata to persist
 */
export async function persistPRData(
  context: PRContext,
  prMetadata: PRMetadata
): Promise<void> {
  const { runDir, logger } = context;
  const prJsonPath = path.join(runDir, 'pr.json');
  const prJsonTempPath = `${prJsonPath}.tmp`;

  logger.debug('Persisting PR metadata', {
    pr_number: prMetadata.pr_number,
    path: prJsonPath,
  });

  try {
    // Write to temp file first (atomic write)
    await fs.writeFile(prJsonTempPath, JSON.stringify(prMetadata, null, 2), 'utf-8');
    await fs.rename(prJsonTempPath, prJsonPath);

    logger.info('PR metadata persisted', {
      pr_number: prMetadata.pr_number,
      path: prJsonPath,
    });

    // Update feature.json external_links if pr_number changed
    const featureJsonPath = path.join(runDir, 'feature.json');
    try {
      const featureContent = await fs.readFile(featureJsonPath, 'utf-8');
      const featureData = JSON.parse(featureContent) as {
        external_links?: { github_pr_number?: number };
      };

      if (featureData.external_links?.github_pr_number !== prMetadata.pr_number) {
        featureData.external_links = {
          ...featureData.external_links,
          github_pr_number: prMetadata.pr_number,
        };

        const featureTempPath = `${featureJsonPath}.tmp`;
        await fs.writeFile(featureTempPath, JSON.stringify(featureData, null, 2), 'utf-8');
        await fs.rename(featureTempPath, featureJsonPath);

        logger.debug('Updated feature.json external_links', {
          pr_number: prMetadata.pr_number,
        });
      }
    } catch (error) {
      // feature.json may not exist yet - log warning but don't fail
      logger.warn('Failed to update feature.json external_links', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    logger.error('Failed to persist PR metadata', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to persist PR metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Render PR output in human or JSON format
 *
 * @param data Output data (must be JSON-serializable)
 * @param jsonMode Whether to render as JSON
 * @returns Formatted output string
 */
export function renderPROutput(data: Record<string, unknown>, jsonMode: boolean): string {
  if (jsonMode) {
    // Stable property ordering for diff-friendly output
    return JSON.stringify(sortKeys(data), null, 2);
  }

  // Human-readable format
  const lines: string[] = [];

  if (isStringOrNumber(data.pr_number)) {
    lines.push(`PR #${String(data.pr_number)}`);
  }

  if (typeof data.url === 'string') {
    lines.push(`URL: ${data.url}`);
  }

  if (typeof data.branch === 'string') {
    lines.push(`Branch: ${data.branch}`);
  }

  if (typeof data.base_branch === 'string') {
    lines.push(`Base: ${data.base_branch}`);
  }

  if (Array.isArray(data.reviewers_requested)) {
    const reviewers = data.reviewers_requested.filter(
      (reviewer): reviewer is string => typeof reviewer === 'string'
    );
    if (reviewers.length > 0) {
      lines.push(`Reviewers: ${reviewers.join(', ')}`);
    } else {
      lines.push('Reviewers: none');
    }
  }

  if (typeof data.merge_ready === 'boolean') {
    lines.push(`Merge ready: ${data.merge_ready ? '✓' : '✗'}`);
  }

  if (Array.isArray(data.blockers)) {
    const blockers = data.blockers.filter(
      (blocker): blocker is string => typeof blocker === 'string'
    );
    if (blockers.length > 0) {
      lines.push('');
      lines.push('Blockers:');
      for (const blocker of blockers) {
        lines.push(`  • ${blocker}`);
      }
    }
  }

  if (Array.isArray(data.status_checks)) {
    lines.push('');
    lines.push(`Status checks (${data.status_checks.length}):`);
    for (const check of data.status_checks) {
      if (!isStatusCheckShape(check)) {
        continue;
      }
      const icon =
        check.conclusion === 'success'
          ? '✓'
          : check.conclusion === 'failure'
            ? '✗'
            : '○';
      lines.push(`  ${icon} ${check.context} (${check.state})`);
    }
  }

  if (typeof data.message === 'string') {
    lines.push('');
    lines.push(data.message);
  }

  return lines.join('\n');
}

/**
 * Sort object keys recursively for stable JSON output
 *
 * @param obj Object to sort
 * @returns Object with sorted keys
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();

  for (const key of keys) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}

/**
 * Check if Code approval gate is completed
 *
 * PR creation requires Code gate approval per governance workflow
 *
 * @param manifest Run manifest
 * @returns true if Code gate is approved
 */
export function isCodeApproved(manifest: RunManifest): boolean {
  return manifest.approvals.completed.includes('code');
}

/**
 * Check if validations have passed
 *
 * PR creation requires validations (lint/test/build) to pass
 *
 * @param runDir Run directory path
 * @returns true if validations passed
 */
export async function hasValidationsPassed(runDir: string): Promise<boolean> {
  const validationPath = path.join(runDir, 'validation.json');

  try {
    const content = await fs.readFile(validationPath, 'utf-8');
    const validation = JSON.parse(content) as { success: boolean };
    return validation.success === true;
  } catch {
    // validation.json doesn't exist or is invalid
    return false;
  }
}

/**
 * Check if branch exists locally
 *
 * @param branchName Branch name
 * @returns true if branch exists
 */
export async function isBranchLocal(branchName: string): Promise<boolean> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  try {
    await execAsync(`git rev-parse --verify ${branchName}`, { cwd: process.cwd() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Log action to deployment.json for audit trail
 *
 * @param context PR command context
 * @param action Action description
 * @param metadata Action metadata
 */
export async function logDeploymentAction(
  context: PRContext,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { runDir, logger } = context;
  const deploymentPath = path.join(runDir, 'deployment.json');

  logger.debug('Logging deployment action', { action, metadata });

  try {
    let deployment: DeploymentLog = {};

    // Load existing deployment.json if it exists
    try {
      const content = await fs.readFile(deploymentPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      if (isDeploymentLog(parsed)) {
        deployment = parsed;
      } else {
        deployment = { actions: [] };
      }
    } catch {
      // deployment.json doesn't exist yet - create new
      deployment = { actions: [] };
    }

    // Append action
    if (!deployment.actions) {
      deployment.actions = [];
    }

    deployment.actions.push({
      timestamp: new Date().toISOString(),
      action,
      metadata,
    });

    // Write atomically
    const tempPath = `${deploymentPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(deployment, null, 2), 'utf-8');
    await fs.rename(tempPath, deploymentPath);

    logger.debug('Deployment action logged', { action });
  } catch (error) {
    logger.warn('Failed to log deployment action', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't fail the command if logging fails
  }
}

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function isStatusCheckShape(
  value: unknown
): value is { context: string; state: string; conclusion: string | null } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybe = value as {
    context?: unknown;
    state?: unknown;
    conclusion?: unknown;
  };

  return (
    typeof maybe.context === 'string' &&
    typeof maybe.state === 'string' &&
    (typeof maybe.conclusion === 'string' || maybe.conclusion === null)
  );
}

type DeploymentLog = {
  actions?: Array<{ timestamp: string; action: string; metadata: Record<string, unknown> }>;
};

function isDeploymentLog(value: unknown): value is DeploymentLog {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybe = value as { actions?: unknown };

  if (maybe.actions === undefined) {
    return true;
  }

  if (!Array.isArray(maybe.actions)) {
    return false;
  }

  return maybe.actions.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const candidate = entry as {
      timestamp?: unknown;
      action?: unknown;
      metadata?: unknown;
    };

    return (
      typeof candidate.timestamp === 'string' &&
      typeof candidate.action === 'string' &&
      (!candidate.metadata || typeof candidate.metadata === 'object')
    );
  });
}
