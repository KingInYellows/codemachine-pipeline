import type { RunnerResult } from './codeMachineRunner.js';
import type { StructuredLogger } from '../telemetry/logger.js';

export interface NormalizedResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
  errorCategory: ErrorCategory;
  redactedStdout: string;
  redactedStderr: string;
  artifacts: string[];
  // Additional fields from issue spec
  status: 'completed' | 'failed' | 'timeout' | 'killed';
  summary: string;
  errorMessage?: string;
  recoverable: boolean;
}

export type ErrorCategory =
  | 'none'
  | 'timeout'
  | 'killed'
  | 'validation'
  | 'authentication'
  | 'rate_limit'
  | 'network'
  | 'unknown';

const CREDENTIAL_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Specific token patterns MUST come before generic patterns
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, replacement: '[ANTHROPIC_KEY_REDACTED]' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[OPENAI_KEY_REDACTED]' },
  { pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: '[GITHUB_TOKEN_REDACTED]' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, replacement: '[GITHUB_PAT_REDACTED]' },
  {
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    replacement: '[JWT_REDACTED]',
  },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, replacement: '[SLACK_TOKEN_REDACTED]' },
  { pattern: /lin_api_[a-zA-Z0-9]{40,}/g, replacement: '[LINEAR_KEY_REDACTED]' },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: '[AWS_ACCESS_KEY_REDACTED]' },
  {
    pattern: /(?:aws[_-]?secret|secret[_-]?access)[^=]*=\s*["']?[A-Za-z0-9/+=]{40}/gi,
    replacement: '[AWS_SECRET_REDACTED]',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END/g,
    replacement: '[PRIVATE_KEY_REDACTED]',
  },
  {
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
    replacement: '[CONNECTION_STRING_REDACTED]',
  },
  {
    pattern: /(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|LINEAR_API_KEY)=["']?[^\s"']+/gi,
    replacement: '[ENV_VAR_REDACTED]',
  },
  // Generic patterns MUST come after specific patterns and exclude already-redacted values
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: 'Bearer [TOKEN_REDACTED]' },
  { pattern: /Authorization:\s*(?!\[)[^\s]+/gi, replacement: 'Authorization: [REDACTED]' },
  { pattern: /api[_-]?key[=:]\s*(?!\[)[^\s&"'\[]+/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /token[=:]\s*(?!\[)[^\s&"'\[]+/gi, replacement: 'token=[REDACTED]' },
  { pattern: /password[=:]\s*(?!\[)[^\s&"'\[]+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /secret[=:]\s*(?!\[)[^\s&"'\[]+/gi, replacement: 'secret=[REDACTED]' },
];

const ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; category: ErrorCategory }> = [
  { pattern: /authentication.*failed|unauthorized|401/i, category: 'authentication' },
  { pattern: /rate.*limit|429|too many requests/i, category: 'rate_limit' },
  { pattern: /network.*error|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i, category: 'network' },
  { pattern: /validation.*error|invalid.*input|schema.*error/i, category: 'validation' },
];

export function redactCredentials(text: string): string {
  let result = text;
  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Extract summary from stdout (first meaningful line, max 500 chars)
 */
export function extractSummary(stdout: string): string {
  const lines = stdout.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) return 'No output';

  const summary = lines[0];
  const maxLength = 500;

  return summary.length > maxLength
    ? summary.slice(0, maxLength) + '...'
    : summary;
}

/**
 * Derive status field from error category and flags
 */
function deriveStatus(
  timedOut: boolean,
  killed: boolean,
  exitCode: number,
): 'completed' | 'failed' | 'timeout' | 'killed' {
  if (exitCode === 0) return 'completed';
  if (timedOut) return 'timeout';
  if (killed) return 'killed';
  return 'failed';
}

export function categorizeError(
  result: RunnerResult,
  logger?: StructuredLogger,
): ErrorCategory {
  if (result.exitCode === 0) {
    return 'none';
  }

  if (result.timedOut) {
    return 'timeout';
  }

  if (result.killed) {
    return 'killed';
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;

  for (const { pattern, category } of ERROR_PATTERNS) {
    if (pattern.test(combinedOutput)) {
      return category;
    }
  }

  // Log warning for unknown exit codes
  logger?.warn('Unknown exit code encountered', {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(0, 200),
    stderr: result.stderr.slice(0, 200),
  });

  return 'unknown';
}

// Overload: 5-parameter signature from issue spec
export function normalizeResult(
  exitCode: number,
  stdout: string,
  stderr: string,
  timedOut: boolean,
  killed: boolean,
  logger?: StructuredLogger,
): NormalizedResult;

// Overload: existing RunnerResult signature
export function normalizeResult(
  result: RunnerResult,
  logger?: StructuredLogger,
): NormalizedResult;

// Implementation
export function normalizeResult(
  resultOrExitCode: RunnerResult | number,
  stdoutOrLogger?: string | StructuredLogger,
  stderr?: string,
  timedOut?: boolean,
  killed?: boolean,
  logger?: StructuredLogger,
): NormalizedResult {
  // Handle overload signatures - determine which overload was called
  let result: RunnerResult;
  let resolvedLogger: StructuredLogger | undefined;

  if (typeof resultOrExitCode === 'number') {
    // 5-parameter overload: (exitCode, stdout, stderr, timedOut, killed, logger?)
    result = {
      taskId: 'synthetic',
      exitCode: resultOrExitCode,
      stdout: stdoutOrLogger as string,
      stderr: stderr!,
      durationMs: 0,
      timedOut: timedOut!,
      killed: killed!,
    };
    resolvedLogger = logger;
  } else {
    // RunnerResult overload: (result, logger?)
    result = resultOrExitCode;
    resolvedLogger = stdoutOrLogger as StructuredLogger | undefined;
  }

  const redactedStdout = redactCredentials(result.stdout);
  const redactedStderr = redactCredentials(result.stderr);
  const errorCategory = categorizeError(result, resolvedLogger);
  const status = deriveStatus(result.timedOut, result.killed, result.exitCode);
  const summary = extractSummary(result.stdout);
  const recoverable = isRecoverableError(errorCategory);
  const artifacts = extractArtifactPaths(result.stdout);

  // Build result with conditional errorMessage
  const normalized: NormalizedResult = {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    killed: result.killed,
    errorCategory,
    redactedStdout,
    redactedStderr,
    artifacts,
    status,
    summary,
    recoverable,
  };

  if (result.exitCode !== 0) {
    normalized.errorMessage = formatErrorMessage(normalized);
  }

  return normalized;
}

export function extractArtifactPaths(stdout: string): string[] {
  const artifacts: string[] = [];
  const artifactPattern =
    /(?:created|generated|wrote|saved):\s*([^\s]+\.(ts|js|json|md|txt|yaml|yml))/gi;

  let match;
  while ((match = artifactPattern.exec(stdout)) !== null) {
    const filePath = match[1];
    if (filePath && isValidArtifactPath(filePath)) {
      artifacts.push(filePath);
    }
  }

  return [...new Set(artifacts)];
}

export function isValidArtifactPath(filePath: string): boolean {
  if (filePath.includes('..')) {
    return false;
  }

  if (filePath.startsWith('/') && !filePath.startsWith('/workspace')) {
    return false;
  }

  const dangerousPaths = ['/etc/', '/usr/', '/var/', '/root/', '/home/', '/tmp/'];
  for (const dangerous of dangerousPaths) {
    if (filePath.startsWith(dangerous)) {
      return false;
    }
  }

  return true;
}

export function isRecoverableError(category: ErrorCategory): boolean {
  const recoverableCategories: ErrorCategory[] = ['timeout', 'rate_limit', 'network', 'killed'];
  return recoverableCategories.includes(category);
}

export function formatErrorMessage(result: NormalizedResult): string {
  const parts: string[] = [];

  parts.push(`Exit code: ${result.exitCode}`);
  parts.push(`Category: ${result.errorCategory}`);

  if (result.timedOut) {
    parts.push('Task timed out');
  }

  if (result.killed) {
    parts.push('Process was killed');
  }

  if (result.redactedStderr) {
    const truncated =
      result.redactedStderr.length > 500
        ? result.redactedStderr.slice(0, 500) + '...'
        : result.redactedStderr;
    parts.push(`Error output: ${truncated}`);
  }

  return parts.join(' | ');
}

export function createResultSummary(result: NormalizedResult): {
  status: 'success' | 'failure';
  message: string;
  recoverable: boolean;
} {
  if (result.success) {
    return {
      status: 'success',
      message: `Completed in ${result.durationMs}ms`,
      recoverable: false,
    };
  }

  return {
    status: 'failure',
    message: formatErrorMessage(result),
    recoverable: isRecoverableError(result.errorCategory),
  };
}
