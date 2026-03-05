/**
 * Test suite for RepoConfig module
 * Tests schema validation, config loading, environment overrides, and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  RepoConfigSchema,
  loadRepoConfig,
  createDefaultConfig,
  applyEnvironmentOverrides,
  formatValidationErrors,
  addConfigHistoryEntry,
  type ValidationError,
} from './RepoConfig';
import { DEFAULT_GITHUB_API_VERSION } from './RepoConfigDefaults';

describe('RepoConfigSchema', () => {
  it('should validate a complete valid config', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test-project',
        repo_url: 'https://github.com/org/repo.git',
        default_branch: 'main',
        context_paths: ['src/'],
        project_leads: [],
      },
      github: {
        enabled: false,
      },
      linear: {
        enabled: false,
      },
      runtime: {},
      safety: {},
      feature_flags: {},
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid schema_version format', () => {
    const config = {
      schema_version: 'invalid',
      project: {
        id: 'test',
        repo_url: 'https://github.com/org/repo.git',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('schema_version');
    }
  });

  it('should reject invalid repo_url format', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test',
        repo_url: 'invalid-url',
        default_branch: 'main',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should apply defaults for optional fields', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test',
        repo_url: 'https://github.com/org/repo.git',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project.default_branch).toBe('main');
      expect(result.data.runtime.max_concurrent_tasks).toBe(3);
      expect(result.data.safety.redact_secrets).toBe(true);
    }
  });

  it('should validate governance structure', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test',
        repo_url: 'https://github.com/org/repo.git',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
      governance: {
        approval_workflow: {
          require_approval_for_prd: true,
          require_approval_for_spec: true,
          require_approval_for_plan: true,
          require_approval_for_code: true,
          require_approval_for_pr: true,
          require_approval_for_deploy: true,
        },
        accountability: {
          record_approver_identity: true,
          require_approval_reason: false,
          audit_log_retention_days: 365,
        },
        risk_controls: {
          prevent_auto_merge: true,
          prevent_force_push: true,
          require_branch_protection: true,
          max_files_per_pr: 100,
          max_lines_changed_per_pr: 5000,
        },
        compliance_tags: ['SOC2'],
        governance_notes: 'Test notes',
      },
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should validate config_history entries', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test',
        repo_url: 'https://github.com/org/repo.git',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
      config_history: [
        {
          timestamp: '2025-12-15T10:00:00.000Z',
          schema_version: '1.0.0',
          changed_by: 'test-user',
          change_description: 'Initial config',
          migration_applied: false,
        },
      ],
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject invalid datetime in config_history', () => {
    const config = {
      schema_version: '1.0.0',
      project: {
        id: 'test',
        repo_url: 'https://github.com/org/repo.git',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
      config_history: [
        {
          timestamp: 'invalid-date',
          schema_version: '1.0.0',
          changed_by: 'test-user',
          change_description: 'Initial config',
          migration_applied: false,
        },
      ],
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('loadRepoConfig', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load valid config successfully', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config?.project.id).toBe('repo');
  });

  it('should return error for missing file', async () => {
    const result = await loadRepoConfig('/nonexistent/config.json');
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].path).toBe('file');
  });

  it('should return error for invalid JSON', async () => {
    fs.writeFileSync(configPath, '{ invalid json }');

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].path).toBe('json');
  });

  it('should return errors for invalid schema', async () => {
    const invalidConfig = {
      schema_version: 'invalid',
      project: {},
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig));

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should include warnings for missing credentials', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('GITHUB_TOKEN'))).toBe(true);
  });

  it('should apply environment overrides', async () => {
    const originalEnv = process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS;
    process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS = '7';

    const config = createDefaultConfig('https://github.com/org/repo.git');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(true);
    expect(result.config?.runtime.max_concurrent_tasks).toBe(7);

    // Cleanup
    if (originalEnv !== undefined) {
      process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS = originalEnv;
    } else {
      delete process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS;
    }
  });

  it('should generate helpful suggestions for errors', async () => {
    const invalidConfig = {
      schema_version: 'invalid',
      project: {
        id: '',
        repo_url: 'not-a-url',
      },
      github: { enabled: false },
      linear: { enabled: false },
      runtime: {},
      safety: {},
      feature_flags: {},
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig));

    const result = await loadRepoConfig(configPath);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();

    const schemaVersionError = result.errors!.find((e) => e.path.includes('schema_version'));
    expect(schemaVersionError?.suggestion).toContain('semver');

    const repoUrlError = result.errors!.find((e) => e.path.includes('repo_url'));
    expect(repoUrlError?.suggestion).toBeDefined();
  });
});

describe('createDefaultConfig', () => {
  it('should create valid default config', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');

    expect(config.schema_version).toBe('1.0.0');
    expect(config.project.id).toBe('repo');
    expect(config.project.repo_url).toBe('https://github.com/org/repo.git');
    expect(config.github.enabled).toBe(false);
    expect(config.linear.enabled).toBe(false);
  });

  it('should extract project id from repo URL', () => {
    const config1 = createDefaultConfig('https://github.com/org/my-project.git');
    expect(config1.project.id).toBe('my-project');

    const config2 = createDefaultConfig('git@github.com:org/another-repo.git');
    expect(config2.project.id).toBe('another-repo');
  });

  it('should include governance when requested', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: true,
    });

    expect(config.governance).toBeDefined();
    expect(config.governance?.approval_workflow).toBeDefined();
    expect(config.governance?.accountability).toBeDefined();
    expect(config.governance?.risk_controls).toBeDefined();
  });

  it('should omit governance when not requested', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: false,
    });

    expect(config.governance).toBeUndefined();
  });

  it('should include initial config_history entry', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      changedBy: 'test-user',
    });

    expect(config.config_history).toBeDefined();
    expect(config.config_history.length).toBe(1);
    expect(config.config_history[0].changed_by).toBe('test-user');
    expect(config.config_history[0].schema_version).toBe('1.0.0');
  });
});

describe('applyEnvironmentOverrides', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      CODEPIPE_GITHUB_TOKEN: process.env.CODEPIPE_GITHUB_TOKEN,
      CODEPIPE_LINEAR_API_KEY: process.env.CODEPIPE_LINEAR_API_KEY,
      CODEPIPE_RUNTIME_AGENT_ENDPOINT: process.env.CODEPIPE_RUNTIME_AGENT_ENDPOINT,
      CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS: process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS,
      CODEPIPE_RUNTIME_TIMEOUT_MINUTES: process.env.CODEPIPE_RUNTIME_TIMEOUT_MINUTES,
    };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  it('should override GitHub token env var', () => {
    process.env.CODEPIPE_GITHUB_TOKEN = 'test-token';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.github.token_env_var).toBe('CODEPIPE_GITHUB_TOKEN');
  });

  it('should override Linear API key env var', () => {
    process.env.CODEPIPE_LINEAR_API_KEY = 'test-key';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.linear.api_key_env_var).toBe('CODEPIPE_LINEAR_API_KEY');
  });

  it('should override agent endpoint', () => {
    process.env.CODEPIPE_RUNTIME_AGENT_ENDPOINT = 'https://agent.example.com';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.runtime.agent_endpoint).toBe('https://agent.example.com');
  });

  it('should override max concurrent tasks', () => {
    process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS = '5';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.runtime.max_concurrent_tasks).toBe(5);
  });

  it('should override timeout minutes', () => {
    process.env.CODEPIPE_RUNTIME_TIMEOUT_MINUTES = '60';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.runtime.timeout_minutes).toBe(60);
  });

  it('should handle invalid numeric env vars gracefully', () => {
    process.env.CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS = 'invalid';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    // Should keep original value when parsing fails
    expect(overridden.runtime.max_concurrent_tasks).toBe(config.runtime.max_concurrent_tasks);
  });

  it('should not modify config when no env vars set', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const overridden = applyEnvironmentOverrides(config);

    expect(overridden.github.token_env_var).toBe('GITHUB_TOKEN');
    expect(overridden.linear.api_key_env_var).toBe('LINEAR_API_KEY');
    expect(overridden.runtime.agent_endpoint).toBeUndefined();
  });
});

describe('formatValidationErrors', () => {
  it('should format errors with suggestions', () => {
    const errors: ValidationError[] = [
      {
        path: 'schema_version',
        message: 'Invalid format',
        suggestion: 'Use semver format: "1.0.0"',
      },
      {
        path: 'project.repo_url',
        message: 'Invalid URL',
      },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted).toContain('schema_version: Invalid format');
    expect(formatted).toContain('Use semver format: "1.0.0"');
    expect(formatted).toContain('project.repo_url: Invalid URL');
    expect(formatted).toContain('docs/reference/config/RepoConfig_schema.md');
  });

  it('should handle empty errors array', () => {
    const formatted = formatValidationErrors([]);
    expect(formatted).toContain('Configuration validation failed');
  });
});

describe('addConfigHistoryEntry', () => {
  it('should add history entry with timestamp', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const initialLength = config.config_history.length;

    const updated = addConfigHistoryEntry(config, {
      schema_version: '1.1.0',
      changed_by: 'test-user',
      change_description: 'Test migration',
      migration_applied: true,
    });

    expect(updated.config_history.length).toBe(initialLength + 1);
    const newEntry = updated.config_history[updated.config_history.length - 1];
    expect(newEntry.schema_version).toBe('1.1.0');
    expect(newEntry.changed_by).toBe('test-user');
    expect(newEntry.timestamp).toBeDefined();
    expect(new Date(newEntry.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('should not mutate original config', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const originalLength = config.config_history.length;

    addConfigHistoryEntry(config, {
      schema_version: '1.1.0',
      changed_by: 'test-user',
      change_description: 'Test migration',
      migration_applied: true,
    });

    expect(config.config_history.length).toBe(originalLength);
  });
});

describe('Env var name validation (CDMCH-214)', () => {
  const minimalConfig = (overrides: Record<string, unknown>) => ({
    schema_version: '1.0.0',
    project: { id: 'test', repo_url: 'https://github.com/org/repo.git' },
    github: { enabled: false },
    linear: { enabled: false },
    runtime: {},
    safety: {},
    feature_flags: {},
    ...overrides,
  });

  it('should accept valid uppercase env var names', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({
        github: { enabled: true, token_env_var: 'MY_GITHUB_TOKEN' },
        linear: { enabled: false, api_key_env_var: 'MY_LINEAR_KEY' },
        runtime: { agent_endpoint_env_var: 'MY_AGENT_ENDPOINT' },
      })
    );
    expect(result.success).toBe(true);
  });

  it('should reject lowercase env var names', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ github: { enabled: true, token_env_var: 'github_token' } })
    );
    expect(result.success).toBe(false);
  });

  it('should reject env var names with special characters', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ linear: { enabled: false, api_key_env_var: 'KEY-NAME' } })
    );
    expect(result.success).toBe(false);
  });

  it('should reject env var names starting with a digit', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ runtime: { agent_endpoint_env_var: '9AGENT' } })
    );
    expect(result.success).toBe(false);
  });

  it('should accept env var names with digits after first char', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ github: { enabled: true, token_env_var: 'TOKEN_V2' } })
    );
    expect(result.success).toBe(true);
  });

  it('should reject invalid env var names in env_allowlist', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ execution: { env_allowlist: ['VALID_KEY', 'bad-key'] } })
    );
    expect(result.success).toBe(false);
  });

  it('should reject invalid env var names in env_credential_keys', () => {
    const result = RepoConfigSchema.safeParse(
      minimalConfig({ execution: { env_credential_keys: ['lowercase_key'] } })
    );
    expect(result.success).toBe(false);
  });
});

describe('GitHub API version (CDMCH-209)', () => {
  const minimalConfig = (githubOverrides: Record<string, unknown> = {}) => ({
    schema_version: '1.0.0',
    project: { id: 'test', repo_url: 'https://github.com/org/repo.git' },
    github: { enabled: false, ...githubOverrides },
    linear: { enabled: false },
    runtime: {},
    safety: {},
    feature_flags: {},
  });

  it('should default api_version to 2022-11-28', () => {
    const result = RepoConfigSchema.safeParse(minimalConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github.api_version).toBe(DEFAULT_GITHUB_API_VERSION);
    }
  });

  it('should accept a valid custom api_version', () => {
    const result = RepoConfigSchema.safeParse(minimalConfig({ api_version: '2024-01-15' }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github.api_version).toBe('2024-01-15');
    }
  });

  it('should reject an invalid api_version format', () => {
    const result = RepoConfigSchema.safeParse(minimalConfig({ api_version: 'latest' }));
    expect(result.success).toBe(false);
  });

  it('should reject api_version values with out-of-range month/day', () => {
    const result = RepoConfigSchema.safeParse(minimalConfig({ api_version: '2024-99-99' }));
    expect(result.success).toBe(false);
  });
});

describe('Edge Cases', () => {
  it('should handle SSH repo URLs', () => {
    const config = createDefaultConfig('git@github.com:org/repo.git');
    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should handle HTTPS repo URLs', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should validate constraints within bounds', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.constraints = {
      max_file_size_kb: 100, // minimum
      max_context_files: 1000, // maximum
      rate_limits: {
        github_requests_per_hour: 1,
        linear_requests_per_minute: 1,
        agent_requests_per_hour: 1,
      },
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject constraints out of bounds', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.constraints = {
      max_file_size_kb: 50000, // exceeds max
      max_context_files: 100,
    };

    const result = RepoConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
