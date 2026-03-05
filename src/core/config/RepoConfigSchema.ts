/**
 * RepoConfig Schema Definitions
 *
 * Contains all Zod schemas and inferred TypeScript types for repository
 * configuration. Validation logic lives in RepoConfig.ts; default values and
 * factory functions live in RepoConfigDefaults.ts.
 */

import { z } from 'zod';
import { ValidationCommandConfigSchema } from '../validation/validationCommandConfig';
import { DEFAULT_GITHUB_API_VERSION } from './RepoConfigDefaults';

const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_VAR_MSG =
  'Must start with an uppercase letter followed by uppercase letters, digits, and underscores (e.g., GITHUB_TOKEN)';

export const ConfigHistoryEntrySchema = z.object({
  timestamp: z.string().datetime({ message: 'Must be ISO 8601 datetime' }),
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
  changed_by: z.string().min(1, 'Changed by identifier required'),
  change_description: z.string().min(1, 'Change description required'),
  migration_applied: z.boolean().default(false),
  backup_path: z.string().optional(),
});

export type ConfigHistoryEntry = z.infer<typeof ConfigHistoryEntrySchema>;

export const GovernanceSchema = z.object({
  // Approval workflow configuration
  approval_workflow: z
    .object({
      require_approval_for_prd: z.boolean().default(true),
      require_approval_for_spec: z.boolean().default(true),
      require_approval_for_plan: z.boolean().default(true),
      require_approval_for_code: z.boolean().default(true),
      require_approval_for_pr: z.boolean().default(true),
      require_approval_for_deploy: z.boolean().default(true),
    })
    .describe('Gate-by-gate approval requirements'),

  // Accountability tracking
  accountability: z
    .object({
      record_approver_identity: z.boolean().default(true),
      require_approval_reason: z.boolean().default(false),
      audit_log_retention_days: z.number().int().min(1).max(3650).default(365),
    })
    .describe('Accountability settings for approval tracking'),

  // Risk containment settings
  risk_controls: z
    .object({
      prevent_auto_merge: z.boolean().default(true),
      prevent_force_push: z.boolean().default(true),
      require_branch_protection: z.boolean().default(true),
      max_files_per_pr: z.number().int().min(1).max(1000).default(100),
      max_lines_changed_per_pr: z.number().int().min(1).max(50000).default(5000),
    })
    .describe('Risk containment controls to limit blast radius'),

  // Compliance and notes
  compliance_tags: z
    .array(z.string())
    .default([])
    .describe('Tags for compliance tracking (e.g., SOC2, GDPR)'),
  governance_notes: z.string().optional().describe('Free-form governance documentation'),
});

export type Governance = z.infer<typeof GovernanceSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1, 'Project ID is required'),
  repo_url: z.string().regex(/^(https?:\/\/|git@)/, 'Invalid repository URL format'),
  default_branch: z.string().default('main'),
  context_paths: z.array(z.string()).default(['src/', 'docs/', 'README.md']),
  project_leads: z.array(z.string()).default([]),
});

export type Project = z.infer<typeof ProjectSchema>;

export const GitHubSchema = z.object({
  enabled: z.boolean(),
  token_env_var: z.string().regex(ENV_VAR_NAME, ENV_VAR_MSG).default('GITHUB_TOKEN'),
  api_base_url: z.string().url().default('https://api.github.com'),
  required_scopes: z
    .array(z.enum(['repo', 'workflow', 'read:org', 'write:org']))
    .default(['repo', 'workflow']),
  default_reviewers: z.array(z.string()).default([]),
  api_version: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Must be a valid YYYY-MM-DD date')
    .default(DEFAULT_GITHUB_API_VERSION),
  branch_protection: z
    .object({
      respect_required_reviews: z.boolean().default(true),
      respect_status_checks: z.boolean().default(true),
    })
    .optional(),
});

export type GitHub = z.infer<typeof GitHubSchema>;

export const LinearSchema = z.object({
  enabled: z.boolean(),
  api_key_env_var: z.string().regex(ENV_VAR_NAME, ENV_VAR_MSG).default('LINEAR_API_KEY'),
  team_id: z.string().optional(),
  project_id: z.string().optional(),
  auto_link_issues: z.boolean().default(true),
});

export type Linear = z.infer<typeof LinearSchema>;

export const RuntimeSchema = z.object({
  agent_endpoint: z.string().url().optional(),
  agent_endpoint_env_var: z.string().regex(ENV_VAR_NAME, ENV_VAR_MSG).default('AGENT_ENDPOINT'),
  max_concurrent_tasks: z.number().int().min(1).max(10).default(3),
  timeout_minutes: z.number().int().min(5).max(120).default(30),
  context_token_budget: z.number().int().min(1000).max(100000).default(32000),
  context_cost_budget_usd: z
    .number()
    .nonnegative()
    .default(5)
    .describe('Maximum USD spend for context summarization'),
  logs_format: z.enum(['ndjson', 'json', 'text']).default('ndjson'),
  run_directory: z.string().default('.codepipe/runs'),
});

