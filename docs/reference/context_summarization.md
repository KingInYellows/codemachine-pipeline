# Context Summarization

**Version:** 1.0.0
**Last Updated:** 2025-12-15
**Status:** Active

## Overview

This document describes the context summarization pipeline that compresses large repository files into AI-generated summaries while enforcing token budgets, redaction rules, and cost tracking requirements.

The summarization system enables the AI Feature Pipeline to work with repositories that exceed single-context window limits by intelligently chunking and summarizing files, then caching the results for reuse across feature execution runs.

## Architecture

### Components

1. **Context Summarizer** (`src/workflows/contextSummarizer.ts`)
   - Chunking logic with semantic boundary preservation
   - Provider-agnostic client interface
   - Incremental caching based on file SHA hashes
   - Integration with redaction engine
   - CLI commands for re-summarization

2. **Cost Tracker** (`src/telemetry/costTracker.ts`)
   - Per-provider token and cost accumulation
   - Configurable cost rates
   - Budget warnings and enforcement
   - Persistence to telemetry files

3. **Cache Storage** (`.codepipe/<feature_id>/context/docs/`)
   - Chunk metadata stored as JSON files
   - Keyed by content hash for deduplication
   - Includes provenance and redaction flags
   - `context/summarization.json` records latest run stats for CLI status output

### Data Flow

```
Repository Files
      ↓
Context Aggregator (discovers files, estimates tokens)
      ↓
Context Summarizer (chunks, summarizes, caches)
      ├→ Redaction Engine (removes secrets)
      ├→ Summarizer Client (provider API)
      └→ Cost Tracker (records tokens/cost)
      ↓
Updated ContextDocument (with summaries array)
      ↓
CLI Status Output (shows summaries, warnings)
```

## Chunking Strategy

### Token Budget

Files are chunked when their estimated token count exceeds the configured `maxTokensPerChunk` (default: 4000 tokens).

Token estimation uses a simple heuristic:

```
estimatedTokens = fileSize (bytes) / 4
```

This approximates common tokenizers (GPT, Claude) at ~4 characters per token.

### Chunk Boundaries

The chunking algorithm prioritizes semantic coherence:

1. **Line-based splitting**: Never splits mid-line
2. **Overlap**: Configurable overlap (default: 10%) between chunks to preserve context
3. **Size limits**: Chunks target `maxTokensPerChunk` but may be slightly larger to respect line boundaries

### Example

For a 20,000-token file with `maxTokensPerChunk=4000` and `chunkOverlapPercent=10`:

- Creates ~5 chunks of ~4000 tokens each
- Each chunk overlaps ~400 tokens with the next
- Chunk 1: tokens 0-4000
- Chunk 2: tokens 3600-7600 (overlap: 3600-4000)
- Chunk 3: tokens 7200-11200 (overlap: 7200-7600)
- etc.

## Caching

### Cache Keys

Summaries are cached using a composite key:

```
chunkId = SHA256(filePath + fileSHA + chunkIndex).substring(0, 16)
```

This ensures:

- Same file content → same cache hit
- Different versions → cache miss (re-summarize)
- Per-chunk granularity → partial reuse when file changes

### Cache Location

Chunk metadata files are stored at:

```
.codepipe/<feature_id>/context/docs/<chunkId>.json
```

### Cache Structure

```json
{
  "chunkId": "a1b2c3d4e5f6g7h8",
  "path": "src/workflows/contextAggregator.ts",
  "fileSha": "abcdef1234567890...",
  "chunkIndex": 0,
  "chunkTotal": 3,
  "summary": "This module orchestrates repository scanning...",
  "tokenCount": {
    "prompt": 3500,
    "completion": 150
  },
  "generatedAt": "2025-12-15T10:30:45.123Z",
  "generatedBy": "claude-3-sonnet",
  "summarizationMethod": "multi_chunk",
  "redactionFlags": ["github_token", "api_key"]
}
```

### Cache Invalidation

Caches are invalidated when:

