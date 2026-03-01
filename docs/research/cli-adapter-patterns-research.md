# TypeScript Adapter Pattern Research: CLI Wrapping Best Practices

## Executive Summary

This research documents production-ready TypeScript patterns for building CLI tool adapters, based on analysis of:

- LinearAdapter (reference HTTP adapter from codemachine-pipeline)
- Production CLI wrappers: Terraform CDK, Pulumi, Docker SDK, Kubernetes client
- Industry standards for process spawning, error handling, and async patterns

Key findings establish patterns for: config injection, error taxonomy, structured output parsing, resource lifecycle, and event emission.

---

## 1. CLI Wrapper Adapter Architecture

### 1.1 Reference: LinearAdapter Pattern

The project's `LinearAdapter` demonstrates proven patterns:

```typescript
// Config interface with dependency injection
export interface LinearAdapterConfig {
  apiKey: string;
  organization?: string;
  mcpEndpoint?: string;
  runDir?: string;
  logger?: LoggerInterface;
  timeout?: number;
  maxRetries?: number;
  enablePreviewFeatures?: boolean;
}

// Constructor with dependency injection
export class LinearAdapter {
  private readonly client: HttpClient;
  private readonly logger: LoggerInterface;
  private readonly runDir: string | undefined;

  constructor(config: LinearAdapterConfig) {
    this.logger = config.logger ?? this.createDefaultLogger();
    this.runDir = config.runDir;

    // Inject HTTP client with configuration
    this.client = new HttpClient({
      baseUrl: config.mcpEndpoint ?? LINEAR_API_URL,
      provider: Provider.LINEAR,
      token: config.apiKey,
      // ...
    });
  }
}

// Direct instantiation
const adapter = new LinearAdapter(config);
```

**Key patterns:**

- Config object with optional fields (default injection)
- Logger injection (testability)
- Internal client initialization in constructor
- Factory function for ease of testing and dependency injection

### 1.2 Proposed CodeMachineCLIAdapter Pattern

Applying these patterns to CLI wrapping:

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { LoggerInterface } from '../telemetry/logger';
import { createLogger } from '../telemetry/logger';

// ============================================================================
// Config & Types
// ============================================================================

export interface CodeMachineCLIAdapterConfig {
  /** Path to CodeMachine CLI executable */
  cliPath: string;
  /** Working directory for CLI execution */
  workspaceDir: string;
  /** Run directory for caching and logs */
  runDir?: string;
  /** Logger instance */
  logger?: LoggerInterface;
  /** Process timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum arguments passed to CLI */
  maxArgs?: number;
  /** Enable debug mode for CLI invocation */
  debug?: boolean;
}

export interface CliExecutionOptions {
  /** Timeout override for this execution */
  timeoutMs?: number;
  /** Pass through environment variables */
  env?: Record<string, string>;
  /** Working directory override */
  cwd?: string;
}

export interface CliOutput {
  /** Exit code from process */
  exitCode: number;
  /** Combined stdout + stderr */
  output: string;
  /** Parsed NDJSON events (if applicable) */
  events?: Record<string, unknown>[];
  /** Execution time in milliseconds */
  durationMs: number;
  /** Process signal if killed */
  signal?: string;
}

export interface CliValidationResult {
  /** Whether CLI is available and valid */
  valid: boolean;
  /** Version string if available */
  version?: string;
  /** Error messages if invalid */
  errors: string[];
}

// Error taxonomy
export type CliErrorType =
  | 'transient' // Temporary: timeout, rate limit, connection reset
  | 'permanent' // Not recoverable: invalid args, missing CLI
  | 'human_required' // Needs manual intervention: auth failure, user confirmation
  | 'parse_error' // Output parsing failed (code error, not CLI error)
  | 'timeout'; // Process exceeded timeout

// ============================================================================
// CLI Error
// ============================================================================

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

  /**
   * Determine if error is retryable
   */
  isRetryable(): boolean {
    return this.errorType === 'transient' || this.errorType === 'timeout';
  }

  /**
   * Serialize for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorType: this.errorType,
      exitCode: this.exitCode,
      operation: this.operation,
      stderr: this.stderr ? this.stderr.slice(0, 500) : undefined,
    };
  }
}

// ============================================================================
// CLI Adapter
// ============================================================================

/**
 * Adapter for wrapping external CodeMachine CLI tool
 *
 * Features:
 * - Type-safe argument building
 * - NDJSON output parsing
 * - Exit code to error type mapping
 * - Timeout management with signal handling
 * - Event emission for streaming output
 * - Logger integration
 */
