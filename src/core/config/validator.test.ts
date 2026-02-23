/**
 * Test suite for validator module
 * Tests comprehensive validation, environment checks, and governance enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateRepoConfig,
  validateEnvironmentVariables,
  checkSchemaCompatibility,
  formatExtendedValidationResult,
} from './validator';
import { createDefaultConfig } from './RepoConfig';

describe('validateRepoConfig', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should validate config with all checks disabled', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      checkCredentials: false,
      checkDirectories: false,
      enforceGovernance: false,
      checkPermissions: false,
    });

    expect(result.success).toBe(true);
    expect(result.checks).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('should return metadata about validation', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath);

    expect(result.metadata).toBeDefined();
    expect(result.metadata!.validation_time_ms).toBeGreaterThanOrEqual(0);
    expect(result.metadata!.config_file_size_bytes).toBeGreaterThan(0);
  });

  it('should fail when config file missing', async () => {
    const result = await validateRepoConfig('/nonexistent/config.json');

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('should check directories when enabled', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.runtime.run_directory = '/nonexistent/directory';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      checkDirectories: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.path.includes('run_directory'))).toBe(true);
  });

  it('should pass directory checks when directory exists', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const runDir = path.join(tempDir, 'runs');
    fs.mkdirSync(runDir, { recursive: true });
    config.runtime.run_directory = runDir;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      checkDirectories: true,
    });

    expect(result.success).toBe(true);
  });

  it('should enforce governance when enabled', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: false, // No governance section
    });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      enforceGovernance: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.path === 'governance')).toBe(true);
  });

  it('should pass governance checks with valid governance', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: true,
    });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      enforceGovernance: true,
      checkCredentials: false,
      checkDirectories: false,
    });

    expect(result.success).toBe(true);
  });

  it('should fail governance when all approvals disabled', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: true,
    });
    // Disable all approval gates
    config.governance!.approval_workflow = {
      require_approval_for_prd: false,
      require_approval_for_spec: false,
      require_approval_for_plan: false,
      require_approval_for_code: false,
      require_approval_for_pr: false,
      require_approval_for_deploy: false,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      enforceGovernance: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.message.includes('All approval gates are disabled'))).toBe(
      true
    );
  });

  it('should warn about disabled security controls', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: true,
    });
    config.governance!.risk_controls.prevent_force_push = false;
    config.governance!.risk_controls.prevent_auto_merge = false;
    config.governance!.accountability.record_approver_identity = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      enforceGovernance: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should fail in strict mode with warnings', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = true; // This will generate warning about missing GITHUB_TOKEN
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      strictMode: true,
    });

    expect(result.success).toBe(false);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
  });

  it('should pass in non-strict mode with warnings', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = true;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      strictMode: false,
      checkCredentials: false,
      checkDirectories: false,
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
  });
});

describe('validateEnvironmentVariables', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      LINEAR_API_KEY: process.env.LINEAR_API_KEY,
      AGENT_ENDPOINT: process.env.AGENT_ENDPOINT,
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

  it('should detect missing GitHub token', () => {
    delete process.env.GITHUB_TOKEN;
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = true;

    const result = validateEnvironmentVariables(config);

    expect(result.GITHUB_TOKEN).toBeDefined();
    expect(result.GITHUB_TOKEN.required).toBe(true);
    expect(result.GITHUB_TOKEN.present).toBe(false);
  });

  it('should detect present GitHub token', () => {
    process.env.GITHUB_TOKEN = 'test-token';
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = true;

    const result = validateEnvironmentVariables(config);

    expect(result.GITHUB_TOKEN).toBeDefined();
    expect(result.GITHUB_TOKEN.required).toBe(true);
    expect(result.GITHUB_TOKEN.present).toBe(true);
    expect(result.GITHUB_TOKEN.value).toBe('***REDACTED***');
  });

  it('should detect missing Linear API key', () => {
    delete process.env.LINEAR_API_KEY;
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.linear.enabled = true;

    const result = validateEnvironmentVariables(config);

    expect(result.LINEAR_API_KEY).toBeDefined();
    expect(result.LINEAR_API_KEY.required).toBe(true);
    expect(result.LINEAR_API_KEY.present).toBe(false);
  });

  it('should detect agent endpoint from env', () => {
    process.env.AGENT_ENDPOINT = 'https://agent.example.com';
    const config = createDefaultConfig('https://github.com/org/repo.git');

    const result = validateEnvironmentVariables(config);

    expect(result.AGENT_ENDPOINT).toBeDefined();
    expect(result.AGENT_ENDPOINT.present).toBe(true);
    expect(result.AGENT_ENDPOINT.value).toBe('***REDACTED***');
  });

  it('should detect agent endpoint from config', () => {
    delete process.env.AGENT_ENDPOINT;
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.runtime.agent_endpoint = 'https://config-endpoint.example.com';

    const result = validateEnvironmentVariables(config);

    expect(result.AGENT_ENDPOINT).toBeDefined();
    expect(result.AGENT_ENDPOINT.present).toBe(true);
    expect(result.AGENT_ENDPOINT.value).toBe('***REDACTED***');
  });

  it('should not require credentials for disabled integrations', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.github.enabled = false;
    config.linear.enabled = false;

    const result = validateEnvironmentVariables(config);

    // Should only have AGENT_ENDPOINT since integrations disabled
    expect(Object.keys(result).length).toBe(1);
    expect(result.AGENT_ENDPOINT).toBeDefined();
  });
});

describe('checkSchemaCompatibility', () => {
  it('should mark same version as compatible', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = checkSchemaCompatibility(config, '1.0.0');

    expect(result.compatible).toBe(true);
    expect(result.current_version).toBe('1.0.0');
    expect(result.target_version).toBe('1.0.0');
    expect(result.breaking_changes).toHaveLength(0);
  });

  it('should detect major version changes', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = checkSchemaCompatibility(config, '2.0.0');

    expect(result.compatible).toBe(false);
    expect(result.breaking_changes.length).toBeGreaterThan(0);
    expect(result.migration_notes.length).toBeGreaterThan(0);
  });

  it('should mark minor version changes as compatible', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = checkSchemaCompatibility(config, '1.1.0');

    expect(result.compatible).toBe(true);
    expect(result.breaking_changes).toHaveLength(0);
  });

  it('should suggest migration for deprecated fields', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: false, // Don't include governance
    });
    config.governance_notes = 'Old governance notes'; // Add deprecated field
    const result = checkSchemaCompatibility(config, '1.1.0');

    expect(result.migration_notes.some((note) => note.includes('governance_notes'))).toBe(true);
  });

  describe('deprecated field detection', () => {
    const testCases = [
      {
        field: 'require_approval_for_prd',
        newPath: 'governance.approval_workflow.require_approval_for_prd',
      },
      {
        field: 'require_approval_for_plan',
        newPath: 'governance.approval_workflow.require_approval_for_plan',
      },
      {
        field: 'require_approval_for_pr',
        newPath: 'governance.approval_workflow.require_approval_for_pr',
      },
      {
        field: 'prevent_force_push',
        newPath: 'governance.risk_controls.prevent_force_push',
      },
    ];

    it.each(testCases)(
      'should detect safety.$field and suggest migration',
      ({ field, newPath }) => {
        const config = createDefaultConfig('https://github.com/org/repo.git');
        const rawConfig = {
          schema_version: '1.0.0',
          safety: {
            [field]: true,
          },
        };
        const result = checkSchemaCompatibility(config, '1.1.0', rawConfig);

        expect(
          result.migration_notes.some(
            (note) => note.includes(`safety.${field}`) && note.includes(newPath)
          )
        ).toBe(true);
      }
    );

    it('should detect governance_notes at root and suggest migration', () => {
      const config = createDefaultConfig('https://github.com/org/repo.git', {
        includeGovernance: false,
      });
      config.governance_notes = 'Some governance notes';
      const result = checkSchemaCompatibility(config, '1.1.0');

      expect(
        result.migration_notes.some(
          (note) =>
            note.includes('governance_notes') && note.includes('governance.governance_notes')
        )
      ).toBe(true);
    });

    it('should detect multiple deprecated fields and list all migrations', () => {
      const config = createDefaultConfig('https://github.com/org/repo.git', {
        includeGovernance: false,
      });
      config.governance_notes = 'Notes';
      const rawConfig = {
        schema_version: '1.0.0',
        safety: {
          require_approval_for_prd: true,
          require_approval_for_plan: true,
          prevent_force_push: true,
        },
        governance_notes: 'Notes',
      };
      const result = checkSchemaCompatibility(config, '1.1.0', rawConfig);

      // Should have migration notes for each deprecated field
      expect(result.migration_notes.length).toBeGreaterThanOrEqual(4);
      expect(result.migration_notes.some((n) => n.includes('require_approval_for_prd'))).toBe(true);
      expect(result.migration_notes.some((n) => n.includes('require_approval_for_plan'))).toBe(
        true
      );
      expect(result.migration_notes.some((n) => n.includes('prevent_force_push'))).toBe(true);
      expect(result.migration_notes.some((n) => n.includes('governance_notes'))).toBe(true);
    });

    it('should not add migration notes when deprecated fields are not set', () => {
      const config = createDefaultConfig('https://github.com/org/repo.git', {
        includeGovernance: true,
      });
      // Don't explicitly set deprecated fields in raw config
      const rawConfig = {
        schema_version: '1.0.0',
        safety: {}, // Empty safety object - no deprecated fields explicitly set
      };
      const result = checkSchemaCompatibility(config, '1.1.0', rawConfig);

      // Should not have migration notes for safety.* fields since they weren't explicitly set
      expect(result.migration_notes.some((n) => n.includes('require_approval_for_prd'))).toBe(
        false
      );
      expect(result.migration_notes.some((n) => n.includes('require_approval_for_plan'))).toBe(
        false
      );
      expect(result.migration_notes.some((n) => n.includes('require_approval_for_pr'))).toBe(false);
      expect(result.migration_notes.some((n) => n.includes('prevent_force_push'))).toBe(false);
      // When governance is included and no root governance_notes, no migration needed for that
      expect(result.migration_notes.some((n) => n.includes('governance_notes'))).toBe(false);
    });
  });

  it('should include migration documentation reference', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = checkSchemaCompatibility(config, '2.0.0');

    expect(result.migration_notes.some((note) => note.includes('config_migrations.md'))).toBe(true);
  });

  it('should recommend backup for major upgrades', () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    const result = checkSchemaCompatibility(config, '2.0.0');

    expect(result.migration_notes.some((note) => note.includes('backup'))).toBe(true);
  });
});

describe('formatExtendedValidationResult', () => {
  it('should format successful validation', () => {
    const result = {
      success: true,
      config: createDefaultConfig('https://github.com/org/repo.git'),
      checks: {
        credentials: true,
        directories: true,
        governance: true,
        permissions: true,
      },
      metadata: {
        validation_time_ms: 42,
        config_file_size_bytes: 2048,
      },
    };

    const formatted = formatExtendedValidationResult(result);
    expect(formatted).toContain('✓ Configuration validation passed');
    expect(formatted).toContain('Credentials:  ✓');
    expect(formatted).toContain('42ms');
    expect(formatted).toContain('2048 bytes');
  });

  it('should format failed validation', () => {
    const result = {
      success: false,
      errors: [
        {
          path: 'test.field',
          message: 'Test error',
          suggestion: 'Fix the field',
        },
      ],
      checks: {
        credentials: false,
        directories: false,
        governance: false,
        permissions: false,
      },
      metadata: {
        validation_time_ms: 10,
        config_file_size_bytes: 100,
      },
    };

    const formatted = formatExtendedValidationResult(result);
    expect(formatted).toContain('✗ Configuration validation failed');
    expect(formatted).toContain('test.field: Test error');
    expect(formatted).toContain('Fix the field');
  });

  it('should format warnings', () => {
    const result = {
      success: true,
      config: createDefaultConfig('https://github.com/org/repo.git'),
      warnings: ['Warning 1', 'Warning 2'],
      checks: {
        credentials: true,
        directories: true,
        governance: false,
        permissions: false,
      },
      metadata: {
        validation_time_ms: 5,
        config_file_size_bytes: 500,
      },
    };

    const formatted = formatExtendedValidationResult(result);
    expect(formatted).toContain('Warnings:');
    expect(formatted).toContain('Warning 1');
    expect(formatted).toContain('Warning 2');
  });

  it('should show which checks were performed', () => {
    const result = {
      success: true,
      config: createDefaultConfig('https://github.com/org/repo.git'),
      checks: {
        credentials: true,
        directories: false,
        governance: true,
        permissions: false,
      },
      metadata: {
        validation_time_ms: 1,
        config_file_size_bytes: 1,
      },
    };

    const formatted = formatExtendedValidationResult(result);
    expect(formatted).toContain('Credentials:  ✓');
    expect(formatted).toContain('Directories:  ○');
    expect(formatted).toContain('Governance:   ✓');
    expect(formatted).toContain('Permissions:  ○');
  });
});

describe('Integration Tests', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-integration-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should perform full validation with all checks', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git', {
      includeGovernance: true,
    });

    // Create run directory
    const runDir = path.join(tempDir, 'runs');
    fs.mkdirSync(runDir, { recursive: true });
    config.runtime.run_directory = runDir;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      checkCredentials: true,
      checkDirectories: true,
      enforceGovernance: true,
      checkPermissions: true,
      strictMode: false,
    });

    expect(result.success).toBe(true);
    expect(result.checks?.credentials).toBe(true);
    expect(result.checks?.directories).toBe(true);
    expect(result.checks?.governance).toBe(true);
    expect(result.checks?.permissions).toBe(true);
  });

  it('should provide actionable errors for common issues', async () => {
    const config = createDefaultConfig('https://github.com/org/repo.git');
    config.runtime.run_directory = '/nonexistent/path';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateRepoConfig(configPath, {
      checkDirectories: true,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();

    const dirError = result.errors!.find((e) => e.path.includes('run_directory'));
    expect(dirError).toBeDefined();
    expect(dirError!.suggestion).toContain('mkdir');
  });
});
