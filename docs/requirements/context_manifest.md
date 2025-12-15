# Context Manifest Specification

## Overview

The Context Manifest captures repository context for agent prompts, enabling deterministic, token-aware code generation. This document describes the manifest schema, configuration options, and operational semantics.

**Purpose:** Aggregate repository files, metadata, and provenance to provide context for AI agents while respecting token budgets and caching unchanged files for efficiency.

**Requirements:** Implements FR-7 (Context Discovery), FR-8 (Context Token Budgeting), and ADR-4 (Context Gathering Strategy).

---

## Manifest Schema

The Context Manifest follows the `ContextDocument` schema defined in `src/core/models/ContextDocument.ts`.

### ContextDocument Structure

```typescript
{
  schema_version: string;      // Semantic version (e.g., "1.0.0")
  feature_id: string;          // Feature identifier (ULID/UUIDv7)
  created_at: string;          // ISO 8601 timestamp
  updated_at: string;          // ISO 8601 timestamp
  files: Record<string, ContextFileRecord>;
  summaries: ContextSummary[]; // Optional summaries (future enhancement)
  total_token_count: number;   // Aggregate token count for all files
  provenance: ProvenanceData;  // Git metadata and source tracking
  metadata?: Record<string, unknown>;
}
```

### ContextFileRecord

Each file in the manifest includes:

```typescript
{
  path: string;           // Relative path from repository root
  hash: string;           // SHA-256 hash of file contents (64 hex chars)
  size: number;           // File size in bytes
  file_type?: string;     // File extension (e.g., "ts", "md")
  token_count?: number;   // Estimated token count
}
```

### ProvenanceData

Provenance metadata tracks the source and git state:

```typescript
{
  source: string;           // Source type: "manual", "linear_issue", etc.
  captured_at: string;      // ISO 8601 timestamp when context was captured
  commit_sha?: string;      // Git commit SHA (40 hex chars)
  branch?: string;          // Git branch name
  metadata?: Record<string, unknown>;
}
```

---

## Storage Location

Context artifacts are stored under the run directory:

```
.ai-feature-pipeline/runs/<feature_id>/context/
├── summary.json          # ContextDocument manifest
└── file_hashes.json      # HashManifest for incremental updates
```

### summary.json

The primary context manifest. Contains the full `ContextDocument` with file records, token counts, and provenance.

**Example:**

```json
{
  "schema_version": "1.0.0",
  "feature_id": "01J9X8K2M3N4P5Q6R7S8T9V0WX",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z",
  "files": {
    "README.md": {
      "path": "README.md",
      "hash": "a3f8c9d2e1b4f5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "size": 1024,
      "file_type": "md",
      "token_count": 256
    },
    "src/index.ts": {
      "path": "src/index.ts",
      "hash": "b4e5f6a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5",
      "size": 2048,
      "file_type": "ts",
      "token_count": 512
    }
  },
  "summaries": [],
  "total_token_count": 768,
  "provenance": {
    "source": "manual",
    "captured_at": "2024-01-15T10:30:00.000Z",
    "commit_sha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "branch": "main"
  }
}
```

### file_hashes.json

Hash manifest for incremental context updates. Tracks file hashes, sizes, and timestamps.

**Example:**

```json
{
  "schema_version": "1.0.0",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z",
  "files": {
    "/absolute/path/to/README.md": {
      "path": "/absolute/path/to/README.md",
      "hash": "a3f8c9d2e1b4f5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "size": 1024,
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  }
}
```

---

## Configuration

Context aggregation is configured via `RepoConfig` (`.codemachine.yml`) and CLI overrides.

### RepoConfig Settings

```yaml
project:
  context_paths:
    - "src/"
    - "docs/"
    - "README.md"
    - "package.json"

runtime:
  context_token_budget: 32000

constraints:
  max_context_files: 100
  max_file_size_kb: 1000
```

#### project.context_paths

Array of glob patterns defining which files to include in context.

**Supported patterns:**
- `**/*.ts` - All TypeScript files recursively
- `src/` - All files in `src/` directory
- `README.md` - Specific file
- `docs/**/*.md` - All Markdown files in `docs/`

**Default patterns:**
```typescript
['src/', 'docs/', 'README.md']
```

#### runtime.context_token_budget

Maximum total tokens for context aggregation. Files are ranked and included until the budget is exhausted.

**Default:** `32000` tokens

**Rationale:** Most agent models support 128K+ context windows, but 32K provides a balance between comprehensive context and prompt efficiency.

#### constraints.max_context_files

Maximum number of files to include, regardless of token budget.

**Default:** `100` files

**Purpose:** Prevents excessive file inclusion that could degrade agent performance.

#### constraints.max_file_size_kb

Maximum size for individual files. Files exceeding this limit are excluded.

**Default:** `1000` KB (1 MB)

