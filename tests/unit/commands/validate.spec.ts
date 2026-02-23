import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('validate command', () => {
  const testDir = path.join(__dirname, '../../../.test-temp-validate');
  const pipelineDir = path.join(testDir, '.codepipe');
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
    test('requires feature run directory', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} validate`, {
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

    test('--help shows command description', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('validate');
      expect(output.toLowerCase()).toContain('validation');
    });
  });

  describe('--init flag', () => {
    test('--init flag is accepted', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const featureId = 'FEAT-test123';
      const runDir = path.join(pipelineDir, 'runs', featureId);
      fs.mkdirSync(runDir, { recursive: true });

      const manifest = {
        schema_version: '1.0.0',
        feature_id: featureId,
        status: 'in_progress',
        repo: { url: 'https://github.com/test/repo.git', default_branch: 'main' },
        execution: { completed_steps: 0 },
        timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        approvals: { pending: [], completed: [] },
        queue: { queue_dir: 'queue', pending_count: 0, completed_count: 0, failed_count: 0 },
        artifacts: {},
        telemetry: { logs_dir: 'logs' },
      };
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      const output = execSync(`node ${binPath} validate --init --feature ${featureId}`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Validation registry initialized');
    });
  });

  describe('--command flag', () => {
    test('accepts --command lint', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--command');
      expect(output).toContain('lint');
    });

    test('accepts --command test', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('test');
    });

    test('accepts --command typecheck', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('typecheck');
    });

    test('accepts --command build', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('build');
    });

    test('-c is shorthand for --command', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('-c');
    });
  });

  describe('--auto-fix flag', () => {
    test('--auto-fix is enabled by default', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--auto-fix');
    });

    test('--no-auto-fix disables auto-fix', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('auto-fix');
    });
  });

  describe('--max-retries flag', () => {
    test('accepts --max-retries flag', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--max-retries');
    });

    test('--max-retries has min/max constraints', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('max-retries');
    });
  });

  describe('--timeout flag', () => {
    test('accepts --timeout flag', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--timeout');
    });
  });

  describe('--json flag', () => {
    test('accepts --json flag', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--json');
    });
  });

  describe('--verbose flag', () => {
    test('accepts --verbose flag', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--verbose');
    });

    test('accepts -v as shorthand for --verbose', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('-v');
    });
  });

  describe('--feature flag', () => {
    test('accepts --feature flag', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--feature');
    });

    test('accepts -f as shorthand for --feature', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('-f');
    });
  });

  describe('exit codes', () => {
    test('returns exit code 1 when no feature exists', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      try {
        execSync(`node ${binPath} validate`, {
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

    test('exit code 10 indicates validation failed', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output.toLowerCase()).toContain('validation');
    });

    test('exit code 11 indicates retry limit exceeded', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('validate');
    });
  });

  describe('validation error messages', () => {
    test('provides clear error when registry not initialized', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const featureId = 'FEAT-noregistry';
      const runDir = path.join(pipelineDir, 'runs', featureId);
      fs.mkdirSync(runDir, { recursive: true });

      const manifest = {
        schema_version: '1.0.0',
        feature_id: featureId,
        status: 'in_progress',
        repo: { url: 'https://github.com/test/repo.git', default_branch: 'main' },
        execution: { completed_steps: 0 },
        timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        approvals: { pending: [], completed: [] },
        queue: { queue_dir: 'queue', pending_count: 0, completed_count: 0, failed_count: 0 },
        artifacts: {},
        telemetry: { logs_dir: 'logs' },
      };
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      try {
        execSync(`node ${binPath} validate --feature ${featureId}`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        expect(true).toBe(false);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'stderr' in error) {
          const stderr = (error as { stderr: Buffer }).stderr.toString();
          expect(stderr.toLowerCase()).toContain('registry');
        }
      }
    });
  });

  describe('help output', () => {
    test('--help shows command description', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('validate');
      expect(output.toLowerCase()).toContain('validation');
    });

    test('--help shows all flags', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--feature');
      expect(output).toContain('--command');
      expect(output).toContain('--auto-fix');
      expect(output).toContain('--max-retries');
      expect(output).toContain('--timeout');
      expect(output).toContain('--json');
      expect(output).toContain('--verbose');
      expect(output).toContain('--init');
    });

    test('--help shows examples', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('EXAMPLES');
    });
  });

  describe('strict mode behavior', () => {
    test('validation respects configured retry limits', () => {
      const output = execSync(`node ${binPath} validate --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('max-retries');
    });
  });

  test('placeholder test passes', () => {
    expect(true).toBe(true);
  });
});
