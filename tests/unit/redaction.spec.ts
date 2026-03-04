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
    'auth',
    'X-API-KEY',
  ])('should detect "%s" as sensitive', (name) => {
    expect(RedactionEngine.isSensitiveFieldName(name)).toBe(true);
  });

  it.each(['content-type', 'accept', 'user-agent', 'x-request-id', 'cache-control', 'host'])(
    'should not detect "%s" as sensitive',
    (name) => {
      expect(RedactionEngine.isSensitiveFieldName(name)).toBe(false);
    }
  );
});

describe('REDACTED constant', () => {
  it('should equal [REDACTED]', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});
