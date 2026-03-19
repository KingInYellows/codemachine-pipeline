/**
 * Status dashboard types.
 *
 * These interfaces define the JSON contract emitted by `codepipe status --json`.
 * Every property is documented so consumers can rely on the schema without
 * reading source code.
 *
 * @module
 */

export type { RunManifest } from '../../persistence/manifestManager';
export type { ValidationMismatch } from '../../workflows/branchProtectionReporter';

/** Default manifest filename within a run directory. */
export const MANIFEST_FILE = 'manifest.json';
/** Path to the run-directory schema documentation. */
export const MANIFEST_SCHEMA_DOC = 'docs/reference/run_directory_schema.md';
/** Path to the default manifest template. */
export const MANIFEST_TEMPLATE = '.codepipe/templates/run_manifest.json';

/** CLI flags parsed from `codepipe status` invocation. */
export type StatusFlags = {
  /** Feature branch identifier to inspect (auto-detected when omitted). */
  feature?: string;
  /** Emit machine-readable JSON instead of human-readable text. */
  json: boolean;
  /** Include verbose details (checksums, timestamps, preview data). */
  verbose: boolean;
  /** Include cost/telemetry section in output. */
  'show-costs': boolean;
};

/** Result of attempting to read a run manifest from disk. */
export interface ManifestLoadResult {
  /** Parsed manifest, present only when the read succeeded. */
  manifest?: import('../../persistence/manifestManager').RunManifest;
  /** Absolute path where the manifest was expected. */
  manifestPath: string;
  /** Human-readable error message when the manifest could not be loaded. */
  error?: string;
}

/** Top-level JSON payload returned by `codepipe status --json`. */
export interface StatusPayload {
  /** Feature branch identifier, or null when not detected. */
  feature_id: string | null;
  /** Human-readable title from the manifest or issue tracker. */
  title?: string;
  /** Origin of the feature (e.g. "linear", "github"). */
  source?: string;
  /** Current pipeline status from the manifest, or "unknown" if unreadable. */
  status: import('../../persistence/manifestManager').RunManifest['status'] | 'unknown';
  /** Absolute path to the run manifest file. */
  manifest_path: string;
  /** Relative path to the run-directory schema documentation. */
  manifest_schema_doc: string;
  /** Relative path to the manifest template file. */
  manifest_template: string;
  /** Name of the last completed pipeline step, or null. */
  last_step: string | null;
  /** Details of the last recorded error, or null if none. */
  last_error:
    | import('../../persistence/manifestManager').RunManifest['execution']['last_error']
    | null;
  /** Task queue state (pending/completed/failed counts), or null. */
  queue: import('../../persistence/manifestManager').RunManifest['queue'] | null;
  /** Approval gate state (pending/completed gates), or null. */
  approvals: import('../../persistence/manifestManager').RunManifest['approvals'] | null;
  /** Telemetry metadata (costs file path, etc.), or null. */
  telemetry: import('../../persistence/manifestManager').RunManifest['telemetry'] | null;
  /** Pipeline lifecycle timestamps, or null. */
  timestamps: import('../../persistence/manifestManager').RunManifest['timestamps'] | null;
  /** Path to the configuration file used for this run. */
  config_reference: string;
  /** Configuration validation errors. */
  config_errors: string[];
  /** Configuration validation warnings. */
  config_warnings: string[];
  /** Advisory notes displayed in the footer. */
  notes: string[];
  /** Error message when the manifest file could not be read. */
  manifest_error?: string;
  /** Context-window summary (files, tokens, summaries). */
  context?: StatusContextPayload;
  /** Traceability link coverage (PRD -> spec -> tasks). */
  traceability?: StatusTraceabilityPayload;
  /** Execution plan DAG summary. */
  plan?: StatusPlanPayload;
  /** Queue and plan validation results. */
  validation?: StatusValidationPayload;
  /** Branch protection compliance status. */
  branch_protection?: StatusBranchProtectionPayload;
  /** GitHub and Linear integration status. */
  integrations?: StatusIntegrationsPayload;
  /** API rate-limit ledger across all providers. */
  rate_limits?: StatusRateLimitsPayload;
  /** Research task tracking summary. */
  research?: StatusResearchPayload;
}

