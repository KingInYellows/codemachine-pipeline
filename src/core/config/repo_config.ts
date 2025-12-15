import { z } from 'zod';
import * as fs from 'node:fs';

/**
 * Zod schema for RepoConfig validation
 * Implements FR-1 and FR-17 requirements for configuration validation
 */

// Project metadata schema
const ProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  repo_url: z.string().regex(/^(https?:\/\/|git@)/, 'Invalid repository URL format'),
  default_branch: z.string().default('main'),
  context_paths: z.array(z.string()).default(['src/', 'docs/', 'README.md']),
  project_leads: z.array(z.string()).default([]),
});

// GitHub integration schema
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

// Linear integration schema
const LinearSchema = z.object({
  enabled: z.boolean(),
  api_key_env_var: z.string().default('LINEAR_API_KEY'),
  team_id: z.string().optional(),
  project_id: z.string().optional(),
  auto_link_issues: z.boolean().default(true),
});

// Runtime execution schema
const RuntimeSchema = z.object({
  agent_endpoint: z.string().url().optional(),
  agent_endpoint_env_var: z.string().default('AGENT_ENDPOINT'),
  max_concurrent_tasks: z.number().int().min(1).max(10).default(3),
  timeout_minutes: z.number().int().min(5).max(120).default(30),
  context_token_budget: z.number().int().min(1000).max(100000).default(32000),
  logs_format: z.enum(['ndjson', 'json', 'text']).default('ndjson'),
  run_directory: z.string().default('.ai-feature-pipeline/runs'),
});

// Safety controls schema
const SafetySchema = z.object({
  redact_secrets: z.boolean().default(true),
  require_approval_for_prd: z.boolean().default(true),
  require_approval_for_plan: z.boolean().default(true),
  require_approval_for_pr: z.boolean().default(true),
  prevent_force_push: z.boolean().default(true),
  allowed_file_patterns: z.array(z.string()).default(['**/*.ts', '**/*.js', '**/*.md', '**/*.json']),
  blocked_file_patterns: z.array(z.string()).default(['.env', '**/*.key', '**/*.pem', '**/credentials.*']),
});

// Feature flags schema
const FeatureFlagsSchema = z.object({
  enable_auto_merge: z.boolean().default(false),
  enable_deployment_triggers: z.boolean().default(false),
  enable_linear_sync: z.boolean().default(false),
  enable_context_summarization: z.boolean().default(true),
  enable_resumability: z.boolean().default(true),
  enable_developer_preview: z.boolean().default(false),
});

// Resource constraints schema
const ConstraintsSchema = z.object({
  max_file_size_kb: z.number().int().min(100).max(10000).default(1000),
  max_context_files: z.number().int().min(10).max(1000).default(100),
  rate_limits: z.object({
    github_requests_per_hour: z.number().int().default(5000),
    linear_requests_per_minute: z.number().int().default(60),
    agent_requests_per_hour: z.number().int().default(100),
  }).optional(),
});

// Main RepoConfig schema
export const RepoConfigSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid schema version format'),
  project: ProjectSchema,
  github: GitHubSchema,
  linear: LinearSchema,
  runtime: RuntimeSchema,
  safety: SafetySchema,
  feature_flags: FeatureFlagsSchema,
  constraints: ConstraintsSchema.optional(),
  governance_notes: z.string().optional(),
});

// Type inference from schema
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type GitHub = z.infer<typeof GitHubSchema>;
export type Linear = z.infer<typeof LinearSchema>;
export type Runtime = z.infer<typeof RuntimeSchema>;
export type Safety = z.infer<typeof SafetySchema>;
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;

/**
 * Validation result with detailed error information
 */
export interface ValidationResult {
  success: boolean;
  config?: RepoConfig;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  warnings?: string[];
}

/**
 * Load and validate RepoConfig from file
 * @param configPath Path to config.json file
 * @returns Validation result with parsed config or errors
 */
export function loadRepoConfig(configPath: string): ValidationResult {
  try {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      return {
        success: false,
        errors: [{ path: 'file', message: `Config file not found: ${configPath}` }],
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
        errors: [{ path: 'json', message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}` }],
      };
    }

    // Validate with zod
    const parseResult = RepoConfigSchema.safeParse(rawConfig);

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(err => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      return {
        success: false,
        errors,
      };
    }

    // Check environment variables for credentials
    const warnings: string[] = [];
    const config = parseResult.data;

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
      errors: [{ path: 'system', message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
    };
  }
}

/**
 * Create a default RepoConfig template
 * @param repoUrl Repository URL
 * @returns Default config object
 */
export function createDefaultConfig(repoUrl: string): RepoConfig {
  // Extract project ID from repo URL
  const projectId = repoUrl.split('/').pop()?.replace('.git', '') || 'unknown-project';

  return {
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
    constraints: {
      max_file_size_kb: 1000,
      max_context_files: 100,
      rate_limits: {
        github_requests_per_hour: 5000,
        linear_requests_per_minute: 60,
        agent_requests_per_hour: 100,
      },
    },
    governance_notes: 'Configure integrations and adjust settings according to your project requirements.',
  };
}

/**
 * Apply environment variable overrides to config
 * Follows AI_FEATURE_<SECTION>_<FIELD> naming convention
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

  return overridden;
}

/**
 * Format validation errors for user-friendly display
 * @param errors Array of validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: Array<{ path: string; message: string }>): string {
  const lines = ['Configuration validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('Please fix the errors above and try again.');
  lines.push('Refer to config/schemas/repo_config.schema.json for the complete schema.');

  return lines.join('\n');
}
