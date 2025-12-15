import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  createDefaultConfig,
  loadRepoConfig,
  formatValidationErrors,
  type RepoConfig,
} from '../core/config/repo_config.js';

/**
 * Init command - Initialize ai-feature-pipeline in the current repository
 * Implements FR-1: Initialize RepoConfig with git detection and directory setup
 * Implements FR-17: Schema-backed configuration with credentials validation
 */
export default class Init extends Command {
  static description = 'Initialize ai-feature-pipeline with schema-validated configuration';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --validate-only',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force re-initialization even if config already exists',
      default: false,
    }),
    'validate-only': Flags.boolean({
      description: 'Only validate existing config without creating new files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    try {
      // Step 1: Detect git repository root
      const gitRoot = this.findGitRoot();
      const pipelineDir = path.join(gitRoot, '.ai-feature-pipeline');
      const configPath = path.join(pipelineDir, 'config.json');

      // Validate-only mode
      if (flags['validate-only']) {
        this.log('Validating existing configuration...');
        this.validateExistingConfig(configPath);
        return;
      }

      this.log(`✓ Git repository detected at: ${gitRoot}`);

      // Step 2: Check if already initialized
      if (fs.existsSync(configPath) && !flags.force) {
        this.warn(`Configuration already exists at: ${configPath}`);
        this.warn('Use --force to re-initialize or --validate-only to check configuration');

        // Validate existing config
        const result = loadRepoConfig(configPath);
        if (!result.success) {
          this.log('\nExisting configuration has validation errors:');
          this.log(formatValidationErrors(result.errors!));
          process.exit(10);
        }

        if (result.warnings && result.warnings.length > 0) {
          this.log('\nWarnings:');
          for (const warning of result.warnings) {
            this.warn(warning);
          }
        }

        this.log('\n✓ Configuration is valid');
        return;
      }

      // Step 3: Create directory structure
      this.createDirectoryStructure(pipelineDir);

      // Step 4: Get repository URL for config
      const repoUrl = this.getRepositoryUrl(gitRoot);

      // Step 5: Create schema-backed configuration
      const config = createDefaultConfig(repoUrl);
      this.writeConfiguration(configPath, config, flags.force);

      // Step 6: Validate the created configuration
      const validationResult = loadRepoConfig(configPath);
      if (!validationResult.success) {
        this.log('\n❌ Configuration validation failed after creation:\n');
        this.log(formatValidationErrors(validationResult.errors!));
        process.exit(10);
      }

      // Step 7: Display warnings about missing credentials
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        this.log('\n⚠ Configuration created with warnings:');
        for (const warning of validationResult.warnings) {
          this.warn(warning);
        }
        this.log('');
      }

      // Success message
      this.log('');
      this.log('✓ ai-feature-pipeline initialized successfully!');
      this.log('');
      this.log('Configuration file: ' + configPath);
      this.log('');
      this.log('Next steps:');
      this.log('  1. Review and edit: .ai-feature-pipeline/config.json');
      this.log('  2. Enable integrations (github/linear) and set credentials:');
      this.log('     export GITHUB_TOKEN=<your-token>');
      this.log('     export LINEAR_API_KEY=<your-key>');
      this.log('     export AGENT_ENDPOINT=<agent-service-url>');
      this.log('  3. Validate configuration: ai-feature init --validate-only');
      this.log('  4. Start a feature: ai-feature start --prompt "your feature description"');
      this.log('');
    } catch (error) {
      // Re-throw oclif errors to preserve exit codes
      if (error && typeof error === 'object' && 'oclif' in error) {
        throw error;
      }

      if (error instanceof Error) {
        this.error(`Initialization failed: ${error.message}`, { exit: 1 });
      } else {
        this.error('Initialization failed with an unknown error', { exit: 1 });
      }
    }
  }

  /**
   * Find git repository root by walking up directory tree
   * @returns Absolute path to git repository root
   * @throws Error if not in a git repository
   */
  private findGitRoot(): string {
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (!gitRoot) {
        throw new Error('Could not determine git repository root');
      }

      return gitRoot;
    } catch {
      throw new Error(
        'Not a git repository. Please run this command from within a git repository.'
      );
    }
  }

  /**
   * Get repository URL from git config
   * @param gitRoot Git repository root path
   * @returns Repository URL or placeholder
   */
  private getRepositoryUrl(gitRoot: string): string {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: gitRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      return remoteUrl || 'https://github.com/org/repo.git';
    } catch {
      // No remote configured, use placeholder
      return 'https://github.com/org/repo.git';
    }
  }

  /**
   * Create directory structure for pipeline
   * @param pipelineDir Base pipeline directory path
   */
  private createDirectoryStructure(pipelineDir: string): void {
    const directories = [
      pipelineDir,
      path.join(pipelineDir, 'runs'),
      path.join(pipelineDir, 'logs'),
      path.join(pipelineDir, 'artifacts'),
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.log(`✓ Created directory: ${dir}`);
      }
    }
  }

  /**
   * Write configuration to file with schema validation
   * @param configPath Path to config.json
   * @param config Configuration object
   * @param force Whether to overwrite existing config
   */
  private writeConfiguration(configPath: string, config: RepoConfig, force: boolean): void {
    if (fs.existsSync(configPath) && !force) {
      throw new Error('Configuration file already exists. Use --force to overwrite.');
    }

    // Write with pretty formatting
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.log(`✓ Created configuration file: ${configPath}`);
  }

  /**
   * Validate existing configuration and display results
   * @param configPath Path to config.json
   */
  private validateExistingConfig(configPath: string): void {
    if (!fs.existsSync(configPath)) {
      this.log(`\n❌ Configuration file not found: ${configPath}\n`);
      this.log('Run "ai-feature init" first to create configuration.\n');
      process.exit(10);
    }

    const result = loadRepoConfig(configPath);

    if (!result.success) {
      this.log('\n❌ Configuration validation failed:\n');
      this.log(formatValidationErrors(result.errors!));
      process.exit(10);
    }

    this.log('✓ Configuration is valid');

    if (result.warnings && result.warnings.length > 0) {
      this.log('\n⚠ Warnings:');
      for (const warning of result.warnings) {
        this.warn(warning);
      }
      this.log('\nNote: Warnings do not prevent operation but may affect functionality.');
    }

    // Display configuration summary
    if (result.config) {
      this.log('\nConfiguration Summary:');
      this.log(`  Schema Version: ${result.config.schema_version}`);
      this.log(`  Project ID: ${result.config.project.id}`);
      this.log(`  Default Branch: ${result.config.project.default_branch}`);
      this.log(`  GitHub Integration: ${result.config.github.enabled ? 'enabled' : 'disabled'}`);
      this.log(`  Linear Integration: ${result.config.linear.enabled ? 'enabled' : 'disabled'}`);
      this.log(`  Context Token Budget: ${result.config.runtime.context_token_budget}`);
      this.log(`  Max Concurrent Tasks: ${result.config.runtime.max_concurrent_tasks}`);
      this.log('');
    }
  }
}