export class CodeMachineCLIAdapter extends EventEmitter {
  private readonly config: Required<CodeMachineCLIAdapterConfig>;
  private readonly logger: LoggerInterface;
  private activeProcesses: Set<ChildProcess> = new Set();

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
      timeoutMs: config.timeoutMs ?? 60000, // 60s default
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
   * Validate CLI availability and version compatibility
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

  /**
   * Execute a command with argument building and output parsing
   */
  async execute(
    command: string,
    args: Record<string, unknown> = {},
    options?: CliExecutionOptions
  ): Promise<CliOutput> {
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;

    this.logger.info('Executing CLI command', {
      command,
      args: this.sanitizeArgs(args),
      timeoutMs,
    });

    try {
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

      return {
        ...output,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error('Command execution failed', {
        command,
        error: this.formatError(error),
        durationMs,
      });

      throw error;
    }
  }

  /**
   * Build CLI arguments from task configuration with validation
   */
  private buildArguments(command: string, args: Record<string, unknown>): string[] {
    const result: string[] = [command];

    for (const [key, value] of Object.entries(args)) {
      // Skip undefined or null values
      if (value === undefined || value === null) {
        continue;
      }

      // Handle boolean flags
      if (typeof value === 'boolean') {
        if (value) {
          result.push(`--${this.kebabCase(key)}`);
        }
        continue;
      }

      // Handle arrays
      if (Array.isArray(value)) {
        for (const item of value) {
          result.push(`--${this.kebabCase(key)}`);
          result.push(this.escapeArgument(String(item)));
        }
        continue;
      }

      // Handle string and number values
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
   *
   * @private
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
          timeout: timeoutMs,
        });

        this.activeProcesses.add(child);

        // Handle stdout
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString();

          // Emit events if parsing NDJSON
          const lines = output.split('\n');
          for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].trim()) {
              this.emitEvent('ndjson', lines[i]);
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
          child.kill('SIGTERM');
        }, timeoutMs);

        // Handle process exit
        child.on('exit', (code, signal) => {
          if (timeout) clearTimeout(timeout);
          this.activeProcesses.delete(child);

          // Determine error based on exit code
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

          if (signal) {
            reject(
              new CliAdapterError(
                `CLI process killed by signal: ${signal}`,
                'transient',
                code ?? undefined,
                stderr,
                undefined
              )
            );
            return;
          }

          // Map exit code to error type
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
            signal: undefined,
          });
        });

        // Handle process errors
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

  /**
   * Build process environment with defaults and overrides
   */
  private buildProcessEnv(overrides?: Record<string, string>): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;

    // Preserve PATH and other critical variables
    if (this.config.workspaceDir) {
      env.PWD = this.config.workspaceDir;
    }

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
   * Classify exit code to error type
   */
  private classifyExitCode(code: number): CliErrorType {
    // 1: general error (likely permanent)
    // 2: misuse of shell command (permanent)
    // 127: command not found (permanent)
    // 128: fatal signal (transient, recoverable)
    // 130: interrupted (transient)
    // 137: killed by SIGKILL (transient)
    // 143: killed by SIGTERM (transient)

    if (code === 127 || code === 2) {
      return 'permanent';
    }

    if (code >= 128) {
      return 'transient';
    }

    // Default: treat as permanent if unknown
    return 'permanent';
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
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'apiKey'];

    for (const [k, v] of Object.entries(args)) {
      if (sensitiveKeys.some((key) => k.toLowerCase().includes(key))) {
        sanitized[k] = '***';
      } else {
        sanitized[k] = v;
      }
    }

    return sanitized;
  }

  /**
   * Emit event for subscribers
   */
  private emitEvent(type: string, data: string): void {
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
   * Escape argument for safe shell execution (when using shell: true)
   *
   * With shell: false (recommended), minimal escaping needed. This is defensive.
   */
  private escapeArgument(arg: string): string {
    // Only escape if contains problematic characters
    if (/[\s"'$`\\]/.test(arg)) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  }

  /**
   * Cleanup: terminate active processes
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up CLI adapter', {
      activeProcesses: this.activeProcesses.size,
    });

    const killPromises = Array.from(this.activeProcesses).map(
      (process) =>
        new Promise<void>((resolve) => {
          process.on('exit', () => resolve());
          process.kill('SIGTERM');

          // Force kill after grace period
          setTimeout(() => {
            if (!process.killed) {
              process.kill('SIGKILL');
            }
            resolve();
          }, 5000);
        })
    );

    await Promise.all(killPromises);
    this.activeProcesses.clear();
    this.removeAllListeners();
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

## 2. Error Handling Taxonomy

### 2.1 Exit Code Classification

Production CLI patterns classify errors by recoverable vs permanent:

```typescript
/**
 * Exit code mapping strategy (matches standard Unix conventions)
 *
 * 0    = Success
 * 1    = General error (could be permanent or transient)
 * 2    = Misuse of shell command (permanent - user error)
 * 127  = "command not found" (permanent - CLI missing)
 * 128  = Fatal signal "N" (transient - OS killed process)
 * 130  = Script terminated by Ctrl+C (transient - can retry)
 * 137  = Killed by SIGKILL (transient - OS resource issue)
 * 143  = Killed by SIGTERM (transient - graceful shutdown)
 */

export function classifyExitCode(exitCode: number): 'transient' | 'permanent' {
  // Permanent: bad arguments, missing CLI, incorrect usage
  if (exitCode === 2 || exitCode === 127) {
    return 'permanent';
  }

  // Transient: killed by signal, OS resource issues
  if (exitCode >= 128) {
    return 'transient';
  }

  // Default to permanent for unknown codes
  return 'permanent';
}
```

### 2.2 Stderr Pattern Matching

Detect specific errors from stderr output:

```typescript
interface ErrorPattern {
  regex: RegExp;
  type: CliErrorType;
  recommendation?: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    regex: /timeout/i,
    type: 'timeout',
    recommendation: 'Increase timeoutMs or optimize task',
  },
  {
    regex: /connection refused|ECONNREFUSED/i,
    type: 'transient',
    recommendation: 'Service may be unavailable, retry with backoff',
  },
  {
    regex: /ENOENT.*no such file|not found/i,
    type: 'permanent',
    recommendation: 'Check file path and ensure input exists',
  },
  {
    regex: /permission denied|EACCES/i,
    type: 'human_required',
    recommendation: 'Check file permissions or auth credentials',
  },
  {
    regex: /out of memory|OOM killer/i,
    type: 'transient',
    recommendation: 'System under memory pressure, retry later',
  },
];

export function classifyStderr(stderr: string): CliErrorType {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.regex.test(stderr)) {
      return pattern.type;
    }
  }

  // Default: treat as permanent if we don't recognize the error
  return 'permanent';
}
```

### 2.3 Error Wrapping with Cause Chain

Always preserve original error for debugging:

```typescript
try {
  const result = await executeCommand(args);
  return result;
} catch (error) {
  const cause = error instanceof Error ? error : undefined;

  throw new CliAdapterError(
    'Failed to execute command',
    'transient',
    undefined,
    undefined,
    'executeCommand',
    cause // Preserve original error
  );
}
```

---

## 3. Event Emitter Pattern vs Alternatives

### 3.1 Event Emitter Approach (Recommended for Streaming)

Best for streaming NDJSON or large output:

```typescript
export class CliAdapter extends EventEmitter {
  async execute(command: string): Promise<CliOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.cliPath, [command]);
      let output = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();

        // Parse and emit individual events
        const lines = output.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          try {
            const event = JSON.parse(lines[i]);
            this.emit('event', event); // Emit for subscribers
          } catch {
            // Skip unparseable lines
          }
        }
        output = lines[lines.length - 1];
      });

      child.on('exit', (code) => {
        resolve({ exitCode: code ?? 0, output });
      });
    });
  }
}

