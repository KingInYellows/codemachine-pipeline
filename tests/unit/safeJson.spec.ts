import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  safeJsonParse,
  safeJsonParseWithResult,
  safeJsonParseValidated,
  isFileNotFound,
  isJsonParseError,
  safeJsonReadFile,
} from '../../src/utils/safeJson';

describe('safeJson utilities', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON', () => {
      const result = safeJsonParse<{ name: string }>('{"name": "test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('should return undefined for invalid JSON', () => {
      const result = safeJsonParse<{ name: string }>('invalid json');
      expect(result).toBeUndefined();
    });

    it('should return default value for invalid JSON when provided', () => {
      const defaultVal = { name: 'default' };
      const result = safeJsonParse<{ name: string }>('invalid json', defaultVal);
      expect(result).toEqual(defaultVal);
    });

    it('should handle empty string', () => {
      const result = safeJsonParse('');
      expect(result).toBeUndefined();
    });

    it('should handle truncated JSON', () => {
      const result = safeJsonParse('{"name": "test"');
      expect(result).toBeUndefined();
    });
  });

  describe('safeJsonParseWithResult', () => {
    it('should return success result for valid JSON', () => {
      const result = safeJsonParseWithResult<{ name: string }>('{"name": "test"}');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
      expect(result.error).toBeUndefined();
    });

    it('should return error result for invalid JSON', () => {
      const result = safeJsonParseWithResult<{ name: string }>('invalid json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unexpected token');
    });

    it('should capture error message for empty input', () => {
      const result = safeJsonParseWithResult('');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should capture error message for truncated JSON', () => {
      const result = safeJsonParseWithResult('{"key":');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('safeJsonParseValidated', () => {
    interface User {
      name: string;
      age: number;
    }

    const isUser = (data: unknown): data is User => {
      return (
        typeof data === 'object' &&
        data !== null &&
        'name' in data &&
        typeof (data as User).name === 'string' &&
        'age' in data &&
        typeof (data as User).age === 'number'
      );
    };

    it('should return success for valid JSON matching validator', () => {
      const result = safeJsonParseValidated<User>(
        '{"name": "Alice", "age": 30}',
        isUser
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
    });

    it('should return validation error for valid JSON not matching validator', () => {
      const result = safeJsonParseValidated<User>(
        '{"name": "Alice"}', // missing age
        isUser,
        'Invalid user object'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid user object');
    });

    it('should return parse error for invalid JSON', () => {
      const result = safeJsonParseValidated<User>('invalid', isUser);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected token');
    });
  });

  describe('isFileNotFound', () => {
    it('should return true for ENOENT errors', () => {
      const error = { code: 'ENOENT', message: 'File not found' };
      expect(isFileNotFound(error)).toBe(true);
    });

    it('should return false for other error codes', () => {
      const error = { code: 'EACCES', message: 'Permission denied' };
      expect(isFileNotFound(error)).toBe(false);
    });

    it('should return false for non-object errors', () => {
      expect(isFileNotFound('error string')).toBe(false);
      expect(isFileNotFound(null)).toBe(false);
      expect(isFileNotFound(undefined)).toBe(false);
    });

    it('should return false for errors without code property', () => {
      const error = new Error('Some error');
      expect(isFileNotFound(error)).toBe(false);
    });
  });

  describe('isJsonParseError', () => {
    it('should return true for SyntaxError', () => {
      try {
        JSON.parse('invalid json');
      } catch (error) {
        expect(isJsonParseError(error)).toBe(true);
      }
    });

    it('should return false for other error types', () => {
      expect(isJsonParseError(new Error('regular error'))).toBe(false);
      expect(isJsonParseError(new TypeError('type error'))).toBe(false);
    });

    it('should return false for non-Error values', () => {
      expect(isJsonParseError('string')).toBe(false);
      expect(isJsonParseError(null)).toBe(false);
    });
  });

  describe('safeJsonReadFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safejson-test-'));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should successfully read and parse valid JSON file', async () => {
      const filePath = path.join(tempDir, 'valid.json');
      await fs.writeFile(filePath, '{"name": "test", "value": 42}');

      const result = await safeJsonReadFile<{ name: string; value: number }>(filePath);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 42 });
      expect(result.fileNotFound).toBeUndefined();
    });

    it('should return fileNotFound for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.json');

      const result = await safeJsonReadFile(filePath);

      expect(result.success).toBe(false);
      expect(result.fileNotFound).toBe(true);
      // Error message includes the path for better debugging
      expect(result.error).toContain('ENOENT');
      expect(result.error).toContain('nonexistent.json');
    });

    it('should return parse error for invalid JSON file', async () => {
      const filePath = path.join(tempDir, 'invalid.json');
      await fs.writeFile(filePath, 'not valid json {');

      const result = await safeJsonReadFile(filePath);

      expect(result.success).toBe(false);
      expect(result.fileNotFound).toBeUndefined();
      expect(result.error).toContain('JSON parse error');
    });

    it('should return parse error for truncated JSON', async () => {
      const filePath = path.join(tempDir, 'truncated.json');
      await fs.writeFile(filePath, '{"name": "test"');

      const result = await safeJsonReadFile(filePath);

      expect(result.success).toBe(false);
      expect(result.fileNotFound).toBeUndefined();
      expect(result.error).toContain('JSON parse error');
    });

    it('should handle empty file', async () => {
      const filePath = path.join(tempDir, 'empty.json');
      await fs.writeFile(filePath, '');

      const result = await safeJsonReadFile(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON parse error');
    });
  });
});
