# CLI Adapter Pattern Alternatives Analysis

Comparative analysis of different architectural approaches for wrapping external CLI tools in TypeScript.

---

## 1. Monolithic vs Adapter Pattern

### 1.1 Monolithic Approach (Anti-pattern)

**Implementation:** CLI logic embedded directly in ExecutionStrategy

```typescript
// ANTI-PATTERN: Monolithic ExecutionStrategy
export class CodeMachineStrategy implements ExecutionStrategy {
  async execute(task: ExecutionTask, context: ExecutionContext) {
    // CLI spawning mixed with strategy logic
    const child = spawn('codemachine', [task.title]);
    let output = '';

    return new Promise((resolve) => {
      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
      });

      child.on('exit', (code) => {
        // Error handling mixed with business logic
        resolve({
          success: code === 0,
          status: code === 0 ? 'completed' : 'failed',
          summary: output.slice(0, 500),
          recoverable: code >= 128, // Hardcoded classification
          durationMs: Date.now() - startTime,
          artifacts: [],
        });
      });
    });
  }
}
```

**Problems:**
- Coupling: Strategy tightly bound to CLI details
- Testability: Cannot mock CLI independently
- Reusability: CLI logic locked inside strategy
- Maintainability: Mixed concerns (strategy + CLI + error handling)
- Duplication: Same CLI logic needed in other strategies

**When to use:** Never (except for one-off scripts)

---

### 1.2 Adapter Pattern (Recommended)

**Separation of concerns:**

```typescript
// Clean: Adapter handles CLI
export class CodeMachineCLIAdapter {
  async execute(command: string, args: Record<string, unknown>): Promise<CliOutput> {
    // CLI spawning, timeout, error handling
  }
}

// Strategy uses adapter
export class CodeMachineCliStrategy implements ExecutionStrategy {
  async execute(task: ExecutionTask, context: ExecutionContext) {
    const result = await this.adapter.execute(task.title, args);
    return this.mapToStrategy(result);
  }
}
```

**Benefits:**
- Separation: CLI logic isolated from strategy
- Testability: Can mock adapter, test strategy independently
- Reusability: Adapter used by multiple strategies
- Maintainability: Clear responsibility boundaries
- Composability: Build higher-level tools from adapter

---

## 2. Streaming Patterns Comparison

### 2.1 EventEmitter (Recommended for NDJSON)

```typescript
export class CliAdapter extends EventEmitter {
  private executeCommand(args: string[]): Promise<CliOutput> {
    return new Promise((resolve) => {
      const child = spawn(cliPath, args);
      let output = '';

      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();

        // Parse and emit NDJSON line-by-line
        const lines = output.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          try {
            const event = JSON.parse(lines[i]);
            this.emit('event', event); // Real-time emission
          } catch {
            this.emit('output', lines[i]);
          }
        }
        output = lines[lines.length - 1];
      });

      child.on('exit', () => resolve({ exitCode, output }));
    });
  }
}

// Usage: Multiple subscribers
adapter.on('event', handleEvent);
adapter.on('event', logEvent);
adapter.on('event', storeMetrics);
await adapter.execute('analyze', args);
```

**Pros:**
- Multiple independent subscribers
- Real-time events (no buffering)
- Standard Node.js pattern
- Decoupled: subscribers don't know about each other
- Memory efficient (streaming, not buffering)

**Cons:**
- Implicit contract (events not discoverable)
- Fire-and-forget (no guaranteed delivery)
- Error handling via 'error' event only
- Testing requires listener setup

**Best for:** NDJSON streaming, real-time logging, metrics

---

### 2.2 Async Iterator Pattern

```typescript
export async function* streamEvents(
  cliPath: string,
  args: string[]
): AsyncGenerator<ParsedEvent, CliOutput, void> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, args);
    let output = '';

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      const lines = output.split('\n');

      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim()) {
          yield JSON.parse(lines[i]); // Explicit yield
        }
      }
      output = lines[lines.length - 1];
    });

    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 0, output });
    });
  });
}

// Usage: Sequential processing
for await (const event of streamEvents(cliPath, args)) {
  console.log('Event:', event);
}
const finalOutput = // return value
```

