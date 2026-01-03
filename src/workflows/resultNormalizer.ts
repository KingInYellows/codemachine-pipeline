import type { RunnerResult } from './codeMachineRunner.js';

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
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[OPENAI_KEY_REDACTED]' },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, replacement: '[ANTHROPIC_KEY_REDACTED]' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[GITHUB_TOKEN_REDACTED]' },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, replacement: '[GITHUB_OAUTH_REDACTED]' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, replacement: '[GITHUB_PAT_REDACTED]' },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: 'Bearer [TOKEN_REDACTED]' },
  { pattern: /Authorization:\s*[^\s]+/gi, replacement: 'Authorization: [REDACTED]' },
  { pattern: /api[_-]?key[=:]\s*[^\s&"']+/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /token[=:]\s*[^\s&"']+/gi, replacement: 'token=[REDACTED]' },
  { pattern: /password[=:]\s*[^\s&"']+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /secret[=:]\s*[^\s&"']+/gi, replacement: 'secret=[REDACTED]' },
  { pattern: /AWS[A-Z0-9]{16,}/g, replacement: '[AWS_KEY_REDACTED]' },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: '[AWS_ACCESS_KEY_REDACTED]' },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, replacement: '[SLACK_TOKEN_REDACTED]' },
  { pattern: /lin_api_[a-zA-Z0-9]{40,}/g, replacement: '[LINEAR_KEY_REDACTED]' },
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

export function categorizeError(result: RunnerResult): ErrorCategory {
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

  return 'unknown';
}

export function normalizeResult(result: RunnerResult): NormalizedResult {
  const redactedStdout = redactCredentials(result.stdout);
  const redactedStderr = redactCredentials(result.stderr);
  const errorCategory = categorizeError(result);

  return {
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
    artifacts: extractArtifactPaths(result.stdout),
  };
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
  const recoverableCategories: ErrorCategory[] = ['timeout', 'rate_limit', 'network'];
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
