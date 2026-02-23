/**
 * Specification Composer
 *
 * Converts approved PRD + research data into structured engineering specification
 * covering constraints, rollout plan, test plan, and risks. Supports CLI editing
 * loops, highlights unknowns requiring more research, and stores change logs.
 *
 * Key features:
 * - PRD-to-Spec transformation with constraint extraction
 * - Test plan and rollout plan generation
 * - Risk assessment integration from research
 * - Change log tracking for iterative refinement
 * - Unknown detection and research task triggering
 * - Approval workflow integration
 *
 * Implements:
 * - FR-10 (Specification Authoring): Spec generation and review
 * - FR-9 (Traceability): PRD → Spec → Plan mapping
 * - ADR-5 (Approval Workflow): Human-in-the-loop gates
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { validateOrThrow } from '../validation/helpers.js';
import { computeFileHash } from '../persistence/hashManifest';
import { withLock, getSubdirectoryPath } from '../persistence/runDirectoryManager';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ContextDocument } from '../core/models/ContextDocument';
import type { ResearchTask } from '../core/models/ResearchTask';
import type { Feature } from '../core/models/Feature';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { PRDDocument } from './prdAuthoringEngine';
import { isPRDApproved, loadPRDMetadata } from './prdAuthoringEngine';
import { getErrorMessage } from '../utils/errors.js';
import {
  createSpecification,
  addChangeLogEntry,
  serializeSpecification,
  parseSpecification,
  formatSpecificationValidationErrors,
  type Specification,
} from '../core/models/Specification';
import {
  createApprovalRecord,
  serializeApprovalRecord,
  parseApprovalRecord,
  ApprovalRecordSchema,
  type ApprovalRecord,
  type ApprovalVerdict,
} from '../core/models/ApprovalRecord';
import { isFileNotFound } from '../utils/safeJson';
import {
  extractPRDSections,
  extractConstraints,
  deriveReferencedFileGlobs,
  detectUnknowns,
} from './specParsing';
import { generateRiskAssessments, generateTestPlan, generateRolloutPlan } from './specGenerators';
import { generateSpecMarkdown } from './specRendering';

// ============================================================================
// Types
// ============================================================================

/**
 * Specification composer configuration
 */
export interface SpecComposerConfig {
  /** Repository root directory */
  repoRoot: string;
  /** Run directory path */
  runDir: string;
  /** Feature metadata */
  feature: Feature;
  /** Context document */
  contextDocument: ContextDocument;
  /** Completed research tasks */
  researchTasks: ResearchTask[];
  /** Repository configuration */
  repoConfig: RepoConfig;
  /** PRD document (optional if loading from disk) */
  prdDocument?: PRDDocument;
  /** Enable agent-assisted drafting (optional) */
  useAgent?: boolean;
}

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

