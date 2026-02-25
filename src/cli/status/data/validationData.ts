import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getRunDirectoryPath } from '../../../persistence/runDirectoryManager';
import { safeJsonParse } from '../../../utils/safeJson';
import type { StatusValidationPayload } from '../types';
import type { DataLogger } from './types';

export async function loadValidationStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusValidationPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  const queueValidationPath = path.join(runDir, 'queue_validation.json');
  const planValidationPath = path.join(runDir, 'plan_validation.json');

  let queueValid: boolean | undefined;
  let planValid: boolean | undefined;
  const integrityWarnings: string[] = [];

  try {
    const queueContent = await fs.readFile(queueValidationPath, 'utf-8');
    const queueData = safeJsonParse<{ valid: boolean; errors?: unknown[] }>(queueContent);
    if (queueData) {
      queueValid = queueData.valid;
      if (!queueData.valid && queueData.errors && Array.isArray(queueData.errors)) {
        integrityWarnings.push(`Queue validation found ${queueData.errors.length} errors`);
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      logger?.warn('Failed to load queue validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        queue_validation_path: queueValidationPath,
        error_code: 'STATUS_QUEUE_VALIDATION_LOAD_FAILED',
      });
    }
  }

  try {
    const planContent = await fs.readFile(planValidationPath, 'utf-8');
    const planData = safeJsonParse<{ valid: boolean; errors?: string[] }>(planContent);
    if (planData) {
      planValid = planData.valid;
      if (!planData.valid && planData.errors && Array.isArray(planData.errors)) {
        integrityWarnings.push(...planData.errors);
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      logger?.warn('Failed to load plan validation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        plan_validation_path: planValidationPath,
        error_code: 'STATUS_PLAN_VALIDATION_LOAD_FAILED',
      });
    }
  }

  const hasValidationData = queueValid !== undefined || planValid !== undefined;

  if (!hasValidationData) {
    return undefined;
  }

  const validationPayload: StatusValidationPayload = {
    has_validation_data: hasValidationData,
  };

  if (queueValid !== undefined) {
    validationPayload.queue_valid = queueValid;
  }

  if (planValid !== undefined) {
    validationPayload.plan_valid = planValid;
  }

  if (integrityWarnings.length > 0) {
    validationPayload.integrity_warnings = integrityWarnings;
  }

  return validationPayload;
}
