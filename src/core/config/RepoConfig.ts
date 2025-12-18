import { z } from 'zod';
import * as fs from 'node:fs';
import {
  DEFAULT_VALIDATION_COMMANDS,
  ValidationCommandConfigSchema,
  type ValidationCommandConfig,
} from '../validation/validationCommandConfig';

/**
 * Enhanced RepoConfig schema with governance and history tracking
 * Implements ADR-2 (State Persistence) and ADR-5 (Approval Workflow)
 *
 * This module provides:
 * - Zod-based schema validation for repository configuration
 * - Governance controls for approval workflows and accountability
 * - Config history tracking for deterministic migrations
 * - Environment variable override support
 * - Type-safe configuration loading and validation
 */

// ============================================================================
// Config History Schema - Tracks schema migrations over time
// ============================================================================

const ConfigHistoryEntrySchema = z.object({
  timestamp: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  changed_by: z.string().min(1, 'Changed by identifier required'),
  change_description: z.string().min(1, 'Change description required'),
  migration_applied: z.boolean().default(false),
  backup_path: z.string().optional(),
});

export type ConfigHistoryEntry = z.infer<typeof ConfigHistoryEntrySchema>;

// ============================================================================
// Governance Schema - Human-in-the-loop controls and accountability
// ============================================================================

const GovernanceSchema = z.object({
  // Approval workflow configuration (ADR-5)
  approval_workflow: z.object({
    require_approval_for_prd: z.boolean().default(true),
    require_approval_for_spec: z.boolean().default(true),
    require_approval_for_plan: z.boolean().default(true),
    require_approval_for_code: z.boolean().default(true),
    require_approval_for_pr: z.boolean().default(true),
    require_approval_for_deploy: z.boolean().default(true),
  }).describe('Gate-by-gate approval requirements per ADR-5'),

  // Accountability tracking
  accountability: z.object({
    record_approver_identity: z.boolean().default(true),
    require_approval_reason: z.boolean().default(false),
    audit_log_retention_days: z.number().int().min(1).max(3650).default(365),
  }).describe('Accountability settings for approval tracking'),

  // Risk containment settings
  risk_controls: z.object({
    prevent_auto_merge: z.boolean().default(true),
    prevent_force_push: z.boolean().default(true),
    require_branch_protection: z.boolean().default(true),
    max_files_per_pr: z.number().int().min(1).max(1000).default(100),
    max_lines_changed_per_pr: z.number().int().min(1).max(50000).default(5000),
  }).describe('Risk containment controls to limit blast radius'),

  // Compliance and notes
  compliance_tags: z.array(z.string()).default([]).describe('Tags for compliance tracking (e.g., SOC2, GDPR)'),
  governance_notes: z.string().optional().describe('Free-form governance documentation'),
});

export type Governance = z.infer<typeof GovernanceSchema>;

// ============================================================================
// Project Metadata Schema
// ============================================================================

const ProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  repo_url: z.string().regex(/^(https?:\/\/|git@)/, 'Invalid repository URL format'),
  default_branch: z.string().default('main'),
  context_paths: z.array(z.string()).default(['src/', 'docs/', 'README.md']),
  project_leads: z.array(z.string()).default([]),
});

export type Project = z.infer<typeof ProjectSchema>;

// ============================================================================
// Integration Toggles - GitHub
// ============================================================================

const GitHubSchema = z.object({
  enabled: z.boolean(),
  token_env_var: z.string().default('GITHUB_TOKEN'),
  api_base_url: z.string().url().default('https://api.github.com'),
  required_scopes: z.array(z.enum(['repo', 'workflow', 'read:org', 'write:org'])).default(['repo', 'workflow']),
  default_reviewers: z.array(z.string()).default([]),
  branch_protection: z.object({
    respect_required_reviews: z.boolean().default(true),
    respect_status_checks: z.boolean().default(true),
  }).optional(),
});

export type GitHub = z.infer<typeof GitHubSchema>;

// ============================================================================
// Integration Toggles - Linear
// ============================================================================

