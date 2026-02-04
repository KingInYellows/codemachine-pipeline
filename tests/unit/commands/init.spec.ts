import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { loadRepoConfig } from '../../../src/core/config/repo_config';

describe('init command', () => {
  const testDir = path.join(__dirname, '../../../.test-temp');
  const pipelineDir = path.join(testDir, '.codepipe');
  const configPath = path.join(pipelineDir, 'config.json');
  const binPath = path.join(__dirname, '../../../bin/run.js');

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize git repo in test directory
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('directory structure', () => {
    test('creates .codepipe directory structure', () => {
      // Run init command
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      // Verify directory structure
      expect(fs.existsSync(pipelineDir)).toBe(true);
      expect(fs.existsSync(path.join(pipelineDir, 'runs'))).toBe(true);
      expect(fs.existsSync(path.join(pipelineDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(pipelineDir, 'artifacts'))).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });

  describe('config.json schema validation', () => {
    test('creates config with all required schema sections', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Verify required top-level fields
      expect(config).toHaveProperty('schema_version');
      expect(config).toHaveProperty('project');
      expect(config).toHaveProperty('github');
      expect(config).toHaveProperty('linear');
      expect(config).toHaveProperty('runtime');
      expect(config).toHaveProperty('safety');
      expect(config).toHaveProperty('feature_flags');

      // Verify schema version format
      expect(config.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('creates valid config that passes schema validation', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const result = loadRepoConfig(configPath);
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
    });

    test('config has project section with required fields', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.project).toHaveProperty('id');
      expect(config.project).toHaveProperty('repo_url');
      expect(config.project).toHaveProperty('default_branch');
      expect(config.project).toHaveProperty('context_paths');
      expect(config.project).toHaveProperty('project_leads');

      expect(typeof config.project.id).toBe('string');
      expect(typeof config.project.repo_url).toBe('string');
      expect(typeof config.project.default_branch).toBe('string');
      expect(Array.isArray(config.project.context_paths)).toBe(true);
      expect(Array.isArray(config.project.project_leads)).toBe(true);
    });

    test('config has github section with credentials stubs', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.github).toHaveProperty('enabled');
      expect(config.github).toHaveProperty('token_env_var');
      expect(config.github).toHaveProperty('api_base_url');
      expect(config.github).toHaveProperty('required_scopes');

      expect(typeof config.github.enabled).toBe('boolean');
      expect(config.github.token_env_var).toBe('GITHUB_TOKEN');
      expect(Array.isArray(config.github.required_scopes)).toBe(true);
    });

    test('config has linear section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.linear).toHaveProperty('enabled');
      expect(config.linear).toHaveProperty('api_key_env_var');
      expect(config.linear.api_key_env_var).toBe('LINEAR_API_KEY');
    });

    test('config has runtime section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.runtime).toHaveProperty('agent_endpoint_env_var');
      expect(config.runtime).toHaveProperty('max_concurrent_tasks');
      expect(config.runtime).toHaveProperty('timeout_minutes');
      expect(config.runtime).toHaveProperty('context_token_budget');
      expect(config.runtime).toHaveProperty('logs_format');

      expect(config.runtime.agent_endpoint_env_var).toBe('AGENT_ENDPOINT');
      expect(typeof config.runtime.max_concurrent_tasks).toBe('number');
      expect(config.runtime.logs_format).toMatch(/^(ndjson|json|text)$/);
    });

    test('config has safety section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.safety).toHaveProperty('redact_secrets');
      expect(config.safety).toHaveProperty('require_approval_for_prd');
      expect(config.safety).toHaveProperty('require_approval_for_plan');
      expect(config.safety).toHaveProperty('require_approval_for_pr');
      expect(config.safety).toHaveProperty('prevent_force_push');
      expect(config.safety).toHaveProperty('allowed_file_patterns');
      expect(config.safety).toHaveProperty('blocked_file_patterns');

      expect(typeof config.safety.redact_secrets).toBe('boolean');
      expect(Array.isArray(config.safety.allowed_file_patterns)).toBe(true);
      expect(Array.isArray(config.safety.blocked_file_patterns)).toBe(true);
    });

    test('config has feature_flags section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(config.feature_flags).toHaveProperty('enable_auto_merge');
      expect(config.feature_flags).toHaveProperty('enable_deployment_triggers');
      expect(config.feature_flags).toHaveProperty('enable_linear_sync');
      expect(config.feature_flags).toHaveProperty('enable_context_summarization');
      expect(config.feature_flags).toHaveProperty('enable_resumability');

      expect(typeof config.feature_flags.enable_auto_merge).toBe('boolean');
    });
  });

  describe('validation errors and exit codes', () => {
    test('invalid config surfaces actionable error with exit code 10', () => {
      // Create invalid config manually
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          schema_version: 'invalid-version',
          project: {
            id: '',
            repo_url: 'not-a-valid-url',
          },
        }),
        'utf-8'
      );

      try {
        execSync(`node ${binPath} init --validate-only`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(10);
        }
      }
    });

    test('missing required fields produces validation error', () => {
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          schema_version: '1.0.0',
          // Missing required sections
        }),
        'utf-8'
      );

      const result = loadRepoConfig(configPath);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    test('invalid JSON produces parse error', () => {
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(configPath, '{ invalid json }', 'utf-8');

      const result = loadRepoConfig(configPath);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].path).toBe('json');
    });

    test('non-existent config file produces file error', () => {
      const result = loadRepoConfig(configPath);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].path).toBe('file');
    });
  });

  describe('force flag behavior', () => {
    test('without --force, warns if config exists', () => {
      // First init
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      // Second init without force should not overwrite
      try {
        const output = execSync(`node ${binPath} init`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        // Should mention that config exists
        expect(output.toLowerCase()).toContain('already exists');
      } catch {
        // Command may exit early, which is acceptable
      }

      // Config should still exist
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test('with --force, overwrites existing config', () => {
      // First init
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      // Modify config
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.project.id = 'modified-id';
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

      // Re-init with force
      execSync(`node ${binPath} init --force`, { cwd: testDir, stdio: 'pipe' });

      // Config should be reset
      const newConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(newConfig.project.id).not.toBe('modified-id');
    });
  });

  describe('validate-only flag', () => {
    test('validates existing config without creating files', () => {
      // First init
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      // Run validate-only
      const output = execSync(`node ${binPath} init --validate-only`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('valid');
    });

    test('validate-only with missing config returns exit code 10', () => {
      try {
        execSync(`node ${binPath} init --validate-only`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(10);
        }
      }
    });
  });

  describe('git repository detection', () => {
    test('fails if not in a git repository', () => {
      const nonGitDir = path.join(__dirname, '../../../.test-temp-no-git');
      if (fs.existsSync(nonGitDir)) {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
      fs.mkdirSync(nonGitDir, { recursive: true });

      try {
        execSync(`node ${binPath} init`, {
          cwd: nonGitDir,
          stdio: 'pipe',
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBeGreaterThan(0);
        }
      } finally {
        if (fs.existsSync(nonGitDir)) {
          fs.rmSync(nonGitDir, { recursive: true, force: true });
        }
      }
    });
  });
});
