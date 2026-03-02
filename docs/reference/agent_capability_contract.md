# Agent Capability Contract

**Document Version:** 1.0.0
**Last Updated:** 2025-12-17
**Status:** Active
**Related ADRs:** ADR-1 (Agent Execution Model), ADR-4 (Context/Token Budget), ADR-7 (Validation Policy)
**Section Reference:** Section 2.1 (Agent Adapter Contract)

---

## Overview

This document defines the **Agent Adapter Contract** for execution contexts within the CodeMachine pipeline. The contract specifies how execution tasks route to agent providers, how capabilities are negotiated, error taxonomies for deterministic failure handling, and fallback strategies for resilience.

The adapter layer enables **bring-your-own-agent (BYO)** workflows by decoupling orchestration logic from provider-specific implementations through declarative capability manifests.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Execution Contexts](#execution-contexts)
3. [Capability Negotiation](#capability-negotiation)
4. [Error Taxonomy](#error-taxonomy)
5. [Fallback Logic](#fallback-logic)
6. [Cost Tracking](#cost-tracking)
7. [Session Telemetry](#session-telemetry)
8. [Manifest Schema](#manifest-schema)
9. [Implementation Guide](#implementation-guide)
10. [Examples](#examples)

---

## Architecture Overview

### Component Responsibilities

```
ExecutionTask → AgentAdapter → ManifestLoader → Provider Manifests
                     ↓
              CostTracker + Logger + Telemetry
```

**AgentAdapter**

- Maps execution contexts to capability requirements
- Selects optimal provider via ManifestLoader
- Classifies errors using taxonomy (transient/permanent/humanAction)
- Handles fallback retries with rate-limit awareness
- Records session telemetry for auditability

**ManifestLoader**

- Loads and validates provider manifests from `.codepipe/agents/*.json`
- Caches manifests with SHA-256 hash-based change detection
- Filters providers by capability requirements
- Ranks candidates by cost-effectiveness
- Registers cost configs with CostTracker

**Provider Manifests**

- Declarative JSON files describing models, tools, features, costs, rate limits
- Supports optional `fallbackProvider` for automatic retry
- Defines error taxonomy rules via `errorTaxonomy` field (optional)
- Context-specific overrides via `executionContexts` field (optional)

### Data Flow

1. **Task Creation**: ExecutionTask specifies `task_type` (e.g., `code_generation`)
2. **Context Mapping**: AgentAdapter maps `task_type` → `ExecutionContext` → `ProviderRequirements`
3. **Provider Selection**: ManifestLoader filters + ranks providers by cost
4. **Session Execution**: Adapter invokes provider SDK with structured prompt
5. **Error Handling**: Classify error → retry transient with fallback → record telemetry
6. **Cost Attribution**: CostTracker records usage by provider/model/feature/task

---

## Execution Contexts

### Context Definitions

Execution contexts map ExecutionTask types to provider capability requirements. Each context specifies minimum context windows, required features, required tools, and cost budgets.

| Context           | Min Context | Required Features | Required Tools            | Max Cost (USD/1k tokens) |
| ----------------- | ----------- | ----------------- | ------------------------- | ------------------------ |
| `code_generation` | 8,000       | codeGeneration    | functionCalling, jsonMode | 0.15                     |
| `code_review`     | 16,000      | codeReview        | jsonMode                  | 0.10                     |
| `test_generation` | 8,000       | testGeneration    | functionCalling, jsonMode | 0.12                     |
| `refactoring`     | 12,000      | codeGeneration    | functionCalling           | 0.15                     |
| `documentation`   | 6,000       | summarization     | -                         | 0.08                     |
| `prd_generation`  | 10,000      | prdGeneration     | jsonMode                  | 0.10                     |
| `spec_generation` | 12,000      | specGeneration    | jsonMode                  | 0.12                     |
| `summarization`   | 4,000       | summarization     | -                         | 0.05                     |

### Task Type Mapping

ExecutionTask types map to execution contexts as follows:

```typescript
const TASK_TO_CONTEXT: Record<ExecutionTaskType, ExecutionContext> = {
  code_generation: 'code_generation',
  testing: 'test_generation',
  review: 'code_review',
  refactoring: 'refactoring',
  documentation: 'documentation',
  pr_creation: 'summarization', // PR descriptions
  deployment: 'documentation', // Deployment docs
  other: 'summarization', // Generic fallback
};
```

---

## Capability Negotiation

### Selection Algorithm

1. **Translate Context**: Map `ExecutionContext` → `ProviderRequirements`
   - Extract `minContextWindow`, `requiredFeatures`, `requiredTools`, `maxCostPer1kTokens`
2. **Filter Providers**: ManifestLoader.selectProvider(requirements, preferredProviderId?)
   - Check preferred provider first (if specified)
   - Filter all providers matching requirements
   - Return `undefined` if none match
3. **Rank by Cost**: Sort matching providers by ascending average cost
4. **Select Cheapest**: Return lowest-cost provider meeting requirements

### Capability Requirements Structure

```typescript
interface ProviderRequirements {
  minContextWindow?: number; // Minimum context window (tokens)
  requiredTools?: Partial<Tools>; // Required tool support flags
  requiredFeatures?: Partial<Features>; // Required feature support flags
  maxCostPer1kTokens?: number; // Maximum acceptable cost
  minRequestsPerMinute?: number; // Minimum rate limit capacity
}
```

### Manifest Feature Flags

**Tools** (technical capabilities):

- `streaming`: Supports streaming responses
- `functionCalling`: Supports function/tool calling
- `vision`: Supports image/vision inputs
- `jsonMode`: Supports structured JSON output mode
- `embeddings`: Supports text embedding generation

**Features** (pipeline workflows):

- `prdGeneration`: PRD generation workflow
- `specGeneration`: Specification generation workflow
- `codeGeneration`: Code generation workflow
- `codeReview`: Code review workflow
- `testGeneration`: Test generation workflow
- `summarization`: Context summarization workflow

---

## Error Taxonomy

### Error Categories

The adapter classifies all errors into three categories for deterministic failure handling:

#### 1. Transient Errors (Automatic Retry)

**Definition**: Temporary failures that may succeed on retry with backoff.

**Examples**:

- Rate limit exceeded (HTTP 429)
- Timeout / deadline exceeded
- Service unavailable (HTTP 503)
- Network errors / connection failures
- Temporary service degradation

**Handling**:

- Retry with exponential backoff (respects `retryAfterSeconds` from provider)
- Attempt fallback provider if configured
- Respect rate limit headers and manifest `rateLimits`
- Max retry attempts controlled by manifest `errorTaxonomy.retryPolicy.maxAttempts`

**Error Codes** (provider-defined, examples):

```
RATE_LIMIT_EXCEEDED
TIMEOUT
503_SERVICE_UNAVAILABLE
429_TOO_MANY_REQUESTS
NETWORK_ERROR
CONNECTION_TIMEOUT
```

#### 2. Permanent Errors (Do Not Retry)

**Definition**: Failures that will not succeed on retry without configuration changes.

**Examples**:

- Invalid API key / authentication failure (HTTP 401, 403)
- Model not found / unsupported model (HTTP 404)
- Invalid request format (HTTP 400)
- Insufficient credits / quota exceeded
- Feature not supported by provider

**Handling**:

- Do NOT retry
- Mark task as `failed` with `recoverable: false`
- Log error for operator review
- Require manual intervention (update credentials, change provider, etc.)

**Error Codes** (provider-defined, examples):

```
INVALID_API_KEY
MODEL_NOT_FOUND
400_BAD_REQUEST
401_UNAUTHORIZED
403_FORBIDDEN
404_NOT_FOUND
INSUFFICIENT_QUOTA
UNSUPPORTED_FEATURE
```

#### 3. Human Action Errors (Escalate to User)

**Definition**: Errors requiring human judgment or input clarification.

**Examples**:

- Ambiguous requirements / unclear prompt
- Content policy violation
- Safety filter triggered
- Conflicting constraints
- Requires domain expertise

**Handling**:

- Mark task as `failed` with `recoverable: false`
- Escalate to user via notification adapter
- Attach clarifying questions or policy guidance
- Require user response to resume

**Error Codes** (provider-defined, examples):

```
POLICY_VIOLATION
CONTENT_FILTER
AMBIGUOUS_INPUT
CLARIFICATION_NEEDED
SAFETY_VIOLATION
CONFLICTING_CONSTRAINTS
```

### Error Classification Logic

The adapter uses heuristic pattern matching on error messages:

```typescript
function classifyError(error: Error): AgentErrorCategory {
  const msg = error.message.toLowerCase();

  // Transient patterns
  if (
    msg.includes('timeout') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('network') ||
    msg.includes('connection')
  ) {
    return 'transient';
  }

  // Human action patterns
  if (
    msg.includes('ambiguous') ||
    msg.includes('policy violation') ||
    msg.includes('clarification') ||
    msg.includes('human review')
  ) {
    return 'humanAction';
  }

  // Default to permanent
  return 'permanent';
}
```

Providers may override classification via manifest `errorTaxonomy` fields:

- `transientErrorCodes`: Array of provider-specific codes for transient errors
- `permanentErrorCodes`: Array of provider-specific codes for permanent errors
- `humanActionErrorCodes`: Array of provider-specific codes for human action

### Retry Policy Configuration

Manifests may specify retry policy for transient errors:

```json
{
  "errorTaxonomy": {
    "retryPolicy": {
      "maxAttempts": 3,
      "baseDelayMs": 1000,
      "maxDelayMs": 60000,
      "backoffMultiplier": 2
    }
  }
}
```

**Retry Delay Calculation**:

```
delay = min(baseDelayMs * (backoffMultiplier ^ attemptNumber), maxDelayMs)
```

Example: `1000 * 2^0 = 1s`, `1000 * 2^1 = 2s`, `1000 * 2^2 = 4s`

---

## Fallback Logic

### Fallback Provider Selection

Manifests may specify `fallbackProvider` field referencing another provider ID. The adapter attempts fallback on transient errors:

1. **Primary Failure**: Invoke primary provider → transient error
2. **Check Fallback**: Read `primaryManifest.fallbackProvider`
3. **Load Fallback Manifest**: `manifestLoader.getManifest(fallbackProviderId)`
4. **Respect Rate Limits**: Wait if `retryAfterSeconds` specified
5. **Invoke Fallback**: Retry with fallback provider
6. **Record Telemetry**: Mark session as `usedFallback: true`

### Fallback Constraints

- **Only on Transient Errors**: Fallback NOT attempted for permanent/humanAction errors
- **Max Attempts**: Controlled by `AgentAdapterConfig.maxFallbackAttempts` (default: 2)
- **Rate Limit Awareness**: Respects `retryAfterSeconds` from error response
- **Cost Tracking**: Both primary + fallback costs attributed to same task

### Example Manifest with Fallback

```json
{
  "schema_version": "1.0.0",
  "providerId": "openai",
  "name": "OpenAI GPT-4",
  "version": "1.0.0",
  "fallbackProvider": "anthropic",
  "rateLimits": { "requestsPerMinute": 500 },
  "costConfig": {
    /* ... */
  },
  "errorTaxonomy": {
    "transientErrorCodes": ["RATE_LIMIT_EXCEEDED", "TIMEOUT"],
    "retryPolicy": { "maxAttempts": 2 }
  }
}
```

---

## Cost Tracking

### Cost Attribution

Every agent session records cost by:

- **Provider**: Agent provider ID (e.g., `openai`, `anthropic`)
- **Model**: Specific model ID (e.g., `gpt-4`, `claude-3-opus`)
- **Feature**: Feature ID from ExecutionTask
- **Task**: Task ID from ExecutionTask

Cost calculation:

```
costUsd = (inputTokens / 1000) * inputCostPer1kTokens +
          (outputTokens / 1000) * outputCostPer1kTokens
```

### CostTracker Integration

```typescript
costTracker.recordUsage({
  provider: 'openai',
  model: 'gpt-4',
  inputTokens: 500,
  outputTokens: 500,
  timestamp: new Date().toISOString(),
  featureId: 'FEAT-123',
  taskId: 'task-code-gen-1',
});
```

### Cost Budget Enforcement

Manifests specify per-model costs. Adapter filters providers by `maxCostPer1kTokens` from context requirements, ensuring budget compliance.

---

## Session Telemetry

### Telemetry Schema

Every session (success or failure) records:

```typescript
interface SessionTelemetry {
  sessionId: string; // Unique session ID
  taskId: string; // ExecutionTask ID
  featureId: string; // Feature ID
  context: ExecutionContext; // Execution context
  providerId: string; // Selected provider
  modelId: string; // Selected model
  manifestHash: string; // SHA-256 hash of manifest
  promptHash: string; // SHA-256 hash of prompt (redacted)
  tokensConsumed: number; // Total tokens (input + output)
  costUsd: number; // Total cost in USD
  durationMs: number; // Processing duration
  usedFallback: boolean; // Whether fallback was used
  fallbackAttempts: number; // Number of fallback attempts
  errorCategory?: AgentErrorCategory; // Error category if failed
  timestamp: string; // ISO 8601 timestamp
  metadata?: Record<string, unknown>; // Optional metadata
}
```

### Redacted Prompt Hashing

To honor auditability WITHOUT exposing sensitive repo contents:

- Prompts are hashed with SHA-256
- Telemetry stores `promptHash` instead of raw prompt
- Auditors can validate prompt consistency by comparing hashes
- Original prompts NOT persisted (security requirement)

### Telemetry Output

Telemetry records written to:

```
<run-directory>/telemetry/agent_sessions.jsonl
```

Format: JSONL (one record per line)

```json
{
  "sessionId": "session_1234_abc",
  "taskId": "task-1",
  "featureId": "FEAT-1",
  "context": "code_generation",
  "providerId": "openai",
  "modelId": "gpt-4",
  "manifestHash": "a1b2c3...",
  "promptHash": "d4e5f6...",
  "tokensConsumed": 1000,
  "costUsd": 0.09,
  "durationMs": 1500,
  "usedFallback": false,
  "fallbackAttempts": 0,
  "timestamp": "2025-12-17T10:00:00Z"
}
```

---

## Manifest Schema

### Schema Location

JSON Schema: `docs/reference/agent_manifest_schema.json`

### Required Fields

Per acceptance criteria, manifests MUST include:

- `schema_version`: Semantic version (e.g., `1.0.0`)
- `providerId`: Unique provider identifier
- `name`: Human-readable name
- `version`: Provider implementation version
- `rateLimits`: Rate limit constraints (REQUIRED)
  - `requestsPerMinute`: Maximum requests per minute
- `costConfig`: Cost configuration (REQUIRED)
  - `currency`: ISO 4217 currency code (default: `USD`)
  - `models`: Array of model pricing configs (min 1)
    - `modelId`: Model identifier
    - `inputCostPer1kTokens`: Input cost
    - `outputCostPer1kTokens`: Output cost

### Optional Fields

- `description`: Provider description
- `tools`: Tool support flags (streaming, functionCalling, vision, jsonMode, embeddings)
- `features`: Feature support flags (prdGeneration, codeGeneration, etc.)
- `endpoint`: API endpoint config (baseUrl, authMethod, timeout)
- `fallbackProvider`: Fallback provider ID
- `errorTaxonomy`: Error classification rules
  - `transientErrorCodes`: Array of transient error codes
  - `permanentErrorCodes`: Array of permanent error codes
  - `humanActionErrorCodes`: Array of human action error codes
  - `retryPolicy`: Retry policy config
- `executionContexts`: Context-specific overrides
  - `code_generation`, `code_review`, etc.
    - `preferredModelId`: Preferred model for this context
    - `maxTokensOverride`: Context-specific max tokens
    - `temperatureOverride`: Context-specific temperature
    - `timeoutOverride`: Context-specific timeout
- `metadata`: Additional provider metadata

### Schema Validation

- **CI Integration**: Schema validated during CI via JSON Schema validator
- **Runtime Validation**: ManifestLoader uses Zod for strict runtime validation
- **Error Messages**: Actionable error messages reference `agent_manifest_schema.json`

---

## Implementation Guide

### Creating a New Provider Manifest

1. **Create Manifest File**:

   ```bash
   touch .codepipe/agents/my-provider.json
   ```

2. **Define Manifest**:

   ```json
   {
     "schema_version": "1.0.0",
     "providerId": "my-provider",
     "name": "My Custom Provider",
     "version": "1.0.0",
     "description": "Custom LLM provider for internal use",
     "rateLimits": {
       "requestsPerMinute": 100,
       "tokensPerMinute": 50000
     },
     "costConfig": {
       "currency": "USD",
       "models": [
         {
           "modelId": "my-model-v1",
           "inputCostPer1kTokens": 0.01,
           "outputCostPer1kTokens": 0.02,
           "contextWindow": 8192,
           "maxOutputTokens": 2048
         }
       ]
     },
     "tools": {
       "streaming": true,
       "functionCalling": true,
       "jsonMode": true
     },
     "features": {
       "codeGeneration": true,
       "codeReview": true,
       "testGeneration": true
     },
     "endpoint": {
       "baseUrl": "https://api.myprovider.com/v1",
       "authMethod": "bearer",
       "timeout": 30000
     },
     "fallbackProvider": "openai"
   }
   ```

3. **Validate Schema**:

   ```bash
   npx ajv validate -s docs/reference/agent_manifest_schema.json \
                     -d .codepipe/agents/my-provider.json
   ```

4. **Test Integration**:

   ```typescript
   const loader = createManifestLoader(logger);
   await loader.loadManifest('.codepipe/agents/my-provider.json');

   const manifest = loader.getManifest('my-provider');
   console.log(manifest);
   ```

### Using AgentAdapter

```typescript
import { createAgentAdapter } from './adapters/agents/AgentAdapter';
import { createManifestLoader } from './adapters/agents/manifestLoader';

// 1. Initialize loader + adapter
const logger = createLogger({ level: 'info' });
const costTracker = new CostTracker(logger);
const manifestLoader = createManifestLoader(logger);
manifestLoader.setCostTracker(costTracker);

await manifestLoader.loadManifestsFromDirectory('.codepipe/agents');

const adapter = createAgentAdapter({
  manifestLoader,
  logger,
  costTracker,
  enableFallback: true,
  maxFallbackAttempts: 2,
  telemetryDir: './run-123/telemetry',
});

// 2. Execute session
try {
  const response = await adapter.executeSession({
    context: 'code_generation',
    prompt: { instruction: 'Generate user auth module', files: [...] },
    taskId: 'task-1',
    featureId: 'FEAT-123',
    preferredProviderId: 'openai', // optional
  });

  console.log('Generated:', response.output);
  console.log('Cost:', response.costUsd);
  console.log('Provider:', response.providerId);

} catch (error) {
  if (error.category === 'transient') {
    // Retry handled by adapter, this shouldn't happen
  } else if (error.category === 'humanAction') {
    // Escalate to user
    notifyUser(error.message);
  } else {
    // Permanent failure
    logError(error);
  }
}

// 3. View statistics
const stats = adapter.getStatistics();
console.log('Total sessions:', stats.totalSessions);
console.log('Total cost:', stats.totalCostUsd);
```

## Sample Manifests (Code/Test/Review)

The following manifest fragments demonstrate how providers describe capabilities for the core execution contexts from Section 2.1 while staying compliant with `docs/reference/agent_manifest_schema.json`.

### Code Generation Provider (`code-gen-pro`)

```json
{
  "schema_version": "1.0.0",
  "providerId": "code-gen-pro",
  "name": "CodeGen Pro 32K",
  "version": "1.3.0",
  "rateLimits": { "requestsPerMinute": 240, "tokensPerMinute": 180000 },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "code-gen-pro-32k",
        "inputCostPer1kTokens": 0.02,
        "outputCostPer1kTokens": 0.04,
        "contextWindow": 32768,
        "maxOutputTokens": 8192
      }
    ]
  },
  "tools": {
    "streaming": true,
    "functionCalling": true,
    "jsonMode": true
  },
  "features": {
    "codeGeneration": true,
    "codeReview": false,
    "testGeneration": false,
    "summarization": true
  },
  "executionContexts": {
    "code_generation": {
      "preferredModelId": "code-gen-pro-32k",
      "maxTokensOverride": 24000,
      "temperatureOverride": 0.15
    }
  },
  "errorTaxonomy": {
    "transientErrorCodes": ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR"],
    "permanentErrorCodes": ["INVALID_API_KEY", "MODEL_NOT_FOUND"],
    "humanActionErrorCodes": ["AMBIGUOUS_INPUT"],
    "retryPolicy": {
      "maxAttempts": 2,
      "baseDelayMs": 1000,
      "maxDelayMs": 8000,
      "backoffMultiplier": 2
    }
  }
}
```

### Code Review Provider (`code-review-pro`)

```json
{
  "schema_version": "1.0.0",
  "providerId": "code-review-pro",
  "name": "Review Sensei",
  "version": "2.0.0",
  "rateLimits": { "requestsPerMinute": 120, "tokensPerMinute": 90000 },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "review-sensei-16k",
        "inputCostPer1kTokens": 0.015,
        "outputCostPer1kTokens": 0.025,
        "contextWindow": 16384,
        "maxOutputTokens": 4096
      }
    ]
  },
  "tools": { "jsonMode": true },
  "features": {
    "codeGeneration": false,
    "codeReview": true,
    "testGeneration": false,
    "summarization": true
  },
  "executionContexts": {
    "code_review": {
      "preferredModelId": "review-sensei-16k",
      "maxTokensOverride": 12000,
      "temperatureOverride": 0.05,
      "timeoutOverride": 45000
    }
  },
  "errorTaxonomy": {
    "transientErrorCodes": ["RATE_LIMIT"],
    "permanentErrorCodes": ["UNSUPPORTED_LANGUAGE"],
    "humanActionErrorCodes": ["CLARIFICATION_REQUIRED"]
  }
}
```

### Test Generation Provider (`test-gen-pro`)

```json
{
  "schema_version": "1.0.0",
  "providerId": "test-gen-pro",
  "name": "TestSmith CX",
  "version": "0.9.5",
  "rateLimits": { "requestsPerMinute": 300 },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "testsmith-cx-8k",
        "inputCostPer1kTokens": 0.01,
        "outputCostPer1kTokens": 0.02,
        "contextWindow": 8192,
        "maxOutputTokens": 2048
      }
    ]
  },
  "tools": {
    "functionCalling": true,
    "jsonMode": true
  },
  "features": {
    "codeGeneration": false,
    "codeReview": false,
    "testGeneration": true,
    "summarization": true
  },
  "executionContexts": {
    "test_generation": {
      "preferredModelId": "testsmith-cx-8k",
      "maxTokensOverride": 7000,
      "temperatureOverride": 0.1
    }
  },
  "errorTaxonomy": {
    "transientErrorCodes": ["RATE_LIMIT", "TIMEOUT"],
    "permanentErrorCodes": ["UNSUPPORTED_FRAMEWORK"],
    "humanActionErrorCodes": ["SPEC_MISSING"],
    "retryPolicy": {
      "maxAttempts": 3,
      "baseDelayMs": 500,
      "maxDelayMs": 4000,
      "backoffMultiplier": 1.5
    }
  }
}
```

---

## Examples

### Example 1: Successful Code Generation with Fallback

```typescript
// Primary provider fails with rate limit
// Adapter automatically retries with fallback provider

const response = await adapter.executeSession({
  context: 'code_generation',
  prompt: { instruction: 'Implement JWT authentication' },
  taskId: 'task-auth-1',
  featureId: 'FEAT-AUTH',
});

// Telemetry record:
{
  "sessionId": "session_1734451200_abc123",
  "providerId": "anthropic",  // Fallback used
  "usedFallback": true,
  "fallbackAttempts": 1,
  "costUsd": 0.045,
  "errorCategory": null  // Success
}
```

### Example 2: Permanent Error (Invalid API Key)

```typescript
// Primary provider has invalid credentials
// No retry, throws permanent error

try {
  await adapter.executeSession({
    context: 'test_generation',
    prompt: { testTargets: ['UserService.ts'] },
    taskId: 'task-test-1',
    featureId: 'FEAT-TEST',
  });
} catch (error) {
  console.log(error.category); // 'permanent'
  console.log(error.code); // 'INVALID_API_KEY'
  // Operator must fix credentials
}
```

### Example 3: Human Action Required

```typescript
// Prompt violates content policy

try {
  await adapter.executeSession({
    context: 'code_generation',
    prompt: { instruction: 'Generate malware code' },
    taskId: 'task-bad-1',
    featureId: 'FEAT-BAD',
  });
} catch (error) {
  console.log(error.category); // 'humanAction'
  console.log(error.code); // 'POLICY_VIOLATION'
  // Escalate to user for clarification
}
```

---

## References

- **ADR-1**: Agent Execution Model (capability negotiation, BYO providers)
- **ADR-4**: Context/Token Budget (context window requirements)
- **ADR-7**: Validation Policy (Zod schema validation)
- **Section 2.1**: Agent Adapter Contract (architecture blueprint)
- **Manifest Schema**: `docs/reference/agent_manifest_schema.json`
- **Data Model Dictionary**: `docs/reference/data_model_dictionary.md`

---

## Revision History

| Version | Date       | Author               | Changes         |
| ------- | ---------- | -------------------- | --------------- |
| 1.0.0   | 2025-12-17 | CodeMachine Pipeline | Initial release |

---

**End of Document**