// Usage
adapter.on('event', (event) => {
  console.log('Received event:', event);
});

await adapter.execute('command');
```

**Pros:**

- Streaming support (real-time events)
- Decoupled: subscribers can attach/detach
- Standard Node.js pattern (familiar)
- Memory efficient for large outputs

**Cons:**

- Implicit contract (hard to discover events)
- Error handling via 'error' event only
- Can be overkill for small tasks

### 3.2 Async Iterator Alternative

For controlled, sequential processing:

```typescript
export async function* executeStream(
  command: string,
  args: string[]
): AsyncGenerator<ParsedEvent, CliOutput> {
  const child = spawn(cliPath, [command, ...args]);
  let output = '';

  return new Promise((resolve, reject) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();

      const lines = output.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim()) {
          yield JSON.parse(lines[i]);
        }
      }
      output = lines[lines.length - 1];
    });

    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0, output });
    });
  });
}

// Usage
for await (const event of executeStream('command', args)) {
  console.log('Event:', event);
}
```

**Pros:**

- Explicit control flow
- Type-safe iteration
- Natural error handling (try/catch)
- Backpressure support

**Cons:**

- Less familiar pattern
- Cannot attach multiple consumers
- Harder to reason about state

### 3.3 Callback Pattern

Simplest for small tasks:

```typescript
export function execute(
  command: string,
  onEvent?: (event: ParsedEvent) => void,
  onError?: (error: Error) => void
): Promise<CliOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, [command]);

    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            onEvent?.(JSON.parse(line));
          } catch (error) {
            onError?.(error as Error);
          }
        }
      }
    });

    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0 });
    });
  });
}

