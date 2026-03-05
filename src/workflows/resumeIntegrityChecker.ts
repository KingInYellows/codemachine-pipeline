/**
 * Resume Integrity Checker
 *
 * Extracted from runStateVerifier.ts: artifact integrity verification
 * using hash manifests during execution resumption.
 */

import { verifyRunDirectoryIntegrity } from '../persistence/runDirectoryManager';
import type { VerificationResult } from '../persistence/hashManifest';
import type { ResumeAnalysis, DiagnosticSeverity, ResumeOptions } from './runStateVerifier';

export type { VerificationResult };

/**
 * Check artifact integrity using hash manifest
 */
export async function checkIntegrity(
  analysis: ResumeAnalysis,
  runDir: string,
  options: ResumeOptions
): Promise<void> {
  try {
    const integrityResult = await verifyRunDirectoryIntegrity(runDir);
    analysis.integrityCheck = integrityResult;

    if (!integrityResult.valid) {
      const severity: DiagnosticSeverity = options.force ? 'warning' : 'blocker';

      if (integrityResult.failed.length > 0) {
        analysis.diagnostics.push({
          severity,
          message: `${integrityResult.failed.length} artifact(s) failed integrity check`,
          code: 'INTEGRITY_HASH_MISMATCH',
          context: {
            failed: integrityResult.failed.map((f) => ({
              path: f.path,
              reason: f.reason,
            })),
          },
        });
      }

      if (integrityResult.missing.length > 0) {
        analysis.diagnostics.push({
          severity,
          message: `${integrityResult.missing.length} artifact(s) missing`,
          code: 'INTEGRITY_MISSING_FILES',
          context: { missing: integrityResult.missing },
        });
      }
    } else {
      analysis.diagnostics.push({
        severity: 'info',
        message: `All ${integrityResult.passed.length} artifact(s) passed integrity check`,
        code: 'INTEGRITY_OK',
      });
    }
  } catch (error) {
    // Hash manifest may not exist yet (early failure)
    analysis.diagnostics.push({
      severity: 'warning',
      message: 'Could not verify artifact integrity - hash manifest not found',
      code: 'INTEGRITY_NO_MANIFEST',
      context: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
}
