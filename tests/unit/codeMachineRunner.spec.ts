/**
 * Unit Tests for CodeMachine Runner
 *
 * Tests CodeMachine CLI execution including:
 * - Successful execution with exit code 0
 * - Non-zero failure with exit code mapping to 1
 * - Timeout path with graceful termination (SIGTERM -> 10s -> SIGKILL)
 * - Large output streaming to log file
 * - Log file creation and appending
 * - Environment sanitization
 * - CLI availability validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import {
  runCodeMachine,
  validateCliAvailability,
  type CodeMachineRunnerOptions,
} from '../../src/workflows/codeMachineRunner';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ============================================================================
// Test Helpers
// ============================================================================

interface MockChildProcess extends EventEmitter {
  stdin: Writable | null;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  killed: boolean;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
}

function createMockChildProcess(): MockChildProcess {
  const mockProcess = new EventEmitter() as MockChildProcess;
  mockProcess.stdin = null;
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();
  mockProcess.killed = false;
  mockProcess.pid = 12345;
  mockProcess.kill = vi.fn((_signal?: string) => {
    mockProcess.killed = true;
    return true;
  });
  return mockProcess;
}

function createDefaultOptions(overrides?: Partial<CodeMachineRunnerOptions>): CodeMachineRunnerOptions {
  return {
    cliPath: '/usr/local/bin/codemachine',
    engine: 'claude',
    workspaceDir: '/test/workspace',
    specPath: '/test/spec.md',
    timeoutMs: 30000,
    logPath: '/test/logs/execution.log',
    ...overrides,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('CodeMachine Runner', () => {
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockChildProcess();
    vi.mocked(childProcess.spawn).mockReturnValue(mockProcess as unknown as childProcess.ChildProcess);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('runCodeMachine', () => {
    describe('successful execution', () => {
      it('should return exit code 0 on successful execution', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        // Simulate successful execution
        process.nextTick(() => {
          mockProcess.stdout?.emit('data', Buffer.from('Task completed successfully\n'));
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(result.killed).toBe(false);
        expect(result.stdout).toContain('Task completed successfully');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });

      it('should capture stdout and stderr correctly', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.stdout?.emit('data', Buffer.from('stdout line 1\n'));
          mockProcess.stdout?.emit('data', Buffer.from('stdout line 2\n'));
          mockProcess.stderr?.emit('data', Buffer.from('stderr warning\n'));
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;

        expect(result.stdout).toContain('stdout line 1');
        expect(result.stdout).toContain('stdout line 2');
        expect(result.stderr).toContain('stderr warning');
      });

      it('should stream output to log file', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.stdout?.emit('data', Buffer.from('log output\n'));
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        expect(fs.appendFileSync).toHaveBeenCalled();
      });

      it('should set cwd to workspaceDir', async () => {
        const options = createDefaultOptions({ workspaceDir: '/custom/workspace' });

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        expect(childProcess.spawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            cwd: '/custom/workspace',
          })
        );
      });

      it('should use shell: true for process execution', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        expect(childProcess.spawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            shell: true,
          })
        );
      });

      it('should include engine and specPath in command arguments', async () => {
        const options = createDefaultOptions({
          engine: 'openai',
          specPath: '/path/to/spec.md',
        });

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const command = spawnCall[0];
        expect(command).toContain('--engine');
        expect(command).toContain('openai');
        expect(command).toContain('--spec');
        expect(command).toContain('/path/to/spec.md');
      });
    });

    describe('non-zero failure', () => {
      it('should map non-zero exit codes to 1', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.stderr?.emit('data', Buffer.from('Error: compilation failed\n'));
          mockProcess.emit('close', 42, null);
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(1);
        expect(result.timedOut).toBe(false);
        expect(result.stderr).toContain('Error: compilation failed');
      });

      it('should preserve original error details in stderr', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.stderr?.emit('data', Buffer.from('Detailed error: line 42, column 10\n'));
          mockProcess.emit('close', 127, null);
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Detailed error: line 42, column 10');
      });

      it('should handle spawn errors gracefully', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('error', new Error('spawn ENOENT'));
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('spawn ENOENT');
      });
    });

    describe('timeout path', () => {
      it('should return exit code 124 on timeout', async () => {
        vi.useFakeTimers();
        const options = createDefaultOptions({ timeoutMs: 1000 });

        const resultPromise = runCodeMachine(options);

        // Advance past timeout
        vi.advanceTimersByTime(1001);

        // Simulate process close after SIGTERM
        process.nextTick(() => {
          mockProcess.emit('close', null, 'SIGTERM');
        });

        vi.useRealTimers();
        const result = await resultPromise;

        expect(result.exitCode).toBe(124);
        expect(result.timedOut).toBe(true);
        expect(result.killed).toBe(true);
      });

      it('should send SIGTERM first on timeout', () => {
        vi.useFakeTimers();
        const options = createDefaultOptions({ timeoutMs: 1000 });

        void runCodeMachine(options);

        // Advance past timeout
        vi.advanceTimersByTime(1001);

        expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

        vi.useRealTimers();
      });

      it('should send SIGKILL after 10 second grace period', () => {
        vi.useFakeTimers();
        const options = createDefaultOptions({ timeoutMs: 1000 });

        void runCodeMachine(options);

        // Advance past timeout
        vi.advanceTimersByTime(1001);

        // First call should be SIGTERM
        expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

        // Reset killed flag to simulate process still running
        mockProcess.killed = false;

        // Advance past 10 second grace period
        vi.advanceTimersByTime(10001);

        // Second call should be SIGKILL
        expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');

        vi.useRealTimers();
      });

      it('should set timedOut and killed flags on timeout', async () => {
        vi.useFakeTimers();
        const options = createDefaultOptions({ timeoutMs: 500 });

        const resultPromise = runCodeMachine(options);

        vi.advanceTimersByTime(501);

        process.nextTick(() => {
          mockProcess.emit('close', null, 'SIGTERM');
        });

        vi.useRealTimers();
        const result = await resultPromise;

        expect(result.timedOut).toBe(true);
        expect(result.killed).toBe(true);
      });
    });

    describe('large output streaming', () => {
      it('should handle large stdout output', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          // Simulate large output in chunks
          for (let i = 0; i < 100; i++) {
            mockProcess.stdout?.emit('data', Buffer.from(`Line ${i}: ${'x'.repeat(1000)}\n`));
          }
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;

        expect(result.exitCode).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(100000);
      });

      it('should stream large output to log file incrementally', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          for (let i = 0; i < 10; i++) {
            mockProcess.stdout?.emit('data', Buffer.from(`Chunk ${i}\n`));
          }
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        // Should have multiple append calls (one per chunk)
        expect(vi.mocked(fs.appendFileSync).mock.calls.length).toBeGreaterThanOrEqual(10);
      });
    });

    describe('log file creation', () => {
      it('should create log directory if it does not exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const options = createDefaultOptions({ logPath: '/new/dir/log.txt' });

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        expect(fs.mkdirSync).toHaveBeenCalledWith('/new/dir', { recursive: true });
      });

      it('should create/truncate log file at start', async () => {
        const options = createDefaultOptions({ logPath: '/test/execution.log' });

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        expect(fs.writeFileSync).toHaveBeenCalledWith('/test/execution.log', '', 'utf-8');
      });
    });

    describe('environment sanitization', () => {
      it('should pass sanitized environment to child process', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const spawnOptions = spawnCall[1] as childProcess.SpawnOptions;
        const env = spawnOptions.env as Record<string, string>;

        // Should include whitelisted variables
        if (process.env.PATH) {
          expect(env.PATH).toBe(process.env.PATH);
        }
        if (process.env.HOME) {
          expect(env.HOME).toBe(process.env.HOME);
        }
      });

      it('should merge custom env variables', async () => {
        const options = createDefaultOptions({
          env: {
            CUSTOM_VAR: 'custom_value',
            ANOTHER_VAR: 'another_value',
          },
        });

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const spawnOptions = spawnCall[1] as childProcess.SpawnOptions;
        const env = spawnOptions.env as Record<string, string>;

        expect(env.CUSTOM_VAR).toBe('custom_value');
        expect(env.ANOTHER_VAR).toBe('another_value');
      });

      it('should not pass sensitive environment variables', async () => {
        // Set some sensitive env vars for testing
        const originalEnv = { ...process.env };
        process.env.AWS_SECRET_ACCESS_KEY = 'secret123';
        process.env.GITHUB_TOKEN = 'ghp_secret';
        process.env.DATABASE_PASSWORD = 'dbpass';

        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const spawnOptions = spawnCall[1] as childProcess.SpawnOptions;
        const env = spawnOptions.env as Record<string, string>;

        // Should NOT include sensitive variables
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.DATABASE_PASSWORD).toBeUndefined();

        // Restore original env
        process.env = originalEnv;
      });
    });

    describe('duration tracking', () => {
      it('should track execution duration accurately', async () => {
        const options = createDefaultOptions();

        const startTime = Date.now();
        const resultPromise = runCodeMachine(options);

        // Add small delay before closing
        await new Promise((resolve) => setTimeout(resolve, 50));

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;
        const endTime = Date.now();

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.durationMs).toBeLessThanOrEqual(endTime - startTime + 100);
      });
    });

    describe('signal handling', () => {
      it('should set killed flag when process is killed by signal', async () => {
        const options = createDefaultOptions();

        const resultPromise = runCodeMachine(options);

        process.nextTick(() => {
          mockProcess.emit('close', null, 'SIGINT');
        });

        const result = await resultPromise;

        expect(result.killed).toBe(true);
      });
    });
  });

  describe('validateCliAvailability', () => {
    describe('CLI available', () => {
      it('should return available: true with version on success', async () => {
        const resultPromise = validateCliAvailability('/usr/local/bin/codemachine');

        process.nextTick(() => {
          mockProcess.stdout?.emit('data', Buffer.from('codemachine v1.2.3\n'));
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;

        expect(result.available).toBe(true);
        expect(result.version).toBe('codemachine v1.2.3');
        expect(result.error).toBeUndefined();
      });

      it('should extract version from first line of output', async () => {
        const resultPromise = validateCliAvailability('/usr/local/bin/codemachine');

        process.nextTick(() => {
          mockProcess.stdout?.emit('data', Buffer.from('v2.0.0\nAdditional info\nMore lines\n'));
          mockProcess.emit('close', 0, null);
        });

        const result = await resultPromise;

        expect(result.available).toBe(true);
        expect(result.version).toBe('v2.0.0');
      });
    });

    describe('CLI not available', () => {
      it('should return available: false with error on non-zero exit', async () => {
        const resultPromise = validateCliAvailability('/nonexistent/cli');

        process.nextTick(() => {
          mockProcess.stderr?.emit('data', Buffer.from('command not found\n'));
          mockProcess.emit('close', 127, null);
        });

        const result = await resultPromise;

        expect(result.available).toBe(false);
        expect(result.error).toContain('command not found');
        expect(result.version).toBeUndefined();
      });

      it('should return available: false with error on spawn error', async () => {
        const resultPromise = validateCliAvailability('/nonexistent/cli');

        process.nextTick(() => {
          mockProcess.emit('error', new Error('spawn ENOENT'));
        });

        const result = await resultPromise;

        expect(result.available).toBe(false);
        expect(result.error).toBe('spawn ENOENT');
        expect(result.version).toBeUndefined();
      });

      it('should return error message when stderr is empty', async () => {
        const resultPromise = validateCliAvailability('/usr/local/bin/codemachine');

        process.nextTick(() => {
          mockProcess.emit('close', 1, null);
        });

        const result = await resultPromise;

        expect(result.available).toBe(false);
        expect(result.error).toContain('CLI exited with code 1');
      });
    });

    describe('command construction', () => {
      it('should call CLI with --version flag', async () => {
        const resultPromise = validateCliAvailability('/path/to/cli');

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const command = spawnCall[0];
        expect(command).toContain('--version');
        expect(command).toContain('/path/to/cli');
      });

      it('should use shell: true for version check', async () => {
        const resultPromise = validateCliAvailability('/path/to/cli');

        process.nextTick(() => {
          mockProcess.emit('close', 0, null);
        });

        await resultPromise;

        const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
        const spawnOptions = spawnCall[1] as childProcess.SpawnOptions;
        expect(spawnOptions.shell).toBe(true);
      });
    });
  });
});