const LinearSchema = z.object({
  enabled: z.boolean(),
  api_key_env_var: z.string().default('LINEAR_API_KEY'),
  team_id: z.string().optional(),
  project_id: z.string().optional(),
  auto_link_issues: z.boolean().default(true),
});

export type Linear = z.infer<typeof LinearSchema>;

// ============================================================================
// Runtime Execution Settings
// ============================================================================

const RuntimeSchema = z.object({
  agent_endpoint: z.string().url().optional(),
  agent_endpoint_env_var: z.string().default('AGENT_ENDPOINT'),
  max_concurrent_tasks: z.number().int().min(1).max(10).default(3),
  timeout_minutes: z.number().int().min(5).max(120).default(30),
  context_token_budget: z.number().int().min(1000).max(100000).default(32000),
  context_cost_budget_usd: z.number().nonnegative().default(5).describe('Maximum USD spend for context summarization'),
  logs_format: z.enum(['ndjson', 'json', 'text']).default('ndjson'),
  run_directory: z.string().default('.ai-feature-pipeline/runs'),
});

export type Runtime = z.infer<typeof RuntimeSchema>;

// ============================================================================
// Runtime Safety Defaults
// ============================================================================

const SafetySchema = z.object({
  redact_secrets: z.boolean().default(true),
  require_approval_for_prd: z.boolean().default(true).describe('DEPRECATED: Use governance.approval_workflow instead'),
  require_approval_for_plan: z.boolean().default(true).describe('DEPRECATED: Use governance.approval_workflow instead'),
  require_approval_for_pr: z.boolean().default(true).describe('DEPRECATED: Use governance.approval_workflow instead'),
  prevent_force_push: z.boolean().default(true).describe('DEPRECATED: Use governance.risk_controls instead'),
  allowed_file_patterns: z.array(z.string()).default(['**/*.ts', '**/*.js', '**/*.md', '**/*.json']),
  blocked_file_patterns: z.array(z.string()).default(['.env', '**/*.key', '**/*.pem', '**/credentials.*']),
});

export type Safety = z.infer<typeof SafetySchema>;

// ============================================================================
// Feature Flags
// ============================================================================

const FeatureFlagsSchema = z.object({
  enable_auto_merge: z.boolean().default(false),
  enable_deployment_triggers: z.boolean().default(false),
  enable_linear_sync: z.boolean().default(false),
  enable_context_summarization: z.boolean().default(true),
  enable_resumability: z.boolean().default(true),
  enable_developer_preview: z.boolean().default(false),
});

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

// ============================================================================
// Validation Settings
// ============================================================================

const ValidationSettingsSchema = z.object({
  commands: z.array(ValidationCommandConfigSchema).min(1),
  template_context: z.record(z.string()).optional(),
});

export type ValidationSettings = z.infer<typeof ValidationSettingsSchema>;

// ============================================================================
// Resource Constraints
// ============================================================================

const ConstraintsSchema = z.object({
  max_file_size_kb: z.number().int().min(100).max(10000).default(1000),
  max_context_files: z.number().int().min(10).max(1000).default(100),
  rate_limits: z.object({
    github_requests_per_hour: z.number().int().default(5000),
    linear_requests_per_minute: z.number().int().default(60),
    agent_requests_per_hour: z.number().int().default(100),
  }).optional(),
});

export type Constraints = z.infer<typeof ConstraintsSchema>;

// ============================================================================
// Main RepoConfig Schema
// ============================================================================

export const RepoConfigSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid schema version format (must be semver)'),
  project: ProjectSchema,
  github: GitHubSchema,
  linear: LinearSchema,
  runtime: RuntimeSchema,
  safety: SafetySchema,
  feature_flags: FeatureFlagsSchema,
  validation: ValidationSettingsSchema.optional(),
  constraints: ConstraintsSchema.optional(),

  // Enhanced governance controls (ADR-5)
  governance: GovernanceSchema.optional().describe('Governance controls for approval workflows and accountability'),

  // Config history tracking for deterministic migrations
  config_history: z.array(ConfigHistoryEntrySchema).default([]).describe('Migration history for schema version tracking'),

  // Deprecated: kept for backward compatibility
  governance_notes: z.string().optional().describe('DEPRECATED: Use governance.governance_notes instead'),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
  suggestion?: string | undefined;
}

