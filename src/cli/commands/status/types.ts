export type { RunManifest } from '../../../persistence/runDirectoryManager';
export type { ValidationMismatch } from '../../../workflows/branchProtectionReporter';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_SCHEMA_DOC = 'docs/requirements/run_directory_schema.md';
export const MANIFEST_TEMPLATE = '.codepipe/templates/run_manifest.json';

export type StatusFlags = {
  feature?: string;
  json: boolean;
  verbose: boolean;
  'show-costs': boolean;
};

export interface ManifestLoadResult {
  manifest?: import('../../../persistence/runDirectoryManager').RunManifest;
  manifestPath: string;
  error?: string;
}

export interface StatusPayload {
  feature_id: string | null;
  title?: string;
  source?: string;
  status: import('../../../persistence/runDirectoryManager').RunManifest['status'] | 'unknown';
  manifest_path: string;
  manifest_schema_doc: string;
  manifest_template: string;
  last_step: string | null;
  last_error: import('../../../persistence/runDirectoryManager').RunManifest['execution']['last_error'] | null;
  queue: import('../../../persistence/runDirectoryManager').RunManifest['queue'] | null;
  approvals: import('../../../persistence/runDirectoryManager').RunManifest['approvals'] | null;
  telemetry: import('../../../persistence/runDirectoryManager').RunManifest['telemetry'] | null;
  timestamps: import('../../../persistence/runDirectoryManager').RunManifest['timestamps'] | null;
  config_reference: string;
  config_errors: string[];
  config_warnings: string[];
  notes: string[];
  manifest_error?: string;
  context?: StatusContextPayload;
  traceability?: StatusTraceabilityPayload;
  plan?: StatusPlanPayload;
  validation?: StatusValidationPayload;
  branch_protection?: StatusBranchProtectionPayload;
  integrations?: StatusIntegrationsPayload;
  rate_limits?: StatusRateLimitsPayload;
  research?: StatusResearchPayload;
}

export interface StatusContextPayload {
  files?: number;
  total_tokens?: number;
  summaries?: number;
  summaries_preview?: Array<{
    file_path: string;
    chunk_id: string;
    generated_at: string;
    summary: string;
  }>;
  summarization?: {
    updated_at?: string;
    chunks_generated?: number;
    chunks_cached?: number;
    tokens_used?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
    cost_usd?: number;
  };
  warnings?: string[];
  budget_warnings?: string[];
  error?: string;
}

export interface StatusTraceabilityPayload {
  trace_path: string;
  total_links: number;
  prd_goals_mapped: number;
  spec_requirements_mapped: number;
  execution_tasks_mapped: number;
  last_updated: string;
  outstanding_gaps: number;
}

export interface StatusPlanPayload {
  plan_path: string;
  plan_exists: boolean;
  total_tasks?: number;
  entry_tasks?: number;
  blocked_tasks?: number;
  task_type_breakdown?: Record<string, number>;
  dag_metadata?: {
    parallel_paths?: number;
    critical_path_depth?: number;
    generated_at: string;
  };
  checksum?: string;
  last_updated?: string;
}

export interface StatusValidationPayload {
  has_validation_data: boolean;
  queue_valid?: boolean;
  plan_valid?: boolean;
  integrity_warnings?: string[];
}

export interface StatusBranchProtectionPayload {
  protected: boolean;
  compliant: boolean;
  blockers_count: number;
  blockers: string[];
  missing_checks: string[];
  reviews_status: {
    required: number;
    completed: number;
    satisfied: boolean;
  };
  branch_status: {
    up_to_date: boolean;
    stale: boolean;
  };
  auto_merge: {
    allowed: boolean;
    enabled: boolean;
  };
  evaluated_at?: string;
  validation_mismatch?: import('../../../workflows/branchProtectionReporter').ValidationMismatch;
}

export interface StatusIntegrationsPayload {
  github?: {
    enabled: boolean;
    rate_limit?: {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
    };
    pr_status?: {
      number: number;
      state: string;
      mergeable: boolean | null;
      url: string;
    };
    warnings: string[];
  };
  linear?: {
    enabled: boolean;
    rate_limit?: {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
    };
    issue_status?: {
      identifier: string;
      state: string;
      url: string;
    };
    warnings: string[];
  };
}

export interface StatusRateLimitsPayload {
  providers: Record<
    string,
    {
      remaining: number;
      reset_at: string;
      in_cooldown: boolean;
      manual_ack_required: boolean;
      recent_hit_count: number;
    }
  >;
  summary: {
    any_in_cooldown: boolean;
    any_requires_ack: boolean;
    providers_in_cooldown: number;
  };
  warnings: string[];
}

export interface StatusResearchPayload {
  total_tasks: number;
  pending_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  cached_tasks: number;
  stale_tasks: number;
  research_dir: string;
  tasks_file: string;
  warnings: string[];
}
