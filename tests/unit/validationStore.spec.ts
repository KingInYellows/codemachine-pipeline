import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  REGISTRY_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSION,
  saveValidationLedger,
  saveValidationRegistry,
  type ValidationLedger,
  type ValidationRegistry,
} from '../../src/workflows/validationStore.js';

describe('validationStore', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('tightens permissions on a pre-existing validation directory when saving the registry', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validation-store-registry-'));
    cleanupDirs.push(runDir);

    const validationDir = path.join(runDir, 'validation');
    await fs.mkdir(validationDir, { recursive: true });

    if (process.platform !== 'win32') {
      await fs.chmod(validationDir, 0o777);
    }

    const registry: ValidationRegistry = {
      schema_version: REGISTRY_SCHEMA_VERSION,
      feature_id: 'feature-test',
      commands: [],
    };

    await saveValidationRegistry(runDir, registry);

    if (process.platform === 'win32') {
      return;
    }

    const stats = await fs.stat(validationDir);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it('tightens permissions on a pre-existing validation directory when saving the ledger', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validation-store-ledger-'));
    cleanupDirs.push(runDir);

    const validationDir = path.join(runDir, 'validation');
    await fs.mkdir(validationDir, { recursive: true });

    if (process.platform !== 'win32') {
      await fs.chmod(validationDir, 0o777);
    }

    const ledger: ValidationLedger = {
      schema_version: LEDGER_SCHEMA_VERSION,
      feature_id: 'feature-test',
      attempts: [],
      summary: {
        total_attempts: 0,
        successful_attempts: 0,
        failed_attempts: 0,
        auto_fix_successes: 0,
        last_updated: new Date().toISOString(),
      },
    };

    await saveValidationLedger(runDir, ledger);

    if (process.platform === 'win32') {
      return;
    }

    const stats = await fs.stat(validationDir);
    expect(stats.mode & 0o777).toBe(0o700);
  });
});
