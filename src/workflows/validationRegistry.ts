import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import type { RepoConfig } from '../core/config/RepoConfig';
import {
  DEFAULT_VALIDATION_COMMANDS,
  ValidationCommandConfigSchema,
  type ValidationCommandConfig,
  type ValidationCommandType,
} from '../core/validation/validationCommandConfig';
import type { StructuredLogger } from '../telemetry/logger';
import { withLock, readManifest } from '../persistence/runDirectoryManager';

export type { ValidationCommandType, ValidationCommandConfig } from '../core/validation/validationCommandConfig';

/**
 * Validation Command Registry
 *
 * Manages validation commands (lint, test, typecheck, build) for feature pipelines.
 * Provides atomic operations for registering, executing, and tracking validation attempts.
 *
 * Implements:
 * - ADR-7: Validation auto-fix loop with bounded retries
 * - FR-14: Deterministic validation execution and logging
 * - Configuration-driven command templates
 * - Retry/backoff policy enforcement
 * - Error summarization and audit trails
 *
 * Used by: AutoFixEngine, validate CLI command, execution engine
 */

// ============================================================================
// Types & Schema
// ============================================================================

/**
 * Validation registry file schema
 */
export const ValidationRegistrySchema = z.object({
  /** Schema version */
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  /** Feature ID */
  feature_id: z.string(),
  /** Registered commands */
  commands: z.array(ValidationCommandConfigSchema),
  /** Metadata */
  metadata: z
    .object({
      updated_at: z.string().datetime(),
      config_hash: z.string().optional(),
    })
    .optional(),
});

export type ValidationRegistry = z.infer<typeof ValidationRegistrySchema>;

/**
 * Validation attempt record schema
 */
