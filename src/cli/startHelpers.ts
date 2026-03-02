/**
 * Start Command Helpers
 *
 * Extracted from start.ts: pure utility functions and Linear integration
 * helpers used by the Start CLI command.
 */

import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { StructuredLogger } from '../telemetry/logger';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { IssueSnapshot } from '../adapters/linear/LinearAdapter';
import { loadLinearIssue } from '../workflows/linearIssueLoader.js';
import { CliError, CliErrorCode, formatErrorMessage } from './utils/cliErrors';
import { getErrorMessage } from '../utils/errors.js';

export type StartFlags = {
  prompt?: string;
  linear?: string;
  spec?: string;
  json: boolean;
  'dry-run': boolean;
  'max-parallel'?: number;
  'skip-execution': boolean;
};

export function resolveFeatureTitle(flags: StartFlags): string {
  if (flags.prompt) {
    return flags.prompt.slice(0, 80);
  }

  if (flags.linear) {
    return `Feature from Linear issue ${flags.linear}`;
  }

  if (flags.spec) {
    return `Feature from spec ${path.basename(flags.spec)}`;
  }

  return 'New Feature';
}

export function resolveSourceDescriptor(flags: StartFlags): string {
  if (flags.prompt) {
    return 'prompt';
  }
  if (flags.linear) {
    return `linear:${flags.linear}`;
  }
  if (flags.spec) {
    return `spec:${flags.spec}`;
  }
  return 'unknown';
}

export function generateFeatureId(): string {
  return `FEAT-${randomUUID().split('-')[0]}`;
}

export function findGitRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new CliError(
      `Failed to determine git repository root: ${formatErrorMessage(error)}`,
      CliErrorCode.GIT_NOT_REPO,
      {
        remediation: 'Ensure you are running inside a git repository.',
        howToFix: 'Run "git init" to initialize a repository, or cd into an existing repo.',
        commonFixes: [
          'Run the command from within a git repository',
          'Initialize a new repo with "git init"',
          'Check that .git directory exists in parent directories',
        ],
        ...(error instanceof Error && { cause: error }),
      }
    );
  }
}

/**
 * Get the git user email from the local git config.
 *
 * Returns 'unknown' if the git config is unavailable.
 * Previously a private method in approve.ts — extracted here so it can be
 * reused by any command that needs the current git user identity.
 */
export function getGitUser(): string {
  try {
    const email = execSync('git config user.email', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return email || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function prdApprovalRequired(config: RepoConfig): boolean {
  if (config.governance?.approval_workflow) {
    return config.governance.approval_workflow.require_approval_for_prd;
  }
  return config.safety.require_approval_for_prd;
}

export async function fetchLinearIssue(
  issueId: string,
  runDir: string,
  logger: StructuredLogger
): Promise<IssueSnapshot> {
  logger.info('Fetching Linear issue snapshot', { issueId });

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new CliError(
      'LINEAR_API_KEY environment variable is required when using --linear flag',
      CliErrorCode.TOKEN_MISSING,
      {
        remediation: 'Set the LINEAR_API_KEY environment variable.',
        howToFix: 'Export your Linear API key: export LINEAR_API_KEY="lin_api_..."',
        commonFixes: [
          'Create a Linear API key at https://linear.app/settings/api',
          'Add LINEAR_API_KEY to your .env or shell profile',
        ],
      }
    );
  }

  try {
    return await loadLinearIssue(
      issueId,
      runDir,
      logger,
      apiKey,
      process.env.LINEAR_ENABLE_PREVIEW === 'true'
    );
  } catch (error) {
    logger.error('Failed to fetch Linear issue', {
      issueId,
      error: getErrorMessage(error),
    });
    throw new CliError(
      `Failed to fetch Linear issue ${issueId}: ${getErrorMessage(error)}`,
      CliErrorCode.LINEAR_API_FAILED,
      {
        remediation: 'Check your LINEAR_API_KEY and network connectivity.',
        howToFix: 'Verify the issue ID exists and your API key has read access.',
        commonFixes: [
          'Verify the Linear issue ID is correct',
          'Check that LINEAR_API_KEY has not expired',
          'Ensure network connectivity to api.linear.app',
        ],
        ...(error instanceof Error && { cause: error }),
      }
    );
  }
}

export function formatPriority(priority: number): string {
  const priorityMap: Record<number, string> = {
    0: 'No priority',
    1: 'Low',
    2: 'Medium',
    3: 'High',
    4: 'Urgent',
  };
  return priorityMap[priority] || `Priority ${priority}`;
}

export function formatLinearContext(snapshot: IssueSnapshot): string {
  const { issue, comments } = snapshot;
  const parts: string[] = [];

  parts.push('# Linear Issue Context');
  parts.push('');
  parts.push(`**Issue**: ${issue.identifier} - ${issue.title}`);
  parts.push(`**URL**: ${issue.url}`);
  parts.push(`**State**: ${issue.state.name} (${issue.state.type})`);
  parts.push(`**Priority**: ${formatPriority(issue.priority)}`);

  if (issue.assignee) {
    parts.push(`**Assignee**: ${issue.assignee.name} (${issue.assignee.email})`);
  }

  if (issue.team) {
    parts.push(`**Team**: ${issue.team.name} (${issue.team.key})`);
  }

  if (issue.project) {
    parts.push(`**Project**: ${issue.project.name}`);
  }

  if (issue.labels.length > 0) {
    parts.push(`**Labels**: ${issue.labels.map((l) => l.name).join(', ')}`);
  }

  parts.push('');
  parts.push('## Description');
  parts.push('');
  parts.push(issue.description || '_No description provided_');

  if (comments.length > 0) {
    parts.push('');
    parts.push('## Comments');
    parts.push('');

    for (const comment of comments) {
      parts.push(`### ${comment.user.name} - ${new Date(comment.createdAt).toLocaleDateString()}`);
      parts.push('');
      parts.push(comment.body);
      parts.push('');
    }
  }

  parts.push('');
  parts.push('---');
  parts.push(`_Snapshot retrieved at: ${snapshot.metadata.retrieved_at}_`);

  if (snapshot.metadata.last_error) {
    parts.push(`_Note: Using cached snapshot due to API unavailability_`);
  }

  return parts.join('\n');
}
