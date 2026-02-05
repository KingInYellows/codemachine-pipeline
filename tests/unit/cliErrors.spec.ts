import { describe, it, expect } from 'vitest';
import {
  CliError,
  CliErrorCode,
  formatErrorMessage,
  formatErrorJson,
  getDocsUrl,
} from '../../src/cli/utils/cliErrors.js';

describe('CliError (CDMCH-53)', () => {
  it('should construct with code, exitCode, remediation', () => {
    const err = new CliError('test error', CliErrorCode.CONFIG_INVALID, {
      remediation: 'fix it',
    });
    expect(err.message).toBe('test error');
    expect(err.code).toBe(CliErrorCode.CONFIG_INVALID);
    expect(err.exitCode).toBe(10);
    expect(err.remediation).toBe('fix it');
    expect(err.name).toBe('CliError');
  });

  it('should accept howToFix and commonFixes', () => {
    const err = new CliError('bad config', CliErrorCode.CONFIG_NOT_FOUND, {
      howToFix: 'Run codepipe init',
      commonFixes: ['Check file path', 'Run init'],
    });
    expect(err.howToFix).toBe('Run codepipe init');
    expect(err.commonFixes).toEqual(['Check file path', 'Run init']);
  });

  it('should preserve cause', () => {
    const cause = new Error('original');
    const err = new CliError('wrapped', CliErrorCode.GENERAL, { cause });
    expect(err.cause).toBe(cause);
  });

  it('should default to GENERAL code when not specified', () => {
    const err = new CliError('default code');
    expect(err.code).toBe(CliErrorCode.GENERAL);
    expect(err.exitCode).toBe(1);
  });

  it('should map all codes to correct exit codes', () => {
    const codeExitMap: [CliErrorCode, number][] = [
      [CliErrorCode.GENERAL, 1],
      [CliErrorCode.CONFIG_INVALID, 10],
      [CliErrorCode.CONFIG_NOT_FOUND, 10],
      [CliErrorCode.MANIFEST_READ_FAILED, 10],
      [CliErrorCode.RUN_DIR_NOT_FOUND, 20],
      [CliErrorCode.GIT_NOT_FOUND, 20],
      [CliErrorCode.GIT_NOT_REPO, 20],
      [CliErrorCode.TOKEN_MISSING, 30],
      [CliErrorCode.AGENT_TIMEOUT, 1],
      [CliErrorCode.QUEUE_CORRUPTED, 1],
      [CliErrorCode.DISK_FULL, 20],
      [CliErrorCode.NETWORK_ERROR, 1],
      [CliErrorCode.LINEAR_API_FAILED, 1],
    ];

    for (const [code, expectedExit] of codeExitMap) {
      const err = new CliError('test', code);
      expect(err.exitCode).toBe(expectedExit);
    }
  });
});

describe('formatErrorMessage', () => {
  it('should return message from CliError', () => {
    const err = new CliError('cli error msg');
    expect(formatErrorMessage(err)).toBe('cli error msg');
  });

  it('should return message from regular Error', () => {
    expect(formatErrorMessage(new Error('regular'))).toBe('regular');
  });

  it('should return string directly', () => {
    expect(formatErrorMessage('string error')).toBe('string error');
  });

  it('should stringify objects', () => {
    expect(formatErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('should return "Unknown error" for unstringifiable values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatErrorMessage(circular)).toBe('Unknown error');
  });
});

describe('formatErrorJson', () => {
  it('should include base fields', () => {
    const err = new CliError('msg', CliErrorCode.CONFIG_INVALID);
    const json = formatErrorJson(err);
    expect(json.error).toBe(true);
    expect(json.code).toBe('CONFIG_INVALID');
    expect(json.exit_code).toBe(10);
    expect(json.message).toBe('msg');
  });

  it('should include remediation when present', () => {
    const err = new CliError('msg', CliErrorCode.GENERAL, { remediation: 'fix it' });
    const json = formatErrorJson(err);
    expect(json.remediation).toBe('fix it');
  });

  it('should include how_to_fix when present', () => {
    const err = new CliError('msg', CliErrorCode.GENERAL, { howToFix: 'do this' });
    const json = formatErrorJson(err);
    expect(json.how_to_fix).toBe('do this');
  });

  it('should include common_fixes when present', () => {
    const err = new CliError('msg', CliErrorCode.GENERAL, {
      commonFixes: ['fix A', 'fix B'],
    });
    const json = formatErrorJson(err);
    expect(json.common_fixes).toEqual(['fix A', 'fix B']);
  });

  it('should omit common_fixes when empty array', () => {
    const err = new CliError('msg', CliErrorCode.GENERAL, { commonFixes: [] });
    const json = formatErrorJson(err);
    expect(json.common_fixes).toBeUndefined();
  });

  it('should include docs_url for mapped codes', () => {
    const err = new CliError('msg', CliErrorCode.CONFIG_INVALID);
    const json = formatErrorJson(err);
    expect(json.docs_url).toBe('https://github.com/KingInYellows/codemachine-pipeline#configuration');
  });

  it('should omit docs_url for unmapped codes', () => {
    const err = new CliError('msg', CliErrorCode.GENERAL);
    const json = formatErrorJson(err);
    expect(json.docs_url).toBeUndefined();
  });

  it('should include all fields when fully populated', () => {
    const err = new CliError('full error', CliErrorCode.TOKEN_MISSING, {
      remediation: 'Set env var',
      howToFix: 'export TOKEN=...',
      commonFixes: ['Check .env file', 'Regenerate token'],
    });
    const json = formatErrorJson(err);
    expect(json).toEqual({
      error: true,
      code: 'TOKEN_MISSING',
      exit_code: 30,
      message: 'full error',
      remediation: 'Set env var',
      how_to_fix: 'export TOKEN=...',
      common_fixes: ['Check .env file', 'Regenerate token'],
      docs_url: 'https://github.com/KingInYellows/codemachine-pipeline#authentication',
    });
  });
});

describe('getDocsUrl', () => {
  it('should return URL for mapped codes', () => {
    expect(getDocsUrl(CliErrorCode.CONFIG_INVALID)).toBe(
      'https://github.com/KingInYellows/codemachine-pipeline#configuration'
    );
    expect(getDocsUrl(CliErrorCode.TOKEN_MISSING)).toBe(
      'https://github.com/KingInYellows/codemachine-pipeline#authentication'
    );
    expect(getDocsUrl(CliErrorCode.GIT_NOT_FOUND)).toBe(
      'https://github.com/KingInYellows/codemachine-pipeline#prerequisites'
    );
  });

  it('should return URL for newly mapped codes', () => {
    expect(getDocsUrl(CliErrorCode.QUEUE_CORRUPTED)).toBe(
      'https://github.com/KingInYellows/codemachine-pipeline#troubleshooting'
    );
    expect(getDocsUrl(CliErrorCode.LINEAR_API_FAILED)).toBe(
      'https://github.com/KingInYellows/codemachine-pipeline#integrations'
    );
  });

  it('should return undefined for unmapped codes', () => {
    expect(getDocsUrl(CliErrorCode.GENERAL)).toBeUndefined();
    expect(getDocsUrl(CliErrorCode.AGENT_TIMEOUT)).toBeUndefined();
  });
});