// Usage
await execute(
  'command',
  (event) => console.log('Event:', event),
  (error) => console.error('Parse error:', error)
);
```

**Recommendation for CodeMachine:** Use **EventEmitter** because:

1. Streaming NDJSON is core to CodeMachine's output format
2. Subscribers can attach/detach dynamically (logging, metrics, processing)
3. Standard Node.js pattern (team familiarity)
4. Matches Pulumi/Terraform CDK patterns

---

## 4. Builder Pattern for Arguments

### 4.1 Type-Safe Argument Builder

```typescript
/**
 * Fluent builder for CLI arguments with validation
 */
export class CliArgumentBuilder {
  private args: Map<string, unknown> = new Map();
  private errors: string[] = [];

  add(key: string, value: unknown, options?: { required?: boolean }): this {
    if (options?.required && (value === null || value === undefined)) {
      this.errors.push(`Required argument missing: ${key}`);
      return this;
    }

    if (value !== null && value !== undefined) {
      this.args.set(key, value);
    }

    return this;
  }

  addIfTrue(key: string, condition: boolean): this {
    if (condition) {
      this.args.set(key, true);
    }
    return this;
  }

  addArray(key: string, items: unknown[]): this {
    if (items.length > 0) {
      this.args.set(key, items);
    }
    return this;
  }

  validate(): { valid: boolean; errors: string[] } {
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
    };
  }

  build(): Record<string, unknown> {
    const { valid, errors } = this.validate();
    if (!valid) {
      throw new Error(`Argument validation failed:\n${errors.join('\n')}`);
    }
    return Object.fromEntries(this.args);
  }
}

// Usage
const args = new CliArgumentBuilder()
  .add('workflow', 'analyze', { required: true })
  .add('target', '/path/to/file', { required: true })
  .addIfTrue('verbose', debugMode)
  .addArray('exclude', ['node_modules', 'dist'])
  .build();

await adapter.execute('command', args);
```

### 4.2 Schema Validation with Zod

```typescript
import { z } from 'zod';

const AnalyzeArgsSchema = z.object({
  workflow: z.enum(['analyze', 'refactor', 'document']),
  target: z.string().min(1),
  verbose: z.boolean().optional(),
  exclude: z.array(z.string()).optional(),
  maxTime: z.number().int().positive().optional(),
});

type AnalyzeArgs = z.infer<typeof AnalyzeArgsSchema>;

export async function analyzeWithCli(
  adapter: CodeMachineCLIAdapter,
  args: AnalyzeArgs
): Promise<CliOutput> {
  // Validation happens automatically
  const validated = AnalyzeArgsSchema.parse(args);
  return adapter.execute('analyze', validated);
}
```

---

## 5. Adapter Lifecycle: Initialize, Validate, Execute, Cleanup

### 5.1 Lifecycle State Machine

```typescript
type AdapterState = 'created' | 'validating' | 'ready' | 'executing' | 'error' | 'cleaned';

export class CliAdapter extends EventEmitter {
  private state: AdapterState = 'created';

