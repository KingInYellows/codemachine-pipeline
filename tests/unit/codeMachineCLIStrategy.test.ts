import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionConfig } from '../../src/core/config/RepoConfig.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';
import type { ExecutionContext } from '../../src/workflows/executionStrategy.js';

// Mock the adapter
vi.mock('../../src/adapters/codemachine/CodeMachineCLIAdapter.js', () => {
  const MockAdapter = vi.fn();
  MockAdapter.prototype.validateAvailability = vi.fn();
  MockAdapter.prototype.execute = vi.fn();
  return { CodeMachineCLIAdapter: MockAdapter };
});

// Mock taskMapper so canHandle filters on task type
vi.mock('../../src/workflows/taskMapper.js', () => ({
  shouldUseNativeEngine: vi.fn((taskType: string) => {
    return taskType === 'testing' || taskType === 'deployment';
  }),
}));

import { CodeMachineCLIStrategy } from '../../src/workflows/codeMachineCLIStrategy.js';
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

function makeTask(overrides?: Partial<ExecutionTask>): ExecutionTask {
  const now = new Date().toISOString();
  return {
    schema_version: '1.0.0',
    task_id: 'task-1',
    feature_id: 'feat-1',
    title: 'Build a login page',
    task_type: 'code_generation',
    status: 'pending',
    dependency_ids: [],
    retry_count: 0,
    max_retries: 3,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeContext(): ExecutionContext {
  return {
    runDir: '/run-dir',
    workspaceDir: '/workspace',
    logPath: '/run-dir/logs/task-1.log',
    timeoutMs: 30000,
  };
}

describe('CodeMachineCLIStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('has name "codemachine-cli"', () => {
    const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
    expect(strategy.name).toBe('codemachine-cli');
  });

  describe('canHandle', () => {
    it('returns false before checkAvailability is called', () => {
      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      expect(strategy.canHandle(makeTask())).toBe(false);
    });

    it('returns true after successful checkAvailability', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.validateAvailability).mockResolvedValue({
        available: true,
        version: '0.8.0',
        binaryPath: '/usr/local/bin/codemachine',
        source: 'optionalDep',
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      await strategy.checkAvailability();

      expect(strategy.canHandle(makeTask())).toBe(true);
    });

    it('returns false after failed checkAvailability', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.validateAvailability).mockResolvedValue({
        available: false,
        error: 'Not found',
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      await strategy.checkAvailability();

      expect(strategy.canHandle(makeTask())).toBe(false);
    });

    it('returns false for native-engine task types even when available', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.validateAvailability).mockResolvedValue({
        available: true,
        version: '0.8.0',
        binaryPath: '/usr/local/bin/codemachine',
        source: 'optionalDep',
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      await strategy.checkAvailability();

      // 'testing' and 'deployment' use native engines per taskMapper.ts
      expect(strategy.canHandle(makeTask({ task_type: 'testing' }))).toBe(false);
      expect(strategy.canHandle(makeTask({ task_type: 'deployment' }))).toBe(false);
    });

    it('returns true for non-native task types when available', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.validateAvailability).mockResolvedValue({
        available: true,
        version: '0.8.0',
        binaryPath: '/usr/local/bin/codemachine',
        source: 'optionalDep',
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      await strategy.checkAvailability();

      expect(strategy.canHandle(makeTask({ task_type: 'code_generation' }))).toBe(true);
      expect(strategy.canHandle(makeTask({ task_type: 'pr_creation' }))).toBe(true);
      expect(strategy.canHandle(makeTask({ task_type: 'review' }))).toBe(true);
    });
  });

  describe('execute', () => {
    it('returns completed result on success', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'Feature implemented successfully',
        stderr: '',
        durationMs: 1500,
        timedOut: false,
        killed: false,
        pid: 12345,
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      const result = await strategy.execute(makeTask(), makeContext());

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.summary).toContain('Feature implemented successfully');
    });

    it('returns failed result on non-zero exit', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Authentication failed',
        durationMs: 200,
        timedOut: false,
        killed: false,
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      const result = await strategy.execute(makeTask(), makeContext());

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Authentication failed');
    });

    it('returns timeout status when timed out', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 124,
        stdout: '',
        stderr: '',
        durationMs: 30000,
        timedOut: true,
        killed: false,
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      const result = await strategy.execute(makeTask(), makeContext());

      expect(result.success).toBe(false);
      expect(result.status).toBe('timeout');
      expect(result.recoverable).toBe(true);
    });

    it('rejects openai engine as unsupported by CodeMachine-CLI', async () => {
      const config = makeConfig({ default_engine: 'openai' });
      const strategy = new CodeMachineCLIStrategy({ config });
      const result = await strategy.execute(makeTask(), makeContext());

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('openai');
      expect(result.errorMessage).toContain('Unsupported engine');
    });

    it('uses task prompt from config when available', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      });

      const task = makeTask({
        config: { prompt: 'Custom prompt from config' },
      });

      const strategy = new CodeMachineCLIStrategy({ config: makeConfig() });
      await strategy.execute(task, makeContext());

      const callArgs = vi.mocked(CodeMachineCLIAdapter.prototype.execute).mock.calls[0];
      const commandArgs = callArgs[0];
      expect(commandArgs[2]).toContain('Custom prompt from config');
    });
  });

  describe('env_credential_keys gathering', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = originalEnv;
    });

    it('gathers specified env vars and passes them as credentials', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      process.env.GITHUB_TOKEN = 'ghp_test_token';

      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      });

      const config = makeConfig({
        env_credential_keys: ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN'],
      });
      const strategy = new CodeMachineCLIStrategy({ config });
      await strategy.execute(makeTask(), makeContext());

      const callArgs = vi.mocked(CodeMachineCLIAdapter.prototype.execute).mock.calls[0];
      const executeOptions = callArgs[1];
      expect(executeOptions.credentials).toEqual({
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
        GITHUB_TOKEN: 'ghp_test_token',
      });
    });

    it('skips env vars that are not set in the environment', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      delete process.env.MISSING_KEY;

      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      });

      const config = makeConfig({
        env_credential_keys: ['ANTHROPIC_API_KEY', 'MISSING_KEY'],
      });
      const strategy = new CodeMachineCLIStrategy({ config });
      await strategy.execute(makeTask(), makeContext());

      const callArgs = vi.mocked(CodeMachineCLIAdapter.prototype.execute).mock.calls[0];
      const executeOptions = callArgs[1];
      // Only the set key should be present
      expect(executeOptions.credentials).toEqual({
        ANTHROPIC_API_KEY: 'sk-ant-test-key',
      });
    });

    it('does not pass credentials when env_credential_keys is empty', async () => {
      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      });

      const config = makeConfig({ env_credential_keys: [] });
      const strategy = new CodeMachineCLIStrategy({ config });
      await strategy.execute(makeTask(), makeContext());

      const callArgs = vi.mocked(CodeMachineCLIAdapter.prototype.execute).mock.calls[0];
      const executeOptions = callArgs[1];
      // No credentials property should be set when none are gathered
      expect(executeOptions.credentials).toBeUndefined();
    });

    it('does not pass credentials when all keys are unset in env', async () => {
      delete process.env.NONEXISTENT_KEY_1;
      delete process.env.NONEXISTENT_KEY_2;

      vi.mocked(CodeMachineCLIAdapter.prototype.execute).mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        durationMs: 100,
        timedOut: false,
        killed: false,
      });

      const config = makeConfig({
        env_credential_keys: ['NONEXISTENT_KEY_1', 'NONEXISTENT_KEY_2'],
      });
      const strategy = new CodeMachineCLIStrategy({ config });
      await strategy.execute(makeTask(), makeContext());

      const callArgs = vi.mocked(CodeMachineCLIAdapter.prototype.execute).mock.calls[0];
      const executeOptions = callArgs[1];
      // Empty credentials object means credentials should not be set
      expect(executeOptions.credentials).toBeUndefined();
    });
  });
});
