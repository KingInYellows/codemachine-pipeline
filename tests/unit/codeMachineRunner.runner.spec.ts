import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  runCodeMachine,
  validateCliPath,
  validateCliAvailability,
  isSuccess,
  isRecoverable,
  EXIT_CODES,
  type RunnerOptions,
  type RunnerResult,
} from '../../src/workflows/codeMachineRunner';
import type { ExecutionConfig } from '../../src/core/config/RepoConfig';
import type { StructuredLogger } from '../../src/telemetry/logger';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    access: vi.fn(),
  };
});
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    createWriteStream: vi.fn(),
  };
});

/**
 * Unit tests for CodeMachineRunner
 *
 * Tests cover:
 * - CLI path validation (security)
 * - CLI availability validation
 * - Environment filtering (security)
 * - Argument building
 * - Process spawning & exit codes
 * - Timeout & graceful termination
 * - Log streaming
 * - Buffer management
 * - Structured logging integration
 * - Result object validation
 * - Helper functions
 */

// Mock ChildProcess factory
function createMockChildProcess(): ChildProcess {
  const childProcess = new EventEmitter() as ChildProcess;
  childProcess.stdout = new Readable({ read() {} });
  childProcess.stderr = new Readable({ read() {} });
  childProcess.kill = vi.fn(() => true);
  // Use Object.defineProperty to allow writing to killed property
  Object.defineProperty(childProcess, 'killed', {
    value: false,
    writable: true,
    configurable: true,
  });
  return childProcess;
}

// Mock WriteStream factory
function createMockWriteStream(): WriteStream {
  const stream = new EventEmitter() as unknown as WriteStream;
  stream.write = vi.fn(() => true) as WriteStream['write'];
  stream.end = vi.fn((callback?: () => void) => {
    if (callback) {
      callback();
    }
    return stream;
  }) as WriteStream['end'];
  return stream;
}

// Mock StructuredLogger
function createMockLogger(): StructuredLogger {
  const logger: StructuredLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return logger;
}

