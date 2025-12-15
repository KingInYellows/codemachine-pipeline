import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Init command - Initialize ai-feature-pipeline in the current repository
 * Implements FR-1: Initialize RepoConfig with git detection and directory setup
 */
export default class Init extends Command {
  static description = 'Initialize ai-feature-pipeline in the current git repository';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --force',
  ];

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force re-initialization even if config already exists',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    try {
      // Step 1: Detect git repository root
      const gitRoot = this.findGitRoot();
      this.log(`✓ Git repository detected at: ${gitRoot}`);

      // Step 2: Create .ai-feature-pipeline directory
      const pipelineDir = path.join(gitRoot, '.ai-feature-pipeline');

      if (fs.existsSync(pipelineDir) && !flags.force) {
        this.warn(`Pipeline directory already exists at: ${pipelineDir}`);
        this.warn('Use --force to re-initialize');
        return;
      }

      if (!fs.existsSync(pipelineDir)) {
        fs.mkdirSync(pipelineDir, { recursive: true });
        this.log(`✓ Created pipeline directory: ${pipelineDir}`);
      } else {
        this.log(`✓ Pipeline directory exists: ${pipelineDir}`);
      }

      // Step 3: Create stub configuration file
      const configPath = path.join(pipelineDir, 'config.json');
      const stubConfig = {
        version: '1.0.0',
        repository: {
          root: gitRoot,
          type: 'git',
        },
        integrations: {
          github: {
            enabled: false,
            // API configuration placeholder
          },
          linear: {
            enabled: false,
            // API configuration placeholder
          },
        },
        settings: {
          runDirectory: path.join(pipelineDir, 'runs'),
          logsFormat: 'ndjson',
        },
        initialized: new Date().toISOString(),
      };

      fs.writeFileSync(configPath, JSON.stringify(stubConfig, null, 2), 'utf-8');
      this.log(`✓ Created configuration file: ${configPath}`);

      // Step 4: Create runs directory
      const runsDir = path.join(pipelineDir, 'runs');
      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
        this.log(`✓ Created runs directory: ${runsDir}`);
      }

      // Success message
      this.log('');
      this.log('✓ ai-feature-pipeline initialized successfully!');
      this.log('');
      this.log('Next steps:');
      this.log('  1. Configure integrations in .ai-feature-pipeline/config.json');
      this.log('  2. Run: ai-feature start --prompt "your feature description"');
      this.log('  3. Check status: ai-feature status <feature_id>');
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Initialization failed: ${error.message}`);
      } else {
        this.error('Initialization failed with an unknown error');
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
}
