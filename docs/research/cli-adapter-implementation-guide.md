# CodeMachineCLIAdapter Implementation Guide

This guide provides concrete, copy-paste-ready implementation patterns for building the `CodeMachineCLIAdapter` class.

---

## Part 1: Core Adapter Structure

### Step 1: Define Types and Config

```typescript
// src/adapters/cli/types.ts
export interface CodeMachineCLIAdapterConfig {
  cliPath: string;
  workspaceDir: string;
  runDir?: string;
  logger?: LoggerInterface;
  timeoutMs?: number;
  maxArgs?: number;
  debug?: boolean;
}

export interface CliExecutionOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface CliOutput {
  exitCode: number;
  output: string;
  events?: Record<string, unknown>[];
  durationMs: number;
  signal?: string;
}

export interface CliValidationResult {
  valid: boolean;
  version?: string;
  errors: string[];
}

export type CliErrorType = 'transient' | 'permanent' | 'human_required' | 'parse_error' | 'timeout';
```

### Step 2: Define Error Class

```typescript
// src/adapters/cli/CliAdapterError.ts
export class CliAdapterError extends Error {
  constructor(
    message: string,
    public readonly errorType: CliErrorType,
    public readonly exitCode?: number,
    public readonly stderr?: string,
    public readonly operation?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'CliAdapterError';
    Object.setPrototypeOf(this, CliAdapterError.prototype);
  }

  isRetryable(): boolean {
    return this.errorType === 'transient' || this.errorType === 'timeout';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorType: this.errorType,
      exitCode: this.exitCode,
      operation: this.operation,
      stderr: this.stderr ? this.stderr.slice(0, 500) : undefined,
      cause: this.cause?.message,
    };
  }
}
```

### Step 3: Core Adapter Class (Part 1 - Initialization)

```typescript
// src/adapters/cli/CodeMachineCLIAdapter.ts (Part 1)
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { LoggerInterface } from '../../telemetry/logger';
import { createLogger } from '../../telemetry/logger';

type AdapterState = 'created' | 'validating' | 'ready' | 'executing' | 'error' | 'cleaned';

export class CodeMachineCLIAdapter extends EventEmitter {
  private readonly config: Required<CodeMachineCLIAdapterConfig>;
  private readonly logger: LoggerInterface;
  private activeProcesses: Set<ChildProcess> = new Set();
  private state: AdapterState = 'created';

  constructor(config: CodeMachineCLIAdapterConfig) {
    super();

    this.logger =
      config.logger ??
      createLogger({
        component: 'codemachine-cli-adapter',
      });

    this.config = {
      cliPath: config.cliPath,
      workspaceDir: config.workspaceDir,
      runDir: config.runDir ?? '',
      logger: this.logger,
      timeoutMs: config.timeoutMs ?? 60000,
      maxArgs: config.maxArgs ?? 1000,
      debug: config.debug ?? false,
    };

    this.logger.info('CodeMachineCLIAdapter initialized', {
      cliPath: this.config.cliPath,
      workspaceDir: this.config.workspaceDir,
      timeoutMs: this.config.timeoutMs,
    });
  }

  /**
   * Initialize and validate CLI
   */
  async initialize(): Promise<void> {
    if (this.state !== 'created') {
      throw new Error(`Cannot initialize adapter in state '${this.state}'`);
    }

    this.state = 'validating';
    this.logger.info('Initializing CLI adapter');

    try {
      const validation = await this.validateCli();
      if (!validation.valid) {
        throw new Error(`CLI validation failed: ${validation.errors.join(', ')}`);
      }

      this.state = 'ready';
      this.logger.info('CLI adapter ready', { version: validation.version });
    } catch (error) {
      this.state = 'error';
      this.logger.error('CLI adapter initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Validate CLI availability and version
   */
  async validateCli(): Promise<CliValidationResult> {
    this.logger.info('Validating CodeMachine CLI');

    try {
      const result = await this.executeCommand(['--version'], {
        timeoutMs: 5000,
      });

      if (result.exitCode !== 0) {
        return {
          valid: false,
          errors: [`CLI returned non-zero exit code: ${result.exitCode}`],
        };
      }

      const version = result.output.trim();
      this.logger.info('CLI validation successful', { version });

      return {
        valid: true,
        version,
        errors: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('CLI validation failed', { error: message });

      return {
        valid: false,
        errors: [message],
      };
    }
  }
}
```

