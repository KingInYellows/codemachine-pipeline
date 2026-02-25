import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { ExecutionTask } from '../core/models/ExecutionTask.js';
import { StructuredLogger } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId) && !taskId.includes('..');
}

export function isPathContained(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + sep) || resolvedTarget === resolvedBase;
}

/**
 * Copy strategy-produced artifacts into the run's artifact directory.
 * Applies path-traversal protection on both source and destination paths.
 */
export async function captureArtifacts(
  runDir: string,
  task: ExecutionTask,
  workspaceDir: string,
  strategyArtifacts: string[],
  logger?: StructuredLogger
): Promise<string[]> {
  if (!validateTaskId(task.task_id)) {
    logger?.warn('Invalid task ID format, skipping artifact capture', { taskId: task.task_id });
    return [];
  }

  const artifactDir = join(runDir, 'artifacts', task.task_id);

  if (!isPathContained(runDir, artifactDir)) {
    logger?.error('Artifact directory escapes run directory', { artifactDir, runDir });
    return [];
  }

  try {
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger?.warn('Failed to create artifact directory', {
      error: getErrorMessage(err),
      taskId: task.task_id,
    });
    return [];
  }

  const artifacts: string[] = [];

  for (const artifactPath of strategyArtifacts) {
    try {
      const sourcePath = isAbsolute(artifactPath)
        ? artifactPath
        : join(workspaceDir, artifactPath);

      if (!isPathContained(workspaceDir, sourcePath)) {
        logger?.warn('Artifact path escapes workspace', { artifactPath, workspaceDir });
        continue;
      }

      const stats = await stat(sourcePath).catch(() => null);
      if (!stats) {
        continue;
      }

      const artifactName = basename(artifactPath);
      const destPath = join(artifactDir, artifactName);

      if (!isPathContained(artifactDir, destPath)) {
        logger?.warn('Artifact destination escapes artifact directory', { destPath, artifactDir });
        continue;
      }

      await copyFile(sourcePath, destPath);
      artifacts.push(artifactName);
    } catch (err) {
      logger?.warn('Artifact capture failed', {
        error: getErrorMessage(err),
        artifactPath,
        taskId: task.task_id,
      });
    }
  }

  return artifacts;
}
