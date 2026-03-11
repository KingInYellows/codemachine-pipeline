import { getRunDirectoryPath } from '../../../persistence/runLifecycle';
import { generateSummary as generateBranchProtectionSummary } from '../../../workflows/branchProtectionReporter';
import { loadReport as loadBranchProtectionReport } from '../../../persistence/branchProtectionStore';
import type { StatusBranchProtectionPayload } from '../types';
import { logIfUnexpectedFileError } from './types';
import type { DataLogger } from './types';

export async function loadBranchProtectionStatus(
  baseDir: string,
  featureId: string,
  logger?: DataLogger
): Promise<StatusBranchProtectionPayload | undefined> {
  const runDir = getRunDirectoryPath(baseDir, featureId);

  try {
    const report = await loadBranchProtectionReport(runDir);

    if (!report) {
      return undefined;
    }

    const summary = generateBranchProtectionSummary(report);

    return {
      ...summary,
      evaluated_at: report.evaluated_at,
      ...(report.validation_mismatch && { validation_mismatch: report.validation_mismatch }),
    };
  } catch (error) {
    logIfUnexpectedFileError(error, logger, 'Failed to load branch protection', {
      run_dir: runDir,
      error_code: 'STATUS_BRANCH_PROTECTION_LOAD_FAILED',
    });
    return undefined;
  }
}
