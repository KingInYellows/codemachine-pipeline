/**
 * Shared GitHub API path parameter validation.
 *
 * Used by GitHubAdapter and BranchProtectionAdapter to validate
 * owner, repo, and pull_number before interpolation into URL paths.
 */

import { AdapterError } from '../../utils/errors';
import { ErrorType } from '../../core/sharedTypes';

/** GitHub usernames and organizations use alphanumerics with single hyphen separators. */
const GITHUB_OWNER_RE = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
/** Repository names allow dot-prefixed repos like `.github` but must remain a single safe path segment. */
const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]+$/;

type AdapterErrorConstructor = new (message: string, errorType: ErrorType) => AdapterError;

export function validateGitHubName(
  value: string,
  label: 'owner' | 'repo',
  ErrorClass: AdapterErrorConstructor
): string {
  if (!value) {
    throw new ErrorClass(
      `Invalid GitHub ${label}: "${value}" — cannot be empty`,
      ErrorType.PERMANENT
    );
  }

  if (label === 'owner') {
    if (!GITHUB_OWNER_RE.test(value)) {
      throw new ErrorClass(
        `Invalid GitHub owner: "${value}" — must contain only alphanumeric characters or single hyphens`,
        ErrorType.PERMANENT
      );
    }
    return value;
  }

  if (!GITHUB_REPO_RE.test(value) || value === '.' || value === '..') {
    throw new ErrorClass(
      `Invalid GitHub repo: "${value}" — must be a single safe path segment`,
      ErrorType.PERMANENT
    );
  }

  if (value.endsWith('.') || value.endsWith('.git')) {
    throw new ErrorClass(
      `Invalid GitHub repo: "${value}" — cannot end with "." or ".git"`,
      ErrorType.PERMANENT
    );
  }

  return value;
}

export function validatePullNumber(
  value: number,
  ErrorClass: AdapterErrorConstructor
): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ErrorClass(
      `Invalid pull request number: ${String(value)} — must be a positive integer`,
      ErrorType.PERMANENT
    );
  }
}
