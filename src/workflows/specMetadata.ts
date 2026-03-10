/**
 * Specification Metadata
 *
 * Types and schema for spec metadata persisted alongside spec markdown files.
 */

import { z } from 'zod';

/**
 * Specification metadata persisted alongside markdown
 */
export interface SpecMetadata {
  /** Feature identifier */
  featureId: string;
  /** Specification ID */
  specId: string;
  /** Spec file hash (SHA-256) */
  specHash: string;
  /** PRD file hash this spec is based on */
  prdHash: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Approval status */
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  /** Approval record IDs */
  approvals: string[];
  /** Version number */
  version: string;
  /** Trace identifier linking to PRD */
  traceId?: string;
}

export const SpecMetadataSchema = z.object({
  featureId: z.string(),
  specId: z.string(),
  specHash: z.string(),
  prdHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected', 'changes_requested']),
  approvals: z.array(z.string()),
  version: z.string(),
  traceId: z.string().optional(),
});
