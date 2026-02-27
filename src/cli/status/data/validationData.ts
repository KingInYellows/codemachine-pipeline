import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../../utils/safeJson';
import type { StatusValidationPayload } from '../types';
import type { DataLogger } from './types';

type ValidationReadResult = {
  valid: boolean | undefined;
  warnings: string[];
};

function shouldLogValidationReadError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT');
}

async function readQueueValidation(
  queueValidationPath: string,
  logger?: DataLogger
): Promise<ValidationReadResult> {
  const warnings: string[] = [];

  try {
    const queueContent = await readFile(queueValidationPath, 'utf-8');
    const queueData = safeJsonParse<{ valid: boolean; errors?: unknown[] }>(queueContent);

    if (!queueData) {
      return { valid: undefined, warnings };
    }

    if (!queueData.valid && Array.isArray(queueData.errors)) {
      warnings.push(`Queue validation found ${queueData.errors.length} errors`);
    }

    return { valid: queueData.valid, warnings };
  } catch (error) {
    if (shouldLogValidationReadError(error)) {
      logger?.warn('Failed to load queue validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        queue_validation_path: queueValidationPath,
        error_code: 'STATUS_QUEUE_VALIDATION_LOAD_FAILED',
      });
    }
    return { valid: undefined, warnings };
  }
}

async function readPlanValidation(
  planValidationPath: string,
  logger?: DataLogger
): Promise<ValidationReadResult> {
  const warnings: string[] = [];

  try {
    const planContent = await readFile(planValidationPath, 'utf-8');
    const planData = safeJsonParse<{ valid: boolean; errors?: string[] }>(planContent);

    if (!planData) {
      return { valid: undefined, warnings };
    }

    if (!planData.valid && Array.isArray(planData.errors)) {
      warnings.push(...planData.errors);
    }

    return { valid: planData.valid, warnings };
  } catch (error) {
    if (shouldLogValidationReadError(error)) {
      logger?.warn('Failed to load plan validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        plan_validation_path: planValidationPath,
        error_code: 'STATUS_PLAN_VALIDATION_LOAD_FAILED',
      });
    }
    return { valid: undefined, warnings };
  }
}

export async function loadValidationStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusValidationPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  const queueValidationPath = join(runDir, 'queue_validation.json');
  const planValidationPath = join(runDir, 'plan_validation.json');

  const [queueValidation, planValidation] = await Promise.all([
    readQueueValidation(queueValidationPath, logger),
    readPlanValidation(planValidationPath, logger),
  ]);

  const hasValidationData =
    queueValidation.valid !== undefined || planValidation.valid !== undefined;

  if (!hasValidationData) {
    return undefined;
  }

  const integrityWarnings = [...queueValidation.warnings, ...planValidation.warnings];
  const validationPayload: StatusValidationPayload = {
    has_validation_data: hasValidationData,
  };

  if (queueValidation.valid !== undefined) {
    validationPayload.queue_valid = queueValidation.valid;
  }

  if (planValidation.valid !== undefined) {
    validationPayload.plan_valid = planValidation.valid;
  }

  if (integrityWarnings.length > 0) {
    validationPayload.integrity_warnings = integrityWarnings;
  }

  return validationPayload;
}
