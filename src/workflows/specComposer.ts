/**
 * Specification Composer
 *
 * Converts approved PRD and research data into a structured engineering specification.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { computeFileHash, getSubdirectoryPath } from '../persistence';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ContextDocument } from '../core/models/ContextDocument';
import type { ResearchTask } from '../core/models/ResearchTask';
import type { Feature } from '../core/models/Feature';
import type { RepoConfig } from '../core/config/RepoConfig';
import type { PRDDocument } from './prdAuthoringEngine';
import { isPRDApproved, loadPRDMetadata } from './prdStore';
import {
  createSpecification,
  addChangeLogEntry,
  serializeSpecification,
  parseSpecification,
  formatSpecificationValidationErrors,
  type Specification,
} from '../core/models/Specification';
import {
  extractPRDSections,
  extractConstraints,
  deriveReferencedFileGlobs,
  detectUnknowns,
} from './specParsing';
import { writeSpecFiles, writeSpecMetadata } from './specStore';
import type { SpecMetadata } from './specMetadata';
import {
  generateRiskAssessments,
  generateTestPlan,
  generateRolloutPlan,
  generateSpecMarkdown,
} from './specMarkdown';

// Re-export types and functions from extracted modules for backward compatibility
export type { SpecMetadata } from './specMetadata';
export {
  loadSpecMetadata,
  isSpecApproved,
  getSpecApprovals,
  recordSpecApproval,
  type RecordSpecApprovalOptions,
} from './specStore';

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

  const prdApproved = await isPRDApproved(config.runDir);
  if (!prdApproved) {
    throw new Error(
      'PRD must be approved before generating specification. ' +
        'Use `codepipe approve prd` to approve the PRD first. (Exit code: 30)'
    );
  }

  const prdMetadata = await loadPRDMetadata(config.runDir);
  if (!prdMetadata) {
    throw new Error('PRD metadata not found. Generate PRD first using `codepipe start`.');
  }

  const artifactsDir = getSubdirectoryPath(config.runDir, 'artifacts');
  const prdPath = path.join(artifactsDir, 'prd.md');
  const prdMarkdown = await fs.readFile(prdPath, 'utf-8');

  const prdSections = extractPRDSections(prdMarkdown);
  const constraints = extractConstraints(prdSections, config.contextDocument, config.repoConfig);
  const risks = generateRiskAssessments(prdSections.risks, config.researchTasks);
  const testPlan = generateTestPlan(prdSections.acceptanceCriteria, constraints);
  const rolloutPlan = generateRolloutPlan(risks);
  const referencedFileGlobs = deriveReferencedFileGlobs(config.contextDocument, config.repoConfig);

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

  const referencedFiles = Object.keys(config.contextDocument.files).slice(0, 20);
  const specMarkdown = generateSpecMarkdown(
    specification,
    prdMetadata,
    constraints,
    referencedFiles,
    referencedFileGlobs
  );

  const { specPath, specJsonPath } = await writeSpecFiles(
    config.runDir,
    specMarkdown,
    serializeSpecification(specification)
  );

  const specHash = await computeFileHash(specPath);

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

  const metadataPath = await writeSpecMetadata(config.runDir, metadata);

  const unknowns = detectUnknowns(specMarkdown, prdSections, prdMarkdown);
  const incompleteSections: string[] = [];
  if (specContent.includes('TODO')) incompleteSections.push('content');
  if (constraints.length === 0) incompleteSections.push('constraints');
  if (testPlan.length === 0) incompleteSections.push('test_plan');

  const warnings: string[] = [];
  if (unknowns.length > 0)
    warnings.push(`${unknowns.length} unknown(s) detected requiring research`);
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
