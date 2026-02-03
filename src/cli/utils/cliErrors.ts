/**
 * Centralized CLI error handling utilities (CDMCH-53)
 *
 * Provides:
 * - CliError class with typed error codes and exit codes
 * - Human-readable and JSON error formatting
 * - Consistent error code registry
 * - Documentation link helper
 */

/**
 * CLI error codes registry.
 *
 * Exit code ranges follow the doctor.ts convention:
 * - 0: Success
 * - 1: General error
 * - 10: Validation error (config issues)
 * - 20: Environment error (missing tools, filesystem)
 * - 30: Credential/auth error
 */
export enum CliErrorCode {
  GENERAL = 'GENERAL_ERROR',
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
  MANIFEST_READ_FAILED = 'MANIFEST_READ_FAILED',
  RUN_DIR_NOT_FOUND = 'RUN_DIR_NOT_FOUND',
  GIT_NOT_FOUND = 'GIT_NOT_FOUND',
  GIT_NOT_REPO = 'GIT_NOT_REPO',
  TOKEN_MISSING = 'TOKEN_MISSING',
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',
  QUEUE_CORRUPTED = 'QUEUE_CORRUPTED',
  DISK_FULL = 'DISK_FULL',
}

/** Map error codes to exit codes */
const EXIT_CODE_MAP: Record<CliErrorCode, number> = {
  [CliErrorCode.GENERAL]: 1,
  [CliErrorCode.CONFIG_INVALID]: 10,
  [CliErrorCode.CONFIG_NOT_FOUND]: 10,
  [CliErrorCode.MANIFEST_READ_FAILED]: 10,
  [CliErrorCode.RUN_DIR_NOT_FOUND]: 20,
  [CliErrorCode.GIT_NOT_FOUND]: 20,
  [CliErrorCode.GIT_NOT_REPO]: 20,
  [CliErrorCode.AGENT_TIMEOUT]: 1,
  [CliErrorCode.QUEUE_CORRUPTED]: 1,
  [CliErrorCode.TOKEN_MISSING]: 30,
  [CliErrorCode.DISK_FULL]: 20,
};

/** Map error codes to documentation anchors */
const DOCS_ANCHOR_MAP: Partial<Record<CliErrorCode, string>> = {
  [CliErrorCode.CONFIG_INVALID]: 'configuration',
  [CliErrorCode.CONFIG_NOT_FOUND]: 'configuration',
  [CliErrorCode.GIT_NOT_FOUND]: 'prerequisites',
  [CliErrorCode.TOKEN_MISSING]: 'authentication',
};

const DOCS_BASE_URL = 'https://github.com/KingInYellows/codemachine-pipeline#';

/**
 * Structured CLI error with typed code and exit code.
 */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly remediation?: string;

  constructor(
    message: string,
    code: CliErrorCode = CliErrorCode.GENERAL,
    options?: { remediation?: string; cause?: Error }
  ) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = EXIT_CODE_MAP[code];
    if (options?.remediation) {
      this.remediation = options.remediation;
    }
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Format an unknown error into a human-readable message.
 *
 * Replaces inline `formatUnknownError` methods in individual commands.
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof CliError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Format a CliError as a JSON payload for --json output.
 */
export function formatErrorJson(error: CliError): Record<string, unknown> {
  const result: Record<string, unknown> = {
    error: true,
    code: error.code,
    exit_code: error.exitCode,
    message: error.message,
  };

  if (error.remediation) {
    result.remediation = error.remediation;
  }

  const docsAnchor = DOCS_ANCHOR_MAP[error.code];
  if (docsAnchor) {
    result.docs_url = `${DOCS_BASE_URL}${docsAnchor}`;
  }

  return result;
}

/**
 * Get a documentation URL for a given error code.
 *
 * @returns URL string or undefined if no docs exist for this code
 */
export function getDocsUrl(code: CliErrorCode): string | undefined {
  const anchor = DOCS_ANCHOR_MAP[code];
  return anchor ? `${DOCS_BASE_URL}${anchor}` : undefined;
}
