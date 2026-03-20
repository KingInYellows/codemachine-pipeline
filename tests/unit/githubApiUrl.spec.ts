import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV,
  DEFAULT_GITHUB_API_BASE_URL,
  hasCustomGitHubApiBaseUrl,
  resolveGitHubApiBaseUrl,
} from '../../src/utils/githubApiUrl.js';

describe('githubApiUrl', () => {
  afterEach(() => {
    delete process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV];
  });

  it('treats the default GitHub API URL as non-custom even with a trailing slash', () => {
    expect(hasCustomGitHubApiBaseUrl(DEFAULT_GITHUB_API_BASE_URL)).toBe(false);
    expect(hasCustomGitHubApiBaseUrl(`${DEFAULT_GITHUB_API_BASE_URL}/`)).toBe(false);
  });

  it('treats malformed URLs as custom so config loading can warn early', () => {
    expect(hasCustomGitHubApiBaseUrl('not a url')).toBe(true);
  });

  it('rejects custom GitHub API base URLs without explicit opt-in', () => {
    expect(() => resolveGitHubApiBaseUrl('https://github.example.com/api/v3')).toThrow(
      `Set ${ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV}=1`
    );
  });

  it('rejects non-https custom GitHub API base URLs even when opted in', () => {
    process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] = '1';

    expect(() => resolveGitHubApiBaseUrl('http://github.example.com/api/v3')).toThrow(
      'GitHub API base URL must use https for custom hosts'
    );
  });

  it('returns custom GitHub API base URLs with a trailing slash when opted in', () => {
    process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] = '1';

    expect(resolveGitHubApiBaseUrl('https://github.example.com/api/v3')).toBe(
      'https://github.example.com/api/v3/'
    );
  });

  it('rejects custom GitHub API base URLs that use unsupported paths', () => {
    process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV] = '1';

    expect(() => resolveGitHubApiBaseUrl('https://github.example.com/custom/api/v3')).toThrow(
      'GitHub API base URL must use either the root path or /api/v3 for custom hosts'
    );
  });

  it('allows the default GitHub API URL without opt-in', () => {
    expect(resolveGitHubApiBaseUrl(undefined)).toBe(DEFAULT_GITHUB_API_BASE_URL);
    expect(resolveGitHubApiBaseUrl(`${DEFAULT_GITHUB_API_BASE_URL}/`)).toBe(
      DEFAULT_GITHUB_API_BASE_URL
    );
  });
});
