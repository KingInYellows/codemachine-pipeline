/**
 * Shared telemetry flush helpers for CLI commands.
 *
 * Eliminates the 15-20 line success/error flush boilerplate repeated
 * across every CLI command's try/catch block.
 */

import { StandardMetrics } from '../../telemetry/metrics';
import { SpanStatusCode } from '../../telemetry/traces';
import { ensureTelemetryReferences } from './runDirectory';
import type { StructuredLogger } from '../../telemetry/logger';
import type { MetricsCollector } from '../../telemetry/metrics';
import type { TraceManager, ActiveSpan } from '../../telemetry/traces';

export interface TelemetryResources {
  /** CLI command name used for metrics labels (e.g., 'plan', 'pr.create') */
  commandName: string;
  startTime: number;
  logger?: StructuredLogger | undefined;
  metrics?: MetricsCollector | undefined;
  traceManager?: TraceManager | undefined;
  commandSpan?: ActiveSpan | undefined;
  /** Run directory path for ensureTelemetryReferences */
  runDirPath?: string | undefined;
}

/**
 * Flush telemetry after a successful command execution.
 *
 * Records metrics, ends the command span with OK status, flushes traces,
 * and flushes the logger.
 *
 * Any extra span attributes (e.g., pr_number) must be set on commandSpan
 * BEFORE calling this function.
 */
export async function flushTelemetrySuccess(
  res: TelemetryResources,
  extraLogFields?: Record<string, unknown>
): Promise<void> {
  const { commandName, startTime, logger, metrics, traceManager, commandSpan, runDirPath } = res;
  const duration = Date.now() - startTime;

  if (metrics) {
    metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
      command: commandName,
    });
    metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
      command: commandName,
      exit_code: '0',
    });
    await metrics.flush();
  }

  if (commandSpan) {
    commandSpan.setAttribute('exit_code', 0);
    commandSpan.end({ code: SpanStatusCode.OK });
  }

  if (traceManager) {
    await traceManager.flush();
  }

  if (runDirPath) {
    await ensureTelemetryReferences(runDirPath);
  }

  if (logger) {
    logger.info(`${commandName} command completed`, {
      duration_ms: duration,
      ...extraLogFields,
    });
    await logger.flush();
  }
}

/**
 * Flush telemetry after a failed command execution.
 *
 * Records error metrics, ends the command span with ERROR status, flushes
 * traces, and flushes the logger.
 */
export async function flushTelemetryError(res: TelemetryResources, error: unknown): Promise<void> {
  const { commandName, startTime, logger, metrics, traceManager, commandSpan, runDirPath } = res;
  const duration = Date.now() - startTime;

  if (metrics) {
    metrics.observe(StandardMetrics.COMMAND_EXECUTION_DURATION_MS, duration, {
      command: commandName,
    });
    metrics.increment(StandardMetrics.COMMAND_INVOCATIONS_TOTAL, {
      command: commandName,
      exit_code: '1',
    });
    await metrics.flush();
  }

  if (commandSpan) {
    commandSpan.setAttribute('exit_code', 1);
    commandSpan.setAttribute('error', true);
    if (error instanceof Error) {
      commandSpan.setAttribute('error.message', error.message);
      commandSpan.setAttribute('error.name', error.name);
    }
    commandSpan.end({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'unknown error',
    });
  }

  if (traceManager) {
    await traceManager.flush();
  }

  if (runDirPath) {
    await ensureTelemetryReferences(runDirPath);
  }

  if (logger) {
    if (error instanceof Error) {
      logger.error(`${commandName} command failed`, {
        error: error.message,
        stack: error.stack,
        duration_ms: duration,
      });
    }
    await logger.flush();
  }
}