1. **File SHA changes** (file content modified)
2. **--force flag** (manual re-summarization)
3. **TTL expires** (future enhancement: configurable TTL)

## Redaction

### Integration

The summarization pipeline integrates with the existing `RedactionEngine` from `src/telemetry/logger.ts` to ensure secrets are never persisted in summaries.

### Redaction Flow

1. **Pre-summarization**: Input text may contain secrets (not redacted)
2. **AI Provider**: Receives raw text (provider-side security applies)
3. **Post-summarization**: Response is passed through `redactor.redact()`
4. **Storage**: Only redacted summaries are cached and persisted

### Redaction Flags

When redaction occurs, the engine sets `redactionFlags` in the chunk metadata:

```json
{
  "redactionFlags": ["github_token", "api_key", "jwt"]
}
```

These flags are:

- Stored in chunk metadata
- Logged to telemetry
- Included in audit trails

## Cost Tracking

### Token Recording

Every summarization operation records:

- **Prompt tokens**: Tokens sent to provider
- **Completion tokens**: Tokens received from provider
- **Total tokens**: Sum of prompt + completion

### Cost Calculation

Cost is calculated using provider-specific rates:

| Provider  | Model           | Input (per 1K) | Output (per 1K) |
| --------- | --------------- | -------------- | --------------- |
| OpenAI    | GPT-4           | $0.03          | $0.06           |
| OpenAI    | GPT-3.5 Turbo   | $0.0015        | $0.002          |
| Anthropic | Claude 3 Opus   | $0.015         | $0.075          |
| Anthropic | Claude 3 Sonnet | $0.003         | $0.015          |
| Anthropic | Claude 3 Haiku  | $0.00025       | $0.00125        |

**Example:**

```
Prompt tokens: 3500
Completion tokens: 150
Provider: Anthropic Claude 3 Sonnet

Prompt cost  = (3500 / 1000) * $0.003 = $0.0105
Completion cost = (150 / 1000) * $0.015 = $0.00225
Total cost = $0.01275
```

### Budget Enforcement

Budgets are configured in `RepoConfig`:

```yaml
runtime:
  context_token_budget: 100000 # Total tokens
  context_cost_budget_usd: 5.0 # Total USD
```

When budgets are exceeded:

1. **Warning threshold** (default: 80%): Logs warning, continues
2. **Hard limit** (100%): Logs error, adds to `warnings` array

### Telemetry Files

Cost data is persisted to:

**costs.json** (snapshot):

```json
{
  "schema_version": "1.0.0",
  "feature_id": "01JFABCD...",
  "created_at": "2025-12-15T10:00:00.000Z",
  "updated_at": "2025-12-15T10:30:45.123Z",
  "providers": {
    "anthropic": {
      "provider": "anthropic",
      "promptTokens": 12500,
      "completionTokens": 850,
      "totalTokens": 13350,
      "totalCostUsd": 0.05025,
      "operationCount": 4
    }
  },
  "totals": {
    "promptTokens": 12500,
    "completionTokens": 850,
    "totalTokens": 13350,
    "totalCostUsd": 0.05025,
    "operationCount": 4
  },
  "budget": {
    "maxCostUsd": 5.0,
    "maxTokens": 100000,
    "warningThreshold": 80
  },
  "warnings": []
}
```

**costs.ndjson** (log):

```json
{"feature_id":"01JFABCD...","provider":"anthropic","operation":"summarize","prompt_tokens":3500,"completion_tokens":150,"cost_usd":0.01275,"timestamp":"2025-12-15T10:30:45.123Z","model":"claude-3-sonnet"}
{"feature_id":"01JFABCD...","provider":"anthropic","operation":"summarize","prompt_tokens":4200,"completion_tokens":180,"cost_usd":0.0153,"timestamp":"2025-12-15T10:31:12.456Z","model":"claude-3-sonnet"}
```

**context/summarization.json** (latest run metadata):