describe('CodeMachineRunner', () => {
  const mockSpawn = vi.mocked(spawn);
  const mockFsAccess = vi.mocked(fs.access);
  const mockCreateWriteStream = vi.mocked(createWriteStream);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('A. CLI Path Validation', () => {
    it('should reject path with traversal (..) sequences', () => {
      const result = validateCliPath('../malicious/path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path traversal');
    });

    it('should reject path with semicolon shell metacharacter', () => {
      const result = validateCliPath('cmd; rm -rf /');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });

    it('should reject path with pipe shell metacharacter', () => {
      const result = validateCliPath('cmd | cat /etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });

    it('should reject path with ampersand shell metacharacter', () => {
      const result = validateCliPath('cmd && malicious');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });

    it('should reject path with newline characters', () => {
      const result = validateCliPath('cmd\nmalicious');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('newline');
    });

    it('should reject path with carriage return', () => {
      const result = validateCliPath('cmd\rmalicious');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('newline');
    });

    it('should reject path with leading whitespace', () => {
      const result = validateCliPath('  /usr/bin/cmd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('whitespace');
    });

    it('should reject path with trailing whitespace', () => {
      const result = validateCliPath('/usr/bin/cmd  ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('whitespace');
    });

    it('should reject empty path', () => {
      const result = validateCliPath('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should accept valid absolute path', () => {
      const result = validateCliPath('/usr/local/bin/codemachine');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid relative path', () => {
      const result = validateCliPath('codemachine');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid path with subdirectory', () => {
      const result = validateCliPath('./node_modules/.bin/codemachine');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('B. CLI Availability Validation', () => {
    it('should detect CLI availability with version', async () => {
      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = validateCliAvailability('/usr/bin/codemachine');

      // Simulate version output
      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('codemachine v1.2.3\n'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.available).toBe(true);
      expect(result.version).toBe('codemachine v1.2.3');
      expect(result.error).toBeUndefined();
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/codemachine',
        ['--version'],
        expect.objectContaining({
          shell: false,
          timeout: 5000,
        })
      );
    });

    it('should handle CLI not found error', async () => {
      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = validateCliAvailability('nonexistent-cli');

      setTimeout(() => {
        childProcess.emit('error', new Error('Command not found'));
      }, 10);

      const result = await promise;

      expect(result.available).toBe(false);
      expect(result.error).toContain('Failed to execute CLI');
      expect(result.error).toContain('Command not found');
    });

    it('should handle non-zero exit code from CLI', async () => {
      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = validateCliAvailability('/usr/bin/codemachine');

      setTimeout(() => {
        childProcess.stderr?.emit('data', Buffer.from('Error: invalid option'));
        childProcess.emit('close', 1);
      }, 10);

      const result = await promise;

      expect(result.available).toBe(false);
      expect(result.error).toContain('exit code 1');
      expect(result.error).toContain('Error: invalid option');
    });

    it('should reject invalid CLI path', async () => {
      const result = await validateCliAvailability('../malicious');

      expect(result.available).toBe(false);
      expect(result.error).toContain('path traversal');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should check executable permissions for absolute paths', async () => {
      mockFsAccess.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await validateCliAvailability('/opt/bin/codemachine');

      expect(result.available).toBe(false);
      expect(result.error).toContain('not accessible');
      expect(result.error).toContain('permission denied');
      expect(mockFsAccess).toHaveBeenCalledWith('/opt/bin/codemachine', fs.constants.X_OK);
    });

    it('should skip executable check for relative paths', async () => {
      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = validateCliAvailability('codemachine');

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('v1.0.0\n'));
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(mockFsAccess).not.toHaveBeenCalled();
    });

    it('should extract version from multiline output', async () => {
      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = validateCliAvailability('codemachine');

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('CodeMachine CLI v2.0.0\nCopyright 2024\n'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.version).toBe('CodeMachine CLI v2.0.0');
    });
  });

  describe('C. Environment Filtering', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        USER: 'testuser',
        SHELL: '/bin/bash',
        TERM: 'xterm',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        AWS_SECRET_ACCESS_KEY: 'secret123',
        AWS_ACCESS_KEY_ID: 'access123',
        CUSTOM_VAR: 'custom_value',
        UNDEFINED_VAR: undefined,
      };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should include always-allowed keys', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(mockSpawn).toHaveBeenCalled();
      const spawnEnv = mockSpawn.mock.calls[0][2]?.env;

      expect(spawnEnv).toHaveProperty('PATH', '/usr/bin');
      expect(spawnEnv).toHaveProperty('HOME', '/home/user');
      expect(spawnEnv).toHaveProperty('USER', 'testuser');
      expect(spawnEnv).toHaveProperty('SHELL', '/bin/bash');
      expect(spawnEnv).toHaveProperty('TERM', 'xterm');
      expect(spawnEnv).toHaveProperty('LANG', 'en_US.UTF-8');
      expect(spawnEnv).toHaveProperty('LC_ALL', 'en_US.UTF-8');
    });

    it('should exclude non-allowlisted keys', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      const spawnEnv = mockSpawn.mock.calls[0][2]?.env;
      expect(spawnEnv).not.toHaveProperty('CUSTOM_VAR');
    });

    it('should exclude credential keys by default', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      const spawnEnv = mockSpawn.mock.calls[0][2]?.env;
      expect(spawnEnv).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
      expect(spawnEnv).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    });

    it('should exclude undefined values', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: ['UNDEFINED_VAR'],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: ['UNDEFINED_VAR'],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      const spawnEnv = mockSpawn.mock.calls[0][2]?.env;
      expect(spawnEnv).not.toHaveProperty('UNDEFINED_VAR');
    });
  });

  describe('D. Argument Building', () => {
    it('should build basic args structure', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'implement feature X',
        workspaceDir: '/tmp/workspace',
        specPath: 'spec.md',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'codemachine',
        ['run', '-d', '/tmp/workspace', '--spec', 'spec.md', 'claude', 'implement feature X'],
        expect.any(Object)
      );
    });

    it('should omit specPath when undefined', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).not.toContain('--spec');
    });

    it('should use custom engine when provided', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test prompt',
        engine: 'codex',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('codex');
    });

    // Verifies that prompts with special characters (quotes, etc.) are passed safely
    // to the CLI without requiring escaping, because shell:false prevents shell interpretation
    it('should not escape prompt (shell: false)', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'fix bug in "auth" module',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['fix bug in "auth" module']),
        expect.objectContaining({ shell: false })
      );
    });
  });

  describe('E. Process Spawning & Exit Codes', () => {
    it('should handle successful execution (exit code 0)', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('Success output\n'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(result.stdout).toBe('Success output\n');
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
    });

    it('should handle failure execution (exit code 1)', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stderr?.emit('data', Buffer.from('Error: compilation failed\n'));
        childProcess.emit('close', 1);
      }, 10);

      const result = await promise;

      expect(result.exitCode).toBe(EXIT_CODES.FAILURE);
      expect(result.stderr).toBe('Error: compilation failed\n');
      expect(result.timedOut).toBe(false);
    });

    it('should handle timeout (exit code 124)', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(1000);

      // Simulate process termination after SIGTERM
      childProcess.emit('close', null, 'SIGTERM');

      const result = await promise;

      expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain('timed out after 1000ms');
      expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');
      vi.useRealTimers();
    });

    it('should handle SIGKILL (exit code 137)', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', null, 'SIGKILL');
      }, 10);

      const result = await promise;

      expect(result.exitCode).toBe(EXIT_CODES.SIGKILL);
    });

    it('should handle spawn error', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      mockSpawn.mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      const result = await runCodeMachine(config, options);

      expect(result.exitCode).toBe(EXIT_CODES.FAILURE);
      expect(result.stderr).toContain('Failed to spawn CodeMachine CLI');
      expect(result.stderr).toContain('spawn ENOENT');
    });

    it('should handle process error event', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('error', new Error('Process error'));
      }, 10);

      const result = await promise;

      expect(result.exitCode).toBe(EXIT_CODES.FAILURE);
      expect(result.stderr).toContain('Execution error: Process error');
    });
  });

  describe('F. Timeout & Termination', () => {
    it('should send SIGTERM at timeout', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      await vi.advanceTimersByTimeAsync(1000);

      expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');

      childProcess.emit('close', null, 'SIGTERM');

      await promise;
      vi.useRealTimers();
    });

    it('should send SIGKILL 5s after SIGTERM if not killed', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      // Trigger timeout
      await vi.advanceTimersByTimeAsync(1000);

      expect(childProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Advance 5s more for SIGKILL
      await vi.advanceTimersByTimeAsync(5000);

      expect(childProcess.kill).toHaveBeenCalledWith('SIGKILL');

      childProcess.emit('close', null, 'SIGKILL');

      const result = await promise;
      expect(result.killed).toBe(true);
      vi.useRealTimers();
    });

    it('should not send SIGKILL if process exits gracefully', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      // Trigger timeout
      await vi.advanceTimersByTimeAsync(1000);

      // Process exits before SIGKILL
      Object.defineProperty(childProcess, 'killed', { value: true });
      childProcess.emit('close', 0);

      await promise;

      // Should not have been killed with SIGKILL
      const killCalls = vi.mocked(childProcess.kill).mock.calls;
      expect(killCalls).toHaveLength(1);
      expect(killCalls[0]?.[0]).toBe('SIGTERM');
      vi.useRealTimers();
    });

    it('should set timedOut and killed flags correctly', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(5000);

      childProcess.emit('close', null, 'SIGKILL');

      const result = await promise;

      expect(result.timedOut).toBe(true);
      expect(result.killed).toBe(true);
      expect(result.exitCode).toBe(EXIT_CODES.TIMEOUT);
      vi.useRealTimers();
    });
  });

  describe('G. Log Streaming', () => {
    it('should create log file with mode 0o600 (secure permissions)', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logPath: '/tmp/test.log',
      };

      // `runCodeMachine` probes the existing log file size via `fs.stat()` before spawning.
      // In CI / heavily loaded environments, relying on real filesystem timing can be flaky.
      // Force a synchronous "not found" path so the spawn + event handlers are attached immediately.
      vi.spyOn(fs, 'stat').mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const mockStream = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(mockStream);

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      childProcess.emit('close', 0, null);

      await promise;

      expect(mockCreateWriteStream).toHaveBeenCalledWith('/tmp/test.log', {
        flags: 'a',
        mode: 0o600,
      });
    });

    it('should stream stdout and stderr to log file', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logPath: '/tmp/test.log',
      };

      const mockStream = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(mockStream);

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        const stdoutChunk = Buffer.from('stdout line\n');
        const stderrChunk = Buffer.from('stderr line\n');
        childProcess.stdout?.emit('data', stdoutChunk);
        childProcess.stderr?.emit('data', stderrChunk);
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(mockStream.write).toHaveBeenCalledWith(Buffer.from('stdout line\n'));
      expect(mockStream.write).toHaveBeenCalledWith(Buffer.from('stderr line\n'));
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle log stream errors gracefully', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logPath: '/tmp/test.log',
        logger,
      };

      const mockStream = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(mockStream);

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        mockStream.emit('error', new Error('Disk full'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(logger.warn).toHaveBeenCalledWith(
        'Log stream error, disabling file logging',
        expect.objectContaining({
          task_id: 'test-task',
          logPath: '/tmp/test.log',
          error: 'Disk full',
        })
      );

      // Execution should continue despite log error
      expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    });
  });

  describe('G.1 Log Rotation', () => {
    it('should rotate logs when size exceeds threshold', async () => {
      const renameSpy = vi.spyOn(fs, 'rename').mockResolvedValue();
      const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
        log_rotation_mb: 1,
        log_rotation_keep: 2,
        log_rotation_compress: false,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logPath: '/tmp/test.log',
        logger,
      };

      mockCreateWriteStream.mockImplementation(() => createMockWriteStream());

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        const largeChunk = Buffer.alloc(1024 * 1024 + 1, 'a');
        childProcess.stdout?.emit('data', largeChunk);
        childProcess.emit('close', 0);
      }, 10);

      await promise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockCreateWriteStream).toHaveBeenCalledTimes(2);
      expect(renameSpy).toHaveBeenCalledWith('/tmp/test.log', '/tmp/test.log.1');
      expect(rmSpy).toHaveBeenCalledWith('/tmp/test.log.2', { force: true });
      expect(logger.warn).toHaveBeenCalledWith(
        'Log rotation occurred',
        expect.objectContaining({
          task_id: 'test-task',
          log_path: '/tmp/test.log',
          rotated_path: '/tmp/test.log.1',
          compressed: false,
        })
      );
    });
  });

  describe('H. Buffer Management', () => {
    it('should capture stdout/stderr up to max_log_buffer_size', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 100, // Small buffer for testing
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('a'.repeat(50)));
        childProcess.stdout?.emit('data', Buffer.from('b'.repeat(50)));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.stdout.length).toBe(100);
      expect(result.stdout).toBe('a'.repeat(50) + 'b'.repeat(50));
    });

    it('should stop buffering after exceeding the default buffer size', async () => {
      const maxBufferSize = 10 * 1024 * 1024;
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        const largeChunk = Buffer.alloc(maxBufferSize + 1, 'a');
        childProcess.stdout?.emit('data', largeChunk);
        childProcess.stdout?.emit('data', Buffer.from('b'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.stdout).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(
        'Large output detected, streaming to file only',
        expect.objectContaining({
          task_id: 'test-task',
          buffer_size: maxBufferSize + 1,
        })
      );
    });

    it('should use default buffer size (10MB) when not specified', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 10 * 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('test output'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.stdout).toBe('test output');
    });
  });

  describe('I. Structured Logging Integration', () => {
    it('should log execution start with key metadata', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: '/usr/bin/codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task-123',
        prompt: 'test prompt',
        engine: 'codex',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 90000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(logger.info).toHaveBeenCalledWith('Starting CodeMachine execution', {
        task_id: 'test-task-123',
        engine: 'codex',
        cli_path: '/usr/bin/codemachine',
        workspace: '/tmp/workspace',
        timeout_ms: 90000,
      });
    });

    it('should log execution completion', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      expect(logger.info).toHaveBeenCalledWith(
        'CodeMachine execution completed',
        expect.objectContaining({
          task_id: 'test-task',
          exit_code: 0,
          duration_ms: expect.any(Number),
        })
      );
    });

    it('should log timeout warning', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      await vi.advanceTimersByTimeAsync(1000);

      childProcess.emit('close', null, 'SIGTERM');

      await promise;

      expect(logger.warn).toHaveBeenCalledWith(
        'CodeMachine execution timed out',
        expect.objectContaining({
          task_id: 'test-task',
          timeout_ms: 1000,
          duration_ms: expect.any(Number),
          killed: expect.any(Boolean),
        })
      );
      vi.useRealTimers();
    });

    it('should log process errors', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('error', new Error('ENOENT'));
      }, 10);

      await promise;

      expect(logger.error).toHaveBeenCalledWith('CodeMachine execution error', {
        task_id: 'test-task',
        error: 'ENOENT',
      });
    });

    it('should include task_id in all log entries', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 100,
      };

      const logger = createMockLogger();

      const options: RunnerOptions = {
        taskId: 'unique-task-id',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
        logger,
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('x'.repeat(150))); // Trigger buffer warning
        childProcess.emit('close', 0);
      }, 10);

      await promise;

      // Check all log calls include task_id
      const mockedInfo = vi.mocked(logger.info);
      const mockedWarn = vi.mocked(logger.warn);
      const allCalls = [...mockedInfo.mock.calls, ...mockedWarn.mock.calls];

      for (const call of allCalls) {
        const metadata = call[1];
        expect(metadata).toHaveProperty('task_id', 'unique-task-id');
      }
    });
  });

  describe('J. Result Object Validation', () => {
    it('should return complete RunnerResult object', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'result-test',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('output'));
        childProcess.stderr?.emit('data', Buffer.from('error'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result).toMatchObject({
        taskId: 'result-test',
        exitCode: expect.any(Number),
        stdout: expect.any(String),
        stderr: expect.any(String),
        durationMs: expect.any(Number),
        timedOut: expect.any(Boolean),
        killed: expect.any(Boolean),
      });
    });

    it('should measure durationMs accurately', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 100);

      const result = await promise;

      // Should be roughly 100ms (within tolerance)
      expect(result.durationMs).toBeGreaterThanOrEqual(90);
      expect(result.durationMs).toBeLessThan(200);
    });

    it('should append timeout message to stderr only on timeout', async () => {
      vi.useFakeTimers();

      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 1000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      await vi.advanceTimersByTimeAsync(1000);

      childProcess.stderr?.emit('data', Buffer.from('original error\n'));
      childProcess.emit('close', null, 'SIGTERM');

      const result = await promise;

      expect(result.stderr).toBe('original error\n\n\nExecution timed out after 1000ms');
      expect(result.timedOut).toBe(true);
      vi.useRealTimers();
    });

    it('should decode stdout/stderr as UTF-8', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.stdout?.emit('data', Buffer.from('Hello 世界', 'utf-8'));
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.stdout).toBe('Hello 世界');
    });

    it('should return empty stderr for successful non-timeout executions', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: 'codemachine',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const childProcess = createMockChildProcess();
      mockSpawn.mockReturnValue(childProcess);

      const promise = runCodeMachine(config, options);

      setTimeout(() => {
        childProcess.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.stderr).toBe('');
    });
  });

  describe('K. Helper Functions', () => {
    it('should identify success with isSuccess()', () => {
      const result: RunnerResult = {
        taskId: 'test',
        exitCode: EXIT_CODES.SUCCESS,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      };

      expect(isSuccess(result)).toBe(true);
    });

    it('should identify failure with isSuccess()', () => {
      const result: RunnerResult = {
        taskId: 'test',
        exitCode: EXIT_CODES.FAILURE,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      };

      expect(isSuccess(result)).toBe(false);
    });

    it('should identify recoverable failure with isRecoverable()', () => {
      const result: RunnerResult = {
        taskId: 'test',
        exitCode: EXIT_CODES.FAILURE,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      };

      expect(isRecoverable(result)).toBe(true);
    });

    it('should identify non-recoverable timeout with isRecoverable()', () => {
      const result: RunnerResult = {
        taskId: 'test',
        exitCode: EXIT_CODES.TIMEOUT,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: true,
        killed: false,
      };

      expect(isRecoverable(result)).toBe(false);
    });

    it('should identify non-recoverable success with isRecoverable()', () => {
      const result: RunnerResult = {
        taskId: 'test',
        exitCode: EXIT_CODES.SUCCESS,
        stdout: '',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      };

      expect(isRecoverable(result)).toBe(false);
    });
  });

  describe('L. Invalid CLI Path Handling', () => {
    it('should return failure for invalid CLI path without spawning', async () => {
      const config: ExecutionConfig = {
        codemachine_cli_path: '../../../malicious',
        default_engine: 'claude',
        workspace_dir: '/tmp/workspace',
        task_timeout_ms: 60000,
        max_retries: 1,
        retry_backoff_ms: 1000,
        env_allowlist: [],
        spec_path: 'spec.md',
        max_log_buffer_size: 1024 * 1024,
      };

      const options: RunnerOptions = {
        taskId: 'test-task',
        prompt: 'test',
        workspaceDir: '/tmp/workspace',
        timeoutMs: 60000,
        envAllowlist: [],
      };

      const result = await runCodeMachine(config, options);

      expect(result.exitCode).toBe(EXIT_CODES.FAILURE);
      expect(result.stderr).toContain('path traversal');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
