/**
 * Linear Adapter Type Definitions
 *
 * Shared interfaces for the LinearAdapter module.
 */

import { z } from 'zod';
import type { ErrorType } from '../http/client';
import type { LoggerInterface } from '../../telemetry/logger';

/**
 * Linear adapter configuration
 */
export interface LinearAdapterConfig {
  organization?: string;
  apiKey: string;
  mcpEndpoint?: string;
  runDir?: string;
  logger?: LoggerInterface;
  timeout?: number;
  maxRetries?: number;
  enablePreviewFeatures?: boolean;
}

/**
 * Linear issue snapshot
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { id: string; name: string; type: string };
  priority: number;
  labels: Array<{ id: string; name: string; color: string }>;
  assignee: { id: string; name: string; email: string } | null;
  team: { id: string; name: string; key: string };
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/**
 * Linear issue comment
 */
export interface LinearComment {
  id: string;
  body: string;
  user: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
}

/**
 * Cached snapshot metadata
 */
export interface SnapshotMetadata {
  issueId: string;
  retrieved_at: string;
  hash: string;
  ttl?: number;
  isPreview?: boolean;
  last_error?: {
    timestamp: string;
    message: string;
    type: ErrorType;
  };
}

/**
 * Issue snapshot with metadata
 */
export interface IssueSnapshot {
  issue: LinearIssue;
  comments: LinearComment[];
  metadata: SnapshotMetadata;
}

export const IssueSnapshotSchema = z.object({
  issue: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.object({ id: z.string(), name: z.string(), type: z.string() }),
    priority: z.number(),
    labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
    assignee: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
    team: z.object({ id: z.string(), name: z.string(), key: z.string() }),
    project: z.object({ id: z.string(), name: z.string() }).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    url: z.string(),
  }),
  comments: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  metadata: z.object({
    issueId: z.string(),
    retrieved_at: z.string(),
    hash: z.string(),
    ttl: z.number().optional(),
    isPreview: z.boolean().optional(),
    last_error: z
      .object({
        timestamp: z.string(),
        message: z.string(),
        type: z.string(),
      })
      .optional(),
  }),
});

/**
 * Linear issue relation (blocks / duplicate / related)
 *
 * Relations are directional: when A blocks B, a relation exists with
 * type: "blocks", issue: A, relatedIssue: B.
 */
export interface LinearIssueRelation {
  type: 'blocks' | 'duplicate' | 'related';
  issue: { id: string; identifier: string };
  relatedIssue: { id: string; identifier: string };
}

export const LinearIssueRelationSchema = z.object({
  type: z.enum(['blocks', 'duplicate', 'related']),
  issue: z.object({ id: z.string(), identifier: z.string() }),
  relatedIssue: z.object({ id: z.string(), identifier: z.string() }),
});

/**
 * Linear issue with relations — used in cycle queries
 */
export interface LinearCycleIssue extends LinearIssue {
  relations: LinearIssueRelation[];
}

export const LinearCycleIssueSchema = IssueSnapshotSchema.shape.issue.extend({
  relations: z.array(LinearIssueRelationSchema),
});

/**
 * Linear cycle metadata
 */
export interface LinearCycle {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  issues: LinearCycleIssue[];
}

export const LinearCycleSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
  issues: z.array(LinearCycleIssueSchema),
});

/**
 * Cycle snapshot with metadata
 */
export interface CycleSnapshot {
  cycle: LinearCycle;
  metadata: {
    retrievedAt: string;
    teamId: string;
    issueCount: number;
  };
}

export const CycleSnapshotSchema = z.object({
  cycle: LinearCycleSchema,
  metadata: z.object({
    retrievedAt: z.string(),
    teamId: z.string(),
    issueCount: z.number(),
  }),
});

/**
 * Update issue parameters
 */
export interface UpdateIssueParams {
  issueId: string;
  title?: string;
  description?: string;
  stateId?: string;
  priority?: number;
  assigneeId?: string;
}

/**
 * Post comment parameters
 */
export interface PostCommentParams {
  issueId: string;
  body: string;
}