---

## Default Globs and Exclusions

### Included by Default

When no `context_paths` are specified, the aggregator includes:

```typescript
[
  'src/',           // Source code
  'docs/',          // Documentation
  'README.md',      // Main README
  'package.json',   // Dependencies
  'tsconfig.json',  // TypeScript config
]
```

### Always Excluded

The following patterns are excluded automatically:

```typescript
[
  '**/node_modules/**',     // Dependencies
  '**/.git/**',             // Git metadata
  '**/dist/**',             // Build output
  '**/build/**',            // Build artifacts
  '**/.next/**',            // Next.js cache
  '**/coverage/**',         // Test coverage
  '**/*.log',               // Log files
  '**/.DS_Store',           // macOS metadata
  '**/package-lock.json',   // Lock files
  '**/yarn.lock',           // Lock files
]
```

---

## Token Estimation and Budgeting

### Token Estimation

Tokens are estimated using a simple heuristic:

```
estimated_tokens = file_size_bytes / 4
```

**Rationale:** This approximates typical tokenization for English text and code (GPT-style tokenizers average ~4 characters per token).

### Ranking and Selection

Files are ranked using a composite score based on:

1. **Path Depth (weight: 0.3):** Shallower files (closer to repository root) score higher.
2. **Git Recency (weight: 0.3):** Recently modified files score higher.
3. **File Type (weight: 0.3):** README > Docs > Source > Config > Tests > Build artifacts.
4. **File Size (weight: 0.1):** Files in the 1KB-100KB range score highest.

**Formula:**

```
composite_score =
  (path_depth_score * 0.3) +
  (git_recency_score * 0.3) +
  (file_type_score * 0.3) +
  (file_size_score * 0.1)
```

### Budget Application

Files are selected in order of composite score until:
1. Token budget is exhausted, OR
2. `max_context_files` limit is reached

**Example:**

With `context_token_budget: 10000` and 20 discovered files totaling 30,000 tokens:
- Files are sorted by score (descending)
- Top-ranked files are included until 10,000 tokens reached
- Remaining files are excluded but tracked in diagnostics

---

## Fallback Ordering

When token budgets are tight, the ranking system ensures critical files are prioritized:

1. **README files:** Always included if within budget (score: 1.0).
2. **Documentation:** High priority (score: 0.8).
3. **Source code:** Medium-high priority (score: 0.6).
4. **Configuration:** Medium priority (score: 0.5).
5. **Tests:** Lower priority (score: 0.4).
6. **Build artifacts:** Lowest priority (score: 0.2).

This ensures that even with minimal budgets, the most relevant context is captured.

---

## Manual Overrides

CLI commands can override configuration with explicit include/exclude patterns.

### Include Overrides

Add specific files or patterns to context:

```bash
ai-feature start --include "experimental/" --include "scripts/deploy.sh"
```

These patterns are **appended** to `context_paths` from configuration.

### Exclude Overrides

Exclude specific files or patterns:

```bash
ai-feature start --exclude "src/legacy/" --exclude "**/*.test.ts"
```

These patterns are **added** to default exclusions.

### Override Precedence

1. Default exclusions (always applied)
2. User exclusions (CLI `--exclude`)
3. Configuration globs (`context_paths`)
4. User inclusions (CLI `--include`)

**Example:**

```yaml
# .codemachine.yml
project:
  context_paths:
    - "src/"
```

```bash
ai-feature start --include "experimental/" --exclude "src/legacy/"
```

**Effective patterns:**
- Include: `src/`, `experimental/`
- Exclude: Default exclusions + `src/legacy/`

---

## Incremental Context Updates

The aggregator supports incremental updates to avoid re-scanning unchanged files.

### Hash-Based Change Detection

1. On first run, all files are hashed and stored in `file_hashes.json`.
2. On subsequent runs, current files are hashed and compared to saved hashes.
3. Files with matching hashes are skipped (no re-processing).
4. Changed or new files are re-hashed and included.

### Freshness Validation

Context is considered **stale** if:
- `file_hashes.json` is missing
- Repository files have changed since last aggregation
- Configuration (`context_paths`, `token_budget`) has changed

### Resume Behavior

When a run is resumed:
1. Load `file_hashes.json` from run directory.
2. Compare hashes to current repository state.
3. Re-aggregate only if changes detected.

This minimizes I/O and ensures consistent context across resume cycles.

---

## Diagnostics and Observability

Context aggregation emits diagnostics for debugging and optimization:

```typescript
{
  discovered: number;   // Total files matching globs
  skipped: number;      // Files unchanged (incremental)
  hashed: number;       // Files newly hashed
  errors: string[];     // Errors during aggregation
  warnings: string[];   // Non-fatal issues
}
```

Additionally, ranking results include:

