/**
 * Research Coordinator Unit Tests
 *
 * Tests for ResearchCoordinator service including:
 * - Task creation and queueing
 * - Caching and freshness checks
 * - Task lifecycle management
 * - Diagnostics and filtering
 * - Persistence and serialization
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ResearchCoordinator,
  createResearchCoordinator,
  initializeResearchDirectory,
  type ResearchCoordinatorConfig,
  type CreateResearchTaskOptions,
} from '../../src/workflows/researchCoordinator';
import { createLogger } from '../../src/telemetry/logger';
import { createMetricsCollector } from '../../src/telemetry/metrics';
import { type ResearchResult, type ResearchTask } from '../../src/core/models/ResearchTask';
import type { ContextDocument } from '../../src/core/models/ContextDocument';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a temporary test run directory
 */
async function createTestRunDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'research-test-'));
  return tmpDir;
}

/**
 * Clean up test run directory
 */
async function cleanupTestRunDir(runDir: string): Promise<void> {
  try {
    await fs.rm(runDir, { recursive: true, force: true });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Create a test research coordinator
 */
function createTestCoordinator(runDir: string): ResearchCoordinator {
  const config: ResearchCoordinatorConfig = {
    repoRoot: runDir,
    runDir,
    featureId: 'test-feature-123',
    defaultFreshness: {
      max_age_hours: 24,
      force_fresh: false,
    },
  };

  const logger = createLogger({
    component: 'research-coordinator-test',
    minLevel: 'error', // Suppress logs during tests
  });

  const metrics = createMetricsCollector();

  return createResearchCoordinator(config, logger, metrics);
}

/**
 * Create a basic context document for tests
 */
function createTestContextDocument(featureId: string, relativePaths: string[]): ContextDocument {
  const now = new Date().toISOString();
  const files: Record<
    string,
    {
      path: string;
      hash: string;
      size: number;
      file_type?: string;
      token_count?: number;
    }
  > = {};

  for (const relPath of relativePaths) {
    files[relPath] = {
      path: relPath,
      hash: 'a'.repeat(64),
      size: 256,
      file_type: path.extname(relPath).replace('.', ''),
      token_count: 100,
    };
  }

  return {
    schema_version: '1.0.0',
    feature_id: featureId,
    created_at: now,
    updated_at: now,
    files,
    summaries: [],
    total_token_count: relativePaths.length * 100,
    provenance: {
      source: 'manual',
      captured_at: now,
    },
  } as ContextDocument;
}

interface TaskLogEvent {
  event_type: string;
  task_id: string;
}

function isTaskLogEvent(value: unknown): value is TaskLogEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.event_type === 'string' && typeof candidate.task_id === 'string';
}

function parseTaskLogEvent(raw: string): TaskLogEvent {
  const parsed: unknown = JSON.parse(raw);
  if (!isTaskLogEvent(parsed)) {
    throw new Error('Invalid task log event');
  }
  return parsed;
}

function hasDetectionMetadata(task: ResearchTask): boolean {
  return Boolean(task.metadata && 'detection' in task.metadata);
}

interface PersistedTaskRecord {
  task_id: string;
  title: string;
}

function parsePersistedTask(content: string): PersistedTaskRecord {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid task file');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.task_id !== 'string' || typeof record.title !== 'string') {
    throw new Error('Invalid task record');
  }
  return {
    task_id: record.task_id,
    title: record.title,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('ResearchCoordinator', () => {
  let runDir: string;
  let coordinator: ResearchCoordinator;

  beforeEach(async () => {
    runDir = await createTestRunDir();
    coordinator = createTestCoordinator(runDir);
  });

  afterEach(async () => {
    await cleanupTestRunDir(runDir);
  });

  describe('initializeResearchDirectory', () => {
    it('should create research directory structure', async () => {
      await initializeResearchDirectory(runDir);

      const researchDir = path.join(runDir, 'research');
      const tasksDir = path.join(researchDir, 'tasks');

      const researchDirExists = await fs
        .stat(researchDir)
        .then(() => true)
        .catch(() => false);
      const tasksDirExists = await fs
        .stat(tasksDir)
        .then(() => true)
        .catch(() => false);

      expect(researchDirExists).toBe(true);
      expect(tasksDirExists).toBe(true);
    });
  });

  describe('queueTask', () => {
    it('should create a new research task', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Research Task',
        objectives: ['What is the answer?', 'How does it work?'],
        sources: [
          {
            type: 'codebase',
            identifier: 'src/test.ts',
            description: 'Test file',
          },
        ],
      };

      const result = await coordinator.queueTask(options);

      expect(result.created).toBe(true);
      expect(result.cached).toBe(false);
      expect(result.task.task_id).toMatch(/^RT-/);
      expect(result.task.title).toBe(options.title);
      expect(result.task.objectives).toEqual(options.objectives);
      expect(result.task.sources).toHaveLength(1);
      expect(result.task.status).toBe('pending');
      expect(result.task.cache_key).toBeDefined();
    });

    it('should reuse cached task if fresh', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Research Task',
        objectives: ['What is the answer?'],
        sources: [
          {
            type: 'documentation',
            identifier: 'docs/test.md',
          },
        ],
        freshnessRequirements: {
          max_age_hours: 24,
          force_fresh: false,
        },
      };

      // Create first task
      const result1 = await coordinator.queueTask(options);
      expect(result1.created).toBe(true);

      // Complete the task with results
      if (!options.sources) {
        throw new Error('sources is required for test');
      }
      const sourcesConsulted = options.sources;
      const results: ResearchResult = {
        summary: 'Test result',
        confidence_score: 0.9,
        timestamp: new Date().toISOString(),
        sources_consulted: sourcesConsulted,
      };
      await coordinator.completeTask(result1.task.task_id, results);

      // Queue same task again (should reuse cache)
      const result2 = await coordinator.queueTask(options);

      expect(result2.created).toBe(false);
      expect(result2.cached).toBe(true);
      expect(result2.task.task_id).toBe(result1.task.task_id);
      expect(result2.task.results).toBeDefined();
      expect(result2.task.results?.summary).toBe('Test result');
    });

    it('should create new task if cached task is stale', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Research Task',
        objectives: ['What is the answer?'],
        sources: [
          {
            type: 'documentation',
            identifier: 'docs/test.md',
          },
        ],
        freshnessRequirements: {
          max_age_hours: 1, // 1 hour freshness
          force_fresh: false,
        },
      };

      // Create first task
      const result1 = await coordinator.queueTask(options);

      // Complete with old timestamp (2 hours ago)
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const results: ResearchResult = {
        summary: 'Old result',
        confidence_score: 0.9,
        timestamp: oldTimestamp,
        sources_consulted: options.sources ?? [],
      };
      await coordinator.completeTask(result1.task.task_id, results);

      // Queue same task again (should create new due to staleness)
      const result2 = await coordinator.queueTask(options);

      expect(result2.created).toBe(true);
      expect(result2.cached).toBe(false);
      expect(result2.task.task_id).not.toBe(result1.task.task_id);
    });

    it('should create new task if force_fresh is true', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Research Task',
        objectives: ['What is the answer?'],
        sources: [],
        freshnessRequirements: {
          max_age_hours: 24,
          force_fresh: false,
        },
      };

      // Create and complete first task
      const result1 = await coordinator.queueTask(options);
      const results: ResearchResult = {
        summary: 'Test result',
        confidence_score: 0.9,
        timestamp: new Date().toISOString(),
        sources_consulted: [],
      };
      await coordinator.completeTask(result1.task.task_id, results);

      // Queue again with force_fresh
      const optionsForced: CreateResearchTaskOptions = {
        ...options,
        freshnessRequirements: {
          max_age_hours: 24,
          force_fresh: true,
        },
      };

      const result2 = await coordinator.queueTask(optionsForced);

      expect(result2.created).toBe(true);
      expect(result2.cached).toBe(false);
    });
  });

  describe('startTask', () => {
    it('should mark task as in_progress', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Task',
        objectives: ['Test objective'],
        sources: [],
      };

      const { task } = await coordinator.queueTask(options);
      const started = await coordinator.startTask(task.task_id);

      expect(started).toBeDefined();
      if (started) {
        expect(started.status).toBe('in_progress');
        expect(started.started_at).toBeDefined();
        expect(new Date(started.updated_at).getTime()).toBeGreaterThanOrEqual(
          new Date(task.updated_at).getTime()
        );
      }
    });

    it('should return null for non-existent task', async () => {
      const started = await coordinator.startTask('RT-nonexistent');
      expect(started).toBeNull();
    });

    it('should not change status if task is not pending', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Task',
        objectives: ['Test objective'],
        sources: [],
      };

      const { task } = await coordinator.queueTask(options);
      await coordinator.startTask(task.task_id);

      // Try to start again
      const started2 = await coordinator.startTask(task.task_id);
      if (!started2) {
        throw new Error('Expected startTask to return a task object, but got null or undefined');
      }
      expect(started2.status).toBe('in_progress');
    });
  });

  describe('completeTask', () => {
    it('should mark task as completed with results', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Task',
        objectives: ['Test objective'],
        sources: [],
      };

      const { task } = await coordinator.queueTask(options);
      await coordinator.startTask(task.task_id);

      const results: ResearchResult = {
        summary: 'Research complete',
        details: 'Detailed findings',
        confidence_score: 0.95,
        timestamp: new Date().toISOString(),
        sources_consulted: [],
      };

      const { task: completed, success } = await coordinator.completeTask(task.task_id, results);

      expect(success).toBe(true);
      expect(completed.status).toBe('completed');
      expect(completed.results).toBeDefined();
      expect(completed.results?.summary).toBe('Research complete');
      expect(completed.results?.confidence_score).toBe(0.95);
      expect(completed.completed_at).toBeDefined();
    });

    it('should return success=false for non-existent task', async () => {
      const results: ResearchResult = {
        summary: 'Test',
        confidence_score: 0.5,
        timestamp: new Date().toISOString(),
        sources_consulted: [],
      };

      const { success } = await coordinator.completeTask('RT-nonexistent', results);
      expect(success).toBe(false);
    });
  });

  describe('failTask', () => {
    it('should mark task as failed with error message', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Test Task',
        objectives: ['Test objective'],
        sources: [],
      };

      const { task } = await coordinator.queueTask(options);
      await coordinator.startTask(task.task_id);

      const failed = await coordinator.failTask(task.task_id, 'Test error');

      expect(failed).toBeDefined();
      expect(failed?.status).toBe('failed');
      expect(failed?.metadata?.error).toBe('Test error');
    });

    it('should return null for non-existent task', async () => {
      const failed = await coordinator.failTask('RT-nonexistent', 'Error');
      expect(failed).toBeNull();
    });
  });

  describe('listTasks', () => {
    it('should return empty array when no tasks exist', async () => {
      const tasks = await coordinator.listTasks();
      expect(tasks).toEqual([]);
    });

    it('should list all tasks', async () => {
      await coordinator.queueTask({
        title: 'Task 1',
        objectives: ['Objective 1'],
        sources: [],
      });
      await coordinator.queueTask({
        title: 'Task 2',
        objectives: ['Objective 2'],
        sources: [],
      });

      const tasks = await coordinator.listTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].title).toBe('Task 2'); // Sorted by created_at desc
      expect(tasks[1].title).toBe('Task 1');
    });

    it('should filter tasks by status', async () => {
      const { task: task1 } = await coordinator.queueTask({
        title: 'Task 1',
        objectives: ['Objective 1'],
        sources: [],
      });
      const { task: task2 } = await coordinator.queueTask({
        title: 'Task 2',
        objectives: ['Objective 2'],
        sources: [],
      });

      await coordinator.startTask(task1.task_id);

      const pendingTasks = await coordinator.listTasks({ status: 'pending' });
      const inProgressTasks = await coordinator.listTasks({ status: 'in_progress' });

      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0].task_id).toBe(task2.task_id);

      expect(inProgressTasks).toHaveLength(1);
      expect(inProgressTasks[0].task_id).toBe(task1.task_id);
    });

    it('should apply limit', async () => {
      for (let i = 0; i < 5; i++) {
        await coordinator.queueTask({
          title: `Task ${i}`,
          objectives: [`Objective ${i}`],
          sources: [],
        });
      }

      const tasks = await coordinator.listTasks({ limit: 3 });
      expect(tasks).toHaveLength(3);
    });

    it('should filter stale tasks', async () => {
      const options: CreateResearchTaskOptions = {
        title: 'Fresh Task',
        objectives: ['Objective'],
        sources: [],
        freshnessRequirements: {
          max_age_hours: 1,
          force_fresh: false,
        },
      };

      const { task } = await coordinator.queueTask(options);

      // Complete with old timestamp
      const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const results: ResearchResult = {
        summary: 'Old result',
        confidence_score: 0.9,
        timestamp: oldTimestamp,
        sources_consulted: [],
      };
      await coordinator.completeTask(task.task_id, results);

      const staleTasks = await coordinator.listTasks({ onlyStale: true });
      expect(staleTasks).toHaveLength(1);
      expect(staleTasks[0].task_id).toBe(task.task_id);
    });
  });

  describe('getTask', () => {
    it('should retrieve specific task by ID', async () => {
      const { task: created } = await coordinator.queueTask({
        title: 'Test Task',
        objectives: ['Test objective'],
        sources: [],
      });

      const retrieved = await coordinator.getTask(created.task_id);

      expect(retrieved).toBeDefined();
      if (!retrieved) {
        throw new Error('Expected retrieved task to be defined');
      }
      expect(retrieved.task_id).toBe(created.task_id);
      expect(retrieved.title).toBe('Test Task');
    });

    it('should return null for non-existent task', async () => {
      const task = await coordinator.getTask('RT-nonexistent');
      expect(task).toBeNull();
    });
  });

  describe('getDiagnostics', () => {
    it('should return zero counts when no tasks exist', async () => {
      const diagnostics = await coordinator.getDiagnostics();

      expect(diagnostics.totalTasks).toBe(0);
      expect(diagnostics.pendingTasks).toBe(0);
      expect(diagnostics.inProgressTasks).toBe(0);
      expect(diagnostics.completedTasks).toBe(0);
      expect(diagnostics.failedTasks).toBe(0);
    });

    it('should count tasks by status', async () => {
      const { task: task1 } = await coordinator.queueTask({
        title: 'Task 1',
        objectives: ['Objective 1'],
        sources: [],
      });
      const { task: task2 } = await coordinator.queueTask({
        title: 'Task 2',
        objectives: ['Objective 2'],
        sources: [],
      });
      const { task: task3 } = await coordinator.queueTask({
        title: 'Task 3',
        objectives: ['Objective 3'],
        sources: [],
      });

      await coordinator.startTask(task1.task_id);

      const results: ResearchResult = {
        summary: 'Done',
        confidence_score: 0.9,
        timestamp: new Date().toISOString(),
        sources_consulted: [],
      };
      await coordinator.completeTask(task2.task_id, results);

      await coordinator.failTask(task3.task_id, 'Error');

      const diagnostics = await coordinator.getDiagnostics();

      expect(diagnostics.totalTasks).toBe(3);
      expect(diagnostics.pendingTasks).toBe(0);
      expect(diagnostics.inProgressTasks).toBe(1);
      expect(diagnostics.completedTasks).toBe(1);
      expect(diagnostics.failedTasks).toBe(1);
    });
  });

  describe('persistence', () => {
    it('should persist tasks to disk', async () => {
      const { task } = await coordinator.queueTask({
        title: 'Persisted Task',
        objectives: ['Test objective'],
        sources: [],
      });

      const taskPath = path.join(runDir, 'research', 'tasks', `${task.task_id}.json`);
      const exists = await fs
        .stat(taskPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);

      const content = await fs.readFile(taskPath, 'utf-8');
      const parsed = parsePersistedTask(content);

      expect(parsed.task_id).toBe(task.task_id);
      expect(parsed.title).toBe('Persisted Task');
    });

    it('should append events to JSONL log', async () => {
      const { task } = await coordinator.queueTask({
        title: 'Logged Task',
        objectives: ['Test objective'],
        sources: [],
      });

      await coordinator.startTask(task.task_id);

      const logPath = path.join(runDir, 'research', 'tasks.jsonl');
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBeGreaterThanOrEqual(2); // created + started events

      const createdEvent = parseTaskLogEvent(lines[0]);
      expect(createdEvent.event_type).toBe('created');
      expect(createdEvent.task_id).toBe(task.task_id);

      const startedEvent = parseTaskLogEvent(lines[1]);
      expect(startedEvent.event_type).toBe('started');
      expect(startedEvent.task_id).toBe(task.task_id);
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent task creation', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          coordinator.queueTask({
            title: `Concurrent Task ${i}`,
            objectives: [`Objective ${i}`],
            sources: [],
          })
        );
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);

      const taskIds = new Set(results.map((r) => r.task.task_id));
      expect(taskIds.size).toBe(10); // All unique IDs
    });
  });

  describe('detectUnknownsFromContext', () => {
    it('should create tasks for detected unknowns from prompt and context files', async () => {
      const docsDir = path.join(runDir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(
        path.join(docsDir, 'README.md'),
        '# TODO\nTBD: Document webhook authentication details?\nEverything else complete.',
        'utf-8'
      );

      const contextDoc = createTestContextDocument('test-feature-123', ['docs/README.md']);

      const tasks = await coordinator.detectUnknownsFromContext(contextDoc, {
        promptText: 'Need clarification on rate limit policy. TBD: confirm daily quotas?',
        specText: 'Unknown: Which endpoints require authentication???',
      });

      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.some((task) => hasDetectionMetadata(task))).toBe(true);
    });

    it('should respect manual unknown inputs', async () => {
      const contextDoc = createTestContextDocument('test-feature-123', []);

      const tasks = await coordinator.detectUnknownsFromContext(contextDoc, {
        manualUnknowns: [
          'Confirm security review owner for rollout',
          {
            title: 'Clarify GitHub scopes',
            objective: 'Which GitHub scopes are required for PR automation?',
            sources: [
              {
                type: 'github',
                identifier: 'settings/apps',
                description: 'GitHub App settings page',
              },
            ],
          },
        ],
      });

      expect(tasks).toHaveLength(2);
      expect(tasks.every((task) => task.objectives.length > 0)).toBe(true);
    });
  });
});
