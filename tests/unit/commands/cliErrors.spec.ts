/**
 * Unit tests for src/cli/utils/cliErrors.ts (CDMCH-53)
 */

import { describe, it, expect } from 'vitest';
import {
  CliError,
  CliErrorCode,
  formatErrorMessage,
  formatErrorJson,
  getDocsUrl,
} from '../../../src/cli/utils/cliErrors';

describe('CliError', () => {
  it('should create error with default GENERAL code', () => {
    const err = new CliError('something went wrong');
    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe(CliErrorCode.GENERAL);
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('CliError');
  });

  it('should set exit code 10 for config errors', () => {
    const err = new CliError('bad config', CliErrorCode.CONFIG_INVALID);
    expect(err.exitCode).toBe(10);
  });

  it('should set exit code 20 for environment errors', () => {
    const err = new CliError('git not found', CliErrorCode.GIT_NOT_FOUND);
    expect(err.exitCode).toBe(20);
  });

  it('should set exit code 30 for credential errors', () => {
    const err = new CliError('token missing', CliErrorCode.TOKEN_MISSING);
    expect(err.exitCode).toBe(30);
  });

  it('should preserve remediation and cause', () => {
    const cause = new Error('root cause');
    const err = new CliError('wrapper', CliErrorCode.GENERAL, {
      remediation: 'Try running doctor',
      cause,
    });
    expect(err.remediation).toBe('Try running doctor');
    expect(err.cause).toBe(cause);
  });

  it('should be instanceof Error', () => {
    const err = new CliError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CliError);
  });
});

describe('formatErrorMessage', () => {
  it('should format CliError', () => {
    const err = new CliError('cli error');
    expect(formatErrorMessage(err)).toBe('cli error');
  });

  it('should format regular Error', () => {
    expect(formatErrorMessage(new Error('regular error'))).toBe('regular error');
  });

  it('should format string', () => {
    expect(formatErrorMessage('string error')).toBe('string error');
  });

  it('should format object via JSON', () => {
    expect(formatErrorMessage({ key: 'value' })).toBe('{"key":"value"}');
  });

  it('should return Unknown error for circular references', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(formatErrorMessage(obj)).toBe('Unknown error');
  });
});

describe('formatErrorJson', () => {
  it('should return structured error payload', () => {
    const err = new CliError('test error', CliErrorCode.CONFIG_INVALID, {
      remediation: 'Check config.json',
    });

    const json = formatErrorJson(err);
    expect(json.error).toBe(true);
    expect(json.code).toBe('CONFIG_INVALID');
    expect(json.exit_code).toBe(10);
    expect(json.message).toBe('test error');
    expect(json.remediation).toBe('Check config.json');
    expect(json.docs_url).toContain('configuration');
  });

  it('should omit remediation when not provided', () => {
    const err = new CliError('test', CliErrorCode.GENERAL);
    const json = formatErrorJson(err);
    expect(json.remediation).toBeUndefined();
  });

  it('should omit docs_url when no anchor mapped', () => {
    const err = new CliError('test', CliErrorCode.AGENT_TIMEOUT);
    const json = formatErrorJson(err);
    expect(json.docs_url).toBeUndefined();
  });
});

describe('getDocsUrl', () => {
  it('should return URL for mapped codes', () => {
    const url = getDocsUrl(CliErrorCode.CONFIG_INVALID);
    expect(url).toContain('configuration');
  });

  it('should return undefined for unmapped codes', () => {
    expect(getDocsUrl(CliErrorCode.DISK_FULL)).toBeUndefined();
  });
});

describe('CliError integration with commands', () => {
  it('should map CONFIG_INVALID to exit code 10', () => {
    const err = new CliError('bad config', CliErrorCode.CONFIG_INVALID);
    expect(err.exitCode).toBe(10);
    expect(err.code).toBe('CONFIG_INVALID');
  });

  it('should map RUN_DIR_NOT_FOUND to exit code 20', () => {
    const err = new CliError('not found', CliErrorCode.RUN_DIR_NOT_FOUND);
    expect(err.exitCode).toBe(20);
    expect(err.code).toBe('RUN_DIR_NOT_FOUND');
  });

  it('should include remediation in formatErrorJson', () => {
    const err = new CliError('missing input', CliErrorCode.CONFIG_INVALID, {
      remediation: 'Provide --prompt or --linear',
    });
    const json = formatErrorJson(err);
    expect(json.remediation).toBe('Provide --prompt or --linear');
    expect(json.docs_url).toContain('configuration');
  });

  it('should wrap non-CliError in GENERAL code', () => {
    const raw = new Error('something broke');
    const wrapped = new CliError(raw.message, CliErrorCode.GENERAL, { cause: raw });
    expect(wrapped.exitCode).toBe(1);
    expect(wrapped.cause).toBe(raw);
  });
});
