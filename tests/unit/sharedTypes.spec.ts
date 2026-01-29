import { describe, it, expect } from 'vitest';
import {
  isSerializedError,
} from '../../src/core/sharedTypes';

describe('SharedTypes', () => {
  describe('SerializedError', () => {
    it('should type-guard valid serialized errors', () => {
      const valid: unknown = {
        name: 'Error',
        message: 'Something went wrong',
      };
      expect(isSerializedError(valid)).toBe(true);
    });

    it('should reject invalid serialized errors', () => {
      expect(isSerializedError(null)).toBe(false);
      expect(isSerializedError(undefined)).toBe(false);
      expect(isSerializedError({ name: 'Error' })).toBe(false); // missing message
      expect(isSerializedError({ message: 'test' })).toBe(false); // missing name
      expect(isSerializedError('string')).toBe(false);
    });

    it('should accept optional fields', () => {
      const withOptional: unknown = {
        name: 'HttpError',
        message: 'Not found',
        stack: 'Error: Not found\n    at test.ts:1',
        statusCode: 404,
        requestId: 'req-123',
      };
      expect(isSerializedError(withOptional)).toBe(true);
      if (isSerializedError(withOptional)) {
        expect(withOptional.statusCode).toBe(404);
        expect(withOptional.requestId).toBe('req-123');
      }
    });

    it('should accept nested cause', () => {
      const withCause: unknown = {
        name: 'WrapperError',
        message: 'Wrapped error',
        cause: {
          name: 'OriginalError',
          message: 'Original message',
        },
      };
      expect(isSerializedError(withCause)).toBe(true);
    });

    it('should reject null cause', () => {
      expect(isSerializedError({ name: 'Error', message: 'test', cause: null })).toBe(false);
    });

    it('should reject invalid optional field types', () => {
      // Invalid stack type
      expect(isSerializedError({ name: 'Error', message: 'test', stack: 123 })).toBe(false);
      // Invalid statusCode type
      expect(isSerializedError({ name: 'Error', message: 'test', statusCode: 'not a number' })).toBe(false);
      // Invalid requestId type
      expect(isSerializedError({ name: 'Error', message: 'test', requestId: 123 })).toBe(false);
      // Invalid type type
      expect(isSerializedError({ name: 'Error', message: 'test', type: 123 })).toBe(false);
      // Invalid operation type
      expect(isSerializedError({ name: 'Error', message: 'test', operation: 123 })).toBe(false);
      // Invalid cause type (not an object)
      expect(isSerializedError({ name: 'Error', message: 'test', cause: 'not an object' })).toBe(false);
    });

    it('should accept valid type, operation, and cause fields', () => {
      const valid: unknown = {
        name: 'HttpError',
        message: 'Request failed',
        type: 'TRANSIENT',
        operation: 'fetchUser',
        cause: { name: 'NetworkError', message: 'Connection refused' },
      };
      expect(isSerializedError(valid)).toBe(true);
    });
  });

  describe('Type narrowing', () => {
    it('should narrow types after guard check', () => {
      const unknown: unknown = {
        name: 'TestError',
        message: 'Test message',
        statusCode: 500,
      };

      if (isSerializedError(unknown)) {
        // TypeScript should now know these properties exist
        const name: string = unknown.name;
        const message: string = unknown.message;
        const statusCode: number | undefined = unknown.statusCode;

        expect(name).toBe('TestError');
        expect(message).toBe('Test message');
        expect(statusCode).toBe(500);
      } else {
        // This branch should not execute
        expect.fail('Type guard should have returned true');
      }
    });
  });
});
