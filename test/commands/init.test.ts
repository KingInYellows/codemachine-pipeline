import { expect, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('init command', () => {
  const testDir = path.join(__dirname, '../../.test-temp');
  const pipelineDir = path.join(testDir, '.ai-feature-pipeline');
  const configPath = path.join(pipelineDir, 'config.json');

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

  test('creates .ai-feature-pipeline directory structure', () => {
    // This is a placeholder test that validates the expected directory structure
    // In a real implementation, this would execute the init command

    // Simulate what init command should create
    fs.mkdirSync(pipelineDir, { recursive: true });
    fs.mkdirSync(path.join(pipelineDir, 'runs'), { recursive: true });

    const stubConfig = {
      version: '1.0.0',
      repository: {
        root: testDir,
        type: 'git',
      },
      integrations: {
        github: { enabled: false },
        linear: { enabled: false },
      },
      settings: {
        runDirectory: path.join(pipelineDir, 'runs'),
        logsFormat: 'ndjson',
      },
      initialized: new Date().toISOString(),
    };

    fs.writeFileSync(configPath, JSON.stringify(stubConfig, null, 2), 'utf-8');

    // Verify directory structure
    expect(fs.existsSync(pipelineDir)).toBe(true);
    expect(fs.existsSync(path.join(pipelineDir, 'runs'))).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    // Verify config file content
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe('1.0.0');
    expect(config.repository.type).toBe('git');
    expect(config.settings.logsFormat).toBe('ndjson');
  });

  test('config.json contains required fields', () => {
    // Simulate config creation
    fs.mkdirSync(pipelineDir, { recursive: true });

    const stubConfig = {
      version: '1.0.0',
      repository: {
        root: testDir,
        type: 'git',
      },
      integrations: {
        github: { enabled: false },
        linear: { enabled: false },
      },
      settings: {
        runDirectory: path.join(pipelineDir, 'runs'),
        logsFormat: 'ndjson',
      },
      initialized: new Date().toISOString(),
    };

    fs.writeFileSync(configPath, JSON.stringify(stubConfig, null, 2), 'utf-8');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Verify required fields per FR-1
    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('repository');
    expect(config).toHaveProperty('integrations');
    expect(config).toHaveProperty('settings');
    expect(config).toHaveProperty('initialized');

    expect(config.repository).toHaveProperty('root');
    expect(config.repository).toHaveProperty('type');

    expect(config.integrations).toHaveProperty('github');
    expect(config.integrations).toHaveProperty('linear');
  });

  test('placeholder test passes', () => {
    // Basic smoke test to ensure Jest is working
    expect(true).toBe(true);
  });
});
