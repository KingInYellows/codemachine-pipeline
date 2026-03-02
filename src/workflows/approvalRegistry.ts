import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../utils/atomicWrite.js';
import { z } from 'zod';
import {
  type ApprovalRecord,
  type ApprovalGateType,
  ApprovalRecordSchema,
  createApprovalRecord,
  parseApprovalRecord,
} from '../core/models/ApprovalRecord';
import { withLock, readManifest, writeManifest } from '../persistence';
import { validateOrThrow } from '../validation/helpers.js';

/**
 * Approval Registry Service
 *
 * Manages approval records for feature pipeline gates.
 * Provides atomic operations for requesting, granting, denying, and validating approvals.
 *
 * Provides human-in-the-loop governance with artifact hash validation.
 * - Atomic file operations with locking
 *
 * Used by: CLI approve command, status command, resume command
 */

export interface RequestApprovalOptions {
  /** Path to artifact requiring approval (relative to run directory) */
  artifactPath: string;
  /** SHA-256 hash of artifact content */
  artifactHash: string;
  /** Intentional: approval request metadata varies by workflow */
  metadata?: Record<string, unknown>;
}

export interface GrantApprovalOptions {
  /** Signer identifier (email or username) */
  signer: string;
  /** Signer display name */
  signerName?: string;
  /** Approval rationale or comments */
  rationale?: string;
  /** Artifact path associated with approval */
  artifactPath?: string;
  /** Intentional: approval grant metadata varies by workflow */
  metadata?: Record<string, unknown>;
}

export interface DenyApprovalOptions {
  /** Signer identifier (email or username) */
  signer: string;
  /** Signer display name */
  signerName?: string;
  /** Reason for denial */
  reason: string;
  /** Artifact path associated with denial */
  artifactPath?: string;
  /** Intentional: approval denial metadata varies by workflow */
  metadata?: Record<string, unknown>;
}

export interface ApprovalValidationResult {
  /** Whether approval exists and is valid */
  valid: boolean;
  /** Approval record if exists */
  approval?: ApprovalRecord;
  /** Validation errors */
  errors: string[];
}

export interface ApprovalsFile {
  /** Schema version */
  schema_version: string;
  /** Feature ID */
  feature_id: string;
  /** List of approval records */
  approvals: ApprovalRecord[];
  /** Intentional: approvals-file metadata is consumer-defined */
  metadata?: Record<string, unknown>;
}

