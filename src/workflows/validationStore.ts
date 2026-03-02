/**
 * Validation Store
 *
 * Schemas, types, constants, and file I/O for validation artifacts
 * (commands registry and attempt ledger). Extracted from validationRegistry.ts.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ValidationCommandConfigSchema } from '../core/validation/validationCommandConfig';
import { readManifest } from '../persistence';

export const ValidationRegistrySchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  feature_id: z.string(),
  commands: z.array(ValidationCommandConfigSchema),
  metadata: z
    .object({
      updated_at: z.string().datetime(),
      config_hash: z.string().optional(),
    })
    .optional(),
});

export type ValidationRegistry = z.infer<typeof ValidationRegistrySchema>;

export const ValidationAttemptSchema = z.object({
  attempt_id: z.string(),
  command_type: z.enum(['lint', 'test', 'typecheck', 'build']),
  attempt_number: z.number().int().min(1),
  exit_code: z.number().int(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  duration_ms: z.number().int().nonnegative(),
  auto_fix_attempted: z.boolean().default(false),
  stdout_path: z.string().optional(),
  stderr_path: z.string().optional(),
  error_summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ValidationAttempt = z.infer<typeof ValidationAttemptSchema>;

export const ValidationLedgerSchema = z.object({
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  feature_id: z.string(),
  attempts: z.array(ValidationAttemptSchema),
  summary: z
    .object({
      total_attempts: z.number().int().nonnegative(),
      successful_attempts: z.number().int().nonnegative(),
      failed_attempts: z.number().int().nonnegative(),
      auto_fix_successes: z.number().int().nonnegative(),
      last_updated: z.string().datetime(),
    })
    .optional(),
});

export type ValidationLedger = z.infer<typeof ValidationLedgerSchema>;

export type {
  ValidationCommandType,
  ValidationCommandConfig,
} from '../core/validation/validationCommandConfig';

export interface ValidationResult {
  success: boolean;
  commandType: import('../core/validation/validationCommandConfig').ValidationCommandType;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  errorSummary?: string;
  attempt: ValidationAttempt;
}

export const REGISTRY_FILE_NAME = 'commands.json';
export const LEDGER_FILE_NAME = 'ledger.json';
export const VALIDATION_DIR_NAME = 'validation';
export const REGISTRY_SCHEMA_VERSION = '1.0.0';
export const LEDGER_SCHEMA_VERSION = '1.0.0';

function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export async function loadValidationRegistry(
  runDir: string
): Promise<ValidationRegistry | undefined> {
  const registryPath = join(runDir, VALIDATION_DIR_NAME, REGISTRY_FILE_NAME);

  try {
    const content = await readFile(registryPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = ValidationRegistrySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid registry schema: ${result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      );
    }

    return result.data;
  } catch (error) {
    if (isErrnoError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function saveValidationRegistry(
  runDir: string,
  registry: ValidationRegistry
): Promise<void> {
  const validationDir = join(runDir, VALIDATION_DIR_NAME);
  const registryPath = join(validationDir, REGISTRY_FILE_NAME);
  const tempPath = `${registryPath}.tmp.${randomBytes(8).toString('hex')}`;

  try {
    await mkdir(validationDir, { recursive: true });
    await writeFile(tempPath, JSON.stringify(registry, null, 2), 'utf-8');
    await rename(tempPath, registryPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export async function loadValidationLedger(runDir: string): Promise<ValidationLedger> {
  const ledgerPath = join(runDir, VALIDATION_DIR_NAME, LEDGER_FILE_NAME);

  try {
    const content = await readFile(ledgerPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = ValidationLedgerSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid ledger schema: ${result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      );
    }

    return result.data;
  } catch (error) {
    if (isErrnoError(error) && error.code === 'ENOENT') {
      const manifest = await readManifest(runDir);
      return {
        schema_version: LEDGER_SCHEMA_VERSION,
        feature_id: manifest.feature_id,
        attempts: [],
        summary: {
          total_attempts: 0,
          successful_attempts: 0,
          failed_attempts: 0,
          auto_fix_successes: 0,
          last_updated: new Date().toISOString(),
        },
      };
    }
    throw error;
  }
}

export async function saveValidationLedger(
  runDir: string,
  ledger: ValidationLedger
): Promise<void> {
  const validationDir = join(runDir, VALIDATION_DIR_NAME);
  const ledgerPath = join(validationDir, LEDGER_FILE_NAME);
  const tempPath = `${ledgerPath}.tmp.${randomBytes(8).toString('hex')}`;

  try {
    await mkdir(validationDir, { recursive: true });
    await writeFile(tempPath, JSON.stringify(ledger, null, 2), 'utf-8');
    await rename(tempPath, ledgerPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