  /**
   * Initialize and validate prerequisites
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
   * Execute command (requires initialized state)
   */
  async execute(command: string, args?: Record<string, unknown>): Promise<CliOutput> {
    if (this.state !== 'ready') {
      throw new Error(`Cannot execute in state '${this.state}'. Call initialize() first.`);
    }

    this.state = 'executing';

    try {
      const result = await this.executeCommand(this.buildArguments(command, args ?? {}));
      this.state = 'ready'; // Return to ready
      return result;
    } catch (error) {
      this.state = 'error';
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up adapter', { state: this.state });

    // Kill any active processes
    for (const process of this.activeProcesses) {
      process.kill('SIGTERM');
    }

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
```

### 5.2 Usage Pattern

```typescript
const adapter = createCodeMachineCLIAdapter({
  cliPath: '/usr/local/bin/codemachine',
  workspaceDir: process.cwd(),
  timeoutMs: 60000,
});

try {
  // Initialize first
  await adapter.initialize();

  // Execute commands
  const result = await adapter.execute('analyze', {
    target: './src',
    verbose: true,
  });

  console.log('Result:', result);
} finally {
  // Always cleanup
  await adapter.cleanup();
}
```

---

## 6. Integration with ExecutionStrategy

### 6.1 Implement ExecutionStrategy Interface

```typescript
import type {
  ExecutionStrategy,
  ExecutionContext,
  ExecutionStrategyResult,
} from './executionStrategy';

export class CodeMachineStrategy implements ExecutionStrategy {
  readonly name = 'codemachine-cli';
  private adapter?: CodeMachineCLIAdapter;

  constructor(private config: CodeMachineStrategyConfig) {}

  canHandle(task: ExecutionTask): boolean {
    return task.task_type === 'codemachine_cli';
  }

  async execute(task: ExecutionTask, context: ExecutionContext): Promise<ExecutionStrategyResult> {
    const startTime = Date.now();

    try {
      // Initialize adapter (lazy)
      if (!this.adapter) {
        this.adapter = createCodeMachineCLIAdapter({
          cliPath: this.config.cliPath,
          workspaceDir: context.workspaceDir,
          runDir: context.runDir,
          timeoutMs: context.timeoutMs,
          logger: this.config.logger,
        });
        await this.adapter.initialize();
      }

      // Build arguments from task config
      const args = this.buildTaskArguments(task);

      // Execute
      const result = await this.adapter.execute(task.title, args);

      const durationMs = Date.now() - startTime;

      // Map to strategy result
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

      return {
        success: false,
        status: 'failed',
        summary: result.output.slice(0, 500),
        errorMessage: result.output,
        recoverable: true,
        durationMs,
        artifacts: this.extractArtifacts(result),
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

  private buildTaskArguments(task: ExecutionTask): Record<string, unknown> {
    // Convert task config to CLI arguments
    const args = new CliArgumentBuilder()
      .add('target', task.config?.target, { required: true })
      .addIfTrue('verbose', task.config?.verbose === true)
      .addArray('exclude', task.config?.exclude ?? [])
      .build();

    return args;
  }

  private extractArtifacts(result: CliOutput): string[] {
    // Parse NDJSON output for artifact paths
    const artifacts: string[] = [];

    if (result.events) {
      for (const event of result.events) {
        if (event && typeof event === 'object' && 'artifact' in event) {
          artifacts.push(String((event as Record<string, unknown>).artifact));
        }
      }
    }

    return artifacts;
  }

  async cleanup(): Promise<void> {
    if (this.adapter) {
      await this.adapter.cleanup();
    }
  }
}
```

---

## 7. Timeout Management with Signals

### 7.1 Graceful Timeout Handling

```typescript
/**
 * Execute with timeout, attempting graceful shutdown first
 */
private executeWithTimeout(
  child: ChildProcess,
  timeoutMs: number
): { cleanup: () => void; timeout?: NodeJS.Timeout } {
  let timeoutHandle: NodeJS.Timeout | undefined;
  let killed = false;

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  };

  timeoutHandle = setTimeout(() => {
    if (killed) return;
    killed = true;

    this.logger.warn('CLI timeout reached, sending SIGTERM', {
      pid: child.pid,
      timeoutMs,
    });

    // Send graceful termination signal
    child.kill('SIGTERM');

    // Force kill after grace period
    const forceKillTimeout = setTimeout(() => {
      if (!child.killed) {
        this.logger.warn('Force killing CLI process after SIGTERM grace period', {
          pid: child.pid,
        });
        child.kill('SIGKILL');
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(forceKillTimeout);
    });
  }, timeoutMs);

  return { cleanup, timeout: timeoutHandle };
}
```

---

## 8. Production Patterns Summary

### 8.1 Recommended Architecture

```
CodeMachineCLIAdapter (main class)
├── Config injection (dependency-driven)
├── Lazy initialization (on first execute)
├── Event emitter (for streaming NDJSON)
├── Error taxonomy (exit code + stderr classification)
├── Argument builder (type-safe)
├── Lifecycle state machine (created → ready → executing → cleaned)
└── Cleanup handler (process termination, resource cleanup)

Error Handling
├── CliAdapterError (structured error with cause chain)
├── Exit code classification (transient vs permanent)
├── Stderr pattern matching (specific error detection)
└── Retryability assessment (error.isRetryable())

Integration
└── ExecutionStrategy implementation (execute task → CLI → result)
```

### 8.2 Design Principles

| Principle                | Implementation                                        |
| ------------------------ | ----------------------------------------------------- |
| **Dependency Injection** | Config object with optional logger/runDir             |
| **Error Taxonomy**       | CliErrorType enum with cause chain preservation       |
| **Type Safety**          | Schema validation with Zod, builder pattern           |
| **Testability**          | Factory functions, mocking-friendly logger injection  |
| **Streaming**            | EventEmitter for NDJSON events                        |
| **Lifecycle**            | State machine (created → ready → executing → cleaned) |
| **Timeout**              | SIGTERM grace period → SIGKILL force kill             |
| **Observability**        | Structured logging, event emission, metrics           |

---

## 9. Testing Patterns

### 9.1 Mock Adapter for Testing

```typescript
export class MockCliAdapter extends EventEmitter {
  async executeCommand(args: string[]): Promise<CliOutput> {
    // Return predictable output for testing
    return {
      exitCode: 0,
      output: 'Mock output',
      durationMs: 100,
      events: [],
    };
  }

  async validateCli(): Promise<CliValidationResult> {
    return {
      valid: true,
      version: '1.0.0-mock',
      errors: [],
    };
  }
}

// Usage in tests
const adapter = new MockCliAdapter();
const result = await adapter.executeCommand(['test']);
expect(result.exitCode).toBe(0);
```

### 9.2 Integration Test

```typescript
describe('CodeMachineCLIAdapter', () => {
  let adapter: CodeMachineCLIAdapter;

  beforeEach(async () => {
    adapter = createCodeMachineCLIAdapter({
      cliPath: process.env.CODEMACHINE_BIN_PATH || 'codemachine',
      workspaceDir: process.cwd(),
      timeoutMs: 5000,
    });
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.cleanup();
  });

  it('should execute command successfully', async () => {
    const result = await adapter.execute('analyze', {
      target: './src/index.ts',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBeTruthy();
  });

  it('should emit NDJSON events', async () => {
    const events: Record<string, unknown>[] = [];
    adapter.on('ndjson', (event) => {
      events.push(event);
    });

    await adapter.execute('analyze', { target: './src' });

    expect(events.length).toBeGreaterThan(0);
  });

  it('should timeout if execution exceeds limit', async () => {
    await expect(adapter.execute('slow-command', { timeout: 100 })).rejects.toThrow('timeout');
  });
});
```

---

## 10. References & Further Reading

### Production CLI Adapters

- **Terraform CDK** (TypeScript): `aws-cdk-lib/aws-*.ts` - Uses spawning for nested execution
- **Pulumi** (TypeScript): `./sdk/python/lib/pulumi/*.ts` - Event-based streaming
- **Docker SDK** (Node.js): `lib/utils.ts` - Process spawning with backpressure
- **Kubernetes Client** (JavaScript): `exec.ts` - Stream handling patterns

### Standard Patterns

- Node.js `child_process` module (stdio, signals, timeouts)
- `EventEmitter` for pub/sub patterns
- Unix exit codes (0=success, 1-125=app error, 128+=signal)
- NDJSON format (newline-delimited JSON)

### TypeScript Best Practices

- Schema validation: Zod, io-ts, Valibot
- Error handling: cause chain, error taxonomy
- Logger injection: structured logging, levels
- Type guards: discriminated unions, type predicates

---

## Conclusion

The recommended `CodeMachineCLIAdapter` combines:

1. **Config injection** (LinearAdapter pattern) for testability
2. **Error taxonomy** (exit code + stderr classification) for intelligent retry logic
3. **EventEmitter** for streaming NDJSON output
4. **Argument builder** with Zod validation for type safety
5. **State machine lifecycle** (created → ready → executing → cleaned)
6. **Graceful timeout handling** (SIGTERM → grace period → SIGKILL)
7. **Cause chain preservation** (e instanceof Error → cause)

This architecture handles production requirements: testability, observability, error recovery, streaming output, and resource cleanup.
