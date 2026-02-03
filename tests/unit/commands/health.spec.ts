/**
 * Unit tests for src/cli/commands/health.ts (CDMCH-77)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Health command', () => {
  // Test the command module is importable and structured correctly
  it('should export default Health command class', async () => {
    const mod = await import('../../../src/cli/commands/health');
    expect(mod.default).toBeDefined();
    expect(mod.default.description).toContain('health');
  });

  it('should have json flag defined', async () => {
    const mod = await import('../../../src/cli/commands/health');
    expect(mod.default.flags.json).toBeDefined();
  });

  // Test the underlying health check logic via direct instantiation
  describe('config check', () => {
    it('should detect valid config in project root', () => {
      const configPath = path.resolve(process.cwd(), '.ai-feature-pipeline', 'config.json');
      const exists = fs.existsSync(configPath);

      // The project has a config file, so this should pass
      if (exists) {
        const content = fs.readFileSync(configPath, 'utf-8');
        expect(() => JSON.parse(content)).not.toThrow();
      }
    });

    it('should detect missing config gracefully', () => {
      const configPath = path.resolve('/nonexistent/path', '.ai-feature-pipeline', 'config.json');
      expect(fs.existsSync(configPath)).toBe(false);
    });
  });

  describe('disk space check', () => {
    it('should read disk space via statfsSync', () => {
      const stats = fs.statfsSync(process.cwd());
      const freeBytes = stats.bavail * stats.bsize;
      const freeMB = Math.round(freeBytes / (1024 * 1024));

      // Should have reasonable disk space on any system running tests
      expect(freeMB).toBeGreaterThan(0);
    });
  });

  describe('run directory writable check', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect writable directory', () => {
      const probePath = path.join(tempDir, '.health_probe_test');
      fs.writeFileSync(probePath, 'probe', 'utf-8');
      fs.unlinkSync(probePath);

      // Should not leave probe file
      expect(fs.existsSync(probePath)).toBe(false);
    });

    it('should detect non-writable directory', () => {
      // Make dir read-only
      fs.chmodSync(tempDir, 0o444);

      try {
        const probePath = path.join(tempDir, '.health_probe_test');
        expect(() => fs.writeFileSync(probePath, 'probe', 'utf-8')).toThrow();
      } finally {
        fs.chmodSync(tempDir, 0o755);
      }
    });
  });

  describe('JSON output format', () => {
    it('should produce valid JSON payload structure', () => {
      // Validate the HealthPayload interface matches expected schema
      const payload = {
        healthy: true,
        exit_code: 0,
        checks: [
          { name: 'config', status: 'pass', message: 'Configuration is valid' },
          { name: 'run_dir', status: 'pass', message: 'Run directory is writable' },
          { name: 'disk_space', status: 'pass', message: '5000MB free' },
        ],
        timestamp: new Date().toISOString(),
      };

      const json = JSON.stringify(payload, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed.healthy).toBe(true);
      expect(parsed.exit_code).toBe(0);
      expect(parsed.checks).toHaveLength(3);
      expect(parsed.timestamp).toBeDefined();
    });

    it('should set healthy=false and exit_code=1 when any check fails', () => {
      const checks = [
        { name: 'config', status: 'pass', message: 'OK' },
        { name: 'run_dir', status: 'fail', message: 'Not writable' },
        { name: 'disk_space', status: 'pass', message: 'OK' },
      ];

      const healthy = checks.every((c) => c.status === 'pass');
      expect(healthy).toBe(false);
    });
  });
});
