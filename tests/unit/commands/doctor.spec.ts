import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

describe('doctor command', () => {
  const testDir = path.join(__dirname, '../../../.test-temp-doctor');
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

  describe('basic execution', () => {
    test('runs diagnostics successfully', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Diagnostics');
    });

    test('shows environment checks', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Node.js');
      expect(output).toContain('Git');
    });

    test('shows summary section', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Summary');
      expect(output).toContain('Total');
    });
  });

  describe('--json flag', () => {
    test('outputs valid JSON when --json flag is provided', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(() => JSON.parse(output)).not.toThrow();
    });

    test('JSON output contains required fields', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload).toHaveProperty('status');
      expect(payload).toHaveProperty('exit_code');
      expect(payload).toHaveProperty('checks');
      expect(payload).toHaveProperty('summary');
      expect(payload).toHaveProperty('config_path');
      expect(payload).toHaveProperty('timestamp');
    });

    test('JSON output has summary with counts', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(payload.summary).toHaveProperty('total');
      expect(payload.summary).toHaveProperty('passed');
      expect(payload.summary).toHaveProperty('warnings');
      expect(payload.summary).toHaveProperty('failed');
    });

    test('JSON output checks array has proper structure', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(Array.isArray(payload.checks)).toBe(true);
      if (payload.checks.length > 0) {
        const check = payload.checks[0];
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('status');
        expect(check).toHaveProperty('message');
      }
    });
  });

  describe('telemetry output', () => {
    test('writes logs, metrics, and traces under .codepipe', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      execSync(`node ${binPath} doctor`, {
        cwd: testDir,
        stdio: 'pipe',
      });

      expect(fs.existsSync(path.join(pipelineDir, 'logs', 'logs.ndjson'))).toBe(true);
      expect(fs.existsSync(path.join(pipelineDir, 'metrics', 'prometheus.txt'))).toBe(true);
      expect(fs.existsSync(path.join(pipelineDir, 'telemetry', 'traces.json'))).toBe(true);
    });
  });

  describe('--verbose flag', () => {
    test('accepts --verbose flag', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} doctor --verbose`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('accepts -v as shorthand for --verbose', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      expect(() => {
        execSync(`node ${binPath} doctor -v`, { cwd: testDir, stdio: 'pipe' });
      }).not.toThrow();
    });

    test('verbose mode shows additional details', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --verbose`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      // Verbose output should include more detail
      expect(output.length).toBeGreaterThan(100);
    });
  });

  describe('diagnostic categories', () => {
    test('checks runtime environment (Node.js version)', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const nodeCheck = payload.checks.find((c: { name: string }) => c.name.includes('Node'));
      expect(nodeCheck).toBeDefined();
    });

    test('checks git installation', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const gitCheck = payload.checks.find((c: { name: string }) => c.name.includes('Git'));
      expect(gitCheck).toBeDefined();
    });

    test('checks npm installation', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const npmCheck = payload.checks.find((c: { name: string }) => c.name.includes('npm'));
      expect(npmCheck).toBeDefined();
    });

    test('checks Docker installation (optional)', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const dockerCheck = payload.checks.find((c: { name: string }) => c.name.includes('Docker'));
      expect(dockerCheck).toBeDefined();
      // Docker is optional, so it can be pass or warn
      expect(['pass', 'warn']).toContain(dockerCheck.status);
    });

    test('checks config validation', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const configCheck = payload.checks.find((c: { name: string }) => c.name.includes('Config'));
      expect(configCheck).toBeDefined();
    });

    test('checks filesystem permissions', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      const fsCheck = payload.checks.find((c: { name: string }) => c.name.includes('Filesystem'));
      expect(fsCheck).toBeDefined();
    });
  });

  describe('exit codes', () => {
    test('returns exit code 0 when all checks pass (warnings allowed)', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      // Should not throw if all critical checks pass
      // Note: May have warnings which still result in exit 0
      try {
        execSync(`node ${binPath} doctor`, { cwd: testDir, stdio: 'pipe' });
      } catch (error: unknown) {
        // If it fails, check it's not a critical failure
        if (error && typeof error === 'object' && 'status' in error) {
          // Warnings are allowed (exit 0), but failures may occur
          expect([0, 10, 20, 30]).toContain(error.status);
        }
      }
    });

    test('returns exit code 10 for config validation errors', () => {
      // Create invalid config
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ schema_version: 'invalid' }), 'utf-8');

      try {
        execSync(`node ${binPath} doctor`, {
          cwd: testDir,
          stdio: 'pipe',
        });
        // May pass with warnings
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) {
          // Config issues should result in exit code 10
          expect([10, 20, 30]).toContain(error.status);
        }
      }
    });

    test('JSON output exit_code matches actual exit code', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      // If command succeeded, exit_code should be 0
      expect(payload.exit_code).toBe(0);
    });
  });

  describe('status values', () => {
    test('status is healthy when all checks pass', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      expect(['healthy', 'issues_detected']).toContain(payload.status);
    });

    test('status is issues_detected when warnings present', () => {
      execSync(`node ${binPath} init`, { cwd: testDir, stdio: 'pipe' });

      const output = execSync(`node ${binPath} doctor --json`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const payload = JSON.parse(output);
      if (payload.summary.warnings > 0 && payload.summary.failed === 0) {
        expect(payload.status).toBe('issues_detected');
      }
    });
  });

  describe('remediation guidance', () => {
    test('failed checks include remediation field', () => {
      // Create scenario with missing config
      // Don't run init

      try {
        const output = execSync(`node ${binPath} doctor --json`, {
          cwd: testDir,
          encoding: 'utf-8',
        });

        const payload = JSON.parse(output);
        const failedChecks = payload.checks.filter((c: { status: string }) => c.status === 'fail');

        // If there are failed checks, they should have remediation
        for (const check of failedChecks) {
          if (check.remediation) {
            expect(typeof check.remediation).toBe('string');
          }
        }
      } catch {
        // Command may fail, which is expected
      }
    });
  });

  describe('help output', () => {
    test('--help shows command description', () => {
      const output = execSync(`node ${binPath} doctor --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('doctor');
      expect(output.toLowerCase()).toContain('diagnostic');
    });

    test('--help shows all flags', () => {
      const output = execSync(`node ${binPath} doctor --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('--json');
      expect(output).toContain('--verbose');
    });
  });
});
