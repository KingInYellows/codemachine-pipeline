/**
 * GitHub API URL Resolution
 *
 * Resolves and validates the GitHub API base URL with security checks:
 * - Rejects URLs with embedded credentials (username/password)
 * - Rejects URLs with query strings or fragments
 * - Requires explicit opt-in for custom (GitHub Enterprise) hosts
 * - Enforces HTTPS for all custom hosts
 */

/** Default GitHub API base URL for github.com */
export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

/** Environment variable that must be set to '1' to allow custom GitHub API hosts */
export const ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV =
  'CODEPIPE_ALLOW_UNSAFE_GITHUB_API_BASE_URL';

function trimTrailingSlash(pathname: string): string {
  if (pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Check whether the given base URL differs from the default GitHub API URL.
 *
 * @param baseUrl - GitHub API base URL to check
 * @returns true if the URL points to a non-default host (e.g., GitHub Enterprise)
 */
export function hasCustomGitHubApiBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = trimTrailingSlash(parsed.pathname);
    return !(
      parsed.protocol === 'https:' &&
      parsed.hostname === 'api.github.com' &&
      parsed.port === '' &&
      normalizedPath === '/'
    );
  } catch {
    return false;
  }
}

/**
 * Resolve and validate the GitHub API base URL.
 *
 * Security validation rules:
 * 1. Rejects URLs with embedded credentials (username:password@host)
 * 2. Rejects URLs with query strings or hash fragments
 * 3. For non-default hosts, requires CODEPIPE_ALLOW_UNSAFE_GITHUB_API_BASE_URL=1
 * 4. Enforces HTTPS for custom hosts
 *
 * @param baseUrl - GitHub API base URL, or undefined to use the default
 * @returns Normalized base URL string
 * @throws {Error} If the URL contains credentials, query strings, or fragments
 * @throws {Error} If a custom host is used without explicit opt-in
 * @throws {Error} If a custom host does not use HTTPS
 */
export function resolveGitHubApiBaseUrl(baseUrl: string | undefined): string {
  const candidate = baseUrl ?? DEFAULT_GITHUB_API_BASE_URL;
  const parsed = new URL(candidate);
  const normalizedPath = trimTrailingSlash(parsed.pathname);
  const allowUnsafeCustomBaseUrl = process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] === '1';
  const isDefaultGitHubApi =
    parsed.protocol === 'https:' &&
    parsed.hostname === 'api.github.com' &&
    parsed.port === '' &&
    normalizedPath === '/';

  if (parsed.username || parsed.password) {
    throw new Error('GitHub API base URL must not include embedded credentials');
  }

  if (parsed.search || parsed.hash) {
    throw new Error('GitHub API base URL must not include query strings or fragments');
  }

  if (isDefaultGitHubApi) {
    return DEFAULT_GITHUB_API_BASE_URL;
  }

  if (!allowUnsafeCustomBaseUrl) {
    throw new Error(
      `Refusing to use custom GitHub API base URL without explicit opt-in. ` +
        `Set ${ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV}=1 only for a trusted GitHub Enterprise host.`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('GitHub API base URL must use https for custom hosts');
  }

  return `${parsed.origin}${normalizedPath === '/' ? '/' : `${normalizedPath}/`}`;
}
