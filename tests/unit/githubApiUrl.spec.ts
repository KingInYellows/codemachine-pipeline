import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV,
  classifyGitHubApiBaseUrl,
  DEFAULT_GITHUB_API_BASE_URL,
  resolveGitHubApiBaseUrl,
} from '../../src/utils/githubApiUrl.js';

describe('githubApiUrl', () => {
  afterEach(() => {
    delete process.env[ALLOW_UNSAFE_CUSTOM_GITHUB_API_BASE_URL_ENV];
  });

  it('classifies the default GitHub API URL even with a trailing slash', () => {
    expect(classifyGitHubApiBaseUrl(DEFAULT_GITHUB_API_BASE_URL)).toBe('default');
    expect(classifyGitHubApiBaseUrl(`${DEFAULT_GITHUB_API_BASE_URL}/`)).toBe('default');
  });

  it('classifies malformed URLs separately from custom enterprise URLs', () => {
    expect(classifyGitHubApiBaseUrl('not a url')).toBe('invalid');
    expect(classifyGitHubApiBaseUrl('https://github.example.com/api/v3')).toBe('custom');
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