```json
{
  "feature_id": "01JFABCD...",
  "updated_at": "2025-12-15T10:31:12.456Z",
  "chunks_generated": 12,
  "chunks_cached": 4,
  "tokens_used": {
    "prompt": 12500,
    "completion": 850,
    "total": 13350
  },
  "warnings": [],
  "patterns": [],
  "force": false
}
```

## CLI Integration

### Status Command

The `status --json` command includes summarization metadata:

```json
{
  "feature_id": "01JFABCDEFGHIJKLMNOPQRSTUV",
  "context": {
    "files": 42,
    "total_tokens": 15320,
    "summaries": 8,
    "summaries_preview": [
      {
        "file_path": "README.md",
        "chunk_id": "0123456789abcdef",
        "generated_at": "2025-12-15T10:30:45.123Z",
        "summary": "Documentation outlines architecture, setup, and iteration goals."
      }
    ],
    "summarization": {
      "chunks_generated": 12,
      "chunks_cached": 4,
      "tokens_used": {
        "prompt": 12500,
        "completion": 850,
        "total": 13350
      },
      "cost_usd": 0.05025
    },
    "budget_warnings": ["Token budget warning: 13350 / 100000 (13.4%)"],
    "warnings": []
  }
}
```

### Re-summarize Command

Re-summarize specific files:

```bash
# Re-summarize all TypeScript files
codepipe context summarize --path "src/**/*.ts"

# Force re-summarization (ignore cache)
codepipe context summarize --path "src/workflows/*.ts" --force

# Re-summarize single file
codepipe context summarize --path "README.md" --force
```

Without `--path`, the command refreshes the entire context manifest, reusing cached summaries unless `--force` is specified.

**Behavior:**

- Matches files using glob patterns
- Clears cached summaries for matched files
- Generates fresh summaries
- Updates `context/summary.json`
- Records new costs to telemetry
- Persists run metadata to `context/summarization.json`
- Supports `--json` output for automation

## Provider Interface

### Summarizer Client

Implementations must conform to the `SummarizerClient` interface:

```typescript
interface SummarizerClient {
  summarizeChunk(
    text: string,
    options?: { streaming?: boolean; context?: string }
  ): Promise<SummaryResponse>;

  getProviderId(): string;
}
```

### Response Format

```typescript
interface SummaryResponse {
  summary: string;
  promptTokens: number;
  completionTokens: number;
  model?: string;
  redactionFlags?: string[];
}
```

### Example Implementation (Stub)

```typescript
class StubSummarizerClient implements SummarizerClient {
  async summarizeChunk(text: string): Promise<SummaryResponse> {
    // Simulate summarization
    const summary = `Summary of ${text.substring(0, 50)}...`;
    const promptTokens = estimateTokens(Buffer.byteLength(text));
    const completionTokens = estimateTokens(Buffer.byteLength(summary));

    return {
      summary,
      promptTokens,
      completionTokens,
      model: 'stub-summarizer',
    };
  }

  getProviderId(): string {
    return 'stub';
  }
}
```

## Configuration

### RepoConfig Settings

```yaml
runtime:
  # Token budget for context aggregation (before summarization)
  context_token_budget: 100000

  # Cost budget for summarization operations
  context_cost_budget_usd: 5.0

feature_flags:
  # Enable summarization pipeline
  enable_context_summarization: true

constraints:
  # Maximum files to include in context
  max_context_files: 50

  # Paths excluded from summarization
  must_not_touch_paths:
    - 'secrets/**'
    - '.env*'
    - '**/*.key'
```

### Summarizer Config

Passed to `summarizeDocument()`:

```typescript
const config: SummarizerConfig = {
  repoRoot: '/path/to/repo',
  runDir: '.codepipe/runs/01JFABCD...',
  featureId: '01JFABCD...',
  maxTokensPerChunk: 4000,
  chunkOverlapPercent: 10,
  tokenBudget: 100000,
  enableSummarization: true,
  forceFresh: false,
};
```

## Error Handling

### Provider Failures

When a provider API call fails:

