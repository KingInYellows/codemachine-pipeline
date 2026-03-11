/**
 * Resume Command Types
 *
 * Shared type definitions used by the Resume CLI command and its
 * extracted helper modules (resumePayloadBuilder, resumeOutput).
 */

import type { Interfaces } from '@oclif/core';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../telemetry/traces';
import type { createExecutionTelemetry } from '../telemetry/executionTelemetry';
import type { TelemetryResources } from './utils/telemetryLifecycle';
import type Resume from './commands/resume';

/**
 * Derived from the oclif flag definitions in Resume.flags so there is a
 * single source of truth.  The `import type` is circular at the type level
 * only and is erased at compile time — no runtime cycle is created.
 */
export type ResumeFlags = Interfaces.InferredFlags<typeof Resume.flags>;

export interface ResumeTelemetry {
  logger: StructuredLogger;
  metrics: MetricsCollector;
  traceManager: TraceManager;
  commandSpan: ActiveSpan;
  executionTelemetry: ReturnType<typeof createExecutionTelemetry>;
  runDirPath: string;
  resources: TelemetryResources;
}

export interface ResumePayload {
  feature_id: string;
  can_resume: boolean;
  status: string;
  last_step?: string;
  current_step?: string;
  last_error?: {
    step: string;
    message: string;
    timestamp: string;
    recoverable: boolean;
  } | null;
  queue_state: {
    pending: number;
    completed: number;
    failed: number;
  };
  execution?: {
    total_tasks: number;
    completed: number;
    failed: number;
    permanently_failed: number;
    skipped: number;
    duration_ms: number;
  };
  pending_approvals: string[];
  integrity_check?: {
    valid: boolean;
    passed: number;
    failed: number;
    missing: number;
  };
  diagnostics: Array<{
    severity: string;
    message: string;
    code?: string;
  }>;
  recommendations: string[];
  queue_validation?: {
    valid: boolean;
    total_tasks: number;
    corrupted_tasks: number;
    errors: Array<{
      taskId: string;
      line: number;
      message: string;
    }>;
  };
  plan_summary?: {
    total_tasks: number;
    entry_tasks: number;
    next_tasks: string[];
  };
  resume_instructions?: {
    checkpoint?: string;
    next_step?: string;
    pending_approvals?: string[];
  };
  rate_limit_warnings?: Array<{
    provider: string;
    in_cooldown: boolean;
    manual_ack_required: boolean;
    reset_at: string;
  }>;
  integration_blockers?: {
    github?: string[];
    linear?: string[];
  };
  branch_protection_blockers?: string[];
  dry_run: boolean;
  playbook_reference: string;
}
