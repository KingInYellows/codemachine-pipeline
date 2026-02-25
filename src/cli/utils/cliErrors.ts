/**
 * Centralized CLI error handling utilities (CDMCH-53)
 *
 * Provides:
 * - CliError class with typed error codes and exit codes
 * - Human-readable and JSON error formatting
 * - Consistent error code registry
 * - Documentation link helper
 * - Actionable remediation with howToFix and commonFixes
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
  NETWORK_ERROR = 'NETWORK_ERROR',
  LINEAR_API_FAILED = 'LINEAR_API_FAILED',
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
  [CliErrorCode.NETWORK_ERROR]: 1,
  [CliErrorCode.LINEAR_API_FAILED]: 1,
};

/** Map error codes to documentation anchors */
const DOCS_ANCHOR_MAP: Partial<Record<CliErrorCode, string>> = {
  [CliErrorCode.CONFIG_INVALID]: 'configuration',
  [CliErrorCode.CONFIG_NOT_FOUND]: 'configuration',
  [CliErrorCode.GIT_NOT_FOUND]: 'prerequisites',
  [CliErrorCode.TOKEN_MISSING]: 'authentication',
  [CliErrorCode.QUEUE_CORRUPTED]: 'troubleshooting',
  [CliErrorCode.MANIFEST_READ_FAILED]: 'troubleshooting',
  [CliErrorCode.RUN_DIR_NOT_FOUND]: 'troubleshooting',
  [CliErrorCode.LINEAR_API_FAILED]: 'integrations',
  [CliErrorCode.NETWORK_ERROR]: 'troubleshooting',
};

const DOCS_BASE_URL = 'https://github.com/KingInYellows/codemachine-pipeline#';

/** Options for constructing a CliError. */
export interface CliErrorOptions {
  remediation?: string;
  howToFix?: string;
  commonFixes?: string[];
  cause?: Error;
}

/**
 * Structured CLI error with typed code and exit code.
 */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly remediation?: string;
  readonly howToFix?: string;
  readonly commonFixes?: string[];

  constructor(
    message: string,
    code: CliErrorCode = CliErrorCode.GENERAL,
    options?: CliErrorOptions
  ) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = EXIT_CODE_MAP[code];
    if (options?.remediation) {
      this.remediation = options.remediation;
    }
    if (options?.howToFix) {
      this.howToFix = options.howToFix;
    }
    if (options?.commonFixes) {
      this.commonFixes = options.commonFixes;
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
/** Typed JSON payload returned by {@link formatErrorJson}. */
export interface CliErrorJsonPayload {
  error: true;
  code: CliErrorCode;
  exit_code: number;
  message: string;
  remediation?: string;
  how_to_fix?: string;
  common_fixes?: string[];
  docs_url?: string;
}

export function formatErrorJson(error: CliError): CliErrorJsonPayload {
  const result: CliErrorJsonPayload = {
    error: true,
    code: error.code,
    exit_code: error.exitCode,
    message: error.message,
  };

  if (error.remediation) {
    result.remediation = error.remediation;
  }

  if (error.howToFix) {
    result.how_to_fix = error.howToFix;
  }

  if (error.commonFixes && error.commonFixes.length > 0) {
    result.common_fixes = error.commonFixes;
  }

  const docsUrl = getDocsUrl(error.code);
  if (docsUrl) {
    result.docs_url = docsUrl;
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

/**
 * Enable JSON output mode for the current CLI command.
 * Centralizes the process.env.JSON_OUTPUT convention so callers
 * don't hard-code the env-var name.
 */
export function setJsonOutputMode(): void {
  process.env['JSON_OUTPUT'] = '1';
}

/**
 * Shared error message constants used across multiple CLI commands.
 */
export const ERROR_MESSAGES = {
  REPO_NOT_INITIALIZED: 'Repository not initialized. Run "codepipe init" first.',
} as const;

/**
 * Re-throw an error if it is an oclif error (i.e. has an `oclif` property).
 *
 * Oclif errors carry structured exit codes that must be preserved.  Calling
 * this at the top of every outer catch block replaces the repeated inline
 * guard:
 *
 *   if (error && typeof error === 'object' && 'oclif' in error) throw error;
 */
export function rethrowIfOclifError(error: unknown): void {
  if (error && typeof error === 'object' && 'oclif' in error) {
    throw error;
  }
}