const SpecMetadataSchema = z.object({
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

/**
 * Result of specification generation
 */
export interface SpecComposerResult {
  /** Structured specification document */
  specification: Specification;
  /** Path to generated spec.md file */
  specPath: string;
  /** SHA-256 hash of spec.md */
  specHash: string;
  /** Path to metadata file */
  metadataPath: string;
  /** Path to JSON representation */
  specJsonPath: string;
  /** Generation diagnostics */
  diagnostics: {
    /** Whether agent was used */
    usedAgent: boolean;
    /** Sections with incomplete content */
    incompleteSections: string[];
    /** Unknowns detected requiring research */
    unknowns: Array<{
      section: string;
      description: string;
      suggestedObjective: string;
    }>;
    /** Citations count */
    totalCitations: number;
    /** Warnings */
    warnings: string[];
  };
}

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
// Main Composer Function
// ============================================================================

/**
 * Compose engineering specification from approved PRD and research
 */
export async function composeSpecification(
  config: SpecComposerConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<SpecComposerResult> {
  logger.info('Starting specification composition', {
    featureId: config.feature.feature_id,
    researchTasks: config.researchTasks.length,
  });

  // Step 1: Verify PRD is approved
  const prdApproved = await isPRDApproved(config.runDir);
  if (!prdApproved) {
    throw new Error(
      'PRD must be approved before generating specification. ' +
        'Use `codepipe approve prd` to approve the PRD first. (Exit code: 30)'
    );
  }

  // Step 2: Load PRD metadata and document
  const prdMetadata = await loadPRDMetadata(config.runDir);
  if (!prdMetadata) {
    throw new Error('PRD metadata not found. Generate PRD first using `codepipe start`.');
  }

  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  const prdPath = path.join(artifactsDir, 'prd.md');
  const prdMarkdown = await fs.readFile(prdPath, 'utf-8');

  // Step 3: Extract PRD sections
  const prdSections = extractPRDSections(prdMarkdown);

  // Step 4: Generate specification components
  const constraints = extractConstraints(prdSections, config.contextDocument, config.repoConfig);
  const risks = generateRiskAssessments(prdSections.risks, config.researchTasks);
  const testPlan = generateTestPlan(prdSections.acceptanceCriteria, constraints);
  const rolloutPlan = generateRolloutPlan(risks);
  const referencedFileGlobs = deriveReferencedFileGlobs(config.contextDocument, config.repoConfig);

  // Step 5: Build specification content
  const specContent = [
    '## Overview',
    '',
    prdSections.problemStatement,
    '',
    '## Goals',
    '',
    ...prdSections.goals.map((g) => `- ${g}`),
    '',
    '## Non-Goals',
    '',
    ...prdSections.nonGoals.map((g) => `- ${g}`),
    '',
    '## Acceptance Criteria',
    '',
    ...prdSections.acceptanceCriteria.map((a) => `- ${a}`),
    '',
  ].join('\n');

  // Step 6: Create structured specification
  const now = new Date().toISOString();
  const specId = `SPEC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  let specification = createSpecification(
    specId,
    config.feature.feature_id,
    config.feature.title ?? 'Untitled Feature',
    specContent,
    {
      risks,
      testPlan,
      rolloutPlan,
      metadata: {
        prdHash: prdMetadata.prdHash,
        prdVersion: prdMetadata.version,
        traceId: prdMetadata.traceId,
      },
    }
  );

  specification = addChangeLogEntry(
    specification,
    config.useAgent ? 'spec-composer:agent' : 'spec-composer',
    `Initial specification draft generated from PRD hash ${prdMetadata.prdHash.substring(0, 12)}.`,
    'v1.0.0'
  );

  const validation = parseSpecification(specification);
  if (!validation.success) {
    throw new Error(formatSpecificationValidationErrors(validation.errors));
  }

  specification = validation.data;

  // Step 7: Generate markdown
  const referencedFiles = Object.keys(config.contextDocument.files).slice(0, 20);
  const specMarkdown = generateSpecMarkdown(
    specification,
    prdMetadata,
    constraints,
    referencedFiles,
    referencedFileGlobs
  );

  // Step 8: Persist to disk
  await fs.mkdir(artifactsDir, { recursive: true });

  const specPath = path.join(artifactsDir, 'spec.md');
  const specJsonPath = path.join(artifactsDir, 'spec.json');
  const metadataPath = path.join(artifactsDir, 'spec_metadata.json');
  const specJson = serializeSpecification(specification);

  await withLock(config.runDir, async () => {
    await fs.writeFile(specPath, specMarkdown, 'utf-8');
    await fs.writeFile(specJsonPath, specJson, 'utf-8');
  });

  // Step 9: Compute hash
  const specHash = await computeFileHash(specPath);

  // Step 10: Save metadata
  const metadata: SpecMetadata = {
    featureId: config.feature.feature_id,
    specId,
    specHash,
    prdHash: prdMetadata.prdHash,
    createdAt: now,
    updatedAt: now,
    approvalStatus: 'pending',
    approvals: [],
    version: '1.0.0',
  };

  if (prdMetadata.traceId) {
    metadata.traceId = prdMetadata.traceId;
  }

  await withLock(config.runDir, async () => {
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  });

  // Step 11: Detect unknowns
  const unknowns = detectUnknowns(specMarkdown, prdSections, prdMarkdown);

  // Step 12: Identify incomplete sections
  const incompleteSections: string[] = [];
  if (specContent.includes('TODO')) incompleteSections.push('content');
  if (constraints.length === 0) incompleteSections.push('constraints');
  if (testPlan.length === 0) incompleteSections.push('test_plan');

  const warnings: string[] = [];
  if (unknowns.length > 0) {
    warnings.push(`${unknowns.length} unknown(s) detected requiring research`);
  }
  if (incompleteSections.length > 0) {
    warnings.push(
      `${incompleteSections.length} section(s) incomplete: ${incompleteSections.join(', ')}`
    );
  }

  logger.info('Specification composition completed', {
    featureId: config.feature.feature_id,
    specId,
    specHash,
    unknowns: unknowns.length,
    warnings: warnings.length,
  });

  metrics.increment('specifications_generated_total', {
    feature_id: config.feature.feature_id,
  });

  return {
    specification,
    specPath,
    specHash,
    metadataPath,
    specJsonPath,
    diagnostics: {
      usedAgent: Boolean(config.useAgent),
      incompleteSections,
      unknowns,
      totalCitations:
        config.researchTasks.length + Object.keys(config.contextDocument.files).length,
      warnings,
    },
  };
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
