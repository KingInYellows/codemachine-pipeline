import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionConfig } from '../../src/core/config/RepoConfig.js';
import type { ExecutionTask } from '../../src/core/models/ExecutionTask.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

const fs = await import('node:fs/promises');

import { WorkflowTemplateMapper } from '../../src/workflows/workflowTemplateMapper.js';

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

describe('WorkflowTemplateMapper', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('mapTaskToCoordination', () => {
    it('maps code_generation to engine-based coordination', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const result = mapper.mapTaskToCoordination(makeTask());

      expect(result).toContain('claude');
      expect(result).toContain('Build a login page');
    });

    it('maps testing to codex agent', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const task = makeTask({ task_type: 'testing', title: 'auth module' });
      const result = mapper.mapTaskToCoordination(task);

      expect(result).toContain('codex');
      expect(result).toContain('write tests');
    });

    it('includes spec path as input modifier when present', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const task = makeTask({
        config: { spec_path: 'spec.md' },
      });
      const result = mapper.mapTaskToCoordination(task);

      expect(result).toContain('input:spec.md');
    });

    it('uses prompt from task config when available', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const task = makeTask({
        config: { prompt: 'Custom prompt override' },
      });
      const result = mapper.mapTaskToCoordination(task);

      expect(result).toContain('Custom prompt override');
    });

    it('escapes single quotes in prompts', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const task = makeTask({ title: "don't break" });
      const result = mapper.mapTaskToCoordination(task);

      // Should escape the quote
      expect(result).not.toContain("'don't break'");
    });

    it('maps all supported task types without error', () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const taskTypes = [
        'code_generation', 'testing', 'pr_creation', 'deployment',
        'review', 'refactoring', 'documentation', 'other',
      ] as const;

      for (const taskType of taskTypes) {
        const task = makeTask({ task_type: taskType });
        const result = mapper.mapTaskToCoordination(task);
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('respects configured default_engine', () => {
      const mapper = new WorkflowTemplateMapper({
        config: makeConfig({ default_engine: 'codex' }),
      });
      const result = mapper.mapTaskToCoordination(makeTask());

      expect(result).toContain('codex');
    });
  });

  describe('mapTaskToWorkflowFile', () => {
    it('returns null when no custom template exists', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const result = await mapper.mapTaskToWorkflowFile(makeTask(), '/workspace');

      expect(result).toBeNull();
    });

    it('returns template path when custom template exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(
        "module.exports = { name: 'test', steps: [{ agent: 'claude', prompt: 'test' }] };"
      );

      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const result = await mapper.mapTaskToWorkflowFile(makeTask(), '/workspace');

      expect(result).toContain('code_generation.workflow.js');
    });

    it('returns null when template has invalid structure', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('// empty file');

      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const result = await mapper.mapTaskToWorkflowFile(makeTask(), '/workspace');

      expect(result).toBeNull();
    });

    it('uses codemachine_workflow_dir from config', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(
        "module.exports = { name: 'test', steps: [{ agent: 'claude', prompt: 'test' }] };"
      );

      const mapper = new WorkflowTemplateMapper({
        config: makeConfig({ codemachine_workflow_dir: '/custom/workflows' }),
      });
      const result = await mapper.mapTaskToWorkflowFile(makeTask(), '/workspace');

      expect(result).toContain('/custom/workflows/');
    });

    it('rejects path traversal in task_type', async () => {
      const mapper = new WorkflowTemplateMapper({ config: makeConfig() });
      const task = makeTask({ task_type: '../../../etc/passwd' as never });
      const result = await mapper.mapTaskToWorkflowFile(task, '/workspace');

      expect(result).toBeNull();
    });
  });
});
