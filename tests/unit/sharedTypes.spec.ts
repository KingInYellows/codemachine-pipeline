import { describe, it, expect } from 'vitest';
import {
  SerializedError,
  LogContext,
  EntityMetadata,
  isSerializedError,
  isLogContext,
  isEntityMetadata,
  createLogContext,
  mergeMetadata,
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
  });

  describe('LogContext', () => {
    it('should type-guard valid log contexts', () => {
      const valid: unknown = {
        component: 'http-client',
        operation: 'fetch',
      };
      expect(isLogContext(valid)).toBe(true);
    });

    it('should accept empty objects as valid context', () => {
      expect(isLogContext({})).toBe(true);
    });

    it('should reject non-objects', () => {
      expect(isLogContext(null)).toBe(false);
      expect(isLogContext(undefined)).toBe(false);
      expect(isLogContext('string')).toBe(false);
      expect(isLogContext(123)).toBe(false);
      expect(isLogContext([])).toBe(false);
    });

    it('should allow string, number, boolean, and nested values', () => {
      const context: unknown = {
        stringVal: 'test',
        numberVal: 42,
        boolVal: true,
        nested: { deep: 'value' },
        arrayVal: [1, 2, 3],
      };
      expect(isLogContext(context)).toBe(true);
    });

    it('should create typed log context via factory', () => {
      const context = createLogContext({
        component: 'test',
        traceId: 'trace-123',
        featureId: 'feat-456',
      });
      expect(context.component).toBe('test');
      expect(context.traceId).toBe('trace-123');
    });
  });

  describe('EntityMetadata', () => {
    it('should type-guard valid metadata', () => {
      const valid: unknown = {
        createdBy: 'user@example.com',
        source: 'api',
      };
      expect(isEntityMetadata(valid)).toBe(true);
    });

    it('should accept empty objects', () => {
      expect(isEntityMetadata({})).toBe(true);
    });

    it('should reject non-objects', () => {
      expect(isEntityMetadata(null)).toBe(false);
      expect(isEntityMetadata(undefined)).toBe(false);
      expect(isEntityMetadata('string')).toBe(false);
    });

    it('should merge metadata correctly', () => {
      const base: EntityMetadata = { source: 'api', version: 1 };
      const override: EntityMetadata = { version: 2, newField: 'added' };
      const merged = mergeMetadata(base, override);

      expect(merged.source).toBe('api');
      expect(merged.version).toBe(2);
      expect(merged.newField).toBe('added');
    });

    it('should handle undefined inputs in merge', () => {
      const base: EntityMetadata = { source: 'api' };
      expect(mergeMetadata(base, undefined)).toEqual(base);
      expect(mergeMetadata(undefined, base)).toEqual(base);
      expect(mergeMetadata(undefined, undefined)).toEqual({});
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
