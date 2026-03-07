import type { NormalizedResult } from './resultNormalizer.js';
import type { ExecutionStrategyResult } from './executionStrategy.js';

/**
 * Map a NormalizedResult to the ExecutionStrategyResult status field.
 *
 * Centralises the exit-code / flag -> status derivation that was previously
 * duplicated in CodeMachineStrategy.mapStatus() and inlined via
 * normalized.status in CodeMachineCLIStrategy.
 */
export function mapExitToStatus(
  normalized: Pick<NormalizedResult, 'success' | 'timedOut' | 'killed'>
): ExecutionStrategyResult['status'] {
  if (normalized.success) return 'completed';
  if (normalized.timedOut) return 'timeout';
  if (normalized.killed) return 'killed';
  return 'failed';
}

/**
 * Optional overrides that individual strategies can supply when their
 * result-building logic diverges from the common defaults.
 */
export interface BuildStrategyResultOverrides {
  /** Override the duration (e.g. when the caller times the span itself). */
  durationMs?: number;
  /** Override the summary string. */
  summary?: string;
  /** Override the error message attached on failure. */
  errorMessage?: string;
}

/**
 * Build an ExecutionStrategyResult from a NormalizedResult.
 *
 * Provides sensible defaults that match the original CodeMachineStrategy
 * behaviour while allowing per-call overrides for CodeMachineCLIStrategy
 * (which computes summary and errorMessage slightly differently).
 */
export function buildStrategyResult(
  normalized: NormalizedResult,
  overrides?: BuildStrategyResultOverrides
): ExecutionStrategyResult {
  const result: ExecutionStrategyResult = {
    success: normalized.success,
    status: mapExitToStatus(normalized),
    summary: overrides?.summary ?? normalized.redactedStdout.slice(0, 500),
    recoverable: normalized.recoverable,
    durationMs: overrides?.durationMs ?? normalized.durationMs,
    artifacts: normalized.artifacts,
  };

  if (!normalized.success) {
    result.errorMessage = overrides?.errorMessage ?? normalized.redactedStderr;
  }

  return result;
}
