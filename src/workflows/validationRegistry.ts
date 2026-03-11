import { createHash, randomBytes } from 'node:crypto';
import type { RepoConfig } from '../core/config/RepoConfig';
import {
  DEFAULT_VALIDATION_COMMANDS,
  type ValidationCommandConfig,
  type ValidationCommandType,
} from '../core/validation/validationCommandConfig';
import type { StructuredLogger } from '../telemetry/logger';
import { withLock, readManifest } from '../persistence';
import {
  REGISTRY_SCHEMA_VERSION,
  loadValidationRegistry,
  saveValidationRegistry,
  loadValidationLedger,
  saveValidationLedger,
  type ValidationRegistry,
  type ValidationLedger,
  type ValidationAttempt,
} from './validationStore.js';

/**
 * Validation Command Registry
 *
 * Manages validation commands (lint, test, typecheck, build) for feature pipelines.
 * Delegates file I/O to validationStore.ts, focusing on orchestration.
 *
 * Features:
 * - Configuration-driven command templates
 * - Retry/backoff policy enforcement
 * - Error summarization and audit trails
 *
 * Used by: AutoFixEngine, validate CLI command, execution engine
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

    const commands = loadCommandsFromConfig(config);
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

    await saveValidationRegistry(runDir, registry);

    logger?.info('Validation registry initialized', {
      feature_id: featureId,
      command_count: commands.length,
      config_hash: configHash,
    });

    return registry;
  });
}

export async function getValidationCommand(
  runDir: string,
  commandType: ValidationCommandType
): Promise<ValidationCommandConfig | undefined> {
  const registry = await loadValidationRegistry(runDir);
  if (!registry) return undefined;
  return registry.commands.find((cmd) => cmd.type === commandType);
}

export async function getRequiredCommands(runDir: string): Promise<ValidationCommandConfig[]> {
  const registry = await loadValidationRegistry(runDir);
  if (!registry) return [];
  return registry.commands.filter((cmd) => cmd.required);
}

export async function recordValidationAttempt(
  runDir: string,
  attempt: ValidationAttempt,
  logger?: StructuredLogger
): Promise<void> {
  return withLock(runDir, async () => {
    const ledger = await loadValidationLedger(runDir);

    ledger.attempts.push(attempt);
    ledger.summary = {
      total_attempts: ledger.attempts.length,
      successful_attempts: ledger.attempts.filter((a) => a.exit_code === 0).length,
      failed_attempts: ledger.attempts.filter((a) => a.exit_code !== 0).length,
      auto_fix_successes: ledger.attempts.filter((a) => a.auto_fix_attempted && a.exit_code === 0)
        .length,
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

export async function getAttemptCount(
  runDir: string,
  commandType: ValidationCommandType
): Promise<number> {
  const attempts = await getValidationAttempts(runDir, commandType);
  return attempts.length;
}

export async function hasExceededRetryLimit(
  runDir: string,
  commandType: ValidationCommandType
): Promise<boolean> {
  const command = await getValidationCommand(runDir, commandType);
  if (!command) return false;
  const attempts = await getValidationAttempts(runDir, commandType);
  return attempts.length >= command.max_retries + 1;
}

export async function getValidationSummary(runDir: string): Promise<ValidationLedger['summary']> {
  const ledger = await loadValidationLedger(runDir);
  return ledger.summary;
}

export function generateAttemptId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `${timestamp}-${random}`;
}

export function summarizeError(stderr: string, maxLines = 20): string {
  const lines = stderr.split('\n').filter((line) => line.trim().length > 0);

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

  return [
    ...relevantLines.slice(0, maxLines - 1),
    `... (${relevantLines.length - maxLines + 1} more lines)`,
  ].join('\n');
}

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

function computeCommandsHash(commands: ValidationCommandConfig[]): string {
  const normalized = JSON.stringify(commands, Object.keys(commands).sort());
  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
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
  if (!globalTemplate && !localTemplate) return undefined;
  return { ...(globalTemplate ?? {}), ...(localTemplate ?? {}) };
}
