# CodeMachine CLI Adapter Guide

**Version:** 1.0.0
**Last Updated:** 2026-01-03

This document describes how the AI Feature Pipeline integrates with the CodeMachine CLI for task execution, including configuration, troubleshooting, and operational best practices.

## Overview

The CodeMachine CLI adapter enables the pipeline to delegate task execution to the external `codemachine` CLI tool. This integration provides:

- Unified execution interface for all task types
- Log streaming with configurable buffer limits
- Credential redaction in outputs
- Artifact capture with path traversal prevention
- Retry logic with exponential backoff

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIExecutionEngine                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │ ExecutionQueue  │→ │ StrategyRouter  │→ │ TaskMapper  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────┘  │
│           │                    │                   │         │
│           ▼                    ▼                   ▼         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              CodeMachineStrategy                         ││
│  │  ┌─────────────────┐  ┌─────────────────────────────┐   ││
│  │  │ CodeMachineRunner│→ │ ResultNormalizer            │   ││
│  │  │ (CLI Spawning)  │  │ (Output Processing)         │   ││
│  │  └─────────────────┘  └─────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Repository Configuration

Add CodeMachine settings to your `config.json`:

```json
{
  "execution": {
    "default_engine": "claude",
    "codemachine_cli_path": "codemachine",
    "task_timeout_ms": 300000,
    "max_retries": 3,
    "max_log_buffer_size": 10485760
  }
}
```

### Configuration Fields

| Field                  | Type   | Default       | Description                                     |
| ---------------------- | ------ | ------------- | ----------------------------------------------- |
| `codemachine_cli_path` | string | `codemachine` | Path to CodeMachine CLI binary                  |
| `task_timeout_ms`      | number | 300000        | Task execution timeout (5 min default)          |
| `max_retries`          | number | 3             | Maximum retry attempts for recoverable failures |
| `max_log_buffer_size`  | number | 10485760      | Max log buffer size (10MB default)              |

### Environment Variables

| Variable                | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `CODEMACHINE_CLI_PATH`  | Override CLI path from config                    |
| `CODEMACHINE_TIMEOUT`   | Override timeout in milliseconds                 |
| `CODEMACHINE_LOG_LEVEL` | Set CLI log verbosity (debug, info, warn, error) |

## CLI Availability Check

The `doctor` command validates CodeMachine CLI availability:

```bash
codepipe doctor
```

Output includes:

```
CodeMachine CLI:
  ✓ CLI found at /usr/local/bin/codemachine
  ✓ Version: 2.1.0
```

If the CLI is not found:

```
CodeMachine CLI:
  ⚠ CLI not found
  → Install CodeMachine CLI or set execution.codemachine_cli_path in config
```

## Task Execution Flow

### 1. Task Reception

Tasks are received from the execution queue with metadata:

```typescript
interface Task {
  task_id: string;
  task_type: 'code_generation' | 'testing' | 'pr_creation' | ...;
  title: string;
  description: string;
  acceptance_criteria: string[];
  context_references: string[];
}
```

### 2. Strategy Selection

The `TaskMapper` determines execution strategy:

```typescript
const mapping = mapTaskToWorkflow(task.task_type);
// Returns: { engine: 'codemachine', workflow: 'generate-code', ... }
```

### 3. CLI Invocation

The `CodeMachineRunner` spawns the CLI process:

```bash
codemachine execute \
  --task-id "task_001" \
  --task-type "code_generation" \
  --workspace "/path/to/workspace" \
  --output-format json \
  --log-file "/path/to/logs/task_001.log"
```

### 4. Output Processing

The `ResultNormalizer` processes CLI output:

- Parses JSON result from stdout
- Categorizes errors (transient vs permanent)
- Redacts credentials from logs
- Captures artifacts

## Error Handling

### Error Categories

| Category                | Recoverable | Action                       |
| ----------------------- | ----------- | ---------------------------- |
| `transient`             | Yes         | Retry with backoff           |
| `permanent`             | No          | Mark task failed             |
| `timeout`               | Yes         | Retry with extended timeout  |
| `human_action_required` | No          | Pause queue, notify operator |

### Retry Backoff Schedule

| Attempt | Delay     |
| ------- | --------- |
| 1       | 1 second  |
| 2       | 2 seconds |
| 3       | 4 seconds |

After max retries, task is marked failed with `recoverable: false`.

### Common Error Scenarios

#### CLI Not Found

```
Error: CodeMachine CLI not found
Category: permanent
Resolution: Install CLI or set CODEMACHINE_CLI_PATH
```

#### Execution Timeout

```
Error: Task execution timed out after 300000ms
Category: timeout
Resolution: Increase timeout_ms or optimize task scope
```

## Security

### Path Validation

All paths are validated to prevent traversal attacks:

```typescript
// Rejected: ../../../etc/passwd
// Rejected: task_id_with_../_traversal
// Accepted: task_001, feature-auth-flow
```

### Credential Redaction

The following patterns are automatically redacted from logs:

| Pattern            | Example                      | Redacted            |
| ------------------ | ---------------------------- | ------------------- |
| Bearer tokens      | `Bearer eyJ...`              | `Bearer [REDACTED]` |
| API keys           | `sk-abc123...`               | `[REDACTED]`        |
| GitHub tokens      | `ghp_xxxxx`                  | `[REDACTED]`        |
| Private keys       | `-----BEGIN...`              | `[REDACTED]`        |
| Connection strings | `postgresql://user:pass@...` | `[REDACTED]`        |
| AWS keys           | `AKIA...`                    | `[REDACTED]`        |

### Log Buffer Limits

Logs are buffered up to the configured limit (default 10MB). If exceeded:

1. Older content is truncated
2. Warning is logged
3. Execution continues

## Artifact Capture

### Captured Artifacts

After task completion, artifacts are captured from the workspace:

| File                | Description            |
| ------------------- | ---------------------- |
| `summary.md`        | Task execution summary |
| `changes.patch`     | Git diff of changes    |
| `test-results.json` | Test execution results |

### Artifact Storage

Artifacts are stored in the run directory:

```
.codepipe/runs/<feature_id>/artifacts/<task_id>/
├── summary.md
├── changes.patch
└── test-results.json
```

## Troubleshooting

### Task Stuck in Running State

1. Check CLI process: `ps aux | grep codemachine`
2. Review logs: `.codepipe/runs/<feature>/logs/`
3. Kill orphaned process if needed
4. Resume with: `codepipe resume --feature <id>`

### High Failure Rate

1. Run diagnostics: `codepipe doctor`
2. Check rate limits: `codepipe rate-limits`
3. Review recent failures in telemetry
4. Consider reducing concurrency

### Log Buffer Overflow

If logs are truncated:

1. Check `max_log_buffer_size` setting
2. Increase limit or reduce task verbosity
3. Enable log file streaming for full capture

## Related Documentation

- [Execution Telemetry](./execution_telemetry.md)
- [Rate Limit Reference](./rate_limit_reference.md)
- [Doctor Reference](./doctor_reference.md)
- [Architecture: Execution Flow](../architecture/execution_flow.md)
