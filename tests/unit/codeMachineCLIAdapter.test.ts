import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { ExecutionConfig } from '../../src/core/config/RepoConfig.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock binary resolver
vi.mock('../../src/adapters/codemachine/binaryResolver.js', () => ({
  resolveBinary: vi.fn(),
  clearBinaryCache: vi.fn(),
}));

// Mock fs/promises for PID file operations
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{"pid": 12345, "startedAt": "2026-01-01T00:00:00Z"}'),
  };
});

const { spawn } = await import('node:child_process');
const { resolveBinary } = await import('../../src/adapters/codemachine/binaryResolver.js');
const { readFile } = await import('node:fs/promises');

import { CodeMachineCLIAdapter } from '../../src/adapters/codemachine/CodeMachineCLIAdapter.js';

function makeConfig(overrides?: Partial<ExecutionConfig>): ExecutionConfig {
  return {
    codemachine_cli_path: 'codemachine',
    default_engine: 'claude',
    workspace_dir: undefined,
    task_timeout_ms: 30000,
    max_parallel_tasks: 1,
    max_log_buffer_size: 10 * 1024 * 1024,
    env_allowlist: [],
    max_retries: 3,
    retry_backoff_ms: 5000,
    log_rotation_mb: 100,
    log_rotation_keep: 3,
    log_rotation_compress: false,
    env_credential_keys: [],
    ...overrides,
  };
}

function createMockChild(exitCode = 0, stdout = '', stderr = ''): ChildProcess {
  const mockStdin = new PassThrough();
  const mockStdout = new PassThrough();
  const mockStderr = new PassThrough();

  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin: mockStdin,
    stdout: mockStdout,
    stderr: mockStderr,
    pid: 12345,
    killed: false,
    kill: vi.fn(),
    ref: vi.fn(),
    unref: vi.fn(),
    connected: true,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    disconnect: vi.fn(),
    send: vi.fn(),
    stdio: [mockStdin, mockStdout, mockStderr, null, null] as const,
    [Symbol.dispose]: vi.fn(),
  }) as unknown as ChildProcess;

  // Simulate output and close on next tick
  process.nextTick(() => {
    if (stdout) mockStdout.push(Buffer.from(stdout));
    mockStdout.push(null);
    if (stderr) mockStderr.push(Buffer.from(stderr));
    mockStderr.push(null);
    emitter.emit('close', exitCode, null);
  });

  return child;
}

describe('CodeMachineCLIAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveBinary).mockResolvedValue({
      resolved: true,
      binaryPath: '/usr/local/bin/codemachine',
      source: 'optionalDep',
    });
  });

  describe('validateAvailability', () => {
    it('returns available when binary resolves and version check succeeds', async () => {
      const child = createMockChild(0, 'codemachine 0.8.0\n');
      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.validateAvailability();

      expect(result.available).toBe(true);
      expect(result.version).toBe('codemachine 0.8.0');
      expect(result.binaryPath).toBe('/usr/local/bin/codemachine');
    });

    it('returns unavailable when binary is not found', async () => {
      vi.mocked(resolveBinary).mockResolvedValue({
        resolved: false,
        error: 'Binary not found',
      });

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.validateAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toBe('Binary not found');
    });

    it('enforces minimum version when configured', async () => {
      const child = createMockChild(0, '0.7.0\n');
      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({
        config: makeConfig({ codemachine_cli_version: '0.8.0' }),
      });
      const result = await adapter.validateAvailability();

      expect(result.available).toBe(false);
      expect(result.error).toContain('does not meet minimum');
    });
  });

  describe('execute', () => {
    it('returns stdout and exit code 0 on success', async () => {
      const child = createMockChild(0, 'Task completed successfully\n');
      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.execute(['run', "claude 'build login page'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Task completed successfully');
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });

    it('returns stderr and non-zero exit code on failure', async () => {
      const child = createMockChild(1, '', 'Error: authentication failed\n');
      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('authentication failed');
    });

    it('prevents concurrent execution', async () => {
      const child = createMockChild(0, 'ok\n');
      vi.mocked(spawn).mockReturnValue(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });

      // Start first execution (don't await yet)
      const promise1 = adapter.execute(['run', "claude 'task1'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      // Attempt second execution immediately (before first completes)
      const result2 = await adapter.execute(['run', "claude 'task2'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(result2.exitCode).toBe(1);
      expect(result2.stderr).toContain('already in progress');

      const result1 = await promise1;
      expect(result1.exitCode).toBe(0);
    });

    it('returns error result when binary is not found', async () => {
      vi.mocked(resolveBinary).mockResolvedValue({
        resolved: false,
        error: 'Binary not found',
      });

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Binary not found');
    });

    it('spawns with shell:false', async () => {
      const child = createMockChild(0, 'ok\n');
      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      await adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/codemachine',
        ['run', "claude 'task'"],
        expect.objectContaining({ shell: false }),
      );
    });
  });

  describe('checkLiveness', () => {
    it('returns alive=true when process is running', async () => {
      vi.mocked(readFile).mockResolvedValue('{"pid": 12345, "startedAt": "2026-01-01T00:00:00Z"}');
      const originalKill = process.kill;
      process.kill = vi.fn() as unknown as typeof process.kill;

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.checkLiveness('/run-dir');

      expect(result.alive).toBe(true);
      expect(result.pid).toBe(12345);

      process.kill = originalKill;
    });
  });
});