1. **Transient errors** (429, 503): Retry with exponential backoff
2. **Permanent errors** (401, 403): Log error, skip file
3. **Timeout errors**: Log error, skip chunk

Errors are logged to `warnings` array in result:

```typescript
{
  warnings: [
    'Failed to summarize src/large-file.ts chunk 2: API timeout',
    'Failed to read file src/missing.ts: ENOENT',
  ];
}
```

### Budget Exceeded

When budgets are exceeded:

1. **Warning threshold** (80%): Continue, add to warnings
2. **Hard limit** (100%): Stop summarization, return partial results

## Performance

### Caching Impact

For a typical feature run:

- **First run** (cold cache): Summarize all files, ~30s for 50 files
- **Second run** (warm cache): Reuse cached summaries, ~2s
- **Incremental run** (3 files changed): Re-summarize 3 files, ~5s

### Token Savings

Example repository:

- **Total files**: 50
- **Total tokens** (raw): 250,000
- **Chunks generated**: 80
- **Total tokens** (summaries): 15,000
- **Compression ratio**: 94% reduction

## Testing

### Unit Tests

See `tests/unit/contextSummarizer.spec.ts`:

1. **Chunking tests**
   - Respects token limits
   - Preserves line boundaries
   - Applies correct overlap

2. **Caching tests**
   - Cache hits avoid re-summarization
   - SHA changes invalidate cache
   - Force flag bypasses cache

3. **Redaction tests**
   - Secrets redacted in summaries
   - Redaction flags set correctly

4. **Cost tracking tests**
   - Token counts accurate
   - Cost calculations correct
   - Budget warnings triggered

### Integration Tests

1. **End-to-end flow**
   - Summarize real files
   - Verify cache persistence
   - Check telemetry files

2. **CLI tests**
   - `status` shows summaries
   - `summarize --path` works
   - `--force` flag bypasses cache

## Troubleshooting

### Summaries Not Generated

**Check:**

1. `feature_flags.enable_context_summarization` is `true`
2. Provider credentials configured
3. Files not excluded by `must_not_touch_paths`
4. Logs for API errors: `cat <run_dir>/logs/logs.ndjson | grep summarize`

### Cache Not Working

**Check:**

1. `context/docs/` directory exists
2. File SHAs match cached metadata
3. `--force` flag not set
4. Permissions allow writing to cache directory

### Budget Warnings

**Actions:**

1. Review `telemetry/costs.json` for breakdown
2. Increase `context_cost_budget_usd` if appropriate
3. Reduce `max_context_files` to limit scope
4. Switch to cheaper provider/model

### High Costs

**Optimize:**

1. Use Haiku instead of Opus for summaries
2. Increase `maxTokensPerChunk` to reduce chunk count
3. Cache more aggressively (higher TTL)
4. Exclude large generated files (dist/, build/)

## Future Enhancements

### Streaming Summaries

Support streaming responses for real-time progress:

```typescript
client.summarizeChunk(text, { streaming: true });
```

### Custom Summarization Prompts

Allow users to configure summary style:

```yaml
summarization:
  prompt_template: 'Summarize the following code, focusing on architecture and key functions.'
  max_summary_tokens: 200
```

### Multi-level Summaries

Generate hierarchical summaries:

1. **Chunk-level**: Detailed per-chunk summaries
2. **File-level**: Aggregate chunk summaries
3. **Module-level**: Aggregate file summaries

### Cost Predictions

Estimate costs before running:

```bash
codepipe context estimate --dry-run
# Estimated cost: $0.15 (5000 tokens, 12 files)
```

## References

- **Implementation**: `src/workflows/contextSummarizer.ts`
- **Cost Tracking**: `src/telemetry/costTracker.ts`
- **Context Aggregator**: `src/workflows/contextAggregator.ts`
- **Data Model**: `docs/requirements/data_model_dictionary.md` (ContextDocument)
- **Observability**: `docs/ops/observability_baseline.md`
- **Redaction**: `src/telemetry/logger.ts` (RedactionEngine)