**Pros:**
- Explicit control flow
- Natural error handling (try/catch)
- Type-safe iteration
- Backpressure support
- Sequential processing guaranteed

**Cons:**
- Less familiar pattern
- Single consumer only
- Can't attach multiple listeners
- Harder to reason about state

**Best for:** Controlled sequential processing, backpressure-aware systems

---

### 2.3 Callback Pattern

```typescript
export function execute(
  cliPath: string,
  args: string[],
  options: {
    onEvent?: (event: ParsedEvent) => void;
    onError?: (error: Error) => void;
    onComplete?: (output: CliOutput) => void;
  }
): Promise<CliOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args);
    let output = '';

    child.stdout?.on('data', (chunk) => {
      // ... accumulate output ...
      for (const line of lines) {
        try {
          options.onEvent?.(JSON.parse(line));
        } catch (error) {
          options.onError?.(error as Error);
        }
      }
    });

    child.on('exit', (code) => {
      options.onComplete?.({ exitCode: code ?? 0, output });
      resolve({ exitCode: code ?? 0, output });
    });
  });
}

// Usage
await execute(cliPath, args, {
  onEvent: (event) => console.log('Event:', event),
  onError: (error) => console.error('Parse error:', error),
  onComplete: (output) => console.log('Done:', output),
});
```

**Pros:**
- Simple, familiar API
- Flexible: inline handlers
- Easy to test (mock callbacks)

**Cons:**
- Callback pyramid with many handlers
- Implicit error handling
- Hard to compose multiple handlers
- No standard Node.js pattern for this

**Best for:** Simple one-off executions, quick scripts

---

### 2.4 Promise-based (Simplest)

```typescript
export function execute(
  cliPath: string,
  args: string[]
): Promise<CliOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args);
    let output = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ exitCode: 0, output, durationMs: 0 });
      } else {
        reject(new Error(`Exit code ${code}: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

// Usage: Simple and clean
const output = await execute(cliPath, args);
```

**Pros:**
- Simplest API
- Uses native promises
- Easy to understand
- Easy to test

**Cons:**
- No event streaming
- Buffers entire output in memory
- No timeout management
- No progress indication

**Best for:** Small commands, simple use cases

---

## 3. Error Handling Strategies

### 3.1 Exit Code-Based (Fast)

```typescript
export function classifyError(exitCode: number): ErrorType {
  if (exitCode === 0) return 'success';
  if (exitCode === 2 || exitCode === 127) return 'permanent'; // Bad args, missing CLI
  if (exitCode >= 128) return 'transient'; // Killed by signal
  return 'permanent'; // Unknown error
}
```

**Pros:**
- Fast (single number check)
- Universal (all CLIs follow Unix conventions)
- No output parsing needed

**Cons:**
- Loses output context
- Some CLIs use same exit code for different errors

**Best for:** Quick classification, first filter

---

### 3.2 Stderr Pattern Matching (Detailed)

```typescript
const ERROR_PATTERNS: ErrorPattern[] = [
  { regex: /timeout/i, type: 'transient' },
  { regex: /connection refused/i, type: 'transient' },
  { regex: /no such file/i, type: 'permanent' },
  { regex: /permission denied/i, type: 'human_required' },
];

export function classifyError(stderr: string): ErrorType {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.regex.test(stderr)) {
      return pattern.type;
    }
  }
  return 'permanent';
}
```

**Pros:**
- Specific error detection
- Contextual information
- Better retry decisions

**Cons:**
- Pattern maintenance overhead
- Brittle (CLI output may change)
- Performance (regex parsing)

**Best for:** Intelligent retry logic, detailed logging

---

### 3.3 Hybrid Approach (Recommended)

```typescript
export function classifyError(exitCode: number, stderr: string): ErrorType {
  // Fast path: use exit code first
  if (exitCode === 0) return 'success';
  if (exitCode === 2 || exitCode === 127) return 'permanent';
  if (exitCode >= 128) return 'transient';

  // Detailed path: pattern matching for unknown codes
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.regex.test(stderr)) {
      return pattern.type;
    }
  }

  return 'permanent'; // Conservative default
}
```

**Efficiency:** O(1) fast path for common codes, O(n) only for unknowns

**Accuracy:** Uses exit code as primary, patterns as fallback

---

## 4. Timeout Strategies

### 4.1 Simple Timeout (Abrupt)

```typescript
const timeout = setTimeout(() => {
  child.kill('SIGKILL'); // Immediate kill
}, timeoutMs);