/** Context-window statistics and summarization metadata. */
export interface StatusContextPayload {
  /** Number of files included in the context window. */
  files?: number;
  /** Total token count across all context files. */
  total_tokens?: number;
  /** Number of chunk summaries generated. */
  summaries?: number;
  /** Preview of the first few summaries (up to 5, truncated). */
  summaries_preview?: Array<{
    /** Relative path of the summarized file. */
    file_path: string;
    /** Unique identifier for the summary chunk. */
    chunk_id: string;
    /** ISO-8601 timestamp when the summary was generated. */
    generated_at: string;
    /** Truncated summary text. */
    summary: string;
  }>;
  /** Summarization run metadata (tokens, cost, cache stats). */
  summarization?: {
    /** ISO-8601 timestamp of the last summarization run. */
    updated_at?: string;
    /** Number of summary chunks newly generated. */
    chunks_generated?: number;
    /** Number of summary chunks served from cache. */
    chunks_cached?: number;
    /** Token usage breakdown for the summarization step. */
    tokens_used?: {
      /** Prompt tokens consumed. */
      prompt?: number;
      /** Completion tokens consumed. */
      completion?: number;
      /** Combined prompt + completion tokens. */
      total?: number;
    };
    /** Estimated cost in USD for the summarization step. */
    cost_usd?: number;
  };
  /** Non-fatal warnings from the summarization process. */
  warnings?: string[];
  /** Warnings related to token/cost budget limits. */
  budget_warnings?: string[];
  /** Fatal error message when context data could not be loaded. */
  error?: string;
}

/** Traceability link coverage across the PRD -> spec -> task chain. */
export interface StatusTraceabilityPayload {
  /** Absolute path to the traceability map file. */
  trace_path: string;
  /** Total number of traceability links recorded. */
  total_links: number;
  /** Number of PRD goals with at least one link. */
  prd_goals_mapped: number;
  /** Number of spec requirements with at least one link. */
  spec_requirements_mapped: number;
  /** Number of execution tasks with at least one link. */
  execution_tasks_mapped: number;
  /** ISO-8601 timestamp of the last traceability update. */
  last_updated: string;
  /** Number of unlinked items (gaps in coverage). */
  outstanding_gaps: number;
}

/** Execution plan (DAG) summary. */
export interface StatusPlanPayload {
  /** Absolute path to the plan.json file. */
  plan_path: string;
  /** Whether a plan file exists on disk. */
  plan_exists: boolean;
  /** Total number of tasks in the plan. */
  total_tasks?: number;
  /** Number of entry-point tasks (no dependencies). */
  entry_tasks?: number;
  /** Number of tasks blocked by unmet dependencies. */
  blocked_tasks?: number;
  /** Count of tasks grouped by type (e.g. "code", "test"). */
  task_type_breakdown?: Record<string, number>;
  /** DAG structural metadata. */
  dag_metadata?: {
    /** Number of independent parallel execution paths. */
    parallel_paths?: number;
    /** Depth of the longest dependency chain (critical path). */
    critical_path_depth?: number;
    /** ISO-8601 timestamp when the DAG was generated. */
    generated_at: string;
  };
  /** SHA-256 checksum of the plan file. */
  checksum?: string;
  /** ISO-8601 timestamp of the last plan update. */
  last_updated?: string;
}

/** Queue and plan validation results. */
export interface StatusValidationPayload {
  /** Whether any validation data was found on disk. */
  has_validation_data: boolean;
  /** Whether the task queue passed validation. */
  queue_valid?: boolean;
  /** Whether the execution plan passed validation. */
  plan_valid?: boolean;
  /** Integrity warnings from queue or plan validation. */
  integrity_warnings?: string[];
}

/** Branch protection rule compliance for the target branch. */
export interface StatusBranchProtectionPayload {
  /** Whether branch protection rules are enabled. */
  protected: boolean;
  /** Whether the branch currently satisfies all protection rules. */
  compliant: boolean;
  /** Number of outstanding blockers preventing merge. */
  blockers_count: number;
  /** Human-readable descriptions of each blocker. */
  blockers: string[];
  /** Required status checks that have not yet passed. */
  missing_checks: string[];
  /** Pull-request review gate status. */
  reviews_status: {
    /** Number of approving reviews required by the ruleset. */
    required: number;
    /** Number of approving reviews received so far. */
    completed: number;
    /** Whether the review requirement is met. */
    satisfied: boolean;
  };
  /** Branch freshness relative to the base branch. */
  branch_status: {
    /** Whether the branch includes the latest base-branch commits. */
    up_to_date: boolean;
    /** Whether the branch is considered stale. */
    stale: boolean;
  };
  /** Auto-merge configuration for the pull request. */
  auto_merge: {
    /** Whether auto-merge is permitted by the repository settings. */
    allowed: boolean;
    /** Whether auto-merge has been enabled on this PR. */
    enabled: boolean;
  };
  /** ISO-8601 timestamp when branch protection was last evaluated. */
  evaluated_at?: string;
  /** Mismatch between execution-task validations and required checks. */
  validation_mismatch?: import('../../workflows/branchProtectionReporter').ValidationMismatch;
}

