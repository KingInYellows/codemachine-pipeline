import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises with constants included
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    access: vi.fn(),
  };
});

const fs = await import('node:fs/promises');

import { resolveBinary, clearBinaryCache } from '../../src/adapters/codemachine/binaryResolver.js';

describe('binaryResolver', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearBinaryCache();
    process.env = { ...originalEnv };
    vi.mocked(fs.access).mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('env var override (CODEMACHINE_BIN_PATH)', () => {
    it('resolves from env var when binary is executable', async () => {
      process.env.CODEMACHINE_BIN_PATH = '/usr/local/bin/codemachine';
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await resolveBinary();

      expect(result.resolved).toBe(true);
      expect(result.binaryPath).toBe('/usr/local/bin/codemachine');
      expect(result.source).toBe('env');
    });

    it('rejects env var with invalid characters', async () => {
      process.env.CODEMACHINE_BIN_PATH = '/usr/local/bin/codemachine;rm -rf /';

      const result = await resolveBinary();

      expect(result.resolved).toBe(false);
      expect(result.error).toContain('invalid');
    });

    it('rejects env var when binary is not executable', async () => {
      process.env.CODEMACHINE_BIN_PATH = '/nonexistent/codemachine';
      vi.mocked(fs.access).mockRejectedValue(new Error('EACCES'));

      const result = await resolveBinary();

      expect(result.resolved).toBe(false);
      expect(result.error).toContain('not executable');
    });
  });

  describe('optionalDependencies resolution', () => {
    it('resolves platform binary when available', async () => {
      delete process.env.CODEMACHINE_BIN_PATH;

      // Let the real resolution run — in test env with codemachine installed,
      // it should find the binary from node_modules
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await resolveBinary();

      // Should resolve from optionalDep or PATH since codemachine is installed
      expect(result.resolved).toBe(true);
      expect(result.source).toBeDefined();
    });
  });

  describe('caching', () => {
    it('returns cached result on second call', async () => {
      process.env.CODEMACHINE_BIN_PATH = '/usr/local/bin/codemachine';
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result1 = await resolveBinary();
      const result2 = await resolveBinary();

      expect(result1).toBe(result2); // Same object reference (cached)
    });

    it('clearBinaryCache resets cache', async () => {
      process.env.CODEMACHINE_BIN_PATH = '/usr/local/bin/codemachine';
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result1 = await resolveBinary();
      clearBinaryCache();
      const result2 = await resolveBinary();

      // Different references after cache clear
      expect(result1).not.toBe(result2);
      // But same content
      expect(result1.binaryPath).toBe(result2.binaryPath);
    });
  });

  describe('graceful fallback', () => {
    it('returns resolved=false with descriptive error when nothing found', async () => {
      delete process.env.CODEMACHINE_BIN_PATH;
      // Override platform to one without a mapped binary
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      process.env.PATH = ''; // Empty PATH

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await resolveBinary();

      expect(result.resolved).toBe(false);
      expect(result.error).toContain('not found');

      // Restore platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    });
  });
});
