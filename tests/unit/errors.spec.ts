import { describe, it, expect } from 'vitest';
import { wrapError, getErrorMessage, serializeError, classifyError } from '../../src/utils/errors';
import { ErrorType, HttpError } from '../../src/adapters/http/client';

describe('Error Utilities', () => {
  describe('wrapError', () => {
    it('wraps Error with context message', () => {
      const original = new Error('Original error');
      const wrapped = wrapError(original, 'Failed to fetch');

      expect(wrapped.message).toBe('Failed to fetch: Original error');
      expect(wrapped.cause).toBe(original);
    });

    it('wraps string error with context', () => {
      const wrapped = wrapError('String error', 'Operation failed');

      expect(wrapped.message).toBe('Operation failed: String error');
    });

    it('wraps unknown type with context', () => {
      const wrapped = wrapError({ code: 500 }, 'API call failed');

      expect(wrapped.message).toBe('API call failed: [object Object]');
    });

    it('preserves original stack trace when available', () => {
      const original = new Error('Original');
      original.stack = 'Error: Original\n    at test.ts:1:1';
      const wrapped = wrapError(original, 'Context');

      expect(wrapped.stack).toBe(original.stack);
    });

    it('handles null error', () => {
      const wrapped = wrapError(null, 'Null error');

      expect(wrapped.message).toBe('Null error: null');
    });

    it('handles undefined error', () => {
      const wrapped = wrapError(undefined, 'Undefined error');

      expect(wrapped.message).toBe('Undefined error: undefined');
    });
  });

  describe('getErrorMessage', () => {
    it('extracts message from Error instance', () => {
      const error = new Error('Test message');

      expect(getErrorMessage(error)).toBe('Test message');
    });

    it('converts string to message', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('converts number to message', () => {
      expect(getErrorMessage(404)).toBe('404');
    });

    it('converts object to string', () => {
      expect(getErrorMessage({ code: 500 })).toBe('[object Object]');
    });

    it('handles null', () => {
      expect(getErrorMessage(null)).toBe('null');
    });

    it('handles undefined', () => {
      expect(getErrorMessage(undefined)).toBe('undefined');
    });
  });

  describe('serializeError', () => {
    it('serializes Error with all properties', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:1:1';
      const serialized = serializeError(error);

      expect(serialized).toEqual({
        name: 'Error',
        message: 'Test error',
        stack: error.stack,
        cause: undefined,
      });
    });

    it('serializes Error with cause', () => {
      const cause = new Error('Root cause');
      const error = new Error('Wrapper error');
      error.cause = cause;
      const serialized = serializeError(error);

      expect(serialized.cause).toEqual({
        name: 'Error',
        message: 'Root cause',
        stack: cause.stack,
        cause: undefined,
      });
    });

    it('serializes non-Error as string', () => {
      expect(serializeError('string error')).toEqual({ error: 'string error' });
      expect(serializeError(42)).toEqual({ error: '42' });
      expect(serializeError(null)).toEqual({ error: 'null' });
    });

    it('serializes HttpError using toJSON', () => {
      const httpError = new HttpError('Not found', ErrorType.PERMANENT, 404, 'req-123');
      const serialized = serializeError(httpError);

      expect(serialized.message).toBe('Not found');
      expect(serialized.type).toBe(ErrorType.PERMANENT);
      expect(serialized.statusCode).toBe(404);
    });
  });

  describe('classifyError', () => {
    it('classifies HttpError by its type', () => {
      const transient = new HttpError('Rate limited', ErrorType.TRANSIENT, 429);
      const permanent = new HttpError('Not found', ErrorType.PERMANENT, 404);
      const human = new HttpError('Auth required', ErrorType.HUMAN_ACTION_REQUIRED, 401);

      expect(classifyError(transient)).toBe(ErrorType.TRANSIENT);
      expect(classifyError(permanent)).toBe(ErrorType.PERMANENT);
      expect(classifyError(human)).toBe(ErrorType.HUMAN_ACTION_REQUIRED);
    });

    it('classifies ECONNREFUSED as TRANSIENT', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');

      expect(classifyError(error)).toBe(ErrorType.TRANSIENT);
    });

    it('classifies ETIMEDOUT as TRANSIENT', () => {
      const error = new Error('connect ETIMEDOUT 10.0.0.1:443');

      expect(classifyError(error)).toBe(ErrorType.TRANSIENT);
    });

    it('classifies ENOTFOUND as TRANSIENT', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.example.com');

      expect(classifyError(error)).toBe(ErrorType.TRANSIENT);
    });

    it('classifies generic Error as PERMANENT', () => {
      const error = new Error('Something went wrong');

      expect(classifyError(error)).toBe(ErrorType.PERMANENT);
    });

    it('classifies non-Error types as PERMANENT', () => {
      expect(classifyError('string error')).toBe(ErrorType.PERMANENT);
      expect(classifyError({ code: 500 })).toBe(ErrorType.PERMANENT);
      expect(classifyError(null)).toBe(ErrorType.PERMANENT);
    });
  });
});