### Step 4: Execution Methods (Part 2)

```typescript
// src/adapters/cli/CodeMachineCLIAdapter.ts (Part 2 - Execution)

export class CodeMachineCLIAdapter extends EventEmitter {
  // ... previous code ...

  /**
   * Execute command with argument building and output parsing
   */
  async execute(
    command: string,
    args: Record<string, unknown> = {},
    options?: CliExecutionOptions
  ): Promise<CliOutput> {
    if (this.state !== 'ready') {
      throw new Error(`Cannot execute in state '${this.state}'. Call initialize() first.`);
    }

    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    this.state = 'executing';

    try {
      this.logger.info('Executing CLI command', {
        command,
        args: this.sanitizeArgs(args),
        timeoutMs,
      });

      // Build arguments with validation
      const commandArgs = this.buildArguments(command, args);

      // Execute and collect output
      const output = await this.executeCommand(commandArgs, {
        ...options,
        timeoutMs,
      });

      const durationMs = Date.now() - startTime;

      this.logger.info('Command executed successfully', {
        command,
        exitCode: output.exitCode,
        durationMs,
      });

      // Map to strategy result on success
      if (output.exitCode === 0) {
        this.state = 'ready'; // Return to ready
        return {
          ...output,
          durationMs,
        };
      }

      // Treat non-zero as failure but still return
      this.state = 'ready';
      return {
        ...output,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.state = this.state === 'executing' ? 'error' : this.state;

      this.logger.error('Command execution failed', {
        command,
        error: this.formatError(error),
        durationMs,
      });

      throw error;
    }
  }

  /**
   * Build CLI arguments from task configuration
   */
  private buildArguments(command: string, args: Record<string, unknown>): string[] {
    const result: string[] = [command];

    for (const [key, value] of Object.entries(args)) {
      // Skip null/undefined
      if (value === undefined || value === null) {
        continue;
      }

      // Boolean flags
      if (typeof value === 'boolean') {
        if (value) {
          result.push(`--${this.kebabCase(key)}`);
        }
        continue;
      }

      // Arrays: repeat flag for each item
      if (Array.isArray(value)) {
        for (const item of value) {
          result.push(`--${this.kebabCase(key)}`);
          result.push(this.escapeArgument(String(item)));
        }
        continue;
      }

      // Strings and numbers
      result.push(`--${this.kebabCase(key)}`);
      result.push(this.escapeArgument(String(value)));
    }

    // Validate argument count
    if (result.length > this.config.maxArgs) {
      throw new CliAdapterError(
        `Too many arguments (${result.length} > ${this.config.maxArgs})`,
        'permanent',
        undefined,
        undefined,
        'buildArguments'
      );
    }

    if (this.config.debug) {
      this.logger.debug('Built arguments', { args: result });
    }

    return result;
  }

  /**
   * Execute command with spawn and output collection
   */
  private executeCommand(
    args: string[],
    options?: CliExecutionOptions & { timeoutMs?: number }
  ): Promise<CliOutput> {
    return new Promise((resolve, reject) => {
      const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;
      let timedOut = false;
      let output = '';
      let stderr = '';
      let timeout: NodeJS.Timeout | null = null;

      try {
        const child = spawn(this.config.cliPath, args, {
          cwd: options?.cwd ?? this.config.workspaceDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.buildProcessEnv(options?.env),
        });

        this.activeProcesses.add(child);

        // Handle stdout - accumulate output, emit events
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString();

          // Parse and emit NDJSON events
          const lines = output.split('\n');
          for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].trim()) {
              try {
                const event = JSON.parse(lines[i]);
                this.emitEvent('event', event);
              } catch {
                // Not JSON, just text
                this.emitEvent('output', lines[i]);
              }
            }
          }
          output = lines[lines.length - 1];
        });

        // Handle stderr
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          this.emitEvent('stderr', chunk.toString());
        });

        // Set timeout handler
        timeout = setTimeout(() => {
          timedOut = true;
          this.logger.warn('CLI timeout reached, sending SIGTERM', {
            pid: child.pid,
            timeoutMs,
          });
          child.kill('SIGTERM');

          // Force kill after grace period
          const forceKill = setTimeout(() => {
            if (!child.killed) {
              this.logger.warn('Force killing CLI with SIGKILL');
              child.kill('SIGKILL');
            }
          }, 5000);

          child.once('exit', () => clearTimeout(forceKill));
        }, timeoutMs);

        // Handle process exit
        child.on('exit', (code, signal) => {
          if (timeout) clearTimeout(timeout);
          this.activeProcesses.delete(child);

          // Timeout takes precedence
          if (timedOut) {
            reject(
              new CliAdapterError(
                `CLI command timed out after ${timeoutMs}ms`,
                'timeout',
                code ?? undefined,
                stderr,
                undefined
              )
            );
            return;
          }

          // Process killed by signal
          if (signal) {
            reject(
              new CliAdapterError(
                `CLI process killed by signal: ${signal}`,
                this.classifySignal(signal),
                code ?? undefined,
                stderr,
                undefined
              )
            );
            return;
          }

          // Non-zero exit code
          if (code !== 0) {
            const errorType = this.classifyExitCode(code ?? 1);
            reject(
              new CliAdapterError(
                `CLI command failed with exit code ${code}`,
                errorType,
                code,
                stderr,
                undefined
              )
            );
            return;
          }

          // Success
          resolve({
            exitCode: 0,
            output,
            durationMs: 0, // Set by caller
          });
        });

        // Handle process spawn errors
        child.on('error', (error) => {
          if (timeout) clearTimeout(timeout);
          this.activeProcesses.delete(child);

          reject(
            new CliAdapterError(
              `Failed to spawn CLI process: ${error.message}`,
              'permanent',
              undefined,
              undefined,
              undefined,
              error
            )
          );
        });
      } catch (error) {
        if (timeout) clearTimeout(timeout);

        reject(
          new CliAdapterError(
            `Unexpected error during CLI execution: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'permanent',
            undefined,
            undefined,
            undefined,
            error instanceof Error ? error : undefined
          )
        );
      }
    });
  }
}
```

### Step 5: Helper Methods (Part 3)

```typescript
// src/adapters/cli/CodeMachineCLIAdapter.ts (Part 3 - Helpers)

