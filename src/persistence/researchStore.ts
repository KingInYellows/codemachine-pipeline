/**
 * Research Persistence Helpers
 *
 * Extracted from researchCoordinator.ts — contains all file-system
 * persistence logic for research tasks: directory structure, save/load,
 * JSONL append logs, task listing, and cache lookup.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  isCachedResultFresh,
  parseResearchTask,
  serializeResearchTask,
  type ResearchTask,
  type FreshnessRequirement,
} from '../core/models/ResearchTask';

// Research Directory Structure

/**
 * Get path to research directory
 */
export function getResearchDirectory(runDir: string): string {
  return path.join(runDir, 'research');
}

/**
 * Get path to tasks subdirectory
 */
export function getTasksDirectory(runDir: string): string {
  return path.join(getResearchDirectory(runDir), 'tasks');
}

/**
 * Get path to task file
 */
export function getTaskFilePath(runDir: string, taskId: string): string {
  return path.join(getTasksDirectory(runDir), `${taskId}.json`);
}

/**
 * Get path to tasks JSONL log
 */
export function getTasksLogPath(runDir: string): string {
  return path.join(getResearchDirectory(runDir), 'tasks.jsonl');
}

/**
 * Ensure research directory structure exists
 */
export async function ensureResearchDirectories(runDir: string): Promise<void> {
  const researchDir = getResearchDirectory(runDir);
  const tasksDir = getTasksDirectory(runDir);

  await fs.mkdir(researchDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });
}

// Task Persistence

/**
 * Save research task to disk
 */
export async function saveTask(runDir: string, task: ResearchTask): Promise<void> {
  await ensureResearchDirectories(runDir);

  const taskPath = getTaskFilePath(runDir, task.task_id);
  const content = serializeResearchTask(task);

  await fs.writeFile(taskPath, content, 'utf-8');
}

/**
 * Load research task from disk
 */
export async function loadTask(runDir: string, taskId: string): Promise<ResearchTask | null> {
  const taskPath = getTaskFilePath(runDir, taskId);

  try {
    const content = await fs.readFile(taskPath, 'utf-8');
    const parsed = parseResearchTask(JSON.parse(content));

    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Append task event to JSONL log
 */
export async function appendTaskLog(
  runDir: string,
  event: {
    timestamp: string;
    event_type: 'created' | 'started' | 'completed' | 'failed' | 'cached';
    task_id: string;
    status: ResearchTask['status'];
    // eslint-disable-next-line @typescript-eslint/no-restricted-types -- intentional: research task metadata varies by source and objective
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await ensureResearchDirectories(runDir);

  const logPath = getTasksLogPath(runDir);
  const line = JSON.stringify(event);

  await fs.appendFile(logPath, `${line}\n`, 'utf-8');
}

/**
 * List all task IDs in the research directory
 */
export async function listTaskIds(runDir: string): Promise<string[]> {
  const tasksDir = getTasksDirectory(runDir);

  try {
    const entries = await fs.readdir(tasksDir);
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace('.json', ''));
  } catch {
    return [];
  }
}

// Cache Management

/**
 * Find existing task with matching cache key
 */
export async function findCachedTask(
  runDir: string,
  cacheKey: string
): Promise<ResearchTask | null> {
  const taskIds = await listTaskIds(runDir);

  for (const taskId of taskIds) {
    const task = await loadTask(runDir, taskId);

    if (task && task.cache_key === cacheKey) {
      return task;
    }
  }

  return null;
}

/**
 * Check if cached task result is still fresh
 */
export function isCachedTaskFresh(task: ResearchTask, requirements: FreshnessRequirement): boolean {
  if (!task.results) {
    return false;
  }

  return isCachedResultFresh(task.results, requirements);
}
