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
  reviewer_id: z.string().min(1), // Reviewer identifier (username, email, or ID)
  name: z.string().optional(),
  assigned_at: z.string().datetime(),
  reviewed_at: z.string().datetime().nullable().optional(),
  verdict: z.enum(['approved', 'rejected', 'requested_changes', 'pending']).default('pending'),
  comments: z.string().optional(),
});

export type ReviewerInfo = z.infer<typeof ReviewerInfoSchema>;

const ChangeLogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  author: z.string().min(1),
  description: z.string().min(1),
  version: z.string().optional(),
});

export type ChangeLogEntry = z.infer<typeof ChangeLogEntrySchema>;

const RiskAssessmentSchema = z.object({
  description: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  mitigation: z.string().optional(),
  owner: z.string().optional(),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

const TestPlanItemSchema = z.object({
  test_id: z.string().min(1),
  description: z.string().min(1),
  test_type: z.enum(['unit', 'integration', 'e2e', 'manual']),
  acceptance_criteria: z.array(z.string()).default([]),
});

export type TestPlanItem = z.infer<typeof TestPlanItemSchema>;

const RolloutPlanSchema = z.object({
  strategy: z.enum(['all_at_once', 'gradual', 'canary', 'blue_green']).default('gradual'),
  phases: z
    .array(
      z.object({
        phase_id: z.string().min(1),
        description: z.string().min(1),
        /** Percentage of users or traffic for this phase */
        percentage: z.number().min(0).max(100).optional(),
        duration: z.string().optional(),
      })
    )
    .default([]),
  rollback_plan: z.string().optional(),
});

export type RolloutPlan = z.infer<typeof RolloutPlanSchema>;

export const SpecificationSchema = z
  .object({
    schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'Invalid semver format'),
    spec_id: z.string().min(1),
    feature_id: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
    status: SpecificationStatusSchema,
    reviewers: z.array(ReviewerInfoSchema).default([]),
    change_log: z.array(ChangeLogEntrySchema).default([]),
    risks: z.array(RiskAssessmentSchema).default([]),
    test_plan: z.array(TestPlanItemSchema).default([]),
    rollout_plan: RolloutPlanSchema.optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    approved_at: z.string().datetime().nullable().optional(),
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
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: specification metadata varies per review workflow
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