const ApprovalsFileSchema = z
  .object({
    schema_version: z.string(),
    feature_id: z.string(),
    approvals: z.array(ApprovalRecordSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const APPROVALS_FILE_NAME = 'approvals.json';
const APPROVALS_SCHEMA_VERSION = '1.0.0';

/**
 * Request approval for an artifact
 *
 * Creates a pending approval record and updates manifest.
 *
 * @param runDir - Run directory path
 * @param gateType - Type of approval gate
 * @param options - Request options
 */
export async function requestApproval(
  runDir: string,
  gateType: ApprovalGateType,
  options: RequestApprovalOptions
): Promise<ApprovalRecord> {
  return withLock(runDir, async () => {
    const manifest = await readManifest(runDir);
    const featureId = manifest.feature_id;

    // Create approval record with 'requested_changes' as pending state
    const approvalId = `${gateType}-${randomUUID().split('-')[0]}`;
    const record = createApprovalRecord(
      approvalId,
      featureId,
      gateType,
      'requested_changes',
      'system',
      {
        artifactHash: options.artifactHash,
        artifactPath: options.artifactPath,
        rationale: 'Approval requested - awaiting human review',
        metadata: {
          ...(options.metadata ?? {}),
          requested_at: new Date().toISOString(),
          status: 'pending',
        },
      }
    );

    // Append to approvals file
    await appendApprovalRecord(runDir, featureId, record);

    // Update manifest pending approvals (inline to avoid nested withLock deadlock)
    if (!manifest.approvals.pending.includes(gateType)) {
      const updated = {
        ...manifest,
        approvals: {
          ...manifest.approvals,
          pending: [...manifest.approvals.pending, gateType],
        },
        timestamps: {
          ...manifest.timestamps,
          updated_at: new Date().toISOString(),
        },
      };
      await writeManifest(runDir, updated);
    }

    return record;
  });
}

/**
 * Grant approval for an artifact
 *
 * Updates approval record with approval verdict and updates manifest.
 *
 * @param runDir - Run directory path
 * @param gateType - Type of approval gate
 * @param artifactHash - Expected artifact hash for validation
 * @param options - Grant options
 * @returns Updated approval record
 */
export async function grantApproval(
  runDir: string,
  gateType: ApprovalGateType,
  artifactHash: string,
  options: GrantApprovalOptions
): Promise<ApprovalRecord> {
  return withLock(runDir, async () => {
    const manifest = await readManifest(runDir);
    const featureId = manifest.feature_id;

    const approvalsData = await loadApprovalsFile(runDir, featureId);
    const existingRecord = findLatestApprovalForGate(approvalsData.approvals, gateType);

    if (existingRecord && existingRecord.artifact_hash !== artifactHash) {
      throw new Error(
        `Artifact hash mismatch: expected ${existingRecord.artifact_hash} but got ${artifactHash}. ` +
          `The artifact may have been modified since approval was requested.`
      );
    }

    const approvalId = `${gateType}-${randomUUID().split('-')[0]}`;
    const recordOptions: Parameters<typeof createApprovalRecord>[5] = {
      artifactHash,
      metadata: {
        ...(options.metadata ?? {}),
        approved_at: new Date().toISOString(),
        status: 'approved',
      },
    };

    if (options.artifactPath) {
      recordOptions.artifactPath = options.artifactPath;
    } else if (existingRecord?.artifact_path) {
      recordOptions.artifactPath = existingRecord.artifact_path;
    }

    if (options.signerName) {
      recordOptions.signerName = options.signerName;
    }

    if (options.artifactPath) {
      recordOptions.artifactPath = options.artifactPath;
    }

    if (options.rationale) {
      recordOptions.rationale = options.rationale;
    }

    const record = createApprovalRecord(
      approvalId,
      featureId,
      gateType,
      'approved',
      options.signer,
      recordOptions
    );

    await appendApprovalRecord(runDir, featureId, record);

    // Update manifest inline (move from pending to completed, avoiding nested withLock deadlock)
    const pending = manifest.approvals.pending.filter((a: string) => a !== gateType);
    const completedSet = new Set(manifest.approvals.completed);
    completedSet.add(gateType);
    const updated = {
      ...manifest,
      approvals: {
        ...manifest.approvals,
        pending,
        completed: Array.from(completedSet),
      },
      timestamps: {
        ...manifest.timestamps,
        updated_at: new Date().toISOString(),
      },
    };
    await writeManifest(runDir, updated);

    return record;
  });
}

/**
 * Deny approval for an artifact
 *
 * Updates approval record with rejection verdict.
 *
 * @param runDir - Run directory path
 * @param gateType - Type of approval gate
 * @param options - Deny options
 * @returns Updated approval record
 */
export async function denyApproval(
  runDir: string,
  gateType: ApprovalGateType,
  options: DenyApprovalOptions
): Promise<ApprovalRecord> {
  return withLock(runDir, async () => {
    const manifest = await readManifest(runDir);
    const featureId = manifest.feature_id;

    const approvalId = `${gateType}-${randomUUID().split('-')[0]}`;
    const recordOptions: Parameters<typeof createApprovalRecord>[5] = {
      rationale: options.reason,
      metadata: {
        ...(options.metadata ?? {}),
        rejected_at: new Date().toISOString(),
        status: 'rejected',
      },
    };

    if (options.signerName) {
      recordOptions.signerName = options.signerName;
    }

    const record = createApprovalRecord(
      approvalId,
      featureId,
      gateType,
      'rejected',
      options.signer,
      recordOptions
    );

    await appendApprovalRecord(runDir, featureId, record);

    // Keep in pending state (rejection doesn't complete approval)
    // User must fix issues and request approval again

    return record;
  });
}

/**
 * Get all pending approvals for a feature
 *
 * @param runDir - Run directory path
 * @returns Array of pending approval gate types
 */
export async function getPendingApprovals(runDir: string): Promise<string[]> {
  const manifest = await readManifest(runDir);
  return manifest.approvals.pending;
}

/**
 * Get approval history for a feature
 *
 * @param runDir - Run directory path
 * @returns Array of all approval records
 */
export async function getApprovalHistory(runDir: string): Promise<ApprovalRecord[]> {
  const manifest = await readManifest(runDir);
  const featureId = manifest.feature_id;
  const approvalsData = await loadApprovalsFile(runDir, featureId);
  return approvalsData.approvals;
}

/**
 * Validate that an approval exists for a gate type and matches the current artifact
 *
 * @param runDir - Run directory path
 * @param gateType - Type of approval gate
 * @param currentArtifactHash - Current artifact hash for validation
 * @returns Validation result
 */
export async function validateApprovalForTransition(
  runDir: string,
  gateType: ApprovalGateType,
  currentArtifactHash: string
): Promise<ApprovalValidationResult> {
  const errors: string[] = [];

  try {
    const manifest = await readManifest(runDir);
    const featureId = manifest.feature_id;

    // Check if approval is pending
    if (!manifest.approvals.completed.includes(gateType)) {
      errors.push(`No completed approval found for ${gateType} gate`);
      return { valid: false, errors };
    }

    // Load approvals and find latest approved record
    const approvalsData = await loadApprovalsFile(runDir, featureId);
    const latestApproval = findLatestApprovedForGate(approvalsData.approvals, gateType);

    if (!latestApproval) {
      errors.push(`No approved record found for ${gateType} gate`);
      return { valid: false, errors };
    }

    // Validate artifact hash matches
    if (latestApproval.artifact_hash && latestApproval.artifact_hash !== currentArtifactHash) {
      errors.push(
        `Artifact hash mismatch for ${gateType}: approval hash ${latestApproval.artifact_hash} ` +
          `does not match current artifact hash ${currentArtifactHash}. ` +
          `Artifact may have been modified after approval.`
      );
      return { valid: false, approval: latestApproval, errors };
    }

    return { valid: true, approval: latestApproval, errors: [] };
  } catch (error) {
    errors.push(
      `Failed to validate approval: ${error instanceof Error ? error.message : 'unknown error'}`
    );
    return { valid: false, errors };
  }
}

/**
 * Compute SHA-256 hash of a file
 *
 * @param filePath - Absolute path to file
 * @returns SHA-256 hash (hex)
 */
export async function computeArtifactHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Compute SHA-256 hash of string content
 *
 * @param content - String content
 * @returns SHA-256 hash (hex)
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Load approvals file from run directory
 */
async function loadApprovalsFile(runDir: string, featureId: string): Promise<ApprovalsFile> {
  const approvalsPath = path.join(runDir, 'approvals', APPROVALS_FILE_NAME);

  try {
    const content = await fs.readFile(approvalsPath, 'utf-8');
    const parsed = validateOrThrow(
      ApprovalsFileSchema,
      JSON.parse(content),
      'approvals file'
    ) as ApprovalsFile;

    // Validate schema version
    if (parsed.schema_version !== APPROVALS_SCHEMA_VERSION) {
      throw new Error(
        `Approvals file schema version mismatch: expected ${APPROVALS_SCHEMA_VERSION}, got ${parsed.schema_version}`
      );
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        schema_version: APPROVALS_SCHEMA_VERSION,
        feature_id: featureId,
        approvals: [],
      };
    }
    throw error;
  }
}

/**
 * Save approvals file to run directory
 */
async function saveApprovalsFile(runDir: string, data: ApprovalsFile): Promise<void> {
  const approvalsDir = path.join(runDir, 'approvals');
  const approvalsPath = path.join(approvalsDir, APPROVALS_FILE_NAME);

  await fs.mkdir(approvalsDir, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  await atomicWriteFile(approvalsPath, content);
}

/**
 * Append approval record to approvals file
 */
async function appendApprovalRecord(
  runDir: string,
  featureId: string,
  record: ApprovalRecord
): Promise<void> {
  const approvalsData = await loadApprovalsFile(runDir, featureId);

  // Validate record
  const parseResult = parseApprovalRecord(record);
  if (!parseResult.success) {
    throw new Error(
      `Invalid approval record: ${parseResult.errors.map((e) => `${e.path}: ${e.message}`).join(', ')}`
    );
  }

  // Append to approvals array
  approvalsData.approvals.push(record);

  // Update metadata
  approvalsData.metadata = {
    ...approvalsData.metadata,
    updated_at: new Date().toISOString(),
    total_approvals: approvalsData.approvals.length,
  };

  await saveApprovalsFile(runDir, approvalsData);
}

/**
 * Find latest approval record for a gate type (regardless of verdict)
 */
function findLatestApprovalForGate(
  approvals: ApprovalRecord[],
  gateType: ApprovalGateType
): ApprovalRecord | undefined {
  const gateApprovals = approvals.filter((a) => a.gate_type === gateType);
  if (gateApprovals.length === 0) {
    return undefined;
  }

  // Sort by approved_at descending
  return gateApprovals.sort((a, b) => {
    return new Date(b.approved_at).getTime() - new Date(a.approved_at).getTime();
  })[0];
}

/**
 * Find latest approved record for a gate type
 */
function findLatestApprovedForGate(
  approvals: ApprovalRecord[],
  gateType: ApprovalGateType
): ApprovalRecord | undefined {
  const approvedRecords = approvals.filter(
    (a) => a.gate_type === gateType && a.verdict === 'approved'
  );

  if (approvedRecords.length === 0) {
    return undefined;
  }

  // Sort by approved_at descending
  return approvedRecords.sort((a, b) => {
    return new Date(b.approved_at).getTime() - new Date(a.approved_at).getTime();
  })[0];
}
