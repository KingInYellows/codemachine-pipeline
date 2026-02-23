import type { ExecutionTask } from '../core/models/ExecutionTask.js';
import type { ExecutionConfig } from '../core/config/RepoConfig.js';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy.js';
import { CodeMachineCLIAdapter, type AvailabilityResult } from '../adapters/codemachine/index.js';
import type { StructuredLogger } from '../telemetry/logger.js';
import { CodeMachineEngineTypeSchema } from './codemachineTypes.js';
import { shouldUseNativeEngine } from './taskMapper.js';
import { normalizeResult } from './resultNormalizer.js';

export interface CodeMachineCLIStrategyOptions {
  config: ExecutionConfig;
  logger?: StructuredLogger | undefined;
}

/**
 * Execution strategy that delegates to CodeMachine-CLI via the adapter bridge.
 *
 * Named 'codemachine-cli' (distinct from the old 'codemachine' strategy).
 * Registered BEFORE the old strategy in start/resume commands so it takes
 * priority when the binary is available (first-match-wins in canHandle() iteration).
 * Call checkAvailability() at registration time to flip the isAvailable flag.
 */
export class CodeMachineCLIStrategy implements ExecutionStrategy {
  readonly name = 'codemachine-cli';

  private readonly adapter: CodeMachineCLIAdapter;
  private readonly config: ExecutionConfig;
  private readonly logger: StructuredLogger | undefined;
  private isAvailable = false;

  constructor(options: CodeMachineCLIStrategyOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.adapter = new CodeMachineCLIAdapter({
      config: options.config,
      logger: options.logger,
    });
  }

  canHandle(task: ExecutionTask): boolean {
    // Must be available AND the task type must not require native engine handling.
    // This mirrors the old CodeMachineStrategy filter so that task types like
    // 'testing' and 'deployment' (which use native engines) are not intercepted.
    return this.isAvailable && !shouldUseNativeEngine(task.task_type);
  }

  /**
   * Check binary availability. Call once at registration time and cache result.
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    const result = await this.adapter.validateAvailability();
    this.isAvailable = result.available;

    if (result.available) {
      this.logger?.info('CodeMachine-CLI strategy available', {
        version: result.version,
        source: result.source,
        binaryPath: result.binaryPath,
      });
    } else {
      this.logger?.debug('CodeMachine-CLI strategy not available', {
        error: result.error,
      });
    }

    return result;
  }

  async execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult> {
    const startTime = Date.now();

    this.logger?.debug('Executing task via CodeMachine-CLI', {
      taskId: task.task_id,
      taskType: task.task_type,
    });

    // Validate engine is supported by CodeMachine-CLI
    const engine = this.config.default_engine;
    const engineCheck = CodeMachineEngineTypeSchema.safeParse(engine);
    if (!engineCheck.success) {
      return {
        success: false,
        status: 'failed',
        summary: `Engine '${engine}' is not supported by CodeMachine-CLI`,
        errorMessage: `Unsupported engine: '${engine}'. Supported: ${CodeMachineEngineTypeSchema.options.join(', ')}`,
        recoverable: false,
        durationMs: 0,
        artifacts: [],
      };
    }

    const prompt = (task.config?.prompt as string | undefined) ?? task.title;
    const args = ['run', engine, prompt];

    // Build credentials from configured keys
    const credentials: Record<string, string> = {};
    for (const key of this.config.env_credential_keys ?? []) {
      const value = process.env[key];
      if (value) {
        credentials[key] = value;
      }
    }

    const executeOptions: Parameters<CodeMachineCLIAdapter['execute']>[1] = {
      workspaceDir: context.workspaceDir,
      timeoutMs: context.timeoutMs,
      runDir: context.runDir,
      taskId: task.task_id,
    };
    if (Object.keys(credentials).length > 0) {
      executeOptions.credentials = credentials;
    }

    const result = await this.adapter.execute(args, executeOptions);
    const normalized = normalizeResult({ ...result, taskId: task.task_id }, this.logger);
    const durationMs = result.durationMs ?? Date.now() - startTime;

    const strategyResult: ExecutionStrategyResult = {
      success: normalized.success,
      status: normalized.status,
      summary: normalized.success
        ? normalized.redactedStdout.slice(0, 500)
        : normalized.redactedStderr.slice(0, 500),
      recoverable: normalized.recoverable,
      durationMs,
      artifacts: normalized.artifacts,
    };

    if (!normalized.success) {
      strategyResult.errorMessage = normalized.redactedStderr || `Exit code ${result.exitCode}`;
    }

    return strategyResult;
  }

  /** Expose adapter for direct use (e.g., doctor command). */
  getAdapter(): CodeMachineCLIAdapter {
    return this.adapter;
  }
}

export function createCodeMachineCLIStrategy(
  options: CodeMachineCLIStrategyOptions
): CodeMachineCLIStrategy {
  return new CodeMachineCLIStrategy(options);
}
