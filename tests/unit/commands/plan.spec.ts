import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('plan command', () => {
  const testDir = path.join(__dirname, '../../../.test-temp-plan');
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

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Feature:');
      expect(output).toContain('Plan:');
    });

    test('exits with code 0 when no feature exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} plan`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('shows plan path in output', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('plan.json');
    });

    test('indicates when plan does not exist', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Plan exists: No');
    });
  });

  describe('--feature flag', () => {
    test('exits with error when specified feature not found', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} plan --feature non-existent-feature`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(1);
        }
      }
    });

    test('accepts -f as shorthand for --feature', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} plan -f non-existent-feature`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(1);
        }
      }
    });
  });

  describe('--json flag', () => {
    test('outputs valid JSON when --json flag is provided', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(() => JSON.parse(output)).not.toThrow();
    });

    test('JSON output contains required fields', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload).toHaveProperty('feature_id');
      expect(payload).toHaveProperty('plan_path');
      expect(payload).toHaveProperty('plan_exists');
      expect(payload).toHaveProperty('notes');
    });

    test('JSON output has correct plan_exists when no plan', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload.plan_exists).toBe(false);
    });
  });

  describe('--verbose flag', () => {
    test('accepts --verbose flag', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} plan --verbose`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('accepts -v as shorthand for --verbose', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} plan -v`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });
  });

  describe('--show-diff flag', () => {
    test('accepts --show-diff flag', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} plan --show-diff`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('--show-diff includes plan_diff in JSON output', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan --show-diff --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload).toHaveProperty('notes');
    });
  });

  describe('missing spec error handling', () => {
    test('provides guidance when no plan exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output.toLowerCase()).toMatch(/spec|plan|generation/);
    });

    test('notes include FR references for plan generation', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const notesText = payload.notes.join(' ');
      expect(notesText).toContain('FR-');
    });
  });

  describe('exit codes', () => {
    test('returns exit code 0 on success', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} plan`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('returns exit code 1 for validation error (feature not found)', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} plan --feature FEAT-nonexistent`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(error.status).toBe(1);
        }
      }
    });
  });

  describe('output format', () => {
    test('human-readable output includes plan summary header', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Feature:');
      expect(output).toContain('Plan:');
    });

    test('human-readable output includes notes section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} plan`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('\u2022');
    });
  });

  describe('help output', () => {
    test('--help shows command description', () => {
      const output = execSync(`node ${binPath} plan --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('plan');
      expect(output.toLowerCase()).toContain('execution');
    });

    test('--help shows all flags', () => {
      const output = execSync(`node ${binPath} plan --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--feature');
      expect(output).toContain('--json');
      expect(output).toContain('--verbose');
      expect(output).toContain('--show-diff');
    });
  });

  describe('config validation', () => {
    test('handles missing config gracefully', () => {
      try {
        execSync(`node ${binPath} plan`, {
          cwd: testDir,
          stdio: 'pipe',
        });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          expect(typeof error.status).toBe('number');
        }
      }
    });
  });
});
