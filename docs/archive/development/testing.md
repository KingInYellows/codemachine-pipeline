# Testing Practices

This guide documents testing practices for the codemachine-pipeline project.

## Overview

| Component | Framework | Location |
|-----------|-----------|----------|
| Test Runner | Vitest v4 | `vitest.config.ts` |
| Unit Tests | Vitest | `tests/unit/` |
| Integration Tests | Vitest | `tests/integration/` |
| Coverage | V8 | `coverage/` |

## Test File Conventions

### Naming

- Use `.spec.ts` suffix for all test files
- Match the source file name: `queueStore.ts` → `queueStore.spec.ts`

### Directory Structure

```
tests/
├── unit/           # Unit tests (flat structure, ~60–65 files)
├── integration/    # Integration tests (~15 files)
├── performance/    # Performance benchmarks
└── fixtures/       # Test fixtures and mocks
    ├── sample_repo/
    ├── github/
    ├── linear/
    └── mock-cli/
```

### Import Pattern

Tests import from source using relative paths with `.js` extension (TypeScript resolution):

```typescript
import { loadQueue, initializeQueue } from '../../src/workflows/queueStore.js';
import { createRunDirectory } from '../../src/persistence/runDirectoryManager.js';
```

## Running Tests Locally

### NPM Scripts

```bash
# Run all tests (config → http → integration → commands)
npm test

# Run specific test suites (included in npm test)
npm run test:config          # Core config tests
npm run test:http            # HTTP client and unit tests
npm run test:integration     # Core integration tests (resume, status, engine)
npm run test:commands        # CLI command tests

# Optional test suites (not included in npm test)
npm run test:telemetry       # Logger/telemetry tests
npm run test:smoke           # Smoke execution test

# Watch mode
npm run test:config:watch

# Coverage report
npm run test:config:coverage
```

### Running Individual Files

```bash
# Run a specific test file
npx vitest run tests/unit/queueStore.spec.ts

# Run with verbose output
npx vitest run tests/unit/queueStore.spec.ts --reporter=verbose

# Run in watch mode
npx vitest watch tests/unit/queueStore.spec.ts
```

### Coverage

Coverage is configured with V8 provider:

```bash
npm run test:config:coverage
```

Reports are generated in:
- Text reporter - coverage summary printed to terminal/stdout (no output directory)
- `coverage/html` - Interactive HTML report
- `coverage/lcov.info` - LCOV format for CI

## Writing New Tests

### Basic Structure (Arrange-Act-Assert)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ModuleName', () => {
  describe('functionName', () => {
    it('should do expected behavior', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

### Temporary Directory Pattern

For tests that need filesystem isolation:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('FileBasedTest', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should work with files', async () => {
    const filePath = path.join(tempDir, 'test.json');
    await fs.writeFile(filePath, '{}');
    // ... test logic
  });
});
```

### Run Directory Pattern

For tests requiring a full run directory structure:

```typescript
import { createRunDirectory, writeManifest } from '../../src/persistence/runDirectoryManager.js';

describe('QueueTests', () => {
  let tempDir: string;
  let runDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'queuestore-test-'));
    runDir = await createRunDirectory(tempDir, 'FEATURE-TEST', {
      title: 'Test Feature',
      repoUrl: 'https://github.com/test/repo',
      defaultBranch: 'main',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
```

### Queue Integrity Cache

When testing queue integrity verification, reset the cache between scenarios:

```typescript
import { invalidateV2Cache } from '../../src/workflows/queueStore.js';

beforeEach(async () => {
  // ... create runDir
  invalidateV2Cache(runDir);  // Reset integrity cache
});
```

## Mocking Patterns

### Function Mocks with `vi.fn()`

```typescript
import { vi } from 'vitest';
import type { Mock } from 'vitest';

interface Logger {
  debug: (msg: string, ctx?: object) => void;
  info: (msg: string, ctx?: object) => void;
  warn: (msg: string, ctx?: object) => void;
  error: (msg: string, ctx?: object) => void;
}

type MockedLogger = {
  [K in keyof Logger]: Mock;
};

const mockLogger: MockedLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Verify mock calls
expect(mockLogger.warn).toHaveBeenCalledWith(
  'Retrying after error',
  expect.objectContaining({ errorType: 'TRANSIENT' })
);
```

### Module Mocks with `vi.mock()`

```typescript
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    open: vi.fn(actual.open),  // Spy on open while keeping other methods
  };
});
```

### HTTP Mocking with undici MockAgent

```typescript
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';

describe('HttpClient', () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    originalDispatcher = getGlobalDispatcher();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  it('should handle API responses', async () => {
    // Assuming 'client' is your HTTP client instance (e.g., from src/clients/)
    const pool = mockAgent.get('https://api.github.com');

    pool
      .intercept({
        path: '/repos/test/repo',
        method: 'GET',
      })
      .reply(200, { name: 'repo' }, {
        headers: { 'content-type': 'application/json' },
      });

    const response = await client.get('/repos/test/repo');
    expect(response.data.name).toBe('repo');
  });
});
```

### Capturing Request Details

```typescript
pool
  .intercept({ path: '/test', method: 'POST' })
  .reply((opts) => {
    // Capture body
    const body = JSON.parse(opts.body as string);

    // Capture headers
    let headers: Record<string, string>;
    if (Array.isArray(opts.headers)) {
      headers = {};
      for (let i = 0; i < opts.headers.length; i += 2) {
        const key = opts.headers[i] as string;
        const value = opts.headers[i + 1] as string;
        headers[key] = value;
      }
    } else {
      headers = opts.headers as Record<string, string>;
    }

    return {
      statusCode: 201,
      data: { id: 1 },
      headers: { 'content-type': 'application/json' },
    };
  });
```

## CI Integration

Tests run automatically in GitHub Actions on:
- Push to `main`/`master`
- Pull requests to `main`/`master`

### CI Pipeline (`ci.yml`)

```yaml
jobs:
  test:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

> Note: In the actual GitHub Actions workflow configuration (for example, `.github/workflows/ci.yml`), all actions are pinned to specific commit SHAs for security and reproducibility. The example above uses major-version tags (`@v4`) for readability only.
### Coverage Uploads

Coverage reports are uploaded to Codecov on successful test runs:

```yaml
- uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
    flags: unittests
```

## Troubleshooting

### Common Failures

| Issue | Solution |
|-------|----------|
| `ENOENT` on temp files | Ensure `afterEach` cleanup doesn't run before async operations complete |
| Module not found | Check import path uses `.js` extension |
| Timeout errors | Increase test timeout: `{ timeout: 30000 }` in test config |
| Mock not working | Ensure `vi.mock()` is called before imports at module level |

### Queue Integrity Test Failures

If queue tests fail with stale cache issues:

```typescript
// Always invalidate cache when creating a new run directory
invalidateV2Cache(runDir);
```

### Debugging

```bash
# Run with Node debugger
node --inspect-brk ./node_modules/.bin/vitest run tests/unit/mytest.spec.ts

# Enable verbose logging
DEBUG=* npm test

# Run single test with extra output
npx vitest run tests/unit/mytest.spec.ts --reporter=verbose --logHeapUsage
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OCLIF_SKIP_MANIFEST` | Skip oclif manifest generation in tests |
| `TZ=UTC` | Consistent timezone for date tests |
| `DEBUG` | Enable debug logging |

## Configuration Reference

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    // Tests are discovered in both src/ (for config tests) and tests/
    include: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'tests/**/*.spec.ts',
      'tests/**/*.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
});
```