/** GitHub and Linear integration status. */
export interface StatusIntegrationsPayload {
  /** GitHub integration state, present when the GitHub adapter is enabled. */
  github?: {
    /** Whether the GitHub adapter is configured and active. */
    enabled: boolean;
    /** Current GitHub API rate-limit snapshot. */
    rate_limit?: {
      /** Remaining API calls before the limit resets. */
      remaining: number;
      /** ISO-8601 timestamp when the rate limit resets. */
      reset_at: string;
      /** Whether requests are currently being throttled. */
      in_cooldown: boolean;
    };
    /** Associated pull-request status, if one exists. */
    pr_status?: {
      /** PR number on the repository. */
      number: number;
      /** PR state (e.g. "open", "closed", "merged"). */
      state: string;
      /** Whether the PR can be merged, or null if unknown. */
      mergeable: boolean | null;
      /** URL to the pull request on GitHub. */
      url: string;
    };
    /** Non-fatal warnings from the GitHub integration. */
    warnings: string[];
  };
  /** Linear integration state, present when the Linear adapter is enabled. */
  linear?: {
    /** Whether the Linear adapter is configured and active. */
    enabled: boolean;
    /** Current Linear API rate-limit snapshot. */
    rate_limit?: {
      /** Remaining API calls before the limit resets. */
      remaining: number;
      /** ISO-8601 timestamp when the rate limit resets. */
      reset_at: string;
      /** Whether requests are currently being throttled. */
      in_cooldown: boolean;
    };
    /** Associated Linear issue status, if one exists. */
    issue_status?: {
      /** Linear issue identifier (e.g. "PROJ-123"). */
      identifier: string;
      /** Current issue state in the Linear workflow. */
      state: string;
      /** URL to the issue on Linear. */
      url: string;
    };
    /** Non-fatal warnings from the Linear integration. */
    warnings: string[];
  };
}

/** API rate-limit ledger across all configured providers. */
export interface StatusRateLimitsPayload {
  /** Per-provider rate-limit state keyed by provider name. */
  providers: Record<
    string,
    {
      /** Remaining API calls before the limit resets. */
      remaining: number;
      /** ISO-8601 timestamp when the rate limit resets. */
      reset_at: string;
      /** Whether the provider is currently in cooldown. */
      in_cooldown: boolean;
      /** Whether a manual acknowledgement is needed to resume. */
      manual_ack_required: boolean;
      /** Number of consecutive rate-limit hits. */
      recent_hit_count: number;
    }
  >;
  /** Aggregate summary across all providers. */
  summary: {
    /** Whether any provider is currently in cooldown. */
    any_in_cooldown: boolean;
    /** Whether any provider requires manual acknowledgement. */
    any_requires_ack: boolean;
    /** Count of providers currently in cooldown. */
    providers_in_cooldown: number;
  };
  /** Human-readable rate-limit warnings. */
  warnings: string[];
}

/** Research task tracking summary. */
export interface StatusResearchPayload {
  /** Total number of research tasks across all states. */
  total_tasks: number;
  /** Tasks awaiting execution. */
  pending_tasks: number;
  /** Tasks currently being executed. */
  in_progress_tasks: number;
  /** Tasks that completed successfully. */
  completed_tasks: number;
  /** Tasks that terminated with an error. */
  failed_tasks: number;
  /** Tasks served from a cached result. */
  cached_tasks: number;
  /** Completed tasks whose cached results have expired. */
  stale_tasks: number;
  /** Absolute path to the research output directory. */
  research_dir: string;
  /** Absolute path to the JSONL task snapshot file. */
  tasks_file: string;
  /** Non-fatal warnings from the research coordinator. */
  warnings: string[];
}
