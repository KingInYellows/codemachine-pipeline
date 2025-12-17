# Agent Manifest Guide

**Version:** 1.0.0
**Last Updated:** 2025-01-XX
**Status:** Active

---

## Table of Contents

1. [Introduction](#introduction)
2. [Manifest Schema Reference](#manifest-schema-reference)
3. [Registration Workflow](#registration-workflow)
4. [Example Manifests](#example-manifests)
5. [Provider Selection & Capability Matching](#provider-selection--capability-matching)
6. [Cost Tracking Integration](#cost-tracking-integration)
7. [Fallback Scenarios](#fallback-scenarios)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## Introduction

The Agent Manifest system enables **bring-your-own-agent** workflows by supporting declarative capability manifests. This allows teams to:

- Swap agent providers without code changes
- Define provider capabilities, rate limits, and cost structures
- Automatically select optimal providers based on task requirements
- Track and budget agent costs with integrated telemetry
- Maintain deterministic prompt packaging across provider changes

Manifests are stored as JSON files under `.ai-feature-pipeline/agents/` and are loaded at pipeline startup.

### Key Design Principles

1. **Schema-First Validation:** All manifests must conform to the JSON Schema specification
2. **Fail-Fast Philosophy:** Invalid manifests are rejected immediately at CLI startup
3. **Cost Transparency:** All providers MUST declare pricing (no silent fallbacks to defaults)
4. **Rate Limit Discipline:** Manifests MUST include rate limit metadata per acceptance criteria
5. **Deterministic Resumes:** Manifest hashes are tracked to detect mid-run changes

---

## Manifest Schema Reference

Agent manifests follow JSON Schema Draft 7. The complete schema is available at:
**`docs/requirements/agent_manifest_schema.json`**

### Required Fields

All manifests MUST include these fields (CLI will reject manifests missing any):

```json
{
  "schema_version": "1.0.0",
  "providerId": "unique-provider-id",
  "name": "Human-Readable Provider Name",
  "version": "1.0.0",
  "rateLimits": {
    "requestsPerMinute": 100
  },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "model-name",
        "inputCostPer1kTokens": 0.01,
        "outputCostPer1kTokens": 0.03
      }
    ]
  }
}
```

### Field Descriptions

#### `schema_version` (required)
- **Type:** String (semver)
- **Example:** `"1.0.0"`
- **Description:** Manifest schema version for forward compatibility

#### `providerId` (required)
- **Type:** String (lowercase alphanumeric, hyphens, underscores)
- **Pattern:** `^[a-z0-9_-]+$`
- **Example:** `"openai"`, `"anthropic"`, `"local-ollama"`
- **Description:** Unique identifier for this provider (used in cost tracking and selection)

#### `name` (required)
- **Type:** String
- **Example:** `"OpenAI GPT-4"`
- **Description:** Human-readable provider name for CLI display

#### `version` (required)
- **Type:** String (semver)
- **Example:** `"2.1.3"`
- **Description:** Provider implementation version (update when capabilities change)

#### `rateLimits` (required)
- **Type:** Object
- **Description:** Rate limit constraints (**REQUIRED** per acceptance criteria)

  **Sub-fields:**
  - `requestsPerMinute` (required): Maximum API requests per minute (integer ≥ 1)
  - `tokensPerMinute` (optional): Maximum tokens processable per minute (integer ≥ 0)
  - `burstCapacity` (optional): Maximum burst requests above steady rate (integer ≥ 0)
  - `concurrentRequests` (optional): Maximum concurrent in-flight requests (integer ≥ 1)

  **Example:**
  ```json
  "rateLimits": {
    "requestsPerMinute": 500,
    "tokensPerMinute": 150000,
    "burstCapacity": 50,
    "concurrentRequests": 10
  }
  ```

#### `costConfig` (required)
- **Type:** Object
- **Description:** Cost estimation configuration (**REQUIRED** - no silent fallbacks)

  **Sub-fields:**
  - `currency` (optional): ISO 4217 currency code (default: `"USD"`)
  - `models` (required): Array of model-specific pricing (must have ≥ 1 entry)

  **Model Configuration:**
  - `modelId` (required): Model identifier (e.g., `"gpt-4"`, `"claude-3-opus"`)
  - `inputCostPer1kTokens` (required): Cost per 1000 input tokens (number ≥ 0)
  - `outputCostPer1kTokens` (required): Cost per 1000 output tokens (number ≥ 0)
  - `contextWindow` (optional): Maximum context window in tokens (integer ≥ 1)
  - `maxOutputTokens` (optional): Maximum output tokens per request (integer ≥ 1)

  **Example:**
  ```json
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "gpt-4-turbo",
        "inputCostPer1kTokens": 0.01,
        "outputCostPer1kTokens": 0.03,
        "contextWindow": 128000,
        "maxOutputTokens": 4096
      }
    ]
  }
  ```

### Optional Fields

#### `description` (optional)
- **Type:** String
- **Description:** Provider capabilities and use case summary

#### `tools` (optional)
- **Type:** Object
- **Description:** Tool and feature support flags
- **Default:** All flags default to `false`

  **Sub-fields:**
  - `streaming`: Supports streaming responses
  - `functionCalling`: Supports function/tool calling
  - `vision`: Supports image/vision inputs
  - `jsonMode`: Supports structured JSON output mode
  - `embeddings`: Supports text embedding generation

  **Example:**
  ```json
  "tools": {
    "streaming": true,
    "functionCalling": true,
    "vision": false,
    "jsonMode": true,
    "embeddings": false
  }
  ```

#### `features` (optional)
- **Type:** Object
- **Description:** Pipeline-specific capability flags (ADR-1 capability set)
- **Default:** All flags default to `true`

  **Sub-fields:**
  - `prdGeneration`: Supports PRD generation workflow
  - `specGeneration`: Supports specification generation workflow
  - `codeGeneration`: Supports code generation workflow
  - `codeReview`: Supports code review workflow
  - `testGeneration`: Supports test generation workflow
  - `summarization`: Supports context summarization workflow

  **Example:**
  ```json
  "features": {
    "prdGeneration": true,
    "specGeneration": true,
    "codeGeneration": true,
    "codeReview": true,
    "testGeneration": true,
    "summarization": true
  }
  ```

#### `endpoint` (optional)
- **Type:** Object
- **Description:** API endpoint configuration for custom providers

  **Sub-fields:**
  - `baseUrl` (optional): Base URL for API requests (must be valid URI)
  - `authMethod` (optional): Authentication method (`"bearer"`, `"api-key"`, `"oauth"`, `"none"`)
  - `timeout` (optional): Request timeout in milliseconds (integer ≥ 1000, default: 30000)

  **Example:**
  ```json
  "endpoint": {
    "baseUrl": "https://api.example.com/v1",
    "authMethod": "bearer",
    "timeout": 60000
  }
  ```

#### `fallbackProvider` (optional)
- **Type:** String (provider ID pattern)
- **Description:** Fallback provider ID to use if this provider fails
- **Example:** `"gpt-3.5-turbo-fallback"`

#### `metadata` (optional)
- **Type:** Object
- **Description:** Additional provider-specific metadata (arbitrary key-value pairs)

---

## Registration Workflow

### 1. Create Manifest File

Create a JSON manifest file following the schema specification:

```bash
# Create manifest directory if it doesn't exist
mkdir -p .ai-feature-pipeline/agents

# Create your manifest
cat > .ai-feature-pipeline/agents/openai.json << 'EOF'
{
  "schema_version": "1.0.0",
  "providerId": "openai",
  "name": "OpenAI GPT-4 Turbo",
  "version": "1.0.0",
  "description": "OpenAI's latest GPT-4 Turbo model with 128K context window",
  "rateLimits": {
    "requestsPerMinute": 500,
    "tokensPerMinute": 150000,
    "burstCapacity": 50
  },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "gpt-4-turbo",
        "inputCostPer1kTokens": 0.01,
        "outputCostPer1kTokens": 0.03,
        "contextWindow": 128000,
        "maxOutputTokens": 4096
      }
    ]
  },
  "tools": {
    "streaming": true,
    "functionCalling": true,
    "jsonMode": true
  },
  "features": {
    "prdGeneration": true,
    "specGeneration": true,
    "codeGeneration": true,
    "codeReview": true,
    "testGeneration": true,
    "summarization": true
  },
  "endpoint": {
    "baseUrl": "https://api.openai.com/v1",
    "authMethod": "bearer",
    "timeout": 60000
  }
}
EOF
```

### 2. Validate Manifest

Use the CLI to validate your manifest before committing:

```bash
# Validate all manifests in directory (future CLI command)
codemachine validate-manifests

# Expected output:
# ✓ Loaded 1 manifest(s)
# ✓ openai (v1.0.0) - Valid
#   Models: gpt-4-turbo
#   Rate Limits: 500 req/min, 150000 tokens/min
```

### 3. Commit to Repository

Commit manifests to version control alongside pipeline configuration:

```bash
git add .ai-feature-pipeline/agents/
git commit -m "feat: add OpenAI GPT-4 Turbo provider manifest"
```

### 4. Verify Registration at Runtime

When the pipeline starts, manifests are automatically loaded and registered:

```bash
codemachine start "Add user authentication"

# Pipeline logs will show:
# [INFO] Loading agent manifest: .ai-feature-pipeline/agents/openai.json
# [INFO] Manifest loaded and registered: providerId=openai, version=1.0.0
# [DEBUG] Registered cost config: provider=openai, model=gpt-4-turbo
```

---

## Example Manifests

### OpenAI Provider

```json
{
  "schema_version": "1.0.0",
  "providerId": "openai",
  "name": "OpenAI GPT Models",
  "version": "1.0.0",
  "description": "OpenAI GPT-4 and GPT-3.5 Turbo via official API",
  "rateLimits": {
    "requestsPerMinute": 500,
    "tokensPerMinute": 150000,
    "burstCapacity": 50
  },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "gpt-4-turbo",
        "inputCostPer1kTokens": 0.01,
        "outputCostPer1kTokens": 0.03,
        "contextWindow": 128000,
        "maxOutputTokens": 4096
      },
      {
        "modelId": "gpt-3.5-turbo",
        "inputCostPer1kTokens": 0.0015,
        "outputCostPer1kTokens": 0.002,
        "contextWindow": 16384,
        "maxOutputTokens": 4096
      }
    ]
  },
  "tools": {
    "streaming": true,
    "functionCalling": true,
    "vision": false,
    "jsonMode": true,
    "embeddings": false
  },
  "features": {
    "prdGeneration": true,
    "specGeneration": true,
    "codeGeneration": true,
    "codeReview": true,
    "testGeneration": true,
    "summarization": true
  },
  "endpoint": {
    "baseUrl": "https://api.openai.com/v1",
    "authMethod": "bearer",
    "timeout": 60000
  }
}
```

### Anthropic Provider

```json
{
  "schema_version": "1.0.0",
  "providerId": "anthropic",
  "name": "Anthropic Claude Models",
  "version": "1.0.0",
  "description": "Anthropic Claude 3 family via official API",
  "rateLimits": {
    "requestsPerMinute": 50,
    "tokensPerMinute": 100000,
    "burstCapacity": 10
  },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "claude-3-opus",
        "inputCostPer1kTokens": 0.015,
        "outputCostPer1kTokens": 0.075,
        "contextWindow": 200000,
        "maxOutputTokens": 4096
      },
      {
        "modelId": "claude-3-sonnet",
        "inputCostPer1kTokens": 0.003,
        "outputCostPer1kTokens": 0.015,
        "contextWindow": 200000,
        "maxOutputTokens": 4096
      },
      {
        "modelId": "claude-3-haiku",
        "inputCostPer1kTokens": 0.00025,
        "outputCostPer1kTokens": 0.00125,
        "contextWindow": 200000,
        "maxOutputTokens": 4096
      }
    ]
  },
  "tools": {
    "streaming": true,
    "functionCalling": true,
    "vision": true,
    "jsonMode": false,
    "embeddings": false
  },
  "endpoint": {
    "baseUrl": "https://api.anthropic.com/v1",
    "authMethod": "api-key",
    "timeout": 60000
  }
}
```

### Local Ollama Provider

```json
{
  "schema_version": "1.0.0",
  "providerId": "local-ollama",
  "name": "Local Ollama (Llama 3)",
  "version": "1.0.0",
  "description": "Self-hosted Llama 3 via Ollama",
  "rateLimits": {
    "requestsPerMinute": 60,
    "concurrentRequests": 1
  },
  "costConfig": {
    "currency": "USD",
    "models": [
      {
        "modelId": "llama3:70b",
        "inputCostPer1kTokens": 0.0,
        "outputCostPer1kTokens": 0.0,
        "contextWindow": 8192,
        "maxOutputTokens": 2048
      }
    ]
  },
  "tools": {
    "streaming": true,
    "functionCalling": false,
    "vision": false,
    "jsonMode": true,
    "embeddings": true
  },
  "features": {
    "prdGeneration": true,
    "specGeneration": true,
    "codeGeneration": true,
    "codeReview": false,
    "testGeneration": true,
    "summarization": true
  },
  "endpoint": {
    "baseUrl": "http://localhost:11434/api",
    "authMethod": "none",
    "timeout": 120000
  },
  "fallbackProvider": "openai"
}
```

---

## Provider Selection & Capability Matching

The pipeline automatically selects providers based on task requirements using capability matching:

### Automatic Selection

When starting a feature workflow, the pipeline selects the best provider matching:

1. **Required capabilities:** Tools, features, context window
2. **Budget constraints:** Maximum acceptable cost per 1K tokens
3. **Rate limits:** Minimum requests per minute capacity

**Selection algorithm:**
1. Filter manifests matching all requirements
2. Rank remaining providers by cost (lowest first)
3. Select cheapest provider meeting criteria
4. Fall back to next cheapest if primary fails

### Manual Selection

Override automatic selection via CLI flags (future):

```bash
# Use specific provider
codemachine start "Feature description" --provider openai

# Prefer specific provider (fallback to auto-selection if unavailable)
codemachine start "Feature description" --prefer-provider anthropic
```

### Example Selection Scenarios

**Scenario 1: PRD Generation (Large Context)**
- **Requirements:** `minContextWindow: 100000`, `requiredFeatures: { prdGeneration: true }`
- **Selected:** Anthropic Claude 3 Sonnet (200K context, $0.018/1K avg cost)
- **Rejected:** OpenAI GPT-3.5 Turbo (16K context insufficient)

**Scenario 2: Code Review (Low Cost)**
- **Requirements:** `maxCostPer1kTokens: 0.01`, `requiredFeatures: { codeReview: true }`
- **Selected:** Anthropic Claude 3 Haiku ($0.00175/1K avg cost)
- **Rejected:** OpenAI GPT-4 Turbo ($0.04/1K exceeds budget)

**Scenario 3: Summarization (High Throughput)**
- **Requirements:** `minRequestsPerMinute: 200`, `requiredFeatures: { summarization: true }`
- **Selected:** OpenAI GPT-3.5 Turbo (500 req/min capacity)
- **Rejected:** Anthropic Claude (50 req/min insufficient)

---

## Cost Tracking Integration

Manifests integrate seamlessly with the `CostTracker` telemetry system:

### Automatic Cost Registration

When manifests load, the system automatically:
1. Registers model pricing with `CostTracker.registerCostConfig()`
2. Attributes spend to correct provider/model in telemetry
3. Enforces budget warnings based on declared costs

### Cost Telemetry Output

Agent spend appears in run directory telemetry:

```bash
cat .codemachine-runs/feature_xyz_20250115_143022/telemetry/costs.json
```

```json
{
  "schema_version": "1.0.0",
  "feature_id": "feature_xyz_20250115_143022",
  "providers": {
    "openai": {
      "provider": "openai",
      "promptTokens": 15420,
      "completionTokens": 3891,
      "totalTokens": 19311,
      "totalCostUsd": 0.271,
      "operationCount": 12
    }
  },
  "totals": {
    "totalCostUsd": 0.271,
    "totalTokens": 19311
  }
}
```

### Budget Enforcement

Configure budgets to halt workflows when limits exceeded:

```bash
codemachine start "Feature description" --max-cost-usd 1.00
```

Manifest-declared costs drive budget calculations and warnings.

---

## Fallback Scenarios

The manifest system supports graceful degradation via fallback chains:

### 1. Primary Provider Failure

If the selected provider fails (rate limit, API error, timeout):
- **Action:** Check manifest's `fallbackProvider` field
- **Behavior:** Retry request with fallback provider
- **Logging:** Record fallback event in telemetry

**Example:**
```json
{
  "providerId": "local-ollama",
  "fallbackProvider": "openai"
}
```

If Ollama fails, requests automatically route to OpenAI.

### 2. No Manifests Available

If `.ai-feature-pipeline/agents/` is empty or all manifests invalid:
- **Action:** CLI exits with error (fail-fast)
- **Behavior:** **No silent defaults** (prevents budget surprises)
- **Message:**
  ```
  ERROR: No valid agent manifests found.
  Please add manifests to .ai-feature-pipeline/agents/
  See docs/ops/agent_manifest_guide.md for instructions.
  ```

### 3. Manifest Change During Resume

If manifest hash changes mid-run (detected during `resume`):
- **Action:** Log warning and halt resume
- **Behavior:** Prevent non-deterministic prompt packaging
- **Message:**
  ```
  WARN: Manifest hash mismatch for provider 'openai'
  Expected: a1b2c3d4e5f6...
  Current:  f6e5d4c3b2a1...
  Capabilities may have changed. Re-run from scratch or rollback manifest.
  ```

### 4. Missing Rate Limit Metadata

If manifest lacks required `rateLimits.requestsPerMinute`:
- **Action:** Reject manifest at load time
- **Behavior:** CLI fails validation immediately
- **Message:**
  ```
  ERROR: Invalid agent manifest at .ai-feature-pipeline/agents/bad.json:
    - rateLimits.requestsPerMinute: Required

  Manifests MUST include "rateLimits" per acceptance criteria.
  ```

---

## Troubleshooting

### Manifest Rejected: "rateLimits.requestsPerMinute: Required"

**Cause:** Missing required `rateLimits` field
**Fix:** Add `rateLimits` object with `requestsPerMinute`:

```json
"rateLimits": {
  "requestsPerMinute": 100
}
```

---

### Manifest Rejected: "costConfig.models: Array must contain at least 1 element(s)"

**Cause:** Empty or missing `costConfig.models` array
**Fix:** Add at least one model configuration:

```json
"costConfig": {
  "currency": "USD",
  "models": [
    {
      "modelId": "my-model",
      "inputCostPer1kTokens": 0.01,
      "outputCostPer1kTokens": 0.03
    }
  ]
}
```

---

### Manifest Rejected: "providerId must be lowercase alphanumeric"

**Cause:** Invalid characters in `providerId`
**Fix:** Use only lowercase letters, numbers, hyphens, underscores:

```diff
- "providerId": "OpenAI_GPT4"
+ "providerId": "openai-gpt4"
```

---

### Warning: "No providers match requirements"

**Cause:** All registered providers fail capability matching
**Debug:** Check pipeline logs for requirement details:

```
[WARN] No providers match requirements
  requirements: {
    minContextWindow: 100000,
    requiredTools: { vision: true }
  }
```

**Fix:** Register a provider meeting those requirements or relax constraints.

---

### Error: "Manifest hash mismatch" on Resume

**Cause:** Manifest file changed after workflow started
**Fix:** Either:
1. Rollback manifest to original version and resume
2. Accept changes and re-run workflow from scratch

```bash
# Option 1: Rollback and resume
git checkout HEAD -- .ai-feature-pipeline/agents/openai.json
codemachine resume feature_xyz_20250115_143022

# Option 2: Re-run
codemachine start "Feature description"
```

---

## Best Practices

### 1. Version Manifests in Git

**DO:** Commit manifests to version control alongside pipeline config
**DON'T:** Manually edit manifests in `.codemachine-runs/` (these are snapshots)

```bash
# Good
git add .ai-feature-pipeline/agents/
git commit -m "chore: update OpenAI pricing to reflect 2025 rates"

# Bad - changes will be lost
vim .codemachine-runs/feature_abc_*/agents/openai.json
```

---

### 2. Use Semantic Versioning

**DO:** Increment `version` when capabilities change
**DON'T:** Keep version static when updating pricing or rate limits

```json
// Breaking change: removed code review support
"version": "2.0.0"

// Non-breaking: updated pricing
"version": "1.1.0"

// Patch: fixed typo in description
"version": "1.0.1"
```

---

### 3. Document Provider Quirks in `description`

**DO:** Note limitations, SLA expectations, or special requirements
**DON'T:** Leave `description` empty for non-obvious providers

```json
"description": "Local Ollama (Llama 3 70B). Requires GPU with 48GB VRAM. No vision support. Best for cost-sensitive workflows."
```

---

### 4. Set Realistic Rate Limits

**DO:** Match values to your actual API tier/quota
**DON'T:** Copy example values without verification

```json
// Bad - Free tier OpenAI has 3 req/min, not 500
"rateLimits": {
  "requestsPerMinute": 500
}

// Good - matches actual quota
"rateLimits": {
  "requestsPerMinute": 3,
  "burstCapacity": 1
}
```

---

### 5. Configure Fallback Chains for Production

**DO:** Set `fallbackProvider` for critical providers
**DON'T:** Rely on single provider without backup

```json
{
  "providerId": "primary-gpt4",
  "fallbackProvider": "backup-claude"
}
```

Prevents workflow halts when primary provider has outages.

---

### 6. Test Manifests Before Committing

**DO:** Run validation CLI command after changes
**DON'T:** Commit untested manifests

```bash
# Validate before commit
codemachine validate-manifests

# Only commit if validation passes
git add .ai-feature-pipeline/agents/
git commit -m "feat: add Azure OpenAI provider"
```

---

### 7. Use Descriptive Provider IDs

**DO:** Choose IDs that indicate purpose/tier
**DON'T:** Use generic IDs when managing multiple configs

```json
// Bad - ambiguous
"providerId": "openai"

// Good - indicates tier/purpose
"providerId": "openai-prod-gpt4"
"providerId": "openai-dev-gpt35"
```

---

## Additional Resources

- **JSON Schema Spec:** `docs/requirements/agent_manifest_schema.json`
- **Manifest Loader Source:** `src/adapters/agents/manifestLoader.ts`
- **Cost Tracker Integration:** `src/telemetry/costTracker.ts`
- **ADR-1 (Agent Execution):** Referenced in planning context
- **ADR-4 (Token Budget):** Referenced in planning context

---

**Questions or Issues?**
Open a GitHub issue or consult the architecture docs under `.codemachine/artifacts/architecture/`.
