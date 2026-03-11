import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ValidationCommandType, ValidationAttempt } from '../../src/workflows/validationStore';
import { loadValidationRegistry } from '../../src/workflows/validationStore';
import {
  initializeValidationRegistry,
  getValidationCommand,
  getRequiredCommands,
  recordValidationAttempt,
  getValidationAttempts,
  getAttemptCount,
  hasExceededRetryLimit,
  getValidationSummary,
  generateAttemptId,
  summarizeError,
} from '../../src/workflows/validationRegistry';
import { createDefaultConfig, type RepoConfig } from '../../src/core/config/RepoConfig';
import {
  createRunDirectory,
  type CreateRunDirectoryOptions,
} from '../../src/persistence/runLifecycle';

describe('ValidationRegistry', () => {
  let testRunDir: string;
  let testConfig: RepoConfig;
  let cleanupDirs: string[] = [];

  beforeEach(async () => {
    // Create temporary directory for test run
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validation-test-'));
    cleanupDirs.push(tempDir);

    const baseDir = path.join(tempDir, '.codepipe', 'runs');
    await fs.mkdir(baseDir, { recursive: true });

    const options: CreateRunDirectoryOptions = {
      repoUrl: 'https://github.com/test/repo.git',
      title: 'Test Feature',
      source: 'test',
    };

    const featureId = 'feature-validation';
    testRunDir = await createRunDirectory(baseDir, featureId, options);

    testConfig = createDefaultConfig('https://github.com/test/repo.git');
  });

  afterEach(async () => {
    // Clean up test directories
    for (const dir of cleanupDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    cleanupDirs = [];
  });

  describe('initializeValidationRegistry', () => {
    it('should create validation registry from config', async () => {
      const registry = await initializeValidationRegistry(testRunDir, testConfig);

      expect(registry).toBeDefined();
      expect(registry.schema_version).toBe('1.0.0');
      expect(registry.commands).toHaveLength(4); // lint, typecheck, test, build
      expect(registry.metadata?.config_hash).toBeDefined();
    });

    it('should persist registry to run directory', async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      const registryPath = path.join(testRunDir, 'validation', 'commands.json');
      const exists = await fs
        .access(registryPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should include default commands', async () => {
      const registry = await initializeValidationRegistry(testRunDir, testConfig);

      const commandTypes = registry.commands.map((c) => c.type);
      expect(commandTypes).toContain('lint');
      expect(commandTypes).toContain('typecheck');
      expect(commandTypes).toContain('test');
      expect(commandTypes).toContain('build');
    });

    it('should configure lint with auto-fix support', async () => {
      const registry = await initializeValidationRegistry(testRunDir, testConfig);

      const lintCommand = registry.commands.find((c) => c.type === 'lint');
      expect(lintCommand).toBeDefined();
      expect(lintCommand?.supports_auto_fix).toBe(true);
      expect(lintCommand?.auto_fix_command).toBe('npm run lint:fix');
    });

    it('should merge RepoConfig validation overrides and template context', async () => {
      const customConfig = createDefaultConfig('https://github.com/test/repo.git');
      customConfig.validation = {
        template_context: {
          branch_name: 'feature/{{feature_id}}',
        },
        commands: [
          {
            type: 'lint',
            command: 'pnpm lint -- --feature {{feature_id}}',
            required: false,
            timeout_ms: 45000,
            max_retries: 4,
            backoff_ms: 600,
            supports_auto_fix: false,
            template_context: {
              lint_mode: 'strict',
            },
          },
        ],
      };

      const registry = await initializeValidationRegistry(testRunDir, customConfig);
      const lintCommand = registry.commands.find((c) => c.type === 'lint');

      expect(lintCommand?.command).toBe('pnpm lint -- --feature {{feature_id}}');
      expect(lintCommand?.required).toBe(false);
      expect(lintCommand?.template_context?.branch_name).toBe('feature/{{feature_id}}');
      expect(lintCommand?.template_context?.lint_mode).toBe('strict');

      const buildCommand = registry.commands.find((c) => c.type === 'build');
      expect(buildCommand).toBeDefined();
    });
  });

  describe('loadValidationRegistry', () => {
    it('should load existing registry', async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      const loaded = await loadValidationRegistry(testRunDir);

      expect(loaded).toBeDefined();
      expect(loaded?.commands).toHaveLength(4);
    });

    it('should return undefined if registry does not exist', async () => {
      const loaded = await loadValidationRegistry(testRunDir);

      expect(loaded).toBeUndefined();
    });

    it('should validate schema on load', async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      // Corrupt registry
      const registryPath = path.join(testRunDir, 'validation', 'commands.json');
      await fs.writeFile(registryPath, JSON.stringify({ invalid: true }), 'utf-8');

      await expect(loadValidationRegistry(testRunDir)).rejects.toThrow('Invalid registry schema');
    });
  });

  describe('getValidationCommand', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);
    });

    it('should retrieve command by type', async () => {
      const command = await getValidationCommand(testRunDir, 'lint');

      expect(command).toBeDefined();
      expect(command?.type).toBe('lint');
      expect(command?.command).toBe('npm run lint');
    });

    it('should return undefined for non-existent command', async () => {
      const command = await getValidationCommand(testRunDir, 'deploy' as ValidationCommandType);

      expect(command).toBeUndefined();
    });

    it('should expose build command by default', async () => {
      const command = await getValidationCommand(testRunDir, 'build');

      expect(command).toBeDefined();
      expect(command?.command).toBe('npm run build');
    });
  });

  describe('getRequiredCommands', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);
    });

    it('should return only required commands', async () => {
      const required = await getRequiredCommands(testRunDir);

      expect(required.length).toBeGreaterThan(0);
      expect(required.every((c) => c.required)).toBe(true);
    });
  });

  describe('recordValidationAttempt', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);
    });

    it('should record validation attempt to ledger', async () => {
      const attempt: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
      };

      await recordValidationAttempt(testRunDir, attempt);

      const ledgerPath = path.join(testRunDir, 'validation', 'ledger.json');
      const exists = await fs
        .access(ledgerPath)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should update summary statistics', async () => {
      const attempt1: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
      };

      const attempt2: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 2,
        exit_code: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1500,
        auto_fix_attempted: true,
      };

      await recordValidationAttempt(testRunDir, attempt1);
      await recordValidationAttempt(testRunDir, attempt2);

      const summary = await getValidationSummary(testRunDir);

      expect(summary?.total_attempts).toBe(2);
      expect(summary?.successful_attempts).toBe(1);
      expect(summary?.failed_attempts).toBe(1);
      expect(summary?.auto_fix_successes).toBe(1);
    });
  });

  describe('getValidationAttempts', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      // Record some attempts
      const attempt1: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
      };

      const attempt2: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'test',
        attempt_number: 1,
        exit_code: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 2000,
        auto_fix_attempted: false,
      };

      await recordValidationAttempt(testRunDir, attempt1);
      await recordValidationAttempt(testRunDir, attempt2);
    });

    it('should retrieve all attempts', async () => {
      const attempts = await getValidationAttempts(testRunDir);

      expect(attempts).toHaveLength(2);
    });

    it('should filter attempts by command type', async () => {
      const lintAttempts = await getValidationAttempts(testRunDir, 'lint');

      expect(lintAttempts).toHaveLength(1);
      expect(lintAttempts[0].command_type).toBe('lint');
    });
  });

  describe('getAttemptCount', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      // Record multiple lint attempts
      for (let i = 0; i < 3; i++) {
        const attempt: ValidationAttempt = {
          attempt_id: generateAttemptId(),
          command_type: 'lint',
          attempt_number: i + 1,
          exit_code: 1,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1000,
          auto_fix_attempted: false,
        };
        await recordValidationAttempt(testRunDir, attempt);
      }
    });

    it('should count attempts for specific command', async () => {
      const count = await getAttemptCount(testRunDir, 'lint');

      expect(count).toBe(3);
    });

    it('should return 0 for commands with no attempts', async () => {
      const count = await getAttemptCount(testRunDir, 'test');

      expect(count).toBe(0);
    });
  });

  describe('hasExceededRetryLimit', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);
    });

    it('should return false when under retry limit', async () => {
      // Record 1 attempt (limit is 2 retries + 1 initial = 3 total)
      const attempt: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
      };
      await recordValidationAttempt(testRunDir, attempt);

      const exceeded = await hasExceededRetryLimit(testRunDir, 'lint');

      expect(exceeded).toBe(false);
    });

    it('should return true when retry limit exceeded', async () => {
      // Record 3 attempts (max for lint is 2 retries + 1 initial = 3 total)
      for (let i = 0; i < 3; i++) {
        const attempt: ValidationAttempt = {
          attempt_id: generateAttemptId(),
          command_type: 'lint',
          attempt_number: i + 1,
          exit_code: 1,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1000,
          auto_fix_attempted: false,
        };
        await recordValidationAttempt(testRunDir, attempt);
      }

      const exceeded = await hasExceededRetryLimit(testRunDir, 'lint');

      expect(exceeded).toBe(true);
    });
  });

  describe('generateAttemptId', () => {
    it('should generate unique attempt IDs', () => {
      const id1 = generateAttemptId();
      const id2 = generateAttemptId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('should generate IDs with timestamp and random components', () => {
      const id = generateAttemptId();

      expect(id).toMatch(/^[a-z0-9]+-[a-f0-9]{12}$/);
    });
  });

  describe('summarizeError', () => {
    it('should extract error lines from stderr', () => {
      const stderr = `
        info: Some info message
        error: First error message
        warning: Some warning
        ERROR: Second error message
        info: Another info
      `;

      const summary = summarizeError(stderr);

      expect(summary).toContain('error: First error message');
      expect(summary).toContain('ERROR: Second error message');
      expect(summary).not.toContain('info: Some info message');
    });

    it('should truncate to max lines', () => {
      const stderr = Array(30).fill('error: Test error').join('\n');

      const summary = summarizeError(stderr, 10);
      const lines = summary.split('\n');

      expect(lines.length).toBe(10);
      expect(summary).toContain('... (');
    });

    it('should return all lines if under max', () => {
      const stderr = 'error: Test error\nerror: Another error';

      const summary = summarizeError(stderr, 10);

      expect(summary).toBe('error: Test error\nerror: Another error');
    });

    it('should handle empty stderr', () => {
      const summary = summarizeError('');

      expect(summary).toBe('');
    });
  });

  describe('Concurrent Access', () => {
    beforeEach(async () => {
      await initializeValidationRegistry(testRunDir, testConfig);
    });

    it('should handle concurrent attempt recording', async () => {
      const attempts = Array(5)
        .fill(null)
        .map((_, i) => ({
          attempt_id: generateAttemptId(),
          command_type: 'lint' as const,
          attempt_number: i + 1,
          exit_code: i % 2,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 1000,
          auto_fix_attempted: false,
        }));

      // Record all attempts concurrently
      await Promise.all(attempts.map((attempt) => recordValidationAttempt(testRunDir, attempt)));

      const recorded = await getValidationAttempts(testRunDir, 'lint');

      expect(recorded).toHaveLength(5);
    });
  });

  describe('Schema Validation', () => {
    it('should reject invalid command configuration', async () => {
      const registryPath = path.join(testRunDir, 'validation', 'commands.json');
      await fs.mkdir(path.dirname(registryPath), { recursive: true });

      const invalidRegistry = {
        schema_version: '1.0.0',
        feature_id: 'test-feature',
        commands: [
          {
            type: 'lint',
            // Missing required 'command' field
            required: true,
          },
        ],
      };

      await fs.writeFile(registryPath, JSON.stringify(invalidRegistry), 'utf-8');

      await expect(loadValidationRegistry(testRunDir)).rejects.toThrow('Invalid registry schema');
    });

    it('should reject invalid ledger schema', async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      const ledgerPath = path.join(testRunDir, 'validation', 'ledger.json');
      const invalidLedger = {
        schema_version: '1.0.0',
        feature_id: 'test-feature',
        attempts: [
          {
            // Missing required fields
            attempt_id: 'test-123',
          },
        ],
      };

      await fs.writeFile(ledgerPath, JSON.stringify(invalidLedger), 'utf-8');

      const invalidAttempt: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
      };

      // This should fail due to invalid existing ledger
      await expect(recordValidationAttempt(testRunDir, invalidAttempt)).rejects.toThrow();
    });
  });

  describe('Resume Flow', () => {
    it('should support resuming validation after failure', async () => {
      await initializeValidationRegistry(testRunDir, testConfig);

      // Simulate first run with failure
      const attempt1: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 1,
        exit_code: 1,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1000,
        auto_fix_attempted: false,
        error_summary: 'Lint errors detected',
      };
      await recordValidationAttempt(testRunDir, attempt1);

      // Verify we can check attempt count before retry
      const count = await getAttemptCount(testRunDir, 'lint');
      expect(count).toBe(1);

      // Simulate retry
      const attempt2: ValidationAttempt = {
        attempt_id: generateAttemptId(),
        command_type: 'lint',
        attempt_number: 2,
        exit_code: 0,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: 1500,
        auto_fix_attempted: true,
      };
      await recordValidationAttempt(testRunDir, attempt2);

      // Verify summary reflects both attempts
      const summary = await getValidationSummary(testRunDir);
      expect(summary?.total_attempts).toBe(2);
      expect(summary?.auto_fix_successes).toBe(1);
    });
  });
});