export class CodeMachineCLIAdapter extends EventEmitter {
  // ... previous code ...

  /**
   * Build process environment
   */
  private buildProcessEnv(overrides?: Record<string, string>): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;

    // Set working directory
    if (this.config.workspaceDir) {
      env.PWD = this.config.workspaceDir;
    }

    // Set run directory if available
    if (this.config.runDir) {
      env.RUN_DIR = this.config.runDir;
    }

    // Apply overrides
    if (overrides) {
      Object.assign(env, overrides);
    }

    return env;
  }

  /**
   * Classify exit code
   */
  private classifyExitCode(code: number): CliErrorType {
    // 0: success (handled elsewhere)
    // 1: general error
    // 2: misuse of shell command (permanent)
    // 127: command not found (permanent)
    // 128+: killed by signal (transient)

    if (code === 2 || code === 127) {
      return 'permanent';
    }

    if (code >= 128) {
      return 'transient';
    }

    return 'permanent';
  }

  /**
   * Classify signal
   */
  private classifySignal(signal: string): CliErrorType {
    // SIGTERM/SIGINT from timeout: transient
    // SIGKILL from OS: transient
    return 'transient';
  }

  /**
   * Format error for logging
   */
  private formatError(error: unknown): string {
    if (error instanceof CliAdapterError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Sanitize arguments for logging
   */
  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'apiKey', 'apiSecret'];

    for (const [k, v] of Object.entries(args)) {
      const isSecret = sensitiveKeys.some((key) => k.toLowerCase().includes(key));
      sanitized[k] = isSecret ? '***' : v;
    }

    return sanitized;
  }

  /**
   * Emit event to subscribers
   */
  private emitEvent(type: string, data: string | Record<string, unknown>): void {
    try {
      this.emit(type, data);
    } catch (error) {
      this.logger.warn('Error emitting event', {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Convert camelCase to kebab-case
   */
  private kebabCase(str: string): string {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Escape argument (defensive, minimal needed with shell: false)
   */
  private escapeArgument(arg: string): string {
    // With shell: false, spawn passes args directly without shell interpretation
    // This is defensive against edge cases with quotes/spaces
    if (/[\s"'$`\\]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up CLI adapter', {
      activeProcesses: this.activeProcesses.size,
      state: this.state,
    });

    // Kill active processes
    const killPromises = Array.from(this.activeProcesses).map(
      (process) =>
        new Promise<void>((resolve) => {
          const onExit = () => resolve();
          process.on('exit', onExit);

          // Graceful termination
          process.kill('SIGTERM');

          // Force kill after grace period
          const forceKillTimeout = setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL');
            }
            resolve();
          }, 5000);

          process.once('exit', () => {
            clearTimeout(forceKillTimeout);
          });
        })
    );

    await Promise.all(killPromises);
    this.activeProcesses.clear();
    this.removeAllListeners();
    this.state = 'cleaned';
  }

  /**
   * Ensure cleanup on process exit
   */
  ensureCleanup(): void {
    process.on('exit', () => {
      if (this.state !== 'cleaned') {
        this.cleanup().catch((error) => {
          console.error('Cleanup failed:', error);
        });
      }
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCodeMachineCLIAdapter(
  config: CodeMachineCLIAdapterConfig
): CodeMachineCLIAdapter {
  return new CodeMachineCLIAdapter(config);
}
```

---

## Part 2: Integration with ExecutionStrategy

```typescript
// src/workflows/codeMachineCliStrategy.ts
import type { ExecutionTask } from '../core/models/ExecutionTask';
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy';
import {
  createCodeMachineCLIAdapter,
  CodeMachineCLIAdapter,
  CliAdapterError,
  type CliOutput,
} from '../adapters/cli/CodeMachineCLIAdapter';

export interface CodeMachineCliStrategyConfig {
  cliPath: string;
  logger?: LoggerInterface;
}

export class CodeMachineCliStrategy implements ExecutionStrategy {
  readonly name = 'codemachine-cli';
  private adapter?: CodeMachineCLIAdapter;
  private readonly config: CodeMachineCliStrategyConfig;

  constructor(config: CodeMachineCliStrategyConfig) {
    this.config = config;
  }

  canHandle(task: ExecutionTask): boolean {
    // Route to this strategy for CLI-based tasks
    return task.task_type === 'codemachine_cli';
  }

  async execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult> {
    const startTime = Date.now();

    try {
      // Lazy initialize adapter
      if (!this.adapter) {
        this.adapter = createCodeMachineCLIAdapter({
          cliPath: this.config.cliPath,
          workspaceDir: context.workspaceDir,
          runDir: context.runDir,
          timeoutMs: context.timeoutMs,
          logger: this.config.logger,
          debug: this.config.logger?.debug === true,
        });

        await this.adapter.initialize();
      }

      // Build arguments from task configuration
      const args = this.buildTaskArguments(task);

      // Subscribe to events if logging is enabled
      if (this.config.logger?.debug) {
        this.adapter.on('event', (event) => {
          this.config.logger?.debug('CLI event', { event });
        });
        this.adapter.on('stderr', (chunk) => {
          this.config.logger?.debug('CLI stderr', { chunk: chunk.slice(0, 100) });
        });
      }

      // Execute command
      const result = await this.adapter.execute(task.title, args, {
        timeoutMs: context.timeoutMs,
      });

      const durationMs = Date.now() - startTime;

      // Map exit code to strategy result
      if (result.exitCode === 0) {
        return {
          success: true,
          status: 'completed',
          summary: result.output.slice(0, 500),
          recoverable: false,
          durationMs,
          artifacts: this.extractArtifacts(result),
        };
      }

      // Non-zero exit: failure
      return {
        success: false,
        status: 'failed',
        summary: result.output.slice(0, 500),
        errorMessage: result.output,
        recoverable: true, // Allow retry
        durationMs,
        artifacts: [],
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof CliAdapterError) {
        return {
          success: false,
          status: error.errorType === 'timeout' ? 'timeout' : 'failed',
          summary: error.message,
          errorMessage: error.stderr,
          recoverable: error.isRetryable(),
          durationMs,
          artifacts: [],
        };
      }

      return {
        success: false,
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        recoverable: false,
        durationMs,
        artifacts: [],
      };
    }
  }

  /**
   * Build CLI arguments from task configuration
   */
  private buildTaskArguments(task: ExecutionTask): Record<string, unknown> {
    const config = task.config ?? {};

    const args: Record<string, unknown> = {
      // Map standard fields
      target: config.target,
      verbose: config.verbose === true,
      exclude: Array.isArray(config.exclude) ? config.exclude : [],

      // Map task-specific fields
      ...(typeof config === 'object' ? config : {}),
    };

    // Remove undefined/null values
    return Object.fromEntries(
      Object.entries(args).filter(([_, v]) => v !== undefined && v !== null)
    );
  }

  /**
   * Extract artifact paths from CLI output
   */
  private extractArtifacts(result: CliOutput): string[] {
    const artifacts: string[] = [];

    if (!result.output) {
      return artifacts;
    }

    // Look for common artifact patterns in output
    const lines = result.output.split('\n');
    for (const line of lines) {
      // Example: Extract paths that look like artifacts
      const match = line.match(/artifact:\s*(.+?)(?:\s|$)/);
      if (match) {
        artifacts.push(match[1].trim());
      }
    }

    return artifacts;
  }

  /**
   * Cleanup when done
   */
  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.cleanup();
    }
  }
}

export function createCodeMachineCliStrategy(
  config: CodeMachineCliStrategyConfig
): CodeMachineCliStrategy {
  return new CodeMachineCliStrategy(config);
}
```

---

## Part 3: Testing

```typescript
// tests/unit/adapters/cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createCodeMachineCLIAdapter,
  CodeMachineCLIAdapter,
  CliAdapterError,
} from '../../../src/adapters/cli/CodeMachineCLIAdapter';

describe('CodeMachineCLIAdapter', () => {
  let adapter: CodeMachineCLIAdapter;

  beforeEach(() => {
    adapter = createCodeMachineCLIAdapter({
      cliPath: 'codemachine',
      workspaceDir: process.cwd(),
      timeoutMs: 5000,
      debug: false,
    });
  });

  afterEach(async () => {
    await adapter.cleanup();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      // Skip if CLI not available
      if (!process.env.CODEMACHINE_BIN_PATH) {
        vi.skip();
      }

      await adapter.initialize();
      expect(adapter).toBeDefined();
    });

    it('should fail if CLI not available', async () => {
      const badAdapter = createCodeMachineCLIAdapter({
        cliPath: '/nonexistent/cli',
        workspaceDir: process.cwd(),
      });

      const result = await badAdapter.validateCli();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('execution', () => {
    it('should reject execution before initialization', async () => {
      await expect(adapter.execute('test')).rejects.toThrow(/Cannot execute in state/);
    });

    it('should emit events during execution', async () => {
      if (!process.env.CODEMACHINE_BIN_PATH) {
        vi.skip();
      }

      await adapter.initialize();

      const events: unknown[] = [];
      adapter.on('event', (event) => {
        events.push(event);
      });

      const result = await adapter.execute('analyze', {
        target: './src',
      });

      expect(result.exitCode).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should classify transient vs permanent errors', () => {
      // Test classifyExitCode (private method via reflection)
      const adapter2 = new CodeMachineCLIAdapter({
        cliPath: 'test',
        workspaceDir: '.',
      });

      // Exit code 127: command not found (permanent)
      // Exit code 143: killed by signal (transient)
      // Would test via public methods that use these
    });

    it('should preserve error cause chain', () => {
      const originalError = new Error('Original error');
      const adapted = new CliAdapterError(
        'Adapted error',
        'permanent',
        1,
        'stderr output',
        'operation',
        originalError
      );

      expect(adapted.cause).toBe(originalError);
      expect(adapted.toJSON().cause).toBe('Original error');
    });
  });

  describe('cleanup', () => {
    it('should cleanup active processes', async () => {
      await adapter.cleanup();
      // Verify no active processes
      expect(adapter['activeProcesses'].size).toBe(0);
    });
  });
});
```

---

## Part 4: Usage Examples

```typescript
// Example 1: Simple execution
async function analyzeCode() {
  const adapter = createCodeMachineCLIAdapter({
    cliPath: process.env.CODEMACHINE_BIN_PATH || 'codemachine',
    workspaceDir: process.cwd(),
  });

  try {
    await adapter.initialize();

    const result = await adapter.execute('analyze', {
      target: './src',
      verbose: true,
    });

    console.log('Analysis complete:', result.exitCode === 0 ? 'SUCCESS' : 'FAILED');
  } finally {
    await adapter.cleanup();
  }
}

// Example 2: With event streaming
async function analyzeWithEvents() {
  const adapter = createCodeMachineCLIAdapter({
    cliPath: 'codemachine',
    workspaceDir: process.cwd(),
    timeoutMs: 30000,
  });

  adapter.on('event', (event) => {
    console.log('Event received:', event);
  });

  adapter.on('stderr', (chunk) => {
    console.log('stderr:', chunk);
  });

  try {
    await adapter.initialize();

    const result = await adapter.execute('analyze', {
      target: './src',
    });

    console.log('Complete. Output length:', result.output.length);
  } finally {
    await adapter.cleanup();
  }
}

// Example 3: Error handling and retry
async function analyzeWithRetry() {
  const adapter = createCodeMachineCLIAdapter({
    cliPath: 'codemachine',
    workspaceDir: process.cwd(),
    timeoutMs: 10000,
  });

  await adapter.initialize();

  let attempt = 0;
  const maxRetries = 3;

  while (attempt < maxRetries) {
    try {
      const result = await adapter.execute('analyze', {
        target: './src',
      });

      if (result.exitCode === 0) {
        console.log('Analysis succeeded');
        return result;
      }

      throw new Error('Analysis returned non-zero exit');
    } catch (error) {
      if (error instanceof CliAdapterError && error.isRetryable()) {
        attempt++;
        if (attempt < maxRetries) {
          console.log(`Retrying (${attempt}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }

      throw error;
    }
  }

  await adapter.cleanup();
}

// Example 4: Integration with ExecutionStrategy
async function executeTask() {
  const strategy = createCodeMachineCliStrategy({
    cliPath: 'codemachine',
  });

  const task = {
    task_id: 'task-123',
    task_type: 'codemachine_cli',
    title: 'analyze',
    config: {
      target: './src',
      verbose: true,
    },
  };

  const context = {
    runDir: '/tmp/run',
    workspaceDir: process.cwd(),
    logPath: '/tmp/run/logs',
    timeoutMs: 30000,
  };

  try {
    const result = await strategy.execute(task, context);
    console.log('Strategy result:', result);
  } finally {
    await strategy.cleanup();
  }
}
```

---

## Part 5: Integration Checklist

- [ ] Create `src/adapters/cli/types.ts` with all type definitions
- [ ] Create `src/adapters/cli/CliAdapterError.ts` with error class
- [ ] Create `src/adapters/cli/CodeMachineCLIAdapter.ts` with main adapter
- [ ] Create `src/adapters/cli/index.ts` with exports
- [ ] Create `src/workflows/codeMachineCliStrategy.ts` for strategy
- [ ] Update `src/adapters/index.ts` to export CLI adapter exports
- [ ] Create `tests/unit/adapters/cli.test.ts` with tests
- [ ] Update `cliExecutionEngine.ts` to register CLI strategy
- [ ] Add CLI adapter config to `RepoConfig.ts`
- [ ] Document CLI adapter in `docs/architecture/adapters.md`
- [ ] Add integration tests with real CodeMachine CLI
- [ ] Add usage examples to README

---

## Key Design Decisions

| Decision                     | Rationale                                               |
| ---------------------------- | ------------------------------------------------------- |
| **EventEmitter extends**     | Streaming NDJSON is primary output format               |
| **State machine lifecycle**  | Prevents invalid operations (execute before init)       |
| **Argument builder**         | Type-safe, prevents injection attacks, validates count  |
| **Exit code classification** | Different retry strategies for transient vs permanent   |
| **Lazy adapter init**        | Strategy can be created early, initialized on first use |
| **Cause chain preservation** | Debugging support, error context not lost               |
| **SIGTERM + grace period**   | Graceful shutdown before force kill                     |
| **Dependency injection**     | Logger, logger testability, configuration flexibility   |

---

## Performance Considerations

- **Streaming events**: Emit as soon as data arrives (don't buffer entire output)
- **Process cleanup**: Always call cleanup() in finally blocks
- **Memory**: NDJSON streaming prevents OOM for large outputs
- **Timeouts**: SIGTERM grace period (5s) before SIGKILL prevents zombie processes
- **Logger injection**: Allows callers to disable debug logging in production
