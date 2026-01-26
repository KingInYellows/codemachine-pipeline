/**
 * Traceability Mapper
 *
 * Links PRD goals → spec requirements → planned ExecutionTasks, storing results
 * in trace.json for auditability and surfacing summaries in CLI status output.
 *
 * Key features:
 * - Deterministic trace link generation from approved artifacts
 * - Deduplication and validation via TraceLink schema
 * - Lock-based atomic writes to trace.json
 * - Summary generation for CLI consumption
 * - Integration with approval gates (PRD and Spec)
 *
 * Implements:
 * - FR-9 (Traceability): PRD → Spec → Plan mapping
 * - FR-10 (Specification Authoring): Spec → ExecutionTask links
 * - ADR-7 (Validation Policy): Zod-based link validation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { withLock, getSubdirectoryPath } from '../persistence/runDirectoryManager';
import { parseTraceLink, type TraceLink } from '../core/models/TraceLink';
import { loadPRDMetadata } from './prdAuthoringEngine';
import { loadSpecMetadata } from './specComposer';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import { computeFileHash } from '../persistence/hashManifest';
import { isFileNotFound } from '../utils/safeJson';

// ============================================================================
// Types
// ============================================================================

/**
 * Traceability mapper configuration
 */
export interface TraceMapperConfig {
  /** Run directory path */
  runDir: string;
  /** Feature identifier */
  featureId: string;
  /** Force regeneration even if trace.json exists */
  force?: boolean;
}

/**
 * Trace mapping result
 */
export interface TraceMapperResult {
  /** Path to generated trace.json */
  tracePath: string;
  /** Generated trace links */
  links: TraceLink[];
  /** Mapping statistics */
  statistics: {
    /** Total links generated */
    totalLinks: number;
    /** PRD goal → Spec requirement links */
    prdToSpecLinks: number;
    /** Spec requirement → ExecutionTask links */
    specToTaskLinks: number;
    /** Duplicates prevented */
    duplicatesPrevented: number;
    /** Validation errors encountered */
    validationErrors: number;
  };
  /** Diagnostics and warnings */
  diagnostics: TraceDiagnostics;
}

/**
 * Trace summary for CLI status output
 */
export interface TraceSummary {
  /** Path to trace.json */
  tracePath: string;
  /** Total trace links */
  totalLinks: number;
  /** PRD goals mapped */
  prdGoalsMapped: number;
  /** Spec requirements mapped */
  specRequirementsMapped: number;
  /** Execution tasks mapped */
  executionTasksMapped: number;
  /** Last updated timestamp */
  lastUpdated: string;
  /** Outstanding gaps requiring attention */
  outstandingGaps: number;
}

interface TraceGap {
  source: string;
  target: string;
  reason: string;
}

interface TraceDiagnostics {
  warnings: string[];
  gaps: TraceGap[];
}

/**
 * Trace document structure persisted to trace.json
 */
interface TraceDocument {
  /** Schema version */
  schema_version: string;
  /** Feature identifier */
  feature_id: string;
  /** Trace identifier (from PRD metadata) */
  trace_id: string;
  /** Generated trace links */
  links: TraceLink[];
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Metadata about the trace generation */
  metadata: {
    /** PRD hash used */
    prd_hash: string;
    /** Spec hash used */
    spec_hash: string;
    /** Plan hash (if available) */
    plan_hash?: string;
    /** Generator version */
    generator: string;
  };
  /** Diagnostics persisted alongside trace map */
  diagnostics?: TraceDiagnostics;
}

// ============================================================================
// Link Generation
// ============================================================================

/**
 * Extract PRD goals from prd.md content
 */
async function extractPRDGoals(
  runDir: string
): Promise<Array<{ goalId: string; content: string }>> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const prdPath = path.join(artifactsDir, 'prd.md');

  const prdContent = await fs.readFile(prdPath, 'utf-8');

  // Extract goals section
  const goalsMatch = prdContent.match(/## Goals\s+([\s\S]*?)(?=##|$)/i);
  if (!goalsMatch) {
    return [];
  }

  const goalsText = goalsMatch[1].trim();
  const goalLines = goalsText
    .split('\n')
    .filter((line) => line.trim().startsWith('-') || line.trim().startsWith('*'));

  const goals: Array<{ goalId: string; content: string }> = [];

  goalLines.forEach((line, index) => {
    const content = line.replace(/^[-*]\s*/, '').trim();
    if (content && !content.includes('TODO') && !content.includes('_TODO:')) {
      goals.push({
        goalId: `GOAL-${(index + 1).toString().padStart(3, '0')}`,
        content,
      });
    }
  });

  return goals;
}

/**
 * Extract spec requirements from spec.json
 */
