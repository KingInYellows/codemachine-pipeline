# TypeScript CLI Adapter Pattern Research

Research documentation on building production-grade TypeScript adapters for wrapping external CLI tools.

## Documents

### 1. [cli-adapter-patterns-research.md](./cli-adapter-patterns-research.md) — Comprehensive Reference

**What it covers:**

- CLI wrapper adapter architecture (LinearAdapter reference pattern)
- Proposed CodeMachineCLIAdapter structure
- Error handling taxonomy (exit codes, stderr patterns, error classification)
- Event emitter vs async iterator vs callback patterns
- Builder pattern for type-safe argument construction
- Adapter lifecycle (init → validate → execute → cleanup)
- Timeout management with graceful shutdown
- ExecutionStrategy integration
- Testing patterns (mock adapters, integration tests)

**Best for:** Understanding the full design, making architectural decisions

**Key sections:**

- Section 1: CLI Wrapper Adapter Architecture
- Section 2: Error Handling Taxonomy
- Section 3: Event Emitter Pattern vs Alternatives
- Section 4: Builder Pattern for Arguments
- Section 5: Adapter Lifecycle
- Section 6: Integration with ExecutionStrategy
- Section 7: Timeout Management with Signals
- Section 8: Production Patterns Summary
- Section 9: Testing Patterns
- Section 10: References & Further Reading

---

### 2. [cli-adapter-implementation-guide.md](./cli-adapter-implementation-guide.md) — Copy-Paste Ready Code

**What it covers:**

- Step-by-step implementation of CodeMachineCLIAdapter
- Type definitions and config interfaces
- Error class implementation
- Core adapter methods (initialization, execution, cleanup)
- Helper methods (environment building, error classification, argument escaping)
- ExecutionStrategy integration code
- Testing examples (unit tests, integration tests)
- Usage examples (simple execution, event streaming, retry logic)
- Integration checklist

**Best for:** Actually building the adapter

**Key sections:**

- Part 1: Core Adapter Structure (5 steps)
- Part 2: Integration with ExecutionStrategy
- Part 3: Testing
- Part 4: Usage Examples
- Part 5: Integration Checklist
- Performance Considerations

---

### 3. [cli-adapter-alternatives-analysis.md](./cli-adapter-alternatives-analysis.md) — Decision Framework

**What it covers:**

- Monolithic vs Adapter pattern (costs/benefits)
- Streaming patterns (EventEmitter vs async iterator vs callback vs promise)
- Error handling strategies (exit code, pattern matching, hybrid)
- Timeout strategies (simple, graceful, adaptive)
- Lifecycle management (constructor-based, lazy, factory)
- Testing strategies (mock adapters, spies/stubs, Docker integration)
- Architecture decision matrix
- Migration path from monolithic to adapter

**Best for:** Making design trade-offs, justifying architectural decisions

**Key sections:**

- Section 1: Monolithic vs Adapter Pattern
- Section 2: Streaming Patterns Comparison
- Section 3: Error Handling Strategies
- Section 4: Timeout Strategies
- Section 5: Lifecycle Management Patterns
- Section 6: Testing Strategies Comparison
- Section 7: Architecture Decision Matrix
- Section 8: Recommended Architecture Summary
- Section 9: Migration Path

---

## Quick Start

### For Architects/Decision Makers

1. Read [cli-adapter-alternatives-analysis.md](./cli-adapter-alternatives-analysis.md) Section 7-9
2. Review the decision matrix
3. Review recommended architecture summary

### For Developers

1. Read [cli-adapter-patterns-research.md](./cli-adapter-patterns-research.md) Sections 1-5
2. Follow [cli-adapter-implementation-guide.md](./cli-adapter-implementation-guide.md) Part 1-3
3. Copy code from Part 2-4
4. Run tests from Part 3

### For Reviewers

1. Skim [cli-adapter-patterns-research.md](./cli-adapter-patterns-research.md) Sections 1-2
2. Compare implementation against [cli-adapter-implementation-guide.md](./cli-adapter-implementation-guide.md)
3. Verify testing against Part 3

---

## Recommended Implementation Summary

### Architecture Decisions

- **Pattern:** Adapter (CLI logic isolated from strategy)
- **Streaming:** EventEmitter (for NDJSON real-time events)
- **Errors:** Hybrid (exit code fast path + pattern matching)
- **Timeout:** Graceful (SIGTERM → 5s grace period → SIGKILL)
- **Lifecycle:** Lazy initialization with state machine
- **Testing:** Mock adapters + Docker integration tests

### Key Design Principles

| Principle                | Implementation                                  |
| ------------------------ | ----------------------------------------------- |
| **Dependency Injection** | Config object + optional logger                 |
| **Error Taxonomy**       | CliErrorType enum with ErrorType classification |
| **Type Safety**          | Zod schemas for argument validation             |
| **Testability**          | Factory functions, mock-friendly logger         |
| **Streaming**            | EventEmitter for NDJSON events                  |
| **Lifecycle**            | State machine prevents invalid operations       |
| **Timeout**              | Graceful shutdown with force-kill fallback      |
| **Observability**        | Structured logging + event emission             |

### File Structure

```
src/
├── adapters/
│   ├── cli/
│   │   ├── types.ts                    # Type definitions
│   │   ├── CliAdapterError.ts          # Error class
│   │   ├── CodeMachineCLIAdapter.ts    # Main adapter
│   │   └── index.ts                    # Exports
│   └── index.ts
├── workflows/
│   ├── codeMachineCliStrategy.ts       # ExecutionStrategy implementation
│   └── ...
└── ...

tests/
├── unit/
│   └── adapters/
│       └── cli.test.ts                 # Adapter tests
└── integration/
    └── adapters/
        └── cli.test.ts                 # Integration tests
```

