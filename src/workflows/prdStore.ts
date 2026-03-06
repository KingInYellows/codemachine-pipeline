/**
 * PRD Store
 *
 * Persistence and approval state management for PRD documents.
 * Handles metadata loading, approval recording, and approval status checks.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { validateOrThrow } from '../validation/helpers.js';
import { computeFileHash, withLock, getSubdirectoryPath } from '../persistence';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import {
  createApprovalRecord,
  serializeApprovalRecord,
  parseApprovalRecord,
  ApprovalRecordSchema,
  type ApprovalRecord,
  type ApprovalVerdict,
} from '../core/models/ApprovalRecord';
import { isFileNotFound } from '../utils/safeJson';
import { getErrorMessage } from '../utils/errors.js';

/**
 * PRD metadata persisted alongside markdown
 */
export interface PRDMetadata {
  /** Feature identifier */
  featureId: string;
  /** PRD file hash (SHA-256) */
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
  /** Trace identifier */
  traceId?: string;
}

const PRDMetadataSchema = z.object({
  featureId: z.string(),
  prdHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected', 'changes_requested']),
  approvals: z.array(z.string()),
  version: z.string(),
  traceId: z.string().optional(),
});

/**
 * Approval recording options
 */
export interface RecordApprovalOptions {
  /** Signer identifier */
  signer: string;
  /** Signer display name */
  signerName?: string;
  /** Approval verdict */
  verdict: ApprovalVerdict;
  /** Rationale or comments */
  rationale?: string;
  /** Intentional: approval metadata varies by workflow */
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: approval metadata varies by workflow
  metadata?: Record<string, unknown>;
}

/**
 * Load PRD metadata from run directory
 */
export async function loadPRDMetadata(runDir: string): Promise<PRDMetadata | null> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const metadataPath = join(artifactsDir, 'prd_metadata.json');

  try {
    const content = await readFile(metadataPath, 'utf-8');
    return validateOrThrow(PRDMetadataSchema, JSON.parse(content), 'prd metadata') as PRDMetadata;
  } catch {
    return null;
  }
}

/**
 * Check if PRD is approved
 */
export async function isPRDApproved(runDir: string): Promise<boolean> {
  const metadata = await loadPRDMetadata(runDir);
  return metadata?.approvalStatus === 'approved';
}

/**
 * Get PRD approval records
 */
export async function getPRDApprovals(runDir: string): Promise<ApprovalRecord[]> {
  const metadata = await loadPRDMetadata(runDir);
  if (!metadata || metadata.approvals.length === 0) {
    return [];
  }

  const approvalsDir = join(runDir, 'approvals');
  const records: ApprovalRecord[] = [];

  for (const approvalId of metadata.approvals) {
    const approvalPath = join(approvalsDir, `${approvalId}.json`);

    try {
      const content = await readFile(approvalPath, 'utf-8');
      const parsed = parseApprovalRecord(JSON.parse(content));

      if (parsed.success && parsed.data.gate_type === 'prd') {
        records.push(parsed.data);
      }
    } catch {
      // Skip invalid or missing approval files
    }
  }

  return records;
}

/**
 * Record PRD approval
 */
export function recordPRDApproval(
  runDir: string,
  featureId: string,
  options: RecordApprovalOptions,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<ApprovalRecord> {
  logger.info('Recording PRD approval', {
    featureId,
    signer: options.signer,
    verdict: options.verdict,
  });

  return withLock(runDir, async () => {
    // Step 1: Load PRD metadata
    const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
    const metadataPath = join(artifactsDir, 'prd_metadata.json');
    const prdPath = join(artifactsDir, 'prd.md');

    let metadata: PRDMetadata;
    try {
      const metadataContent = await readFile(metadataPath, 'utf-8');
      metadata = validateOrThrow(
        PRDMetadataSchema,
        JSON.parse(metadataContent),
        'prd metadata'
      ) as PRDMetadata;
    } catch (error) {
      throw new Error(
        `Failed to load PRD metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }

    // Step 2: Verify PRD hash matches
    const currentHash = await computeFileHash(prdPath);
    if (currentHash !== metadata.prdHash) {
      throw new Error(
        'PRD content has changed since metadata was last updated. ' +
          `Expected hash: ${metadata.prdHash}, Current hash: ${currentHash}. ` +
          'Please regenerate PRD or update metadata.'
      );
    }

    // Step 3: Create approval record
    const approvalId = `APR-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const approvalOptions: {
      signerName?: string;
      artifactHash?: string;
      artifactPath?: string;
      rationale?: string;
      // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: approval metadata varies by workflow
      metadata?: Record<string, unknown>;
    } = {
      artifactHash: currentHash,
      artifactPath: 'artifacts/prd.md',
    };

    if (options.signerName) {
      approvalOptions.signerName = options.signerName;
    }
    if (options.rationale) {
      approvalOptions.rationale = options.rationale;
    }
    if (options.metadata) {
      approvalOptions.metadata = options.metadata;
    }

    const approvalRecord = createApprovalRecord(
      approvalId,
      featureId,
      'prd',
      options.verdict,
      options.signer,
      approvalOptions
    );

    // Step 4: Save approval record
    const approvalsDir = join(runDir, 'approvals');
    await mkdir(approvalsDir, { recursive: true });

    const approvalPath = join(approvalsDir, `${approvalId}.json`);
    await writeFile(approvalPath, serializeApprovalRecord(approvalRecord), 'utf-8');

    // Step 5: Update metadata
    metadata.approvals.push(approvalId);
    metadata.approvalStatus =
      options.verdict === 'approved'
        ? 'approved'
        : options.verdict === 'rejected'
          ? 'rejected'
          : 'changes_requested';
    metadata.updatedAt = new Date().toISOString();

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Step 6: Update approvals.json in run root (if exists)
    const approvalsIndexPath = join(runDir, 'approvals.json');
    let approvalsIndex: { approvals: ApprovalRecord[] } = { approvals: [] };
    let shouldWriteApprovalsIndex = true;

    try {
      const existingContent = await readFile(approvalsIndexPath, 'utf-8');
      approvalsIndex = validateOrThrow(
        z.object({ approvals: z.array(ApprovalRecordSchema) }),
        JSON.parse(existingContent),
        'approvals index'
      );
    } catch (error) {
      const missingApprovalsIndex =
        isFileNotFound(error) || (error instanceof Error && error.message.includes('ENOENT'));

      if (missingApprovalsIndex) {
        approvalsIndex = { approvals: [] };
      } else {
        // Preserve existing file if it cannot be parsed to avoid destructive overwrite.
        shouldWriteApprovalsIndex = false;
        logger.warn('Failed to parse existing approvals.json; leaving file unchanged', {
          featureId,
          error: getErrorMessage(error),
        });
      }
    }

    if (shouldWriteApprovalsIndex) {
      approvalsIndex.approvals.push(approvalRecord);
      await writeFile(approvalsIndexPath, JSON.stringify(approvalsIndex, null, 2), 'utf-8');
    }

    logger.info('PRD approval recorded', {
      featureId,
      approvalId,
      verdict: options.verdict,
      artifactHash: currentHash,
    });

    metrics.increment('prd_approvals_recorded_total', {
      feature_id: featureId,
      verdict: options.verdict,
    });

    return approvalRecord;
  });
}
