/**
 * Branch Protection Store
 *
 * Persistence layer for branch protection report artifacts.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BranchProtectionReportSchema,
  type BranchProtectionReport,
} from '../core/models/BranchProtectionReport';

const BRANCH_PROTECTION_FILE = 'branch_protection.json';

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Persist branch protection report to run directory
 */
export async function persistReport(
  runDir: string,
  report: BranchProtectionReport
): Promise<string> {
  const reportPath = join(runDir, 'status', BRANCH_PROTECTION_FILE);

  await mkdir(dirname(reportPath), { recursive: true });

  const validated = BranchProtectionReportSchema.parse(report);
  await writeFile(reportPath, JSON.stringify(validated, null, 2), 'utf-8');

  return reportPath;
}

/**
 * Load branch protection report from run directory
 */
export async function loadReport(runDir: string): Promise<BranchProtectionReport | null> {
  const reportPath = join(runDir, 'status', BRANCH_PROTECTION_FILE);

  try {
    const content = await readFile(reportPath, 'utf-8');
    const data: unknown = JSON.parse(content);
    return BranchProtectionReportSchema.parse(data);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
