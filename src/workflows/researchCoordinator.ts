/**
 * Research Coordinator
 *
 * Identifies unknowns from prompts/specs, queues ResearchTasks with objectives,
 * sources, and cache keys, manages caching/refresh policies, and records outputs.
 *
 * Key features:
 * - Auto-detection of unknowns from context documents and requirements
 * - Deterministic caching based on objectives + sources
 * - Freshness-aware result reuse (configurable TTL)
 * - CLI integration for task listing and management
 * - Storage under run directory with JSONL append logs
 *
 * Implements FR-6, FR-7, ADR-4 requirements for research discovery.
 */

import { withLock } from '../persistence';
import type { StructuredLogger } from '../telemetry/logger';
import type { MetricsCollector } from '../telemetry/metrics';
import type { ContextDocument } from '../core/models/ContextDocument';
import {
  createResearchTask,
  generateCacheKey,
  isCachedResultFresh,
  type ResearchTask,
  type ResearchSource,
  type ResearchResult,
  type FreshnessRequirement,
} from '../core/models/ResearchTask';
import {
  type UnknownDetectionHint,
  type UnknownOrigin,
  type ManualUnknownInput,
  DEFAULT_CONTEXT_FILE_SCAN_LIMIT,
  DEFAULT_MAX_UNKNOWN_PER_SOURCE,
  extractUnknownsFromMetadata,
  manualUnknownsToHints,
  extractUnknownsFromText,
  collectContextFileHints,
} from './researchDetection';
import {
  ensureResearchDirectories,
  saveTask,
  loadTask,
  appendTaskLog,
  listTaskIds,
  findCachedTask,
  isCachedTaskFresh,
} from '../persistence/researchStore.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Research coordinator configuration
 */
export interface ResearchCoordinatorConfig {
  /** Repository root directory */
  repoRoot: string;
  /** Run directory path */
  runDir: string;
  /** Feature identifier */
  featureId: string;
  /** Default freshness requirements */
  defaultFreshness?: FreshnessRequirement;
  /** Enable automatic task detection */
  autoDetectTasks?: boolean;
}

/**
 * Research task creation options
 */
export interface CreateResearchTaskOptions {
  /** Task title */
  title: string;
  /** Research objectives (questions or goals) */
  objectives: string[];
  /** Sources to consult */
  sources?: ResearchSource[];
  /** Freshness requirements */
  freshnessRequirements?: FreshnessRequirement;
  /** Intentional: research task metadata varies by source and objective */
  metadata?: Record<string, unknown>;
}

/**
 * Research task query filters
 */
export interface ResearchTaskFilters {
  /** Filter by status */
  status?: ResearchTask['status'] | ResearchTask['status'][];
  /** Filter by cache freshness */
  onlyStale?: boolean;
  /** Limit number of results */
  limit?: number;
}

/**
 * Result of queueing a research task
 */
export interface QueueTaskResult {
  /** Created or cached task */
  task: ResearchTask;
  /** Whether task was newly created */
  created: boolean;
  /** Whether task result was reused from cache */
  cached: boolean;
}

/**
 * Result of completing a research task
 */
export interface CompleteTaskResult {
  /** Updated task */
  task: ResearchTask;
  /** Whether task was successfully updated */
  success: boolean;
}

/**
 * Research coordinator diagnostics
 */
export interface ResearchDiagnostics {
  /** Total tasks queued */
  totalTasks: number;
  /** Tasks pending execution */
  pendingTasks: number;
  /** Tasks in progress */
  inProgressTasks: number;
  /** Tasks completed */
  completedTasks: number;
  /** Tasks failed */
  failedTasks: number;
  /** Tasks with cached results */
  cachedTasks: number;
  /** Warnings */
  warnings: string[];
  /** Errors */
  errors: string[];
}

export type { ManualUnknownInput } from './researchDetection';

/**
 * Options for unknown detection
 */
export interface UnknownDetectionOptions {
  /** Prompt or user story text */
  promptText?: string;
  /** Specification text */
  specText?: string;
  /** Manual unknown descriptions */
  manualUnknowns?: ManualUnknownInput[];
  /** Maximum number of context files to scan for TODO/TBD markers */
  maxContextFiles?: number;
}

// ============================================================================
// Research Coordinator Class
// ============================================================================

/**
 * Research coordinator service
 */
export class ResearchCoordinator {
  private readonly config: ResearchCoordinatorConfig;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;
  private lastCreatedAtMs = 0;

