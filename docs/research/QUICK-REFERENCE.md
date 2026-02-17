# CLI Adapter Pattern — Quick Reference Cards

Fast lookup guide for common patterns and decisions.

---

## Card 1: Adapter Architecture at a Glance

```typescript
// Minimal complete example
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface CliOutput {
  exitCode: number;
  output: string;
  durationMs: number;
}

export class CodeMachineCLIAdapter extends EventEmitter {
  constructor(
    private cliPath: string,
    private workspaceDir: string,
    private timeoutMs: number = 60000
  ) {
    super();
  }

  async execute(command: string, args: Record<string, unknown> = {}): Promise<CliOutput> {
    const startTime = Date.now();
    const cliArgs = [command, ...this.buildArgs(args)];

    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, cliArgs, {
        cwd: this.workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
        this.emit('output', chunk.toString());
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({
            exitCode: 0,
            output,
            durationMs: Date.now() - startTime,
          });
        } else {
          reject(new Error(`Exit code ${code}`));
        }
      });
    });
  }

  private buildArgs(args: Record<string, unknown>): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value !== null && value !== undefined) {
        if (typeof value === 'boolean' && value) {
          result.push(`--${key}`);
        } else if (!['boolean'].includes(typeof value)) {
          result.push(`--${key}`, String(value));
        }
      }
    }
    return result;
  }
}

// Usage
const adapter = new CodeMachineCLIAdapter('codemachine', process.cwd());
const result = await adapter.execute('analyze', { target: './src' });
```

---

## Card 2: Error Classification Decision Tree

```
Exit Code Analysis
│
├─ 0: SUCCESS
│  └─ Return success result
│
├─ 1-127: General/app error
│  └─ Check stderr patterns:
│     ├─ /timeout|timed out/i → TRANSIENT (retry)
│     ├─ /connection refused|ECONNREFUSED/i → TRANSIENT (retry)
│     ├─ /no such file|not found/i → PERMANENT (fail)
│     ├─ /permission denied|EACCES/i → HUMAN_REQUIRED (manual)
│     └─ (no match) → PERMANENT (fail)
│
├─ 127: Command not found
│  └─ PERMANENT (CLI missing)
│
├─ 128-134 (128+N): Killed by signal N
│  └─ TRANSIENT (retry)
│
└─ 255+: Overflow/special
   └─ PERMANENT (unusual state)
```

**Implementation:**

```typescript
export function classifyError(exitCode: number, stderr: string): ErrorType {
  // Fast path: exit codes
  if (exitCode === 0) return 'success';
  if (exitCode === 2 || exitCode === 127) return 'permanent';
  if (exitCode >= 128) return 'transient';

  // Detailed path: pattern matching
  if (/timeout|timed out/i.test(stderr)) return 'transient';
  if (/connection refused/i.test(stderr)) return 'transient';
  if (/no such file|not found/i.test(stderr)) return 'permanent';
  if (/permission denied/i.test(stderr)) return 'human_required';

  return 'permanent'; // Conservative default
}
```

---

## Card 3: Timeout Management

```
Timeline with Graceful Shutdown
│
├─ 0ms: Execute command
│  └─ Set timeout handler
│
├─ T-5000ms: Timeout fires
│  └─ child.kill('SIGTERM')
│     └─ Process gets 5 seconds to cleanup
│
├─ T: Deadline reached
│  └─ Check if process still alive
│     ├─ Yes: child.kill('SIGKILL')
│     └─ No: Already exited
│
├─ T+100ms: Child exit event
│  └─ Resolve/reject promise
│     └─ Clean up timeout handlers
```

**Code:**

```typescript
const timeout1 = setTimeout(() => {
  child.kill('SIGTERM'); // Graceful
}, timeoutMs);

const timeout2 = setTimeout(() => {
  if (!child.killed) {
    child.kill('SIGKILL'); // Force
  }
}, timeoutMs + 5000);

child.on('exit', () => {
  clearTimeout(timeout1);
  clearTimeout(timeout2);
  // resolve/reject
});
```

---

## Card 4: Streaming NDJSON Events

