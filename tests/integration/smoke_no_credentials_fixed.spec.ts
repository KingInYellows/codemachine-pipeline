/**
 * Smoke Test Suite: Credential-Free Validation
 *
 * These tests validate that the pipeline can be tested and explored
 * without requiring external credentials (GITHUB_TOKEN, LINEAR_API_KEY, etc).
 *
 * This enables:
 * - CI/CD testing without secrets
 * - Local development without API access
 * - Offline testing scenarios
 *
 * Implements CDMCH-14: Add smoke tests without credentials
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateRepoConfig, validateEnvironmentVariables } from '../../src/core/config/validator';
import { createDefaultConfig } from '../../src/core/config/RepoConfig';
import { setLastStep, setCurrentStep, updateManifest } from '../../src/persistence/manifestManager';
import { createRunDirectory } from '../../src/persistence/runLifecycle';
import {
  initializeQueue,
  appendToQueue,
  updateTaskInQueue,
  loadQueue,
  getNextTask,
} from '../../src/workflows/queue/queueStore';
import { createExecutionTask } from '../../src/core/models/ExecutionTask';
import { analyzeResumeState } from '../../src/workflows/resumeCoordinator';

/**
 * Helper function to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper function to parse NDJSON strings
 */
function parseNDJSON(ndjson: string): unknown[] {
  return ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

describe('Smoke Tests: No Credentials Required', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-nocreds-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Config Validation Without Credentials', () => {
    it('should validate config with all integrations disabled', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git');
      config.github.enabled = false;
      config.linear.enabled = false;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const result = await validateRepoConfig(configPath, {
        checkCredentials: false,
        checkDirectories: false,
        enforceGovernance: false,
        checkPermissions: false,
      });

      expect(result.success).toBe(true);
      expect(result.checks).toBeDefined();
      if (!result.checks) {
        throw new Error('Expected result.checks to be defined');
      }
      expect(result.checks.credentials).toBe(false);
    });

    it('should validate config with enabled integrations but skip credential checks', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git');
      config.github.enabled = true;
      config.linear.enabled = true;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const result = await validateRepoConfig(configPath, {
        checkCredentials: false,
        checkDirectories: false,
      });

      // Should pass even though credentials aren't set
      expect(result.success).toBe(true);
    });

    it('should report environment variables without requiring them', () => {
      // Store and clear credentials
      const originalGithub = process.env.GITHUB_TOKEN;
      const originalLinear = process.env.LINEAR_API_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.LINEAR_API_KEY;

      try {
        const config = createDefaultConfig('https://github.com/test/repo.git');
        config.github.enabled = false; // Disabled integrations don't require creds
        config.linear.enabled = false;

        const envResult = validateEnvironmentVariables(config);
        const endpointVar = config.runtime.agent_endpoint_env_var;

        // Only AGENT_ENDPOINT should be checked when integrations are disabled
        expect(Object.keys(envResult).length).toBe(1);
        expect(envResult[endpointVar]).toBeDefined();
      } finally {
        // Restore
        if (originalGithub === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = originalGithub;
        }

        if (originalLinear === undefined) {
          delete process.env.LINEAR_API_KEY;
        } else {
          process.env.LINEAR_API_KEY = originalLinear;
        }
      }
    });

    it('should validate governance without external API access', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git', {
        includeGovernance: true,
      });
      config.github.enabled = false;
      config.linear.enabled = false;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const result = await validateRepoConfig(configPath, {
        checkCredentials: false,
        checkDirectories: false,
        enforceGovernance: true,
      });

      // Should validate governance structure without needing API calls
      if (!result.checks) {
        throw new Error('Expected result.checks to be defined');
      }
      expect(result.checks.governance).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should detect missing governance even without credentials', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git', {
        includeGovernance: false,
      });
      config.github.enabled = false;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      const result = await validateRepoConfig(configPath, {
        checkCredentials: false,
        checkDirectories: false,
        enforceGovernance: true,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      if (!result.errors) {
        throw new Error('Expected errors to be defined');
      }
      expect(result.errors.some((e) => e.path === 'governance')).toBe(true);
    });
  });

  describe('Run Directory Operations Without Credentials', () => {
    it('should create and manage run directory without external services', async () => {
      const runsDir = path.join(tempDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });
      const featureId = `test-feature-${Date.now()}`;

      // Create run directory - no credentials needed
      const runDir = await createRunDirectory(runsDir, featureId, {
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
        title: 'Test Feature',
      });

      expect(runDir).toContain(featureId);

      // Verify manifest created
      const manifestPath = path.join(runDir, 'manifest.json');
      const manifestExists = await fileExists(manifestPath);
      expect(manifestExists).toBe(true);
    });

    it('should handle queue operations without credentials', async () => {
      const runsDir = path.join(tempDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });
      const featureId = `queue-test-${Date.now()}`;

      const runDir = await createRunDirectory(runsDir, featureId, {
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
        title: 'Queue Test',
      });

      // Initialize and use queue without credentials
      await initializeQueue(runDir, featureId);

      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'documentation'),
        createExecutionTask('T2', featureId, 'Task 2', 'code_generation', {
          dependencyIds: ['T1'],
        }),
      ];

      await appendToQueue(runDir, tasks);

      // Verify queue state
      const queue = await loadQueue(runDir);
      expect(queue.size).toBe(2);
      expect(queue.get('T1')?.status).toBe('pending');
      expect(queue.get('T2')?.status).toBe('pending');

      // Get next task
      const nextTask = await getNextTask(runDir);
      expect(nextTask?.task_id).toBe('T1');
    });

    it('should analyze resume state without credentials', async () => {
      const runsDir = path.join(tempDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });
      const featureId = `resume-test-${Date.now()}`;

      const runDir = await createRunDirectory(runsDir, featureId, {
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
        title: 'Resume Test',
      });

      await initializeQueue(runDir, featureId);

      const tasks = [
        createExecutionTask('T1', featureId, 'Task 1', 'documentation'),
        createExecutionTask('T2', featureId, 'Task 2', 'testing'),
      ];

      await appendToQueue(runDir, tasks);

      // Simulate partial execution
      await updateTaskInQueue(runDir, 'T1', {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await setLastStep(runDir, 'T1');
      await setCurrentStep(runDir, 'T2');
      await updateManifest(runDir, { status: 'in_progress' });

      // Analyze resume - no credentials needed
      const analysis = await analyzeResumeState(runDir);

      expect(analysis.canResume).toBe(true);
      expect(analysis.lastStep).toBe('T1');
      expect(analysis.currentStep).toBe('T2');
      expect(analysis.queueState.completed).toBe(1);
      expect(analysis.queueState.pending).toBe(1);
    });
  });

  describe('Output Format Tests', () => {
    it('should format NDJSON correctly', () => {
      const records = [
        { id: 1, name: 'first', timestamp: new Date().toISOString() },
        { id: 2, name: 'second', timestamp: new Date().toISOString() },
        { id: 3, name: 'third', timestamp: new Date().toISOString() },
      ];

      // Format to NDJSON (inline implementation test)
      const ndjson = records.map((r) => JSON.stringify(r)).join('\n');

      // Should be newline-delimited
      const lines = ndjson.trim().split('\n');
      expect(lines.length).toBe(3);

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }

      // Parse back
      const parsed = parseNDJSON(ndjson);
      expect(parsed.length).toBe(3);
      expect(parsed[0].id).toBe(1);
      expect(parsed[2].name).toBe('third');
    });

    it('should handle empty NDJSON', () => {
      const ndjson = '';
      const parsed = parseNDJSON(ndjson);
      expect(parsed).toEqual([]);
    });

    it('should handle NDJSON with blank lines', () => {
      const ndjson = '{"a":1}\n\n{"b":2}\n';
      const parsed = parseNDJSON(ndjson);
      expect(parsed.length).toBe(2);
    });
  });

  describe('Task Model Tests', () => {
    it('should create execution tasks with correct defaults', () => {
      const task = createExecutionTask('T1', 'feature-123', 'Implement feature', 'code_generation');

      expect(task.task_id).toBe('T1');
      expect(task.feature_id).toBe('feature-123');
      expect(task.title).toBe('Implement feature');
      expect(task.task_type).toBe('code_generation');
      expect(task.status).toBe('pending');
      expect(task.created_at).toBeDefined();
    });

    it('should create tasks with dependencies', () => {
      const task = createExecutionTask('T2', 'feature-123', 'Add tests', 'testing', {
        dependencyIds: ['T1'],
        maxRetries: 3,
      });

      expect(task.dependency_ids).toEqual(['T1']);
      expect(task.max_retries).toBe(3);
    });

    it('should create tasks with all supported task types', () => {
      const taskTypes = [
        'code_generation',
        'testing',
        'pr_creation',
        'deployment',
        'review',
        'refactoring',
        'documentation',
        'other',
      ] as const;

      for (const taskType of taskTypes) {
        const task = createExecutionTask(`task-${taskType}`, 'feature', 'Test', taskType);
        expect(task.task_type).toBe(taskType);
      }
    });
  });

  describe('Config Structure Validation', () => {
    it('should validate all required config sections exist', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git');

      // Verify all required sections
      expect(config.schema_version).toBeDefined();
      expect(config.project).toBeDefined();
      expect(config.github).toBeDefined();
      expect(config.linear).toBeDefined();
      expect(config.runtime).toBeDefined();
      expect(config.safety).toBeDefined();
      expect(config.feature_flags).toBeDefined();
    });

    it('should validate project section structure', async () => {
      const config = createDefaultConfig('https://github.com/org/repo.git');

      expect(config.project.repo_url).toBe('https://github.com/org/repo.git');
      expect(config.project.default_branch).toBeDefined();
      expect(config.project.context_paths).toBeInstanceOf(Array);
    });

    it('should validate safety section structure', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git');

      expect(typeof config.safety.redact_secrets).toBe('boolean');
      expect(config.safety.allowed_file_patterns).toBeInstanceOf(Array);
      expect(config.safety.blocked_file_patterns).toBeInstanceOf(Array);
    });

    it('should validate governance section when included', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git', {
        includeGovernance: true,
      });

      expect(config.governance).toBeDefined();
      expect(config.governance?.approval_workflow).toBeDefined();
      expect(config.governance?.accountability).toBeDefined();
      expect(config.governance?.risk_controls).toBeDefined();
    });

    it('should validate feature flags section', async () => {
      const config = createDefaultConfig('https://github.com/test/repo.git');

      expect(typeof config.feature_flags.enable_auto_merge).toBe('boolean');
      expect(typeof config.feature_flags.enable_deployment_triggers).toBe('boolean');
      expect(typeof config.feature_flags.enable_context_summarization).toBe('boolean');
      expect(typeof config.feature_flags.enable_resumability).toBe('boolean');
    });
  });

  describe('Directory Structure Tests', () => {
    it('should create expected run directory structure', async () => {
      const runsDir = path.join(tempDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });
      const featureId = `structure-test-${Date.now()}`;

      const runDir = await createRunDirectory(runsDir, featureId, {
        repoUrl: 'https://github.com/test/repo.git',
        defaultBranch: 'main',
        title: 'Structure Test',
      });

      // Initialize queue to create queue directory
      await initializeQueue(runDir, featureId);

      // Check expected paths exist
      const expectedPaths = ['manifest.json', 'queue'];

      for (const expectedPath of expectedPaths) {
        const fullPath = path.join(runDir, expectedPath);
        const exists = await fileExists(fullPath);
        expect(exists).toBe(true);
      }
    });

    it('should handle concurrent directory operations', async () => {
      const runsDir = path.join(tempDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });

      // Create multiple run directories concurrently
      const featureIds = ['feature-a', 'feature-b', 'feature-c'];
      const createPromises = featureIds.map((id) =>
        createRunDirectory(runsDir, id, {
          repoUrl: 'https://github.com/test/repo.git',
          defaultBranch: 'main',
          title: `Feature ${id}`,
        })
      );

      const runDirs = await Promise.all(createPromises);

      // All should be created successfully
      expect(runDirs.length).toBe(3);
      for (const runDir of runDirs) {
        const manifestExists = await fileExists(path.join(runDir, 'manifest.json'));
        expect(manifestExists).toBe(true);
      }
    });
  });
});
