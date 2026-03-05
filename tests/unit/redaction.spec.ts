/**
 * Tests for consolidated RedactionEngine (CDMCH-168)
 */

import { describe, it, expect } from 'vitest';
import { RedactionEngine, REDACTED } from '../../src/utils/redaction';

describe('RedactionEngine.isSensitiveFieldName', () => {
  it.each([
    'authorization',
    'Authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-csrf-token',
    'password',
    'secret',
    'token',
    'api_key',
    'apikey',
    'credential',
    'private_key',
    'privatekey',
    'X-API-KEY',
  ])('should detect "%s" as sensitive', (name) => {
    expect(RedactionEngine.isSensitiveFieldName(name)).toBe(true);
  });

  it.each([
    'content-type',
    'accept',
    'user-agent',
    'x-request-id',
    'cache-control',
    'host',
    'oauth_state',
    'www-authenticate',
    'x-auth-provider',
  ])('should not detect "%s" as sensitive', (name) => {
    expect(RedactionEngine.isSensitiveFieldName(name)).toBe(false);
  });
});

describe('RedactionEngine.isSensitiveUrlQueryParamName', () => {
  it.each([
    'token',
    'access_token',
    'api_key',
    'apikey',
    'client_secret',
    'refresh_token',
    'id_token',
    'authorization',
  ])('should detect "%s" as a sensitive URL query parameter', (name) => {
    expect(RedactionEngine.isSensitiveUrlQueryParamName(name)).toBe(true);
  });

  it.each([
    'page_token',
    'next_page_token',
    'sync_token',
    'continuation_token',
    'oauth_state',
  ])('should not detect "%s" as a sensitive URL query parameter', (name) => {
    expect(RedactionEngine.isSensitiveUrlQueryParamName(name)).toBe(false);
  });
});

describe('REDACTED constant', () => {
  it('should equal [REDACTED]', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});