```typescript
// Pattern: Emit events as they arrive (don't buffer)
child.stdout?.on('data', (chunk: Buffer) => {
  output += chunk.toString();

  // Parse complete lines
  const lines = output.split('\n');

  // Emit all complete lines (all but last)
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line) {
      try {
        const event = JSON.parse(line);
        this.emit('event', event); // ← Emit immediately
      } catch {
        this.emit('line', line); // Not JSON
      }
    }
  }

  // Keep incomplete last line
  output = lines[lines.length - 1];
});

// Usage
adapter.on('event', (event) => {
  console.log('Progress:', event);
});

adapter.on('line', (line) => {
  console.log('Output:', line);
});

await adapter.execute('command', args);
```

---

## Card 5: Type-Safe Argument Building

```typescript
// Problem: Type errors and injection attacks
// Solution: Type-safe builder with validation

interface BuilderConfig {
  command: string; // string
  target: string; // string
  verbose?: boolean; // boolean → --verbose (no value)
  exclude?: string[]; // array → --exclude a --exclude b
  timeout?: number; // number → --timeout 30
  maxArgs?: number; // override default 1000
}

class ArgumentBuilder {
  private args: string[] = [];
  private errors: string[] = [];

  add(key: string, value: unknown, required = false): this {
    if (required && (value === null || value === undefined)) {
      this.errors.push(`Required: ${key}`);
      return this;
    }

    if (value === null || value === undefined) return this;

    if (typeof value === 'boolean') {
      if (value) this.args.push(`--${this.kebab(key)}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.args.push(`--${this.kebab(key)}`, String(item));
      }
    } else {
      this.args.push(`--${this.kebab(key)}`, String(value));
    }

    return this;
  }

  build(): string[] {
    if (this.errors.length > 0) {
      throw new Error(this.errors.join('\n'));
    }
    return this.args;
  }

  private kebab(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }
}

// Usage
const args = new ArgumentBuilder()
  .add('command', 'analyze', true) // Required
  .add('target', './src', true)
  .add('verbose', true) // Boolean flag
  .add('exclude', ['node_modules', 'dist'])
  .add('timeout', 30000)
  .build();

// Result: ['command', 'analyze', '--target', './src', '--verbose', ...]
```

---

## Card 6: Lifecycle State Machine

```
States and Valid Transitions

  ┌─────────────────────────────────────────┐
  │                                         │
  │  created ──────────────────────────→ ready
  │    ▲          initialize()             ▲ │
  │    │                          │ execute()
  │    │                          ▼
  │    └──────── error ←──────── executing
  │                ▲
  │                │ cleanup()
  │                ▼
  │             cleaned

Rules:
- Can only initialize() from 'created'
- Can only execute() from 'ready'
- Any error → 'error' state
- Can always cleanup()
- After cleanup() → 'cleaned'
```

**Implementation:**

```typescript
type State = 'created' | 'validating' | 'ready' | 'executing' | 'error' | 'cleaned';

export class Adapter {
  private state: State = 'created';

  async initialize(): Promise<void> {
    if (this.state !== 'created') throw new Error(`Cannot init in state: ${this.state}`);
    this.state = 'validating';
    try {
      // ... validation ...
      this.state = 'ready';
    } catch (e) {
      this.state = 'error';
      throw e;
    }
  }

  async execute(): Promise<void> {
    if (this.state !== 'ready') throw new Error(`Cannot execute in state: ${this.state}`);
    this.state = 'executing';
    try {
      // ... execution ...
      this.state = 'ready';
    } catch (e) {
      this.state = 'error';
      throw e;
    }
  }

  async cleanup(): Promise<void> {
    // ... cleanup any resources ...
    this.state = 'cleaned';
  }
}
```

---

## Card 7: Mock Adapter for Testing

```typescript
// Mock implementation for testing without real CLI
export class MockCliAdapter extends EventEmitter {
  async initialize(): Promise<void> {
    // Instantly ready
  }

