import { describe, it, expect } from 'vitest';
import {
  validateCliPath,
  validateCliAvailability,
  EXIT_CODES,
} from '../../src/workflows/codeMachineRunner';

describe('codeMachineRunner', () => {
  describe('validateCliPath', () => {
    it('returns valid for normal paths', () => {
      expect(validateCliPath('/usr/bin/codemachine').valid).toBe(true);
      expect(validateCliPath('codemachine').valid).toBe(true);
      expect(validateCliPath('./bin/codemachine').valid).toBe(true);
    });

    it('rejects paths with path traversal', () => {
      const result = validateCliPath('../../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('..');
    });

    it('rejects paths with shell metacharacters', () => {
      expect(validateCliPath('cmd; rm -rf /').valid).toBe(false);
      expect(validateCliPath('cmd | cat /etc/passwd').valid).toBe(false);
      expect(validateCliPath('cmd & background').valid).toBe(false);
    });

    it('rejects paths with newlines', () => {
      expect(validateCliPath('cmd\ninjected').valid).toBe(false);
      expect(validateCliPath('cmd\rinjected').valid).toBe(false);
    });

    it('rejects paths with whitespace padding', () => {
      expect(validateCliPath(' codemachine').valid).toBe(false);
      expect(validateCliPath('codemachine ').valid).toBe(false);
    });

    it('rejects empty paths', () => {
      expect(validateCliPath('').valid).toBe(false);
    });
  });

  describe('validateCliAvailability', () => {
    it('returns not available for invalid paths', async () => {
      const result = await validateCliAvailability('../invalid');
      expect(result.available).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns not available for non-existent CLI', async () => {
      const result = await validateCliAvailability('/nonexistent/path/to/cli');
      expect(result.available).toBe(false);
    });
  });

  describe('EXIT_CODES', () => {
    it('has correct exit code values', () => {
      expect(EXIT_CODES.SUCCESS).toBe(0);
      expect(EXIT_CODES.FAILURE).toBe(1);
      expect(EXIT_CODES.TIMEOUT).toBe(124);
      expect(EXIT_CODES.SIGKILL).toBe(137);
    });
  });
});