```typescript
{
  included: FileMetadata[];  // Files included in context
  excluded: FileMetadata[];  // Files excluded by budget
  totalTokens: number;       // Actual token count
  diagnostics: {
    totalFiles: number;
    includedCount: number;
    excludedCount: number;
    tokenBudget: number;
    maxFiles?: number;
  }
}
```

---

## Usage Examples

### Basic Aggregation

```bash
ai-feature start
```

Uses default `context_paths` from `.codemachine.yml`.

### Custom Token Budget

```bash
ai-feature start --token-budget 50000
```

Override the token budget for this run.

### Manual Inclusions

```bash
ai-feature start --include "experimental/" --include "migrations/"
```

Add specific directories to context.

### Exclusions

```bash
ai-feature start --exclude "**/*.test.ts" --exclude "legacy/"
```

Exclude test files and legacy code.

### Combined

```bash
ai-feature start \
  --include "src/" \
  --include "docs/" \
  --exclude "src/deprecated/" \
  --token-budget 20000 \
  --max-files 50
```

---

## Schema Evolution

The manifest schema is versioned (`schema_version: "1.0.0"`) to support future enhancements.

### Planned Enhancements

- **Context Summarization:** Generate LLM-powered summaries for large files.
- **Semantic Ranking:** Use embedding-based similarity to prioritize relevant files.
- **Custom Scoring Weights:** Allow users to configure ranking weights per project.
- **Binary File Handling:** Detect and exclude binary files automatically.

### Migration Strategy

When the schema version changes:
1. Old manifests remain valid (backward compatibility).
2. New runs generate updated manifests with new `schema_version`.
3. Validators emit warnings for outdated manifests.

---

## References

- **ContextDocument Model:** `src/core/models/ContextDocument.ts`
- **Hash Manifest Utilities:** `src/persistence/hashManifest.ts`
- **Context Aggregator:** `src/workflows/contextAggregator.ts`
- **Context Ranking:** `src/workflows/contextRanking.ts`
- **ADR-4 (Context Gathering):** `docs/adr/ADR-4-context-gathering.md`
- **FR-7 (Context Discovery):** Architecture Document Section 2.1
- **FR-8 (Token Budgeting):** Architecture Document Section 2.1

---

## Troubleshooting

### No Files Discovered

**Problem:** `diagnostics.discovered = 0`

**Solutions:**
1. Check `context_paths` patterns in `.codemachine.yml`.
2. Verify files exist in repository.
3. Ensure patterns are not overly restrictive.
4. Check for conflicting exclusions.

### Token Budget Exceeded

**Problem:** `ranking.excluded.length > 0`

**Solutions:**
1. Increase `context_token_budget` in configuration.
2. Narrow `context_paths` to essential files.
3. Add exclusions for low-priority files (tests, build artifacts).
4. Review ranking scores to understand prioritization.

### Stale Context

**Problem:** Context not updating after file changes

**Solutions:**
1. Delete `file_hashes.json` to force full re-scan.
2. Check if files are excluded by patterns.
3. Verify git metadata is accessible (for recency scoring).

### High Aggregation Time

**Problem:** Slow context gathering

**Solutions:**
1. Reduce `max_context_files` limit.
2. Exclude large directories (e.g., `vendor/`, `third_party/`).
3. Use more specific glob patterns instead of `**/*`.

---

## Appendix: Scoring Reference

### Path Depth Scoring

| Depth | Example Path               | Score |
|-------|---------------------------|-------|
| 0     | `README.md`               | 1.0   |
| 1     | `src/index.ts`            | 0.8   |
| 2     | `src/utils/helper.ts`     | 0.6   |
| 3     | `src/deep/nested/file.ts` | 0.4   |
| 5+    | `a/b/c/d/e/f/g.ts`        | 0.0   |

### File Type Scoring

| Type                  | Score | Example                    |
|-----------------------|-------|----------------------------|
| README                | 1.0   | `README.md`, `readme.txt`  |
| Documentation         | 0.8   | `docs/guide.md`            |
| Source Code           | 0.6   | `src/index.ts`             |
| Configuration         | 0.5   | `package.json`             |
| Tests                 | 0.4   | `tests/index.spec.ts`      |
| Build Artifacts       | 0.2   | `dist/bundle.js`           |

### File Size Scoring

| Size Range   | Score | Notes                    |
|--------------|-------|--------------------------|
| 0 bytes      | 0.0   | Empty files excluded     |
| < 1 KB       | 0.5   | Penalized (too small)    |
| 1 KB - 100 KB| 1.0   | Optimal range            |
| 100 KB - 1 MB| 0.5   | Penalized (large)        |
| > 1 MB       | 0.0   | Excluded (too large)     |

---

**Document Version:** 1.0.0
**Last Updated:** 2024-01-15
**Maintained By:** CodeMachine Pipeline Team
