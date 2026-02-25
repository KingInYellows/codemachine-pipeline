/**
 * PRD Store
 *
 * Persistence and approval state management for PRD documents.
 * Handles metadata loading, approval recording, and approval status checks.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { computeFileHash, withLock, getSubdirectoryPath } from '../persistence';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import {
  createApprovalRecord,
  serializeApprovalRecord,
  parseApprovalRecord,
  type ApprovalRecord,
  type ApprovalVerdict,
} from '../core/models/ApprovalRecord';

// ============================================================================
// Types
// ============================================================================

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
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Persistence Functions
// ============================================================================

/**
 * Load PRD metadata from run directory
 */
export async function loadPRDMetadata(runDir: string): Promise<PRDMetadata | null> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const metadataPath = path.join(artifactsDir, 'prd_metadata.json');

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    const parsedMetadata = JSON.parse(content) as unknown;
    return parsedMetadata as PRDMetadata;
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

  const approvalsDir = path.join(runDir, 'approvals');
  const records: ApprovalRecord[] = [];

  for (const approvalId of metadata.approvals) {
    const approvalPath = path.join(approvalsDir, `${approvalId}.json`);

    try {
      const content = await fs.readFile(approvalPath, 'utf-8');
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
export async function recordPRDApproval(
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
    const metadataPath = path.join(artifactsDir, 'prd_metadata.json');
    const prdPath = path.join(artifactsDir, 'prd.md');

    let metadata: PRDMetadata;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const parsedMetadata = JSON.parse(metadataContent) as unknown;
      metadata = parsedMetadata as PRDMetadata;
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
        `PRD content has changed since metadata was last updated. ` +
          `Expected hash: ${metadata.prdHash}, Current hash: ${currentHash}. ` +
          `Please regenerate PRD or update metadata.`
      );
    }

    // Step 3: Create approval record
    const approvalId = `APR-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const approvalOptions: {
      signerName?: string;
      artifactHash?: string;
      artifactPath?: string;
      rationale?: string;
      metadata?: Record<string, unknown>;
    } = {
      artifactHash: currentHash,
      artifactPath: 'docs/prd.md',
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
    const approvalsDir = path.join(runDir, 'approvals');
    await fs.mkdir(approvalsDir, { recursive: true });

    const approvalPath = path.join(approvalsDir, `${approvalId}.json`);
    await fs.writeFile(approvalPath, serializeApprovalRecord(approvalRecord), 'utf-8');

    // Step 5: Update metadata
    metadata.approvals.push(approvalId);
    metadata.approvalStatus =
      options.verdict === 'approved'
        ? 'approved'
        : options.verdict === 'rejected'
          ? 'rejected'
          : 'changes_requested';
    metadata.updatedAt = new Date().toISOString();

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Step 6: Update approvals.json in run root (if exists)
    const approvalsIndexPath = path.join(runDir, 'approvals.json');
    let approvalsIndex: { approvals: ApprovalRecord[] } = { approvals: [] };

    try {
      const existingContent = await fs.readFile(approvalsIndexPath, 'utf-8');
      const parsedIndex = JSON.parse(existingContent) as unknown;
      approvalsIndex = parsedIndex as { approvals: ApprovalRecord[] };
    } catch {
      // File doesn't exist yet, use empty array
    }

    approvalsIndex.approvals.push(approvalRecord);
    await fs.writeFile(approvalsIndexPath, JSON.stringify(approvalsIndex, null, 2), 'utf-8');

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
