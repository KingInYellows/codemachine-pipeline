import { z } from 'zod';
import { createModelParser } from './modelParser.js';

/**
 * Specification Model
 *
 * Structured technical specification with reviewer info, status,
 * change log, risks, test plan, and rollout plan.
 *
 * Used by CLI commands: start, approve, status
 */

export const SpecificationStatusSchema = z.enum([
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'obsolete',
]);

export type SpecificationStatus = z.infer<typeof SpecificationStatusSchema>;

const ReviewerInfoSchema = z.object({
  /** Reviewer identifier (username, email, or ID) */
  reviewer_id: z.string().min(1),
  /** Reviewer display name */
  name: z.string().optional(),
  /** ISO 8601 timestamp when review was assigned */
  assigned_at: z.string().datetime(),
  /** ISO 8601 timestamp when review was completed */
  reviewed_at: z.string().datetime().nullable().optional(),
  /** Review verdict (approved, rejected, requested_changes) */
  verdict: z.enum(['approved', 'rejected', 'requested_changes', 'pending']).default('pending'),
  /** Review comments or feedback */
  comments: z.string().optional(),
});

export type ReviewerInfo = z.infer<typeof ReviewerInfoSchema>;

const ChangeLogEntrySchema = z.object({
  /** ISO 8601 timestamp of the change */
  timestamp: z.string().datetime(),
  /** Author identifier */
  author: z.string().min(1),
  /** Description of the change */
  description: z.string().min(1),
  /** Version number or label */
  version: z.string().optional(),
});

export type ChangeLogEntry = z.infer<typeof ChangeLogEntrySchema>;

const RiskAssessmentSchema = z.object({
  /** Risk description */
  description: z.string().min(1),
  /** Risk severity (low, medium, high, critical) */
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  /** Mitigation strategy */
  mitigation: z.string().optional(),
  /** Risk owner or responsible party */
  owner: z.string().optional(),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

const TestPlanItemSchema = z.object({
  /** Test case identifier */
  test_id: z.string().min(1),
  /** Test case description */
  description: z.string().min(1),
  /** Test type (unit, integration, e2e, manual) */
  test_type: z.enum(['unit', 'integration', 'e2e', 'manual']),
  /** Acceptance criteria for this test */
  acceptance_criteria: z.array(z.string()).default([]),
});

export type TestPlanItem = z.infer<typeof TestPlanItemSchema>;

const RolloutPlanSchema = z.object({
  /** Rollout strategy (all_at_once, gradual, canary, blue_green) */
  strategy: z.enum(['all_at_once', 'gradual', 'canary', 'blue_green']).default('gradual'),
  /** Rollout phases or stages */
  phases: z
    .array(
      z.object({
        /** Phase number or identifier */
        phase_id: z.string().min(1),
        /** Phase description */
        description: z.string().min(1),
        /** Percentage of users or traffic for this phase */
        percentage: z.number().min(0).max(100).optional(),
        /** Duration of this phase */
        duration: z.string().optional(),
      })
    )
    .default([]),
  /** Rollback plan in case of issues */
  rollback_plan: z.string().optional(),
});

export type RolloutPlan = z.infer<typeof RolloutPlanSchema>;

export const SpecificationSchema = z
  .object({
    /** Schema version for future migrations (semver) */
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    /** Unique specification identifier */
    spec_id: z.string().min(1),
    /** Feature ID this specification belongs to */
    feature_id: z.string().min(1),
    /** Specification title */
    title: z.string().min(1),
    /** Full specification content (markdown or structured text) */
    content: z.string().min(1),
    /** Current specification status */
    status: SpecificationStatusSchema,
    /** Reviewers assigned to this specification */
    reviewers: z.array(ReviewerInfoSchema).default([]),
    /** Change log tracking specification revisions */
    change_log: z.array(ChangeLogEntrySchema).default([]),
    /** Risk assessments identified during specification */
    risks: z.array(RiskAssessmentSchema).default([]),
    /** Test plan derived from specification */
    test_plan: z.array(TestPlanItemSchema).default([]),
    /** Rollout plan for deploying this feature */
    rollout_plan: RolloutPlanSchema.optional(),
    /** ISO 8601 timestamp when specification was created */
    created_at: z.string().datetime(),
    /** ISO 8601 timestamp when specification was last updated */
    updated_at: z.string().datetime(),
    /** ISO 8601 timestamp when specification was approved */
    approved_at: z.string().datetime().nullable().optional(),
    /** Optional specification metadata */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Specification = Readonly<z.infer<typeof SpecificationSchema>>;

const { parse: parseSpecification, serialize: serializeSpecification } =
  createModelParser<Specification>(SpecificationSchema);
export { parseSpecification, serializeSpecification };

/**
 * Create a new Specification
 *
 * @param specId - Unique specification identifier
 * @param featureId - Feature identifier
 * @param title - Specification title
 * @param content - Specification content
 * @param options - Optional configuration
 * @returns Initialized Specification object
 */
export function createSpecification(
  specId: string,
  featureId: string,
  title: string,
  content: string,
  options?: {
    reviewers?: ReviewerInfo[];
    risks?: RiskAssessment[];
    testPlan?: TestPlanItem[];
    rolloutPlan?: RolloutPlan;
    metadata?: Record<string, unknown>;
  }
): Specification {
  const now = new Date().toISOString();

  return {
    schema_version: '1.0.0',
    spec_id: specId,
    feature_id: featureId,
    title,
    content,
    status: 'draft',
    reviewers: options?.reviewers || [],
    change_log: [],
    risks: options?.risks || [],
    test_plan: options?.testPlan || [],
    rollout_plan: options?.rolloutPlan,
    created_at: now,
    updated_at: now,
    metadata: options?.metadata,
  };
}

/**
 * Add a change log entry to specification
 *
 * @param specification - Existing specification
 * @param author - Change author identifier
 * @param description - Change description
 * @param version - Optional version label
 * @returns Updated specification
 */
export function addChangeLogEntry(
  specification: Specification,
  author: string,
  description: string,
  version?: string
): Specification {
  const entry: ChangeLogEntry = {
    timestamp: new Date().toISOString(),
    author,
    description,
    version,
  };

  return {
    ...specification,
    updated_at: new Date().toISOString(),
    change_log: [...specification.change_log, entry],
  };
}

/**
 * Check if specification is approved by all reviewers
 *
 * @param specification - Specification to check
 * @returns True if all reviewers approved, false otherwise
 */
export function isFullyApproved(specification: Specification): boolean {
  if (specification.reviewers.length === 0) {
    return false;
  }

  return specification.reviewers.every((reviewer) => reviewer.verdict === 'approved');
}

/**
 * Get pending reviewers
 *
 * @param specification - Specification to check
 * @returns Array of reviewers with pending status
 */
export function getPendingReviewers(specification: Specification): ReviewerInfo[] {
  return specification.reviewers.filter((reviewer) => reviewer.verdict === 'pending');
}

/**
 * Format validation errors for user-friendly display
 *
 * @param errors - Array of validation errors from parseSpecification
 * @returns Formatted error message
 */
export function formatSpecificationValidationErrors(
  errors: Array<{ path: string; message: string }>
): string {
  const lines = ['Specification validation failed:', ''];

  for (const error of errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
  }

  lines.push('');
  lines.push('For schema documentation, see:');
  lines.push('  docs/reference/data_model_dictionary.md');

  return lines.join('\n');
}