export const ValidationAttemptSchema = z.object({
  /** Attempt ID (ULID-compatible) */
  attempt_id: z.string(),
  /** Command type */
  command_type: z.enum(['lint', 'test', 'typecheck', 'build']),
  /** Attempt number (1-indexed) */
  attempt_number: z.number().int().min(1),
  /** Exit code */
  exit_code: z.number().int(),
  /** Execution start timestamp */
  started_at: z.string().datetime(),
  /** Execution end timestamp */
  completed_at: z.string().datetime(),
  /** Duration in milliseconds */
  duration_ms: z.number().int().nonnegative(),
  /** Whether auto-fix was attempted */
  auto_fix_attempted: z.boolean().default(false),
  /** stdout path (relative to run directory) */
  stdout_path: z.string().optional(),
  /** stderr path (relative to run directory) */
  stderr_path: z.string().optional(),
  /** Error summary (extracted from stderr) */
  error_summary: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export type ValidationAttempt = z.infer<typeof ValidationAttemptSchema>;

/**
 * Validation ledger schema (tracks all attempts)
 */
export const ValidationLedgerSchema = z.object({
  /** Schema version */
  schema_version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  /** Feature ID */
  feature_id: z.string(),
  /** All validation attempts */
  attempts: z.array(ValidationAttemptSchema),
  /** Summary statistics */
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

/**
 * Validation command execution result
 */
export interface ValidationResult {
  /** Whether validation passed */
  success: boolean;
  /** Command type */
  commandType: ValidationCommandType;
  /** Exit code */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** stdout output */
  stdout: string;
  /** stderr output */
  stderr: string;
  /** Error summary (if failed) */
  errorSummary?: string;
  /** Attempt record */
  attempt: ValidationAttempt;
}

// ============================================================================
// Constants
// ============================================================================

const REGISTRY_FILE_NAME = 'commands.json';
const LEDGER_FILE_NAME = 'ledger.json';
const VALIDATION_DIR_NAME = 'validation';
const REGISTRY_SCHEMA_VERSION = '1.0.0';
const LEDGER_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Validation Registry Operations
// ============================================================================

/**
 * Initialize validation registry for a run directory
 *
 * Loads commands from RepoConfig or uses defaults, then persists to run directory.
 *
 * @param runDir - Run directory path
 * @param config - Repository configuration
 * @param logger - Structured logger instance
 */
export async function initializeValidationRegistry(
  runDir: string,
  config: RepoConfig,
  logger?: StructuredLogger
): Promise<ValidationRegistry> {
  return withLock(runDir, async () => {
    const manifest = await readManifest(runDir);
    const featureId = manifest.feature_id;

    logger?.info('Initializing validation registry', { feature_id: featureId });

    // Load commands from config or use defaults
    const commands = loadCommandsFromConfig(config);

    // Compute config hash for change detection
    const configHash = computeCommandsHash(commands);

    const registry: ValidationRegistry = {
      schema_version: REGISTRY_SCHEMA_VERSION,
      feature_id: featureId,
      commands,
      metadata: {
        updated_at: new Date().toISOString(),
        config_hash: configHash,
      },
    };

    // Persist registry
    await saveValidationRegistry(runDir, registry);

    logger?.info('Validation registry initialized', {
      feature_id: featureId,
      command_count: commands.length,
      config_hash: configHash,
    });

    return registry;
  });
}

/**
 * Load validation registry from run directory
 *
 * @param runDir - Run directory path
 * @returns Validation registry or undefined if not initialized
 */
export async function loadValidationRegistry(runDir: string): Promise<ValidationRegistry | undefined> {
  const registryPath = path.join(runDir, VALIDATION_DIR_NAME, REGISTRY_FILE_NAME);

  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = ValidationRegistrySchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid registry schema: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      );
    }

    return result.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Get validation command configuration by type
 *
 * @param runDir - Run directory path
 * @param commandType - Command type to retrieve
 * @returns Command configuration or undefined if not found
 */
export async function getValidationCommand(
  runDir: string,
  commandType: ValidationCommandType
): Promise<ValidationCommandConfig | undefined> {
  const registry = await loadValidationRegistry(runDir);
  if (!registry) {
    return undefined;
  }

  return registry.commands.find((cmd) => cmd.type === commandType);
}

/**
 * Get all required validation commands
 *
 * @param runDir - Run directory path
 * @returns Array of required command configurations
 */
export async function getRequiredCommands(runDir: string): Promise<ValidationCommandConfig[]> {
  const registry = await loadValidationRegistry(runDir);
  if (!registry) {
    return [];
  }

  return registry.commands.filter((cmd) => cmd.required);
}

/**
 * Record a validation attempt
 *
 * Appends attempt to ledger and updates summary statistics.
 *
 * @param runDir - Run directory path
 * @param attempt - Validation attempt record
 * @param logger - Structured logger instance
 */
export async function recordValidationAttempt(
  runDir: string,
  attempt: ValidationAttempt,
  logger?: StructuredLogger
): Promise<void> {
  return withLock(runDir, async () => {
    const ledger = await loadValidationLedger(runDir);

    // Append attempt
    ledger.attempts.push(attempt);

    // Update summary
    ledger.summary = {
      total_attempts: ledger.attempts.length,
      successful_attempts: ledger.attempts.filter((a) => a.exit_code === 0).length,
      failed_attempts: ledger.attempts.filter((a) => a.exit_code !== 0).length,
      auto_fix_successes: ledger.attempts.filter((a) => a.auto_fix_attempted && a.exit_code === 0).length,
      last_updated: new Date().toISOString(),
    };

    await saveValidationLedger(runDir, ledger);

    logger?.info('Validation attempt recorded', {
      attempt_id: attempt.attempt_id,
      command_type: attempt.command_type,
      exit_code: attempt.exit_code,
      duration_ms: attempt.duration_ms,
      auto_fix_attempted: attempt.auto_fix_attempted,
    });
  });
}

/**
 * Get validation attempts for a specific command type
 *
 * @param runDir - Run directory path
 * @param commandType - Command type to filter by
 * @returns Array of validation attempts
 */
export async function getValidationAttempts(
  runDir: string,
  commandType?: ValidationCommandType
): Promise<ValidationAttempt[]> {
  const ledger = await loadValidationLedger(runDir);

  if (commandType) {
    return ledger.attempts.filter((a) => a.command_type === commandType);
  }

  return ledger.attempts;
}

/**
 * Get validation attempt count for a command type
 *
 * @param runDir - Run directory path
 * @param commandType - Command type
 * @returns Number of attempts
 */
export async function getAttemptCount(runDir: string, commandType: ValidationCommandType): Promise<number> {
  const attempts = await getValidationAttempts(runDir, commandType);
  return attempts.length;
}

/**
 * Check if validation command has exceeded retry limit
 *
 * @param runDir - Run directory path
 * @param commandType - Command type
 * @returns Whether retry limit has been exceeded
 */
export async function hasExceededRetryLimit(runDir: string, commandType: ValidationCommandType): Promise<boolean> {
  const command = await getValidationCommand(runDir, commandType);
  if (!command) {
    return false;
  }

  const attempts = await getValidationAttempts(runDir, commandType);
  return attempts.length >= command.max_retries + 1; // +1 for initial attempt
}

/**
 * Get validation summary for run directory
 *
 * @param runDir - Run directory path
 * @returns Validation ledger summary
 */
export async function getValidationSummary(runDir: string): Promise<ValidationLedger['summary']> {
  const ledger = await loadValidationLedger(runDir);
  return ledger.summary;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Load commands from RepoConfig or return defaults
 */
function loadCommandsFromConfig(config: RepoConfig): ValidationCommandConfig[] {
  const configured = config.validation?.commands ?? [];
  const globalTemplate = config.validation?.template_context;
  const commandsByType = new Map<ValidationCommandType, ValidationCommandConfig>();

  for (const command of configured) {
    commandsByType.set(command.type, mergeCommandDefinition(command, globalTemplate));
  }

  for (const fallback of DEFAULT_VALIDATION_COMMANDS) {
    if (!commandsByType.has(fallback.type)) {
      commandsByType.set(fallback.type, mergeCommandDefinition(fallback, globalTemplate));
    }
  }

  return Array.from(commandsByType.values());
}

/**
 * Compute hash of command configurations for change detection
 */
function computeCommandsHash(commands: ValidationCommandConfig[]): string {
  const normalized = JSON.stringify(commands, Object.keys(commands).sort());
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

function mergeCommandDefinition(
  command: ValidationCommandConfig,
  globalTemplate?: Record<string, string>
): ValidationCommandConfig {
  return {
    ...command,
    env: command.env ? { ...command.env } : undefined,
    template_context: mergeTemplateContext(globalTemplate, command.template_context),
  };
}

function mergeTemplateContext(
  globalTemplate?: Record<string, string>,
  localTemplate?: Record<string, string>
): Record<string, string> | undefined {
  if (!globalTemplate && !localTemplate) {
    return undefined;
  }

  return {
    ...(globalTemplate ?? {}),
    ...(localTemplate ?? {}),
  };
}

/**
 * Save validation registry to run directory
 */
async function saveValidationRegistry(runDir: string, registry: ValidationRegistry): Promise<void> {
  const validationDir = path.join(runDir, VALIDATION_DIR_NAME);
  const registryPath = path.join(validationDir, REGISTRY_FILE_NAME);
  const tempPath = `${registryPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

  try {
    // Ensure validation directory exists
    await fs.mkdir(validationDir, { recursive: true });

    // Write to temp file
    const content = JSON.stringify(registry, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await fs.rename(tempPath, registryPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Load validation ledger from run directory
 */
async function loadValidationLedger(runDir: string): Promise<ValidationLedger> {
  const ledgerPath = path.join(runDir, VALIDATION_DIR_NAME, LEDGER_FILE_NAME);

  try {
    const content = await fs.readFile(ledgerPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    const result = ValidationLedgerSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid ledger schema: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      );
    }

    return result.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist, create empty ledger
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

/**
 * Save validation ledger to run directory
 */
async function saveValidationLedger(runDir: string, ledger: ValidationLedger): Promise<void> {
  const validationDir = path.join(runDir, VALIDATION_DIR_NAME);
  const ledgerPath = path.join(validationDir, LEDGER_FILE_NAME);
  const tempPath = `${ledgerPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;

  try {
    // Ensure validation directory exists
    await fs.mkdir(validationDir, { recursive: true });

    // Write to temp file
    const content = JSON.stringify(ledger, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await fs.rename(tempPath, ledgerPath);
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Generate unique attempt ID (timestamp-based ULID-compatible)
 */
export function generateAttemptId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Summarize error output (extract actionable lines)
 *
 * @param stderr - stderr content
 * @param maxLines - Maximum lines to include
 * @returns Error summary
 */
export function summarizeError(stderr: string, maxLines = 20): string {
  const lines = stderr.split('\n').filter((line) => line.trim().length > 0);

  // Prioritize lines with error indicators
  const errorLines = lines.filter(
    (line) =>
      line.includes('error') ||
      line.includes('Error') ||
      line.includes('ERROR') ||
      line.includes('✖') ||
      line.includes('×') ||
      line.includes('failed')
  );

  const relevantLines = errorLines.length > 0 ? errorLines : lines;

  if (relevantLines.length <= maxLines) {
    return relevantLines.join('\n');
  }

  return [...relevantLines.slice(0, maxLines - 1), `... (${relevantLines.length - maxLines + 1} more lines)`].join(
    '\n'
  );
}