async function extractSpecRequirements(
  runDir: string
): Promise<Array<{ requirementId: string; content: string }>> {
  const artifactsDir = getSubdirectoryPath(runDir, 'artifacts');
  const specJsonPath = path.join(artifactsDir, 'spec.json');

  let specJson: unknown;
  try {
    const specContent = await fs.readFile(specJsonPath, 'utf-8');
    specJson = JSON.parse(specContent);
  } catch {
    return [];
  }

  const requirements: Array<{ requirementId: string; content: string }> = [];

  // Extract test plan items as requirements
  const spec = specJson as { test_plan?: Array<{ test_id: string; description: string }> };
  if (spec.test_plan && Array.isArray(spec.test_plan)) {
    spec.test_plan.forEach((test) => {
      requirements.push({
        requirementId: test.test_id,
        content: test.description,
      });
    });
  }

  return requirements;
}

/**
 * Extract execution tasks from plan.json
 */
async function extractExecutionTasks(runDir: string): Promise<{
  tasks: Array<{ taskId: string; description: string }>;
  hash?: string;
}> {
  const planPath = path.join(runDir, 'plan.json');

  let planJson: unknown;
  try {
    const planContent = await fs.readFile(planPath, 'utf-8');
    planJson = JSON.parse(planContent);
  } catch {
    // plan.json may not exist yet
    return { tasks: [] };
  }

  const tasks: Array<{ taskId: string; description: string }> = [];

  const plan = planJson as { tasks?: Array<{ task_id: string; description: string }> };
  if (plan.tasks && Array.isArray(plan.tasks)) {
    plan.tasks.forEach((task) => {
      tasks.push({
        taskId: task.task_id,
        description: task.description,
      });
    });
  }

  let planHash: string | undefined;
  try {
    planHash = await computeFileHash(planPath);
  } catch {
    planHash = undefined;
  }

  if (planHash) {
    return {
      tasks,
      hash: planHash,
    };
  }

  return { tasks };
}

/**
 * Generate trace links from PRD goals to spec requirements
 */
function generatePRDToSpecLinks(
  featureId: string,
  traceId: string,
  prdGoals: Array<{ goalId: string; content: string }>,
  specRequirements: Array<{ requirementId: string; content: string }>
): TraceLink[] {
  const links: TraceLink[] = [];
  const now = new Date().toISOString();

  // For each PRD goal, create a derived_from link to all spec requirements
  // (simplified heuristic - in production, you'd use semantic analysis)
  prdGoals.forEach((goal) => {
    specRequirements.forEach((req) => {
      const linkId = `LINK-PRD-SPEC-${goal.goalId}-${req.requirementId}`;

      links.push({
        schema_version: '1.0.0',
        link_id: linkId,
        feature_id: featureId,
        source_type: 'prd_goal',
        source_id: goal.goalId,
        target_type: 'spec_requirement',
        target_id: req.requirementId,
        relationship: 'derived_from',
        created_at: now,
        metadata: {
          prd_goal_content: goal.content.substring(0, 200),
          spec_requirement_content: req.content.substring(0, 200),
          trace_id: traceId,
        },
      });
    });
  });

  return links;
}

/**
 * Generate trace links from spec requirements to execution tasks
 */
function generateSpecToTaskLinks(
  featureId: string,
  traceId: string,
  specRequirements: Array<{ requirementId: string; content: string }>,
  executionTasks: Array<{ taskId: string; description: string }>
): TraceLink[] {
  const links: TraceLink[] = [];
  const now = new Date().toISOString();

  // For each spec requirement, create an implements link to execution tasks
  specRequirements.forEach((req) => {
    executionTasks.forEach((task) => {
      const linkId = `LINK-SPEC-TASK-${req.requirementId}-${task.taskId}`;

      links.push({
        schema_version: '1.0.0',
        link_id: linkId,
        feature_id: featureId,
        source_type: 'execution_task',
        source_id: task.taskId,
        target_type: 'spec_requirement',
        target_id: req.requirementId,
        relationship: 'implements',
        created_at: now,
        metadata: {
          spec_requirement_content: req.content.substring(0, 200),
          task_description: task.description.substring(0, 200),
          trace_id: traceId,
        },
      });
    });
  });

  return links;
}

/**
 * Deduplicate trace links by link_id
 */
function deduplicateLinks(links: TraceLink[]): { unique: TraceLink[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: TraceLink[] = [];
  let duplicates = 0;

  for (const link of links) {
    if (seen.has(link.link_id)) {
      duplicates++;
      continue;
    }

    seen.add(link.link_id);
    unique.push(link);
  }

  return { unique, duplicates };
}

/**
 * Validate trace links using TraceLink schema
 */
function validateLinks(links: TraceLink[]): {
  valid: TraceLink[];
  errors: Array<{ linkId: string; errors: string }>;
} {
  const valid: TraceLink[] = [];
  const errors: Array<{ linkId: string; errors: string }> = [];

  for (const link of links) {
    const result = parseTraceLink(link);

    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({
        linkId: link.link_id,
        errors: result.errors.map((e) => `${e.path}: ${e.message}`).join(', '),
      });
    }
  }

  return { valid, errors };
}

