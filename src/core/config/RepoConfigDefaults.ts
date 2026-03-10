/**
 * RepoConfig Defaults
 *
 * Extracted from RepoConfig.ts: default configuration values and the
 * factory function for generating default configurations.
 */

import {
  DEFAULT_VALIDATION_COMMANDS,
  type ValidationCommandConfig,
} from '../validation/validationCommandConfig';
import type { RepoConfig, ExecutionConfig } from './RepoConfigSchema';

export const DEFAULT_GITHUB_API_VERSION = '2022-11-28';

/**
 * Clone default validation commands to avoid shared mutable state
 */
function cloneDefaultValidationCommands(): ValidationCommandConfig[] {
  return DEFAULT_VALIDATION_COMMANDS.map((command) => ({
    ...command,
    env: command.env ? { ...command.env } : undefined,
    template_context: command.template_context ? { ...command.template_context } : undefined,
  }));
}

/**
 * Create a default RepoConfig template with governance and history tracking
 * @param repoUrl Repository URL
 * @param options Optional settings
 * @returns Default configuration object
 */
export function createDefaultConfig(
  repoUrl: string,
  options?: { includeGovernance?: boolean; changedBy?: string }
): RepoConfig {
  const { includeGovernance = true, changedBy = 'codepipe init' } = options || {};

  // Extract project ID from repo URL
  const projectId = repoUrl.split('/').pop()?.replace('.git', '') || 'unknown-project';

  const config: RepoConfig = {
    schema_version: '1.0.0',
    project: {
      id: projectId,
      repo_url: repoUrl,
      default_branch: 'main',
      context_paths: ['src/', 'docs/', 'README.md'],
      project_leads: [],
    },
    github: {
      enabled: false,
      token_env_var: 'GITHUB_TOKEN',
      api_base_url: 'https://api.github.com',
      api_version: DEFAULT_GITHUB_API_VERSION,
      required_scopes: ['repo', 'workflow'],
      default_reviewers: [],
      branch_protection: {
        respect_required_reviews: true,
        respect_status_checks: true,
      },
    },
    linear: {
      enabled: false,
      api_key_env_var: 'LINEAR_API_KEY',
      auto_link_issues: true,
    },
    runtime: {
      agent_endpoint_env_var: 'AGENT_ENDPOINT',
      max_concurrent_tasks: 3,
      timeout_minutes: 30,
      context_token_budget: 32000,
      context_cost_budget_usd: 5,
      logs_format: 'ndjson',
      run_directory: '.codepipe/runs',
    },
    safety: {
      redact_secrets: true,
      require_approval_for_prd: true,
      require_approval_for_plan: true,
      require_approval_for_pr: true,
      prevent_force_push: true,
      allowed_file_patterns: ['**/*.ts', '**/*.js', '**/*.md', '**/*.json'],
      blocked_file_patterns: ['.env', '**/*.key', '**/*.pem', '**/credentials.*'],
    },
    feature_flags: {
      enable_auto_merge: false,
      enable_deployment_triggers: false,
      enable_linear_sync: false,
      enable_context_summarization: true,
      enable_resumability: true,
      enable_developer_preview: false,
    },
    validation: {
      commands: cloneDefaultValidationCommands(),
    },
    constraints: {
      max_file_size_kb: 1000,
      max_context_files: 100,
      rate_limits: {
        github_requests_per_hour: 5000,
        linear_requests_per_minute: 60,
        agent_requests_per_hour: 100,
      },
    },
    execution: {
      codemachine_cli_path: 'codemachine',
      default_engine: 'claude',
      task_timeout_ms: 1800000,
      max_parallel_tasks: 1,
      max_log_buffer_size: 10 * 1024 * 1024,
      env_allowlist: [],
      max_retries: 3,
      retry_backoff_ms: 5000,
      log_rotation_mb: 100,
      log_rotation_keep: 3,
      log_rotation_compress: false,
      env_credential_keys: [],
    },
    config_history: [
      {
        timestamp: new Date().toISOString(),
        schema_version: '1.0.0',
        changed_by: changedBy,
        change_description: 'Initial configuration created',
        migration_applied: false,
      },
    ],
  };

  // Add governance structure if requested
  if (includeGovernance) {
    config.governance = {
      approval_workflow: {
        require_approval_for_prd: true,
        require_approval_for_spec: true,
        require_approval_for_plan: true,
        require_approval_for_code: true,
        require_approval_for_pr: true,
        require_approval_for_deploy: true,
      },
      accountability: {
        record_approver_identity: true,
        require_approval_reason: false,
        audit_log_retention_days: 365,
      },
      risk_controls: {
        prevent_auto_merge: true,
        prevent_force_push: true,
        require_branch_protection: true,
        max_files_per_pr: 100,
        max_lines_changed_per_pr: 5000,
      },
      compliance_tags: [],
      governance_notes:
        'Configure integrations and adjust governance settings according to your organization requirements. See docs/reference/config/RepoConfig_schema.md for details.',
    };
  }

  return config;
}

/**
 * Default execution configuration values.
 * Used as fallback when repo config does not specify execution settings.
 */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  task_timeout_ms: 1800000,
  max_parallel_tasks: 1,
  max_retries: 3,
  retry_backoff_ms: 5000,
  codemachine_cli_path: 'codemachine',
  default_engine: 'claude',
  max_log_buffer_size: 10 * 1024 * 1024,
  env_allowlist: [],
  log_rotation_mb: 100,
  log_rotation_keep: 3,
  log_rotation_compress: false,
  env_credential_keys: [],
};
