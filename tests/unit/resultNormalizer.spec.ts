import { describe, it, expect } from 'vitest';
import {
  redactCredentials,
  categorizeError,
  normalizeResult,
  isRecoverableError,
} from '../../src/workflows/resultNormalizer';

describe('resultNormalizer', () => {
  describe('redactCredentials', () => {
    it('redacts OpenAI API keys', () => {
      const text = 'Using key sk-1234567890abcdefghijklmnop';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[OPENAI_KEY_REDACTED]');
      expect(redacted).not.toContain('sk-1234567890');
    });

    it('redacts Anthropic API keys', () => {
      const text = 'Using key sk-ant-abc123-xyz789-longer-key-here';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[ANTHROPIC_KEY_REDACTED]');
      expect(redacted).not.toContain('sk-ant-');
    });

    it('redacts GitHub tokens', () => {
      const text = 'Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[GITHUB_TOKEN_REDACTED]');
      expect(redacted).not.toContain('ghp_');
    });

    it('redacts Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[TOKEN_REDACTED]');
    });

    it('redacts AWS access keys', () => {
      const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[AWS_ACCESS_KEY_REDACTED]');
      expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('redacts JWT tokens', () => {
      const text =
        'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[JWT_REDACTED]');
    });

    it('redacts connection strings', () => {
      const text = 'Database: postgres://user:password@localhost:5432/db';
      const redacted = redactCredentials(text);
      expect(redacted).toContain('[CONNECTION_STRING_REDACTED]');
      expect(redacted).not.toContain('password');
    });

    it('preserves non-sensitive text', () => {
      const text = 'Hello, this is a normal message without secrets';
      const redacted = redactCredentials(text);
      expect(redacted).toBe(text);
    });
  });

  describe('categorizeError', () => {
    const baseResult = { taskId: 'test-1', durationMs: 1000 };

    it('categorizes timeout errors', () => {
      const result = {
        ...baseResult,
        exitCode: 124,
        timedOut: true,
        killed: false,
        stdout: '',
        stderr: '',
      };
      expect(categorizeError(result)).toBe('timeout');
    });

    it('categorizes killed errors', () => {
      const result = {
        ...baseResult,
        exitCode: 137,
        timedOut: false,
        killed: true,
        stdout: '',
        stderr: '',
      };
      expect(categorizeError(result)).toBe('killed');
    });

    it('categorizes authentication errors', () => {
      const result = {
        ...baseResult,
        exitCode: 1,
        timedOut: false,
        killed: false,
        stdout: '',
        stderr: 'authentication failed',
      };
      expect(categorizeError(result)).toBe('authentication');
    });

    it('categorizes rate limit errors', () => {
      const result = {
        ...baseResult,
        exitCode: 1,
        timedOut: false,
        killed: false,
        stdout: '',
        stderr: 'rate limit exceeded',
      };
      expect(categorizeError(result)).toBe('rate_limit');
    });

    it('categorizes network errors', () => {
      const result = {
        ...baseResult,
        exitCode: 1,
        timedOut: false,
        killed: false,
        stdout: '',
        stderr: 'ECONNREFUSED',
      };
      expect(categorizeError(result)).toBe('network');
    });

    it('returns none for successful results', () => {
      const result = {
        ...baseResult,
        exitCode: 0,
        timedOut: false,
        killed: false,
        stdout: 'success',
        stderr: '',
      };
      expect(categorizeError(result)).toBe('none');
    });
  });

  describe('isRecoverableError', () => {
    it('returns true for recoverable errors', () => {
      expect(isRecoverableError('rate_limit')).toBe(true);
      expect(isRecoverableError('network')).toBe(true);
      expect(isRecoverableError('timeout')).toBe(true);
    });

    it('returns false for non-recoverable errors', () => {
      expect(isRecoverableError('authentication')).toBe(false);
      expect(isRecoverableError('validation')).toBe(false);
    });

    it('returns false for none category', () => {
      expect(isRecoverableError('none')).toBe(false);
    });
  });

  describe('normalizeResult', () => {
    it('normalizes successful results', () => {
      const result = {
        taskId: 'task-1',
        exitCode: 0,
        stdout: 'Task completed successfully',
        stderr: '',
        durationMs: 1000,
        timedOut: false,
        killed: false,
      };
      const normalized = normalizeResult(result);
      expect(normalized.success).toBe(true);
      expect(normalized.errorCategory).toBe('none');
    });

    it('normalizes failed results with credentials redacted', () => {
      const result = {
        taskId: 'task-1',
        exitCode: 1,
        stdout: '',
        stderr: 'Error with key sk-secret1234567890abcdef',
        durationMs: 500,
        timedOut: false,
        killed: false,
      };
      const normalized = normalizeResult(result);
      expect(normalized.success).toBe(false);
      expect(normalized.redactedStderr).toContain('[OPENAI_KEY_REDACTED]');
      expect(normalized.redactedStderr).not.toContain('sk-secret');
    });

    it('normalizes timeout results', () => {
      const result = {
        taskId: 'task-1',
        exitCode: 124,
        stdout: 'partial output',
        stderr: 'Execution timed out',
        durationMs: 30000,
        timedOut: true,
        killed: false,
      };
      const normalized = normalizeResult(result);
      expect(normalized.success).toBe(false);
      expect(normalized.errorCategory).toBe('timeout');
      expect(normalized.timedOut).toBe(true);
    });
  });
});
