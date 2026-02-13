import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const { spawn } = await import('node:child_process');
const { resolveBinary } = await import('../../src/adapters/codemachine/binaryResolver.js');

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

  describe('child process error event', () => {
    it('returns error result when child emits an error event (e.g. ENOENT)', async () => {
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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const resultPromise = adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      // Emit error on next tick (simulates ENOENT when binary not found at spawn time)
      process.nextTick(() => {
        const err = new Error('spawn codemachine ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        emitter.emit('error', err);
      });

      const result = await resultPromise;

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Execution error');
      expect(result.stderr).toContain('ENOENT');
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });
  });

  describe('timeout SIGTERM -> SIGKILL escalation', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends SIGTERM on timeout, then SIGKILL after grace period', async () => {
      vi.useFakeTimers();

      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const mockStderr = new PassThrough();
      const emitter = new EventEmitter();

      const killFn = vi.fn();

      const child = Object.assign(emitter, {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 12345,
        killed: false,
        kill: killFn,
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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const resultPromise = adapter.execute(['run', "claude 'long task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 1000,
      });

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(1000);

      // SIGTERM should have been sent
      expect(killFn).toHaveBeenCalledWith('SIGTERM');
      expect(killFn).not.toHaveBeenCalledWith('SIGKILL');

      // Advance past the 5s grace period -- child.killed is still false
      await vi.advanceTimersByTimeAsync(5000);

      // SIGKILL should now have been sent (child.killed was false)
      expect(killFn).toHaveBeenCalledWith('SIGKILL');

      // Now close the process so the promise resolves
      mockStdout.push(null);
      mockStderr.push(null);
      emitter.emit('close', null, 'SIGKILL');

      const result = await resultPromise;

      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);
      expect(result.exitCode).toBe(124);
    });

    it('skips SIGKILL if process already marked as killed after SIGTERM', async () => {
      vi.useFakeTimers();

      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const mockStderr = new PassThrough();
      const emitter = new EventEmitter();

      const killFn = vi.fn((signal?: string) => {
        // Simulate Node.js behavior: after kill(), child.killed becomes true
        if (signal === 'SIGTERM') {
          (child as Record<string, unknown>).killed = true;
        }
      });

      const child = Object.assign(emitter, {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 12345,
        killed: false,
        kill: killFn,
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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const resultPromise = adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 1000,
      });

      // Advance past the timeout -- SIGTERM fires, child.killed becomes true
      await vi.advanceTimersByTimeAsync(1000);
      expect(killFn).toHaveBeenCalledWith('SIGTERM');

      // Advance past grace period -- SIGKILL should NOT fire because child.killed is true
      await vi.advanceTimersByTimeAsync(5000);
      expect(killFn).not.toHaveBeenCalledWith('SIGKILL');

      // Process exits after SIGTERM
      mockStdout.push(null);
      mockStderr.push(null);
      emitter.emit('close', 143, 'SIGTERM');

      const result = await resultPromise;

      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(false); // killed flag is only set by the SIGKILL code path
    });
  });

  describe('credential stdin write', () => {
    it('writes credentials to stdin when provided', async () => {
      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const mockStderr = new PassThrough();
      const emitter = new EventEmitter();

      const writtenData: string[] = [];
      const originalWrite = mockStdin.write.bind(mockStdin);
      mockStdin.write = vi.fn((...args: Parameters<typeof mockStdin.write>) => {
        const chunk = args[0];
        if (typeof chunk === 'string') {
          writtenData.push(chunk);
        }
        return originalWrite(...args);
      }) as typeof mockStdin.write;

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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const resultPromise = adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
        credentials: { ANTHROPIC_API_KEY: 'sk-ant-test', GITHUB_TOKEN: 'ghp_test123' },
      });

      // Let execution proceed and close the process
      process.nextTick(() => {
        mockStdout.push(Buffer.from('ok\n'));
        mockStdout.push(null);
        mockStderr.push(null);
        emitter.emit('close', 0, null);
      });

      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
      // Verify credentials were written as JSON to stdin
      expect(writtenData.length).toBeGreaterThanOrEqual(1);
      const jsonWritten = writtenData.join('');
      expect(jsonWritten).toContain('ANTHROPIC_API_KEY');
      expect(jsonWritten).toContain('sk-ant-test');
      expect(jsonWritten).toContain('GITHUB_TOKEN');
      expect(jsonWritten).toContain('ghp_test123');
    });

    it('kills process and returns error when stdin.write throws', async () => {
      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const mockStderr = new PassThrough();
      const emitter = new EventEmitter();

      // Make stdin.write throw
      mockStdin.write = vi.fn(() => {
        throw new Error('write EPIPE');
      }) as typeof mockStdin.write;

      const killFn = vi.fn();
      const child = Object.assign(emitter, {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: mockStderr,
        pid: 12345,
        killed: false,
        kill: killFn,
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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
        credentials: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to deliver credentials');
      expect(result.stderr).toContain('EPIPE');
      expect(killFn).toHaveBeenCalledWith('SIGTERM');
    });

    it('does not write to stdin when credentials object is empty', async () => {
      const mockStdin = new PassThrough();
      const mockStdout = new PassThrough();
      const mockStderr = new PassThrough();
      const emitter = new EventEmitter();

      const writeSpy = vi.spyOn(mockStdin, 'write');

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

      vi.mocked(spawn).mockReturnValueOnce(child);

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const resultPromise = adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
        credentials: {},
      });

      process.nextTick(() => {
        mockStdout.push(null);
        mockStderr.push(null);
        emitter.emit('close', 0, null);
      });

      const result = await resultPromise;

      expect(result.exitCode).toBe(0);
      // stdin.write should NOT have been called (empty credentials)
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('spawn failure (synchronous throw)', () => {
    it('returns error result when spawn itself throws', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => {
        throw new Error('spawn ENOMEM');
      });

      const adapter = new CodeMachineCLIAdapter({ config: makeConfig() });
      const result = await adapter.execute(['run', "claude 'task'"], {
        workspaceDir: '/workspace',
        timeoutMs: 30000,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to spawn');
      expect(result.stderr).toContain('ENOMEM');
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });
  });

});