// ============================================================================
// Main Mapper Function
// ============================================================================

/**
 * Generate traceability map linking PRD → Spec → ExecutionTasks
 */
export async function generateTraceMap(
  config: TraceMapperConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<TraceMapperResult> {
  logger.info('Starting traceability map generation', {
    featureId: config.featureId,
    runDir: config.runDir,
  });

  const tracePath = path.join(config.runDir, 'trace.json');

  // Check if trace.json already exists
  if (!config.force) {
    try {
      await fs.access(tracePath);
      logger.info('trace.json already exists, skipping generation', { tracePath });

      // Load existing trace document
      const existingContent = await fs.readFile(tracePath, 'utf-8');
      const existingDoc = JSON.parse(existingContent) as TraceDocument;

      return {
        tracePath,
        links: existingDoc.links,
        statistics: {
          totalLinks: existingDoc.links.length,
          prdToSpecLinks: existingDoc.links.filter(
            (l) => l.source_type === 'prd_goal' && l.target_type === 'spec_requirement'
          ).length,
          specToTaskLinks: existingDoc.links.filter(
            (l) => l.source_type === 'execution_task' && l.target_type === 'spec_requirement'
          ).length,
          duplicatesPrevented: 0,
          validationErrors: 0,
        },
        diagnostics: {
          warnings: ['trace.json already exists; use --force to regenerate'],
          gaps: [],
        },
      };
    } catch (error) {
      if (!isFileNotFound(error)) {
        // File exists but failed to read or parse - log warning and regenerate
        logger.warn('Failed to read existing trace.json, regenerating', {
          tracePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // File doesn't exist or is corrupted, continue with generation
    }
  }

  // Step 1: Load PRD and Spec metadata
  const prdMetadata = await loadPRDMetadata(config.runDir);
  if (!prdMetadata) {
    throw new Error('PRD metadata not found. Generate PRD first.');
  }

  if (prdMetadata.approvalStatus !== 'approved') {
    throw new Error('PRD must be approved before generating trace map.');
  }

  const specMetadata = await loadSpecMetadata(config.runDir);
  if (!specMetadata) {
    throw new Error('Spec metadata not found. Generate spec first.');
  }

  if (specMetadata.approvalStatus !== 'approved') {
    throw new Error('Spec must be approved before generating trace map.');
  }

  const traceId = prdMetadata.traceId ?? `TRACE-${Date.now()}`;

  logger.info('Loaded artifact metadata', {
    prdHash: prdMetadata.prdHash,
    specHash: specMetadata.specHash,
    traceId,
  });

  // Step 2: Extract entities
  const prdGoals = await extractPRDGoals(config.runDir);
  const specRequirements = await extractSpecRequirements(config.runDir);
  const executionTasksResult = await extractExecutionTasks(config.runDir);
  const executionTasks = executionTasksResult.tasks;

  logger.debug('Extracted entities', {
    prdGoals: prdGoals.length,
    specRequirements: specRequirements.length,
    executionTasks: executionTasks.length,
  });

  // Step 3: Generate links
  const prdToSpecLinks = generatePRDToSpecLinks(
    config.featureId,
    traceId,
    prdGoals,
    specRequirements
  );

  const specToTaskLinks = generateSpecToTaskLinks(
    config.featureId,
    traceId,
    specRequirements,
    executionTasks
  );

  const allLinks = [...prdToSpecLinks, ...specToTaskLinks];

  logger.info('Generated initial links', {
    prdToSpecLinks: prdToSpecLinks.length,
    specToTaskLinks: specToTaskLinks.length,
    total: allLinks.length,
  });

  // Step 4: Deduplicate
  const { unique: deduplicatedLinks, duplicates } = deduplicateLinks(allLinks);

  logger.info('Deduplicated links', {
    unique: deduplicatedLinks.length,
    duplicates,
  });

  // Step 5: Validate
  const { valid: validLinks, errors: validationErrors } = validateLinks(deduplicatedLinks);

  if (validationErrors.length > 0) {
    logger.warn('Validation errors encountered', {
      errorCount: validationErrors.length,
      errors: validationErrors,
    });
  }

  // Step 6: Identify gaps
  const gaps: TraceGap[] = [];

  if (prdGoals.length === 0) {
    gaps.push({
      source: 'PRD',
      target: 'Goals',
      reason: 'No goals extracted from PRD',
    });
  }

  if (specRequirements.length === 0) {
    gaps.push({
      source: 'Spec',
      target: 'Requirements',
      reason: 'No requirements extracted from spec.json',
    });
  }

  if (executionTasks.length === 0) {
    gaps.push({
      source: 'Plan',
      target: 'ExecutionTasks',
      reason: 'No execution tasks found in plan.json (may be generated later)',
    });
  }

  // Step 7: Collect warnings
  const warnings: string[] = [];
  if (validationErrors.length > 0) {
    warnings.push(`${validationErrors.length} link(s) failed validation`);
  }

  const diagnostics: TraceDiagnostics = {
    warnings,
    gaps,
  };

  // Step 8: Build trace document
  const now = new Date().toISOString();

  const traceDocument: TraceDocument = {
    schema_version: '1.0.0',
    feature_id: config.featureId,
    trace_id: traceId,
    links: validLinks,
    created_at: now,
    updated_at: now,
    metadata: {
      prd_hash: prdMetadata.prdHash,
      spec_hash: specMetadata.specHash,
      ...(executionTasksResult.hash ? { plan_hash: executionTasksResult.hash } : {}),
      generator: 'traceability-mapper:v1.0.0',
    },
    diagnostics,
  };

  // Step 9: Persist to disk
  await withLock(config.runDir, async () => {
    await fs.writeFile(tracePath, JSON.stringify(traceDocument, null, 2), 'utf-8');
  });

  logger.info('Trace map persisted', {
    tracePath,
    totalLinks: validLinks.length,
  });

  metrics.increment('trace_maps_generated_total', {
    feature_id: config.featureId,
  });

  const finalPrdToSpecCount = validLinks.filter(
    (link) => link.source_type === 'prd_goal' && link.target_type === 'spec_requirement'
  ).length;
  const finalSpecToTaskCount = validLinks.filter(
    (link) => link.source_type === 'execution_task' && link.target_type === 'spec_requirement'
  ).length;

  return {
    tracePath,
    links: validLinks,
    statistics: {
      totalLinks: validLinks.length,
      prdToSpecLinks: finalPrdToSpecCount,
      specToTaskLinks: finalSpecToTaskCount,
      duplicatesPrevented: duplicates,
      validationErrors: validationErrors.length,
    },
    diagnostics,
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Load trace summary for CLI status output
 */
export async function loadTraceSummary(runDir: string): Promise<TraceSummary | null> {
  const tracePath = path.join(runDir, 'trace.json');

  try {
    const content = await fs.readFile(tracePath, 'utf-8');
    const doc = JSON.parse(content) as TraceDocument;

    const prdGoals = new Set<string>();
    const specRequirements = new Set<string>();
    const executionTasks = new Set<string>();

    for (const link of doc.links) {
      if (link.source_type === 'prd_goal') {
        prdGoals.add(link.source_id);
      }
      if (link.target_type === 'prd_goal') {
        prdGoals.add(link.target_id);
      }

      if (link.source_type === 'spec_requirement') {
        specRequirements.add(link.source_id);
      }
      if (link.target_type === 'spec_requirement') {
        specRequirements.add(link.target_id);
      }

      if (link.source_type === 'execution_task') {
        executionTasks.add(link.source_id);
      }
      if (link.target_type === 'execution_task') {
        executionTasks.add(link.target_id);
      }
    }

    const documentedGaps = doc.diagnostics?.gaps?.length ?? 0;
    const outstandingGaps = documentedGaps > 0 ? documentedGaps : executionTasks.size === 0 ? 1 : 0;

    return {
      tracePath,
      totalLinks: doc.links.length,
      prdGoalsMapped: prdGoals.size,
      specRequirementsMapped: specRequirements.size,
      executionTasksMapped: executionTasks.size,
      lastUpdated: doc.updated_at,
      outstandingGaps,
    };
  } catch (error) {
    // Return null for both file-not-found and parse errors
    // This function is designed for graceful degradation
    // Non-ENOENT errors (like JSON parse failures) indicate corrupted data
    // but we still return null to allow the caller to continue
    if (!isFileNotFound(error) && process.env.DEBUG) {
      // Only log in debug mode to avoid noise in normal operation
      console.warn('[traceabilityMapper] Failed to load trace.json:', error);
    }
    return null;
  }
}

/**
 * Update trace map when spec changes
 */
export async function updateTraceMapOnSpecChange(
  config: TraceMapperConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector
): Promise<TraceMapperResult> {
  logger.info('Updating trace map due to spec change', {
    featureId: config.featureId,
  });

  // Force regeneration
  return generateTraceMap({ ...config, force: true }, logger, metrics);
}
