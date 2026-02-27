import { copyFile, mkdir, realpath, stat } from 'node:fs/promises';
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

async function resolveRealPathSafe(candidatePath: string): Promise<string> {
  try {
    return await realpath(candidatePath);
  } catch {
    return resolve(candidatePath);
  }
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
  const realWorkspaceDir = await resolveRealPathSafe(workspaceDir);

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

  const realRunDir = await resolveRealPathSafe(runDir);
  const realArtifactDir = await resolveRealPathSafe(artifactDir);
  if (!isPathContained(realRunDir, realArtifactDir)) {
    logger?.error('Artifact directory escapes run directory via symlink', {
      artifactDir,
      runDir,
      realArtifactDir,
      realRunDir,
    });
    return [];
  }

  const artifacts: string[] = [];

  for (const artifactPath of strategyArtifacts) {
    try {
      const sourcePath = isAbsolute(artifactPath) ? artifactPath : join(workspaceDir, artifactPath);

      const stats = await stat(sourcePath).catch(() => null);
      if (!stats) {
        continue;
      }

      const realSourcePath = await resolveRealPathSafe(sourcePath);
      if (!isPathContained(realWorkspaceDir, realSourcePath)) {
        logger?.warn('Artifact path escapes workspace', {
          artifactPath,
          workspaceDir,
          sourcePath,
          realSourcePath,
          realWorkspaceDir,
        });
        continue;
      }

      const artifactName = basename(artifactPath);
      const destPath = join(realArtifactDir, artifactName);

      if (!isPathContained(realArtifactDir, destPath)) {
        logger?.warn('Artifact destination escapes artifact directory', { destPath, artifactDir });
        continue;
      }

      await copyFile(realSourcePath, destPath);
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