### Implementation Steps

1. Create `src/adapters/cli/types.ts` with type definitions
2. Create `src/adapters/cli/CliAdapterError.ts` with error class
3. Create `src/adapters/cli/CodeMachineCLIAdapter.ts` with main adapter
4. Create `src/adapters/cli/index.ts` with exports
5. Create `src/workflows/codeMachineCliStrategy.ts` for strategy integration
6. Update `src/adapters/index.ts` to export CLI adapter
7. Create `tests/unit/adapters/cli.test.ts` with tests
8. Update `cliExecutionEngine.ts` to register CLI strategy

---

## Key Code Examples

### Type-Safe Execution

```typescript
const adapter = createCodeMachineCLIAdapter({
  cliPath: '/usr/local/bin/codemachine',
  workspaceDir: process.cwd(),
  timeoutMs: 60000,
});

await adapter.initialize();

// Type-safe arguments with builder pattern
const result = await adapter.execute('analyze', {
  target: './src',
  verbose: true,
  exclude: ['node_modules', 'dist'],
});
```

### Event Streaming

```typescript
adapter.on('event', (event) => {
  console.log('Parsed NDJSON event:', event);
});

adapter.on('stderr', (chunk) => {
  console.log('Error output:', chunk);
});

await adapter.execute('command', args);
```

### Error Handling

```typescript
try {
  await adapter.execute('command', args);
} catch (error) {
  if (error instanceof CliAdapterError) {
    if (error.isRetryable()) {
      // Transient error, can retry
      console.log('Retryable error:', error.message);
    } else {
      // Permanent error, don't retry
      console.log('Permanent error:', error.message);
    }
  }
}
```

### ExecutionStrategy Integration

```typescript
const strategy = createCodeMachineCliStrategy({
  cliPath: 'codemachine',
  logger: myLogger,
});

const result = await strategy.execute(task, {
  runDir: '/tmp/run',
  workspaceDir: process.cwd(),
  logPath: '/tmp/run/logs',
  timeoutMs: 30000,
});

if (result.success) {
  console.log('Task completed:', result.artifacts);
} else if (result.recoverable) {
  console.log('Recoverable error, can retry');
}
```

---

## Error Classification

### Exit Code Mapping

```
0      = Success
1      = General error (classify by stderr patterns)
2      = Misuse of shell → PERMANENT
127    = Command not found → PERMANENT
128+   = Killed by signal → TRANSIENT
```

### Stderr Pattern Examples

```
timeout              → TRANSIENT (can retry)
connection refused   → TRANSIENT (can retry)
no such file         → PERMANENT (don't retry)
permission denied    → HUMAN_REQUIRED (operator action)
out of memory        → TRANSIENT (retry later)
```

---

## Testing Strategy

### Unit Tests (Fast, Isolated)

- Mock adapter for strategy tests
- No external dependencies
- Test error handling, argument building, timeout logic

### Integration Tests (Medium, Real CLI)

- Use real CodeMachine CLI
- Docker container for isolation
- Test streaming, output parsing, real behavior

### E2E Tests (Slow, Full Stack)

- Real CLI, real files, real network
- Verify end-to-end task execution
- Only for critical paths

---

## Performance Characteristics

| Operation                 | Time   | Notes                   |
| ------------------------- | ------ | ----------------------- |
| Adapter initialization    | ~100ms | CLI version check       |
| Command execution (small) | ~500ms | Typical command         |
| Event emission            | <1ms   | Per event, async        |
| Argument building         | <1ms   | Type-safe validation    |
| Timeout + cleanup         | ~5s    | Graceful shutdown       |
| Memory (1GB output)       | ~1GB   | Streamed (not buffered) |

---

## Migration from Existing Code

If adapting an existing monolithic ExecutionStrategy:

1. Extract CLI spawning logic to new adapter class
2. Create adapter config interface with dependency injection
3. Implement error taxonomy mapping
4. Update strategy to use adapter instead of inline CLI code
5. Add event subscription for observability
6. Add tests for both adapter and strategy
7. Gradually migrate clients to use new adapter directly

Example migration:

```typescript
// Before: CLI code in strategy
export class CodeMachineStrategy implements ExecutionStrategy {
  async execute(task, context) {
    const child = spawn('codemachine', [task.title]);
    // ... CLI handling mixed with strategy logic ...
  }
}

// After: Clean separation
export class CodeMachineStrategy implements ExecutionStrategy {
  constructor(private adapter: CodeMachineCLIAdapter) {}

  async execute(task, context) {
    const result = await this.adapter.execute(task.title, args);
    return this.mapToStrategy(result);
  }
}
```

---

## Further Reading

### Related Technologies

- Node.js `child_process` module: Process spawning, signals
- EventEmitter: Pub/sub pattern for streaming events
- NDJSON format: Newline-delimited JSON for streaming
- Unix signals: SIGTERM (graceful), SIGKILL (force)

### Related ADRs/Patterns

- ADR-3: Execution Strategy Pattern (decision to use strategies)
- ADR-6: Linear Adapter Pattern (HTTP adapter reference)
- ADR-7: Error Taxonomy (classification approach)

### Production Examples

- Terraform CDK (TypeScript): CLI spawning with backpressure
- Pulumi (TypeScript): Event-based streaming output
- Docker SDK (Node.js): Process management patterns
- Kubernetes Client (JavaScript): Stream handling

---

## Questions?

For questions about this research:

1. Check the specific document (patterns, implementation, or alternatives)
2. Review the code examples in the implementation guide
3. Compare against decision matrix in alternatives analysis
4. Refer to "Testing Patterns" for test examples