  async execute(command: string, args?: Record<string, unknown>): Promise<CliOutput> {
    // Simulate streaming events
    setImmediate(() => {
      this.emit('event', { type: 'analysis_started', command });
      this.emit('event', { type: 'analysis_complete', issues: 0 });
    });

    return {
      exitCode: 0,
      output: '{"type":"analysis_complete","issues":0}',
      durationMs: 100,
    };
  }

  async cleanup(): Promise<void> {
    // No-op
  }
}

// Test
it('should handle CLI output', async () => {
  const adapter = new MockCliAdapter();
  const strategy = new Strategy(adapter);

  const result = await strategy.execute(task, context);
  expect(result.success).toBe(true);
});
```

---

## Card 8: Integration with ExecutionStrategy

```typescript
// Three steps: Config → Initialize → Execute

// Step 1: Create strategy with adapter
const strategy = new CodeMachineCliStrategy({
  adapter: createCodeMachineCLIAdapter({
    cliPath: '/usr/local/bin/codemachine',
    workspaceDir: process.cwd(),
    timeoutMs: 60000,
  }),
});

// Step 2: Initialize (optional, can be lazy)
await strategy.adapter.initialize();

// Step 3: Execute task
const result = await strategy.execute(task, {
  runDir: '/tmp/run',
  workspaceDir: process.cwd(),
  logPath: '/tmp/run/logs',
  timeoutMs: 30000,
});

// Result shape
if (result.success) {
  console.log('✓ Completed in', result.durationMs, 'ms');
  console.log('Artifacts:', result.artifacts);
} else if (result.recoverable) {
  console.log('✗ Recoverable error, can retry');
} else {
  console.log('✗ Permanent error:', result.errorMessage);
}
```

---

## Card 9: Common Pitfalls & Fixes

| Pitfall                        | Fix                                            |
| ------------------------------ | ---------------------------------------------- |
| **Not clearing timeouts**      | Always `clearTimeout()` in exit handler        |
| **Buffering large output**     | Use events instead, stream data                |
| **Ignoring stderr**            | Parse stderr for error classification          |
| **Synchronous initialization** | Make initialize() async with validation        |
| **No error cause chain**       | Always wrap errors: `{ cause: originalError }` |
| **Killing immediately**        | Use SIGTERM first, SIGKILL after grace period  |
| **Leaking processes**          | Call cleanup() in finally blocks               |
| **Not validating CLI**         | Call validateCli() during initialize()         |
| **Escaping without shell**     | With `shell: false`, minimal escaping needed   |
| **No timeout management**      | Always set timeout and handle cleanup          |

---

## Card 10: Pattern Selection Checklist

**Choose EventEmitter if:**

- [ ] Output is streaming (NDJSON, large files)
- [ ] Multiple consumers need events (logging, metrics, processing)
- [ ] Real-time progress indication needed
- [ ] Output is unbounded in size

**Choose Async Iterator if:**

- [ ] Sequential processing needed
- [ ] Backpressure handling required
- [ ] Single consumer
- [ ] Want natural error handling (try/catch)

**Choose Promise if:**

- [ ] Small, one-shot execution
- [ ] Need simple API
- [ ] No event streaming
- [ ] Output fits in memory

**Choose Callback if:**

- [ ] Legacy codebase
- [ ] Simple one-off scripts
- [ ] Multiple independent handlers (but prefer EventEmitter)

---

## Card 11: Testing Checklist

**Unit Tests (Mock Adapter)**

- [ ] Error handling (exit codes, stderr patterns)
- [ ] Argument building (boolean flags, arrays, escaping)
- [ ] Timeout logic (SIGTERM, grace period, SIGKILL)
- [ ] Event emission (listeners, error events)
- [ ] State machine (invalid state transitions)

**Integration Tests (Real CLI)**

- [ ] CLI available and valid
- [ ] Simple command execution
- [ ] Large output streaming
- [ ] NDJSON event parsing
- [ ] Timeout behavior
- [ ] Process cleanup

**E2E Tests (Full Stack)**

- [ ] Real task execution
- [ ] File I/O
- [ ] Network (if applicable)
- [ ] Failure scenarios
- [ ] Performance

---

## Card 12: Performance Optimization Tips

| Optimization                   | Impact                     | Cost              |
| ------------------------------ | -------------------------- | ----------------- |
| Event streaming (no buffering) | Memory: O(1) vs O(n)       | Low               |
| Exit code fast path            | Error classification: ~1ms | Low               |
| Lazy initialization            | Startup: -CLI check time   | Low               |
| Argument validation            | Prevents bad requests      | Negligible        |
| Process pooling                | Startup: -spawn overhead   | High (complexity) |
| Caching results                | Memory usage: +cache size  | Medium            |

**Recommended priorities:**

1. Event streaming (required for large output)
2. Exit code classification (fast, accurate)
3. Lazy initialization (defers expensive work)

---

## Card 13: One-Liner Cheat Sheet

```typescript
// Create adapter
const adapter = createCodeMachineCLIAdapter({ cliPath: 'codemachine', workspaceDir: '.' });

