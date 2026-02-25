/**
 * Specification Store
 *
 * File I/O operations for reading and writing spec artifacts with locking,
 * including approval record management and metadata persistence.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
import { type SpecMetadata, SpecMetadataSchema } from './specMetadata';

// ============================================================================
// Types
// ============================================================================

/**
 * Approval recording options
 */
export interface RecordSpecApprovalOptions {
  /** Signer identifier */
  signer: string;
  /** Signer display name */
  signerName?: string;
  /** Approval verdict */
  verdict: ApprovalVerdict;
  /** Rationale or comments */
  rationale?: string;
  /** Intentional: spec approval metadata varies by workflow */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Spec File I/O
// ============================================================================

/**
 * Write spec files (spec.md and spec.json) atomically under lock
 */
export async function writeSpecFiles(
  runDir: string,
  specMarkdown: string,
  specJson: string
): Promise<{ specPath: string; specJsonPath: string }> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  const specPath = path.join(artifactsDir, 'spec.md');
  const specJsonPath = path.join(artifactsDir, 'spec.json');

  await withLock(runDir, async () => {
    await fs.writeFile(specPath, specMarkdown, 'utf-8');
    await fs.writeFile(specJsonPath, specJson, 'utf-8');
  });

  return { specPath, specJsonPath };
}

/**
 * Write spec metadata file atomically under lock
 */
export async function writeSpecMetadata(runDir: string, metadata: SpecMetadata): Promise<string> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const metadataPath = path.join(artifactsDir, 'spec_metadata.json');

  await withLock(runDir, async () => {
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  });

  return metadataPath;
}

// ============================================================================
// Metadata Loading
// ============================================================================

/**
 * Load spec metadata from run directory
 */
export async function loadSpecMetadata(runDir: string): Promise<SpecMetadata | null> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const metadataPath = path.join(artifactsDir, 'spec_metadata.json');

  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    return validateOrThrow(
      SpecMetadataSchema,
      JSON.parse(content),
      'spec metadata'
    ) as SpecMetadata;
  } catch {
    return null;
  }
}

/**
 * Check if spec is approved
 */
export async function isSpecApproved(runDir: string): Promise<boolean> {
  const metadata = await loadSpecMetadata(runDir);
  return metadata?.approvalStatus === 'approved';
}

/**
 * Get spec approval records
 */
export async function getSpecApprovals(runDir: string): Promise<ApprovalRecord[]> {
  const metadata = await loadSpecMetadata(runDir);
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

      if (parsed.success && parsed.data.gate_type === 'spec') {
        records.push(parsed.data);
      }
    } catch {
      // Skip invalid or missing approval files
    }
  }

  return records;
}

// ============================================================================
// Approval Management
// ============================================================================

/**
 * Record specification approval
 */
export async function recordSpecApproval(
  runDir: string,
  featureId: string,
  options: RecordSpecApprovalOptions,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<ApprovalRecord> {
  logger.info('Recording spec approval', {
    featureId,
    signer: options.signer,
    verdict: options.verdict,
  });

  return withLock(runDir, async () => {
    // Step 1: Load spec metadata
    const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
    const metadataPath = path.join(artifactsDir, 'spec_metadata.json');
    const specPath = path.join(artifactsDir, 'spec.md');

    let metadata: SpecMetadata;
    try {
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      metadata = validateOrThrow(
        SpecMetadataSchema,
        JSON.parse(metadataContent),
        'spec metadata'
      ) as SpecMetadata;
    } catch (error) {
      throw new Error(
        `Failed to load spec metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }

    // Step 2: Verify spec hash matches
    const currentHash = await computeFileHash(specPath);
    if (currentHash !== metadata.specHash) {
      throw new Error(
        `Spec content has changed since metadata was last updated. ` +
          `Expected hash: ${metadata.specHash}, Current hash: ${currentHash}. ` +
          `Please regenerate spec or update metadata.`
      );
    }

    // Step 3: Create approval record
    const approvalId = `APR-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const approvalRecordOptions: {
      signerName?: string;
      artifactHash?: string;
      artifactPath?: string;
      rationale?: string;
      metadata?: Record<string, unknown>;
    } = {
      artifactHash: currentHash,
      artifactPath: 'artifacts/spec.md',
    };

    if (options.signerName) {
      approvalRecordOptions.signerName = options.signerName;
    }
    if (options.rationale) {
      approvalRecordOptions.rationale = options.rationale;
    }
    if (options.metadata) {
      approvalRecordOptions.metadata = options.metadata;
    }

    const approvalRecord = createApprovalRecord(
      approvalId,
      featureId,
      'spec',
      options.verdict,
      options.signer,
      approvalRecordOptions
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

    const approvalsIndexPath = path.join(runDir, 'approvals.json');
    let approvalsIndex: { approvals: ApprovalRecord[] } = { approvals: [] };

    try {
      const existingIndex = await fs.readFile(approvalsIndexPath, 'utf-8');
      approvalsIndex = validateOrThrow(
        z.object({ approvals: z.array(ApprovalRecordSchema) }),
        JSON.parse(existingIndex),
        'approvals index'
      );
    } catch (error) {
      if (!isFileNotFound(error)) {
        // Log non-ENOENT errors (e.g., JSON parse failures) but continue with empty index
        logger.warn('Failed to parse existing approvals.json, starting fresh', {
          featureId,
          error: getErrorMessage(error),
        });
      }
      // Index file may not exist yet - continue with empty index
    }

    approvalsIndex.approvals.push(approvalRecord);
    await fs.writeFile(approvalsIndexPath, JSON.stringify(approvalsIndex, null, 2), 'utf-8');

    logger.info('Spec approval recorded', {
      featureId,
      approvalId,
      verdict: options.verdict,
      artifactHash: currentHash,
    });

    metrics.increment('spec_approvals_recorded_total', {
      feature_id: featureId,
      verdict: options.verdict,
    });

    return approvalRecord;
  });
}