child.on('exit', () => clearTimeout(timeout));
```

**Pros:**
- Simple implementation
- Guaranteed termination

**Cons:**
- No grace period
- Might lose work in progress
- Abrupt (zombie processes possible)

---

### 4.2 Graceful Timeout (Recommended)

```typescript
const timeout = setTimeout(() => {
  child.kill('SIGTERM'); // Graceful termination

  // Force kill after grace period
  const forceKill = setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 5000); // 5s grace period

  child.once('exit', () => clearTimeout(forceKill));
}, timeoutMs);

child.on('exit', () => clearTimeout(timeout));
```

**Pros:**
- Graceful shutdown first
- Process can cleanup
- Force kill if needed
- No zombies

**Cons:**
- Slightly more complex
- Extra delay possible

---

### 4.3 Adaptive Timeout

```typescript
const baseTimeout = 30000; // 30s
const adaptiveTimeout = Math.max(
  baseTimeout,
  fileSize / BYTES_PER_SECOND + 5000 // Adjust for input size
);

// ... use adaptiveTimeout ...
```

**Pros:**
- Handles variable workloads
- Data-driven

**Cons:**
- Additional complexity
- Still may timeout on slow systems

---

## 5. Lifecycle Management Patterns

### 5.1 Constructor-Based (Early)

```typescript
export class CliAdapter {
  private client: CliClient;

  constructor(config: Config) {
    // Initialize immediately
    this.client = new CliClient(config);
    this.validateCli(); // Validate upfront
  }

  async execute(): Promise<Result> {
    return this.client.spawn(...);
  }
}

// Issues: What if CLI not available? Validation in constructor is anti-pattern
```

**Cons:**
- Validates in constructor (anti-pattern)
- Fails early if CLI not available
- Synchronous initialization

---

### 5.2 Lazy Initialization (Recommended)

```typescript
export class CliAdapter {
  private client?: CliClient;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.client = new CliClient(this.config);
    await this.client.validate();
    this.initialized = true;
  }

  async execute(): Promise<Result> {
    if (!this.initialized) {
      throw new Error('Call initialize() first');
    }
    return this.client.spawn(...);
  }
}

// Usage
const adapter = new CliAdapter(config);
await adapter.initialize(); // Explicit initialization
await adapter.execute();
```

**Pros:**
- Explicit lifecycle
- Separate construction from initialization
- Can delay validation
- Allows error recovery

---

### 5.3 Factory Pattern (Clean)

```typescript
export async function createAndInitializeCliAdapter(
  config: Config
): Promise<CliAdapter> {
  const adapter = new CliAdapter(config);
  await adapter.initialize();
  return adapter;
}

// Usage: Single step
const adapter = await createAndInitializeCliAdapter(config);
await adapter.execute();
```

**Pros:**
- Single-step initialization
- Factory handles setup
- Cleaner API

**Cons:**
- Hides initialization step
- Less control

---

## 6. Testing Strategies Comparison

### 6.1 Mock Adapter (Isolation)

```typescript
export class MockCliAdapter implements CliAdapter {
  async execute(command: string): Promise<CliOutput> {
    // Return predictable output
    return {
      exitCode: 0,
      output: 'Mock output',
      durationMs: 100,
    };
  }
}

// Test
const mockAdapter = new MockCliAdapter();
const strategy = new CodeMachineCliStrategy(mockAdapter);
const result = await strategy.execute(task, context);
expect(result.success).toBe(true);
```

**Pros:**
- True isolation
- Fast tests
- No external dependencies

**Cons:**
- Manual mock maintenance
- Doesn't test real CLI behavior

---

### 6.2 Spy/Stub (Integration)

```typescript
import { stub } from 'sinon';

