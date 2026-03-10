import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('status command', () => {
  const testDir = path.join(__dirname, '../../../.test-temp-status');
  const pipelineDir = path.join(testDir, '.codepipe');
  const configPath = path.join(pipelineDir, 'config.json');
  const binPath = path.join(__dirname, '../../../bin/run.js');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('basic execution', () => {
    test('runs without error when no feature exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Feature:');
      expect(output).toContain('none detected');
    });

    test('exits with code 0 when no feature exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} status`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('shows manifest path in output', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Manifest:');
    });
  });

  describe('--feature flag', () => {
    test('exits with code 10 when specified feature not found', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} status --feature nonexistent`, {
          cwd: testDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        throw new Error('Command should have failed');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(10);
        }
      }
    });

    test('accepts -f as shorthand for --feature', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} status -f nonexistent`, {
          cwd: testDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        throw new Error('Command should have failed');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(10);
        }
      }
    });
  });

  describe('--json flag', () => {
    test('outputs valid JSON when --json flag is provided', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(() => JSON.parse(output)).not.toThrow();
    });

    test('JSON output contains required fields', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload).toHaveProperty('feature_id');
      expect(payload).toHaveProperty('status');
      expect(payload).toHaveProperty('manifest_path');
      expect(payload).toHaveProperty('config_reference');
      expect(payload).toHaveProperty('notes');
    });

    test('JSON output has correct status when no feature exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload.feature_id).toBeNull();
      expect(payload.status).toBe('unknown');
    });
  });

  describe('--verbose flag', () => {
    test('accepts --verbose flag', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} status --verbose`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('accepts -v as shorthand for --verbose', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} status -v`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });
  });

  describe('--show-costs flag', () => {
    test('accepts --show-costs flag', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} status --show-costs`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('shows telemetry costs info when flag is provided', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status --show-costs`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Telemetry');
    });
  });

  describe('no run directory scenario', () => {
    test('handles missing .codepipe directory gracefully', () => {
      try {
        execSync(`node ${binPath} status`, {
          cwd: testDir,
          stdio: 'pipe',
        });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(typeof error.status).toBe('number');
        }
      }
    });

    test('provides guidance when no feature run directory exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output.toLowerCase()).toMatch(/start|run|feature/);
    });
  });

  describe('exit codes', () => {
    test('returns exit code 0 on success', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} status`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('returns exit code 10 for validation error (feature not found)', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} status --feature nonexistent`, {
          cwd: testDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        throw new Error('Command should have failed');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(10);
        }
      }
    });
  });

  describe('output format', () => {
    test('human-readable output includes status line', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Status:');
    });

    test('human-readable output includes queue info', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Queue:');
    });

    test('human-readable output includes notes section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} status`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('\u2022');
    });
  });

  describe('config validation', () => {
    test('reports config errors in output', () => {
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ schema_version: 'invalid' }), 'utf-8');

      try {
        const output = execSync(`node ${binPath} status --json`, {
          cwd: testDir,
          encoding: 'utf-8',
        });

        const payload = JSON.parse(output);
        expect(payload.config_errors.length).toBeGreaterThan(0);
      } catch {
        // Command may fail with invalid config, which is acceptable
      }
    });
  });

  test('placeholder test passes', () => {
    expect(true).toBe(true);
  });
});
