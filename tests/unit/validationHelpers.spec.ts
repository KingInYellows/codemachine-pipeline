/**
 * Tests for src/validation/helpers.ts and src/validation/errors.ts
 *
 * Covers:
 * - validateOrThrow: success and failure paths
 * - validateOrResult: success and failure paths
 * - ValidationError: construction, formatting, serialization
 * - fromZodError: ZodError → ValidationError mapping
 * - Edge cases: nested paths, multiple issues, empty input
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateOrThrow, validateOrResult } from '../../src/validation/helpers.js';
import { ValidationError, fromZodError } from '../../src/validation/errors.js';

// ============================================================================
// Test Schema
// ============================================================================

const TestSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive(),
  tags: z.array(z.string()).optional(),
  nested: z.object({
    enabled: z.boolean(),
  }).optional(),
});

type TestType = z.infer<typeof TestSchema>;

// ============================================================================
// validateOrThrow
// ============================================================================

describe('validateOrThrow', () => {
  it('should return typed data on valid input', () => {
    const input = { name: 'test', count: 5 };
    const result: TestType = validateOrThrow(TestSchema, input, 'test');
    expect(result).toEqual({ name: 'test', count: 5 });
  });

  it('should return data with optional fields when provided', () => {
    const input = { name: 'test', count: 1, tags: ['a', 'b'], nested: { enabled: true } };
    const result = validateOrThrow(TestSchema, input, 'test');
    expect(result.tags).toEqual(['a', 'b']);
    expect(result.nested?.enabled).toBe(true);
  });

  it('should throw ValidationError on invalid input', () => {
    const input = { name: '', count: -1 };
    expect(() => validateOrThrow(TestSchema, input, 'config')).toThrow(ValidationError);
  });

  it('should include boundary label in error message', () => {
    try {
      validateOrThrow(TestSchema, {}, 'webhook');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).boundary).toBe('webhook');
      expect((err as ValidationError).message).toContain('[webhook]');
    }
  });

  it('should throw on null input', () => {
    expect(() => validateOrThrow(TestSchema, null, 'test')).toThrow(ValidationError);
  });

  it('should throw on undefined input', () => {
    expect(() => validateOrThrow(TestSchema, undefined, 'test')).toThrow(ValidationError);
  });
});

// ============================================================================
// validateOrResult
// ============================================================================

describe('validateOrResult', () => {
  it('should return success result on valid input', () => {
    const input = { name: 'test', count: 1 };
    const result = validateOrResult(TestSchema, input, 'test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test');
    }
  });

  it('should return failure result on invalid input', () => {
    const input = { name: 123, count: 'not-a-number' };
    const result = validateOrResult(TestSchema, input, 'ai-output');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.boundary).toBe('ai-output');
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('should not throw on invalid input', () => {
    const result = validateOrResult(TestSchema, null, 'test');
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// ValidationError
// ============================================================================

describe('ValidationError', () => {
  it('should construct with single issue', () => {
    const err = new ValidationError('config', [
      { path: 'name', message: 'Required', code: 'invalid_type' },
    ]);
    expect(err.message).toBe('[config] Required');
    expect(err.name).toBe('ValidationError');
    expect(err.issues).toHaveLength(1);
  });

  it('should construct with multiple issues', () => {
    const err = new ValidationError('config', [
      { path: 'name', message: 'Required', code: 'invalid_type' },
      { path: 'count', message: 'Must be positive', code: 'too_small' },
    ]);
    expect(err.message).toBe('[config] 2 validation errors');
  });

  it('should format issues for CLI', () => {
    const err = new ValidationError('config', [
      { path: 'name', message: 'Required', code: 'invalid_type' },
      { path: 'nested.enabled', message: 'Expected boolean', code: 'invalid_type' },
    ]);
    const output = err.formatForCLI();
    expect(output).toContain('name: Required');
    expect(output).toContain('nested.enabled: Expected boolean');
  });

  it('should serialize to JSON', () => {
    const err = new ValidationError('webhook', [
      { path: 'payload', message: 'Invalid', code: 'custom' },
    ]);
    const json = err.toJSON();
    expect(json.boundary).toBe('webhook');
    expect(json.issues).toHaveLength(1);
    expect(json.message).toContain('[webhook]');
  });
});

// ============================================================================
// fromZodError
// ============================================================================

describe('fromZodError', () => {
  it('should map ZodError to ValidationError', () => {
    const result = TestSchema.safeParse({ name: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = fromZodError('test', result.error);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.issues[0].code).toBeDefined();
    }
  });

  it('should preserve nested paths', () => {
    const result = TestSchema.safeParse({ name: 'ok', count: 1, nested: { enabled: 'nope' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = fromZodError('config', result.error);
      const nestedIssue = err.issues.find((i) => i.path.includes('nested'));
      expect(nestedIssue).toBeDefined();
      expect(nestedIssue!.path).toBe('nested.enabled');
    }
  });

  it('should include expected/received when available', () => {
    const result = TestSchema.safeParse({ name: 42, count: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = fromZodError('test', result.error);
      const nameIssue = err.issues.find((i) => i.path === 'name');
      expect(nameIssue).toBeDefined();
      expect(nameIssue!.code).toBeDefined();
      // expected/received may or may not be present depending on Zod version
      // The mapper preserves them when present
      expect(nameIssue!.expected).toBeDefined();
    }
  });
});