  constructor(
    config: ResearchCoordinatorConfig,
    logger: StructuredLogger,
    metrics: MetricsCollector
  ) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Queue a new research task
   *
   * If a cached task with the same cache key exists and is fresh,
   * it will be reused. Otherwise, a new task is created.
   */
  async queueTask(options: CreateResearchTaskOptions): Promise<QueueTaskResult> {
    this.logger.info('Queueing research task', {
      title: options.title,
      objectivesCount: options.objectives.length,
    });

    return withLock(this.config.runDir, async () => {
      // Generate cache key
      const sources = options.sources ?? [];
      const cacheKey = generateCacheKey(options.objectives, sources);

      // Check for existing cached task
      const cachedTask = await findCachedTask(this.config.runDir, cacheKey);

      if (cachedTask) {
        const freshnessReq = options.freshnessRequirements ??
          this.config.defaultFreshness ?? {
            max_age_hours: 24,
            force_fresh: false,
          };

        const isFresh = isCachedTaskFresh(cachedTask, freshnessReq);

        if (isFresh) {
          this.logger.info('Using cached research task', {
            taskId: cachedTask.task_id,
            cacheKey,
          });

          await appendTaskLog(this.config.runDir, {
            timestamp: new Date().toISOString(),
            event_type: 'cached',
            task_id: cachedTask.task_id,
            status: cachedTask.status,
            metadata: { cache_key: cacheKey },
          });

          this.metrics.increment('research_tasks_cached_total', {
            feature_id: this.config.featureId,
          });

          return {
            task: cachedTask,
            created: false,
            cached: true,
          };
        }

        this.logger.info('Cached task is stale, creating new task', {
          oldTaskId: cachedTask.task_id,
          cacheKey,
        });
      }

      // Create new task
      const taskId = `RT-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const taskOptions: {
        sources?: ResearchSource[];
        cacheKey?: string;
        freshnessRequirements?: FreshnessRequirement;
        metadata?: Record<string, unknown>;
      } = {
        sources,
        cacheKey,
      };

      if (options.freshnessRequirements) {
        taskOptions.freshnessRequirements = options.freshnessRequirements;
      }

      if (options.metadata) {
        taskOptions.metadata = options.metadata;
      }

      const rawTask = createResearchTask(
        taskId,
        this.config.featureId,
        options.title,
        options.objectives,
        taskOptions
      );

      const task = this.normalizeTaskTimestamps(rawTask);

      await saveTask(this.config.runDir, task);

      await appendTaskLog(this.config.runDir, {
        timestamp: new Date().toISOString(),
        event_type: 'created',
        task_id: task.task_id,
        status: task.status,
        metadata: {
          cache_key: cacheKey,
          objectives_count: options.objectives.length,
          sources_count: sources.length,
        },
      });

      this.logger.info('Created research task', {
        taskId: task.task_id,
        cacheKey,
        objectives: options.objectives.length,
        sources: sources.length,
      });

      this.metrics.increment('research_tasks_created_total', {
        feature_id: this.config.featureId,
      });

      return {
        task,
        created: true,
        cached: false,
      };
    });
  }

  /**
   * Ensure created_at timestamps are strictly monotonic to guarantee deterministic ordering
   */
  private normalizeTaskTimestamps(task: ResearchTask): ResearchTask {
    const createdMs = Date.parse(task.created_at);
    if (Number.isNaN(createdMs)) {
      return task;
    }

    const normalizedMs = Math.max(createdMs, this.lastCreatedAtMs + 1);
    this.lastCreatedAtMs = normalizedMs;

    if (normalizedMs === createdMs) {
      return task;
    }

    const normalizedIso = new Date(normalizedMs).toISOString();

    return {
      ...task,
      created_at: normalizedIso,
      updated_at: normalizedIso,
    };
  }

  /**
   * Start a research task (mark as in_progress)
   */
  async startTask(taskId: string): Promise<ResearchTask | null> {
    return withLock(this.config.runDir, async () => {
      const task = await loadTask(this.config.runDir, taskId);

      if (!task) {
        this.logger.warn('Task not found', { taskId });
        return null;
      }

      if (task.status !== 'pending') {
        this.logger.warn('Task is not pending', { taskId, status: task.status });
        return task;
      }

      const now = new Date().toISOString();
      const updatedTask: ResearchTask = {
        ...task,
        status: 'in_progress',
        started_at: now,
        updated_at: now,
      };

      await saveTask(this.config.runDir, updatedTask);

      await appendTaskLog(this.config.runDir, {
        timestamp: now,
        event_type: 'started',
        task_id: taskId,
        status: 'in_progress',
      });

      this.logger.info('Started research task', { taskId });

      return updatedTask;
    });
  }

  /**
   * Complete a research task with results
   */
  async completeTask(taskId: string, results: ResearchResult): Promise<CompleteTaskResult> {
    return withLock(this.config.runDir, async () => {
      const task = await loadTask(this.config.runDir, taskId);

      if (!task) {
        this.logger.error('Task not found', { taskId });
        // Return a result indicating failure without a valid task
        return {
          task: {} as ResearchTask,
          success: false,
        };
      }

      const now = new Date().toISOString();
      const updatedTask: ResearchTask = {
        ...task,
        status: 'completed',
        results,
        completed_at: now,
        updated_at: now,
      };

      await saveTask(this.config.runDir, updatedTask);

      await appendTaskLog(this.config.runDir, {
        timestamp: now,
        event_type: 'completed',
        task_id: taskId,
        status: 'completed',
        metadata: {
          confidence_score: results.confidence_score,
          sources_consulted: results.sources_consulted.length,
        },
      });

      this.logger.info('Completed research task', {
        taskId,
        confidenceScore: results.confidence_score,
      });

      this.metrics.increment('research_tasks_completed_total', {
        feature_id: this.config.featureId,
      });

      return { task: updatedTask, success: true };
    });
  }

  /**
   * Fail a research task with error message
   */
  async failTask(taskId: string, errorMessage: string): Promise<ResearchTask | null> {
    return withLock(this.config.runDir, async () => {
      const task = await loadTask(this.config.runDir, taskId);

      if (!task) {
        this.logger.error('Task not found', { taskId });
        return null;
      }

      const now = new Date().toISOString();
      const updatedTask: ResearchTask = {
        ...task,
        status: 'failed',
        updated_at: now,
        metadata: {
          ...task.metadata,
          error: errorMessage,
        },
      };

      await saveTask(this.config.runDir, updatedTask);

      await appendTaskLog(this.config.runDir, {
        timestamp: now,
        event_type: 'failed',
        task_id: taskId,
        status: 'failed',
        metadata: { error: errorMessage },
      });

      this.logger.error('Research task failed', { taskId, error: errorMessage });

      this.metrics.increment('research_tasks_failed_total', {
        feature_id: this.config.featureId,
      });

      return updatedTask;
    });
  }

  /**
   * List research tasks with optional filters
   */
  async listTasks(filters: ResearchTaskFilters = {}): Promise<ResearchTask[]> {
    const taskIds = await listTaskIds(this.config.runDir);
    const tasks: ResearchTask[] = [];

    for (const taskId of taskIds) {
      const task = await loadTask(this.config.runDir, taskId);

      if (!task) {
        continue;
      }

      // Apply status filter
      if (filters.status) {
        const statusFilter = Array.isArray(filters.status) ? filters.status : [filters.status];

        if (!statusFilter.includes(task.status)) {
          continue;
        }
      }

      // Apply staleness filter
      if (filters.onlyStale && task.results && task.freshness_requirements) {
        const isFresh = isCachedResultFresh(task.results, task.freshness_requirements);
        if (isFresh) {
          continue;
        }
      }

      tasks.push(task);
    }

    // Sort by created_at descending with deterministic tie-breaker
    tasks.sort((a, b) => {
      const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (createdDiff !== 0) {
        return createdDiff;
      }

      return b.task_id.localeCompare(a.task_id);
    });

    // Apply limit
    if (filters.limit && filters.limit > 0) {
      return tasks.slice(0, filters.limit);
    }

    return tasks;
  }

  /**
   * Get a specific research task by ID
   */
  async getTask(taskId: string): Promise<ResearchTask | null> {
    return loadTask(this.config.runDir, taskId);
  }

  /**
   * Get diagnostics about research tasks
   */
  async getDiagnostics(): Promise<ResearchDiagnostics> {
    const tasks = await this.listTasks();

    const diagnostics: ResearchDiagnostics = {
      totalTasks: tasks.length,
      pendingTasks: 0,
      inProgressTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      cachedTasks: 0,
      warnings: [],
      errors: [],
    };

    for (const task of tasks) {
      switch (task.status) {
        case 'pending':
          diagnostics.pendingTasks++;
          break;
        case 'in_progress':
          diagnostics.inProgressTasks++;
          break;
        case 'completed':
          diagnostics.completedTasks++;
          break;
        case 'failed':
          diagnostics.failedTasks++;
          break;
        case 'cached':
          diagnostics.cachedTasks++;
          break;
      }
    }

    return diagnostics;
  }

  /**
   * Detect unknowns from context document and create research tasks
   *
   * This is a placeholder for future implementation that analyzes
   * context documents for missing information, unclear requirements,
   * or ambiguous references and automatically generates research tasks.
   */
  async detectUnknownsFromContext(
    contextDoc: ContextDocument,
    options: UnknownDetectionOptions = {}
  ): Promise<ResearchTask[]> {
    if (this.config.autoDetectTasks === false) {
      this.logger.warn('Automatic unknown detection disabled via configuration', {
        featureId: this.config.featureId,
      });
      return [];
    }

    this.logger.info('Detecting unknowns from context document', {
      featureId: contextDoc.feature_id,
      filesCount: Object.keys(contextDoc.files).length,
    });

    const hints: UnknownDetectionHint[] = [];

    // Metadata supplied unknowns
    hints.push(...extractUnknownsFromMetadata(contextDoc.metadata));

    // Manual unknowns supplied at runtime
    hints.push(...manualUnknownsToHints(options.manualUnknowns));

    // Prompt-derived unknowns
    if (options.promptText) {
      const origin: UnknownOrigin = {
        type: 'prompt',
        label: 'prompt',
        source: {
          type: 'documentation',
          identifier: 'prompt',
          description: 'User prompt description',
        },
      };
      hints.push(
        ...extractUnknownsFromText(options.promptText, origin, DEFAULT_MAX_UNKNOWN_PER_SOURCE)
      );
    }

    // Specification-derived unknowns
    if (options.specText) {
      const origin: UnknownOrigin = {
        type: 'spec',
        label: 'spec',
        source: {
          type: 'documentation',
          identifier: 'spec',
          description: 'Specification draft',
        },
      };
      hints.push(
        ...extractUnknownsFromText(options.specText, origin, DEFAULT_MAX_UNKNOWN_PER_SOURCE)
      );
    }

    // Context files heuristics
    const contextHints = await collectContextFileHints(
      this.config.repoRoot,
      contextDoc,
      options.maxContextFiles ?? DEFAULT_CONTEXT_FILE_SCAN_LIMIT
    );
    hints.push(...contextHints);

    // Deduplicate hints
    const deduped: UnknownDetectionHint[] = [];
    const seen = new Set<string>();
    for (const hint of hints) {
      const key = [
        hint.title.toLowerCase(),
        hint.objectives.join('|').toLowerCase(),
        hint.sources
          .map((source) => source.identifier)
          .sort()
          .join('|'),
      ].join('::');

      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(hint);
    }

    if (deduped.length === 0) {
      this.logger.info('No unknowns detected from current inputs', {
        featureId: contextDoc.feature_id,
      });
      return [];
    }

    this.logger.info('Queueing research tasks for detected unknowns', {
      detected: deduped.length,
    });

    this.metrics.increment(
      'research_unknowns_detected_total',
      {
        feature_id: this.config.featureId,
      },
      deduped.length
    );

    const tasks: ResearchTask[] = [];
    let createdCount = 0;
    let cachedCount = 0;

    for (const hint of deduped) {
      const taskOptions: CreateResearchTaskOptions = {
        title: hint.title,
        objectives: hint.objectives,
        sources: hint.sources,
      };

      if (hint.metadata) {
        taskOptions.metadata = hint.metadata;
      }

      const result = await this.queueTask(taskOptions);

      tasks.push(result.task);

      if (result.created) {
        createdCount++;
      } else if (result.cached) {
        cachedCount++;
      }
    }

    this.logger.info('Unknown detection complete', {
      totalTasks: tasks.length,
      newlyCreated: createdCount,
      cached: cachedCount,
    });

    return tasks;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a research coordinator instance
 */
export function createResearchCoordinator(
  config: ResearchCoordinatorConfig,
  logger: StructuredLogger,
  metrics: MetricsCollector
): ResearchCoordinator {
  return new ResearchCoordinator(config, logger, metrics);
}

/**
 * Initialize research directory structure for a feature
 */
export async function initializeResearchDirectory(runDir: string): Promise<void> {
  await ensureResearchDirectories(runDir);
}