export type Runtime = z.infer<typeof RuntimeSchema>;

export const SafetySchema = z.object({
  redact_secrets: z.boolean().default(true),
  require_approval_for_prd: z
    .boolean()
    .default(true)
    .describe('DEPRECATED: Use governance.approval_workflow instead'),
  require_approval_for_plan: z
    .boolean()
    .default(true)
    .describe('DEPRECATED: Use governance.approval_workflow instead'),
  require_approval_for_pr: z
    .boolean()
    .default(true)
    .describe('DEPRECATED: Use governance.approval_workflow instead'),
  prevent_force_push: z
    .boolean()
    .default(true)
    .describe('DEPRECATED: Use governance.risk_controls instead'),
  allowed_file_patterns: z
    .array(z.string())
    .default(['**/*.ts', '**/*.js', '**/*.md', '**/*.json']),
  blocked_file_patterns: z
    .array(z.string())
    .default(['.env', '**/*.key', '**/*.pem', '**/credentials.*']),
});

export type Safety = z.infer<typeof SafetySchema>;

export const FeatureFlagsSchema = z.object({
  enable_auto_merge: z.boolean().default(false),
  enable_deployment_triggers: z.boolean().default(false),
  enable_linear_sync: z.boolean().default(false),
  enable_context_summarization: z.boolean().default(true),
  enable_resumability: z.boolean().default(true),
  enable_developer_preview: z.boolean().default(false),
});

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const ValidationSettingsSchema = z.object({
  commands: z.array(ValidationCommandConfigSchema).min(1),
  template_context: z.record(z.string(), z.string()).optional(),
});

export type ValidationSettings = z.infer<typeof ValidationSettingsSchema>;

export const ConstraintsSchema = z.object({
  max_file_size_kb: z.number().int().min(100).max(10000).default(1000),
  max_context_files: z.number().int().min(10).max(1000).default(100),
  rate_limits: z
    .object({
      github_requests_per_hour: z.number().int().default(5000),
      linear_requests_per_minute: z.number().int().default(60),
      agent_requests_per_hour: z.number().int().default(100),
    })
    .optional(),
});

export type Constraints = z.infer<typeof ConstraintsSchema>;

export const ExecutionEngineType = z.enum(['claude', 'codex', 'openai']);

export type ExecutionEngineType = z.infer<typeof ExecutionEngineType>;

export const ExecutionConfigSchema = z.object({
  codemachine_cli_path: z.string().default('codemachine'),
  default_engine: ExecutionEngineType.default('claude'),
  workspace_dir: z.string().optional(),
  spec_path: z.string().optional(),
  task_timeout_ms: z.number().int().min(60000).max(7200000).default(1800000), // 30 min, max 2h
  max_parallel_tasks: z.number().int().min(1).max(10).default(1),
  max_log_buffer_size: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  env_allowlist: z.array(z.string().regex(ENV_VAR_NAME, ENV_VAR_MSG)).default([]),
  max_retries: z.number().int().min(0).max(10).default(3),
  retry_backoff_ms: z.number().int().min(1000).default(5000),
  log_rotation_mb: z.number().int().min(1).max(10240).default(100),
  log_rotation_keep: z.number().int().min(1).max(20).default(3),
  log_rotation_compress: z.boolean().default(false),
  codemachine_cli_version: z
    .string()
    .optional()
    .describe('Minimum required CodeMachine-CLI version (semver)'),
  codemachine_workflow_dir: z
    .string()
    .optional()
    .describe('Path to workflow template overrides directory'),
  env_credential_keys: z
    .array(z.string().regex(ENV_VAR_NAME, ENV_VAR_MSG))
    .default([])
    .describe('Env var names to pipe to CodeMachine-CLI via stdin'),
});

export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;

export const RepoConfigSchema = z.object({
  schema_version: z
    .string()
    .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid schema version format (must be semver)'),
  project: ProjectSchema,
  github: GitHubSchema,
  linear: LinearSchema,
  runtime: RuntimeSchema,
  safety: SafetySchema,
  feature_flags: FeatureFlagsSchema,
  validation: ValidationSettingsSchema.optional(),
  constraints: ConstraintsSchema.optional(),
  execution: ExecutionConfigSchema.optional().describe('CodeMachine CLI execution configuration'),

  governance: GovernanceSchema.optional().describe(
    'Governance controls for approval workflows and accountability'
  ),

  // Config history tracking for deterministic migrations
  config_history: z
    .array(ConfigHistoryEntrySchema)
    .default([])
    .describe('Migration history for schema version tracking'),

  // Deprecated: kept for backward compatibility
  governance_notes: z
    .string()
    .optional()
    .describe('DEPRECATED: Use governance.governance_notes instead'),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export interface ValidationError {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  success: boolean;
  config?: RepoConfig;
  errors?: ValidationError[];
  warnings?: string[];
}