// Initialize
await adapter.initialize();

// Execute
const { exitCode, output } = await adapter.execute('analyze', { target: './src' });

// Handle events
adapter.on('event', (e) => console.log(e));

// Classify error
if (error instanceof CliAdapterError && error.isRetryable()) {
  retry();
}

// Cleanup
await adapter.cleanup();

// With strategy
const strategy = new CodeMachineCliStrategy({ cliPath: 'codemachine' });
const result = await strategy.execute(task, context);

// Mock for testing
const mock = new MockCliAdapter();
```

---

## Card 14: Decision Tree: Which Pattern to Use?

```
Need to wrap external CLI?
│
├─ YES
│  │
│  ├─ Streaming output?
│  │  ├─ YES → EventEmitter ✓ (recommended)
│  │  └─ NO
│  │     ├─ Multiple consumers?
│  │     │  ├─ YES → EventEmitter
│  │     │  └─ NO → Promise (simple) or AsyncIterator (complex)
│  │     └─ Need backpressure?
│  │        ├─ YES → AsyncIterator
│  │        └─ NO → Promise
│  │
│  └─ Error handling?
│     ├─ Need retry logic?
│     │  ├─ YES → Hybrid error classification (exit code + patterns)
│     │  └─ NO → Exit code only
│     └─ Need cause chain?
│        ├─ YES → Always wrap with cause
│        └─ NO → Simple error message

Timeout strategy?
├─ SIGTERM only → Simple but risks zombies
├─ SIGTERM + SIGKILL → Recommended (graceful + forceful)
└─ SIGKILL only → Works but no graceful shutdown

Lifecycle?
├─ Constructor init → NOT recommended (validation in ctor is anti-pattern)
├─ Lazy init (explicit initialize()) → Recommended
└─ Factory function → Also good

Testing?
├─ Unit tests → Use MockCliAdapter
├─ Integration tests → Real CLI or Docker
└─ E2E tests → Full stack with all dependencies
```

---

## Quick Copy-Paste Templates

### Template 1: Minimal Adapter

```typescript
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class MinimalCliAdapter extends EventEmitter {
  constructor(private cliPath: string) {
    super();
  }

  async execute(cmd: string, args: string[] = []): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      let output = '';
      const child = spawn(this.cliPath, [cmd, ...args]);

      child.stdout?.on('data', (chunk) => {
        output += chunk.toString();
        this.emit('data', chunk);
      });

      child.on('exit', (code) => {
        if (code === 0) resolve({ exitCode: 0, output });
        else reject(new Error(`Exit code ${code}`));
      });
    });
  }
}
```

### Template 2: With Error Classification

```typescript
function classifyError(code: number, stderr: string): 'transient' | 'permanent' {
  if (code === 0) return 'transient'; // But shouldn't get here
  if (code >= 128) return 'transient'; // Signal
  if (/timeout|connection refused/i.test(stderr)) return 'transient';
  return 'permanent';
}

// In catch block
} catch (error) {
  const isRetryable = classifyError(exitCode, stderr) === 'transient';
  if (isRetryable) { retry(); } else { fail(); }
}
```

### Template 3: With Timeout

```typescript
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => child.killed || child.kill('SIGKILL'), 5000);
}, timeoutMs);

child.on('exit', () => clearTimeout(timeout));
```

---