export interface ValidationResult {
  success: boolean;
  config?: RepoConfig;
  errors?: ValidationError[];
  warnings?: string[];
}

// ============================================================================
// Configuration Loading and Validation
// ============================================================================

/**
 * Load and validate RepoConfig from file
 * @param configPath Path to config.json file
 * @returns Validation result with parsed config or actionable errors
 */
export function loadRepoConfig(configPath: string): ValidationResult {
  try {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      return {
        success: false,
        errors: [{
          path: 'file',
          message: `Config file not found: ${configPath}`,
          suggestion: 'Run "ai-feature init" to create the configuration file',
        }],
      };
    }

    // Read and parse JSON
    const rawContent = fs.readFileSync(configPath, 'utf-8');
    let rawConfig: unknown;

    try {
      rawConfig = JSON.parse(rawContent);
    } catch (parseError) {
      return {
        success: false,
        errors: [{
          path: 'json',
          message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`,
          suggestion: 'Check for syntax errors (missing commas, quotes, brackets)',
        }],
      };
    }

    // Validate with zod
    const parseResult = RepoConfigSchema.safeParse(rawConfig);

    if (!parseResult.success) {
      const errors: ValidationError[] = parseResult.error.errors.map(err => {
        const path = err.path.join('.');
        const suggestion = generateSuggestion(path, err.message);

        return {
          path: path || 'root',
          message: err.message,
          suggestion,
        };
      });

      return {
        success: false,
        errors,
      };
    }

    // Apply environment overrides
    const config = applyEnvironmentOverrides(parseResult.data);

    // Check environment variables for credentials
    const warnings: string[] = [];

    if (config.github.enabled) {
      const githubToken = process.env[config.github.token_env_var];
      if (!githubToken) {
        warnings.push(
          `GitHub integration enabled but ${config.github.token_env_var} not set. ` +
          `Set ${config.github.token_env_var} with scopes: ${config.github.required_scopes.join(', ')}`
        );
      }
    }

    if (config.linear.enabled) {
      const linearKey = process.env[config.linear.api_key_env_var];
      if (!linearKey) {
        warnings.push(
          `Linear integration enabled but ${config.linear.api_key_env_var} not set`
        );
      }
    }

    if (config.runtime.agent_endpoint) {
      // Agent endpoint specified in config
    } else {
      const agentEndpoint = process.env[config.runtime.agent_endpoint_env_var];
      if (!agentEndpoint) {
        warnings.push(
          `Agent endpoint not configured. Set ${config.runtime.agent_endpoint_env_var} or add runtime.agent_endpoint to config`
        );
      }
    }

    // Check for deprecated fields
    if (config.governance_notes && !config.governance?.governance_notes) {
      warnings.push(
        'Field "governance_notes" is deprecated. Migrate to "governance.governance_notes"'
      );
    }

    const result: ValidationResult = {
      success: true,
      config,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  } catch (error) {
    return {
      success: false,
      errors: [{
        path: 'system',
        message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
    };
  }
}

/**
 * Generate actionable suggestions for validation errors
 * @param path Error path
 * @param message Error message
 * @returns Suggestion string
 */
function generateSuggestion(path: string, message: string): string | undefined {
  if (path.includes('schema_version')) {
    return 'Use semver format: "1.0.0"';
  }

  if (path.includes('repo_url')) {
    return 'Use format: "https://github.com/org/repo.git" or "git@github.com:org/repo.git"';
  }

  if (path.includes('enabled')) {
    return 'Must be boolean: true or false';
  }

  if (path.includes('token_env_var') || path.includes('api_key_env_var')) {
    return 'Specify the environment variable name (e.g., "GITHUB_TOKEN")';
  }

  if (path.includes('api_base_url') || path.includes('agent_endpoint')) {
    return 'Must be a valid URL starting with http:// or https://';
  }

  if (message.includes('required')) {
    return `Add "${path}" field to configuration`;
  }

  return undefined;
}

/**
 * Apply environment variable overrides to config
 * Follows AI_FEATURE_<SECTION>_<FIELD> naming convention
 *
 * Supported overrides:
 * - AI_FEATURE_GITHUB_TOKEN -> github.token_env_var
 * - AI_FEATURE_LINEAR_API_KEY -> linear.api_key_env_var
 * - AI_FEATURE_RUNTIME_AGENT_ENDPOINT -> runtime.agent_endpoint
 * - AI_FEATURE_RUNTIME_MAX_CONCURRENT_TASKS -> runtime.max_concurrent_tasks
 * - AI_FEATURE_RUNTIME_TIMEOUT_MINUTES -> runtime.timeout_minutes
 *
 * @param config Base configuration
 * @returns Config with environment overrides applied
 */
export function applyEnvironmentOverrides(config: RepoConfig): RepoConfig {
  const overridden = { ...config };

  // GitHub overrides
  const githubToken = process.env.AI_FEATURE_GITHUB_TOKEN;
  if (githubToken) {
    overridden.github = { ...overridden.github, token_env_var: 'AI_FEATURE_GITHUB_TOKEN' };
  }

  // Linear overrides
  const linearKey = process.env.AI_FEATURE_LINEAR_API_KEY;
  if (linearKey) {
    overridden.linear = { ...overridden.linear, api_key_env_var: 'AI_FEATURE_LINEAR_API_KEY' };
  }

  // Runtime overrides
  const agentEndpoint = process.env.AI_FEATURE_RUNTIME_AGENT_ENDPOINT;
  if (agentEndpoint) {
    overridden.runtime = { ...overridden.runtime, agent_endpoint: agentEndpoint };
  }

  const maxConcurrentTasks = process.env.AI_FEATURE_RUNTIME_MAX_CONCURRENT_TASKS;
  if (maxConcurrentTasks) {
    const parsed = parseInt(maxConcurrentTasks, 10);
    if (!isNaN(parsed)) {
      overridden.runtime = { ...overridden.runtime, max_concurrent_tasks: parsed };
    }
  }

  const timeoutMinutes = process.env.AI_FEATURE_RUNTIME_TIMEOUT_MINUTES;
  if (timeoutMinutes) {
    const parsed = parseInt(timeoutMinutes, 10);
    if (!isNaN(parsed)) {
      overridden.runtime = { ...overridden.runtime, timeout_minutes: parsed };
    }
  }

  return overridden;
}

/**
 * Create a default RepoConfig template with governance and history tracking
 * @param repoUrl Repository URL
 * @param options Optional creation settings
 * @returns Default config object
 */
function cloneDefaultValidationCommands(): ValidationCommandConfig[] {
  return DEFAULT_VALIDATION_COMMANDS.map((command) => ({
    ...command,
    env: command.env ? { ...command.env } : undefined,
    template_context: command.template_context ? { ...command.template_context } : undefined,
  }));
}

export function createDefaultConfig(
  repoUrl: string,
  options?: { includeGovernance?: boolean; changedBy?: string }
): RepoConfig {
  const { includeGovernance = true, changedBy = 'ai-feature init' } = options || {};

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
      run_directory: '.ai-feature-pipeline/runs',
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
      governance_notes: 'Configure integrations and adjust governance settings according to your organization requirements. See docs/requirements/RepoConfig_schema.md for details.',
    };
  }

  return config;
}

/**
 * Format validation errors for user-friendly display with actionable hints
 * @param errors Array of validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = ['Configuration validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
    if (error.suggestion) {
      lines.push(`    → ${error.suggestion}`);
    }
  }

  lines.push('');
  lines.push('For detailed schema documentation, see:');
  lines.push('  docs/requirements/RepoConfig_schema.md');
  lines.push('  .ai-feature-pipeline/templates/config.example.json');

  return lines.join('\n');
}

/**
 * Add a config history entry (useful for migrations)
 * @param config Current configuration
 * @param entry New history entry
 * @returns Updated configuration
 */
export function addConfigHistoryEntry(
  config: RepoConfig,
  entry: Omit<ConfigHistoryEntry, 'timestamp'>
): RepoConfig {
  return {
    ...config,
    config_history: [
      ...config.config_history,
      {
        ...entry,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