it('should handle timeout', async () => {
  const spawnStub = stub(child_process, 'spawn');
  spawnStub.returns({
    // ... mock child process ...
    kill: () => { /* simulate timeout */ },
  });

  const adapter = new CliAdapter(config);
  await expect(adapter.execute()).rejects.toThrow('timeout');
});
```

**Pros:**
- Tests real adapter code
- Can simulate failures

**Cons:**
- Requires stubbing
- Mocking child_process is complex

---

### 6.3 Docker Container (Full Integration)

```typescript
// tests/integration/cli.test.ts
describe('CodeMachineCLI Integration', () => {
  before(async () => {
    // Start CodeMachine CLI in Docker
    container = await docker.run('codemachine:test');
  });

  it('should analyze code', async () => {
    const adapter = new CliAdapter({
      cliPath: `docker exec ${container.id} codemachine`,
      workspaceDir: '/workspace',
    });

    const result = await adapter.execute('analyze', { target: './src' });
    expect(result.exitCode).toBe(0);
  });

  after(async () => {
    await container.stop();
  });
});
```

**Pros:**
- Tests real CLI behavior
- Production-like environment
- Catches integration issues

**Cons:**
- Slow (Docker startup)
- Complex setup
- Requires Docker

**Recommendation:** Use mock adapters for unit tests, Docker containers for integration tests

---

## 7. Architecture Decision Matrix

| Aspect | EventEmitter | Async Iterator | Callback | Promise |
|--------|--------------|----------------|----------|---------|
| **Streaming** | ✅ Excellent | ✅ Good | ✅ Good | ❌ Poor |
| **Multiple Subscribers** | ✅ Yes | ❌ No | ⚠️ Complex | ❌ No |
| **Error Handling** | ⚠️ Event-based | ✅ Try/catch | ⚠️ Callback | ✅ Try/catch |
| **Familiarity** | ✅ Standard | ❌ New | ✅ Common | ✅ Standard |
| **Memory Efficient** | ✅ Streaming | ✅ Streaming | ⚠️ Buffers | ❌ Buffers |
| **Testing** | ⚠️ Setup listeners | ✅ Clean | ✅ Easy | ✅ Easy |
| **Complexity** | Low | Medium | Low | Minimal |

**Recommendation for CodeMachine:** **EventEmitter** (streaming NDJSON is primary use case)

---

## 8. Recommended Architecture Summary

```
CodeMachineCLIAdapter (Main Class)
├── extends EventEmitter (for streaming NDJSON)
├── Dependencies injected (config, logger)
├── Lazy initialization (explicit initialize() call)
├── Graceful timeout (SIGTERM → grace period → SIGKILL)
├── Hybrid error classification (exit code + patterns)
├── State machine lifecycle (created → ready → executing → cleaned)
└── Cause chain preservation (error.cause)

Used by:
└── CodeMachineCliStrategy
    ├── implements ExecutionStrategy
    ├── routes tasks to CLI
    ├── maps CLI output to strategy results
    └── handles cleanup

Testing:
├── Unit: Mock adapter, isolated strategy tests
├── Integration: Spy on spawn, simulate failures
└── End-to-end: Docker container with real CLI
```

---

## 9. Migration Path (If Changing Implementation)

### From Monolithic to Adapter

**Phase 1:** Extract CLI logic
```typescript
// Before: CLI code in strategy
// After: Extract to CodeMachineCLIAdapter
```

**Phase 2:** Create adapter interface
```typescript
interface CliAdapter {
  execute(command: string, args: Record<string, unknown>): Promise<CliOutput>;
}
```

**Phase 3:** Implement adapter
```typescript
export class CodeMachineCLIAdapter implements CliAdapter { ... }
```

**Phase 4:** Update strategy
```typescript
export class CodeMachineCliStrategy implements ExecutionStrategy {
  constructor(private adapter: CliAdapter) { }
  async execute(task, context) {
    const result = await this.adapter.execute(...);
  }
}
```

**Phase 5:** Deprecate old code
- Mark monolithic strategy as deprecated
- Update all references
- Remove in next major version

---

## Conclusion

**Recommended for CodeMachine:**

1. **Architecture:** Adapter Pattern (CLI isolated from strategy)
2. **Streaming:** EventEmitter (real-time NDJSON events)
3. **Errors:** Hybrid classification (exit code + patterns)
4. **Timeout:** Graceful with force-kill grace period
5. **Lifecycle:** Lazy initialization with state machine
6. **Testing:** Mock adapters + Docker integration tests

This provides production-grade reliability, testability, observability, and maintainability while following Node.js standards.

