export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
export const ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV =
  'CODEPIPE_ALLOW_UNSAFE_GITHUB_API_BASE_URL';

function trimTrailingSlash(pathname: string): string {
  if (pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '') || '/';
}

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

export function resolveGitHubApiBaseUrl(baseUrl: string | undefined): string {
  const candidate = baseUrl ?? DEFAULT_GITHUB_API_BASE_URL;
  const parsed = new URL(candidate);
  const normalizedPath = trimTrailingSlash(parsed.pathname);
  const allowUnsafeCustomBaseUrl =
    process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] === '1';
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
