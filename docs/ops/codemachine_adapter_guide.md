# CodeMachine Adapter Guide

This guide covers the setup, configuration, and troubleshooting of the CodeMachine CLI integration with the AI Feature Pipeline.

## Prerequisites

- Node.js 24.0.0 or higher
- CodeMachine CLI installed globally: `npm install -g codemachine-cli`
- Valid agent endpoint configured

## Quick Start

### 1. Install CodeMachine CLI

```bash
npm install -g codemachine-cli

# Verify installation
codemachine-cli --version
```

### 2. Configure the Pipeline

Add execution settings to `.ai-feature-pipeline/config.json`:

```json
{
  "execution": {
    "engine": "claude",
    "cli_path": "codemachine-cli",
    "timeout_seconds": 300,
    "max_retries": 3
  }
}
```

### 3. Verify Setup

```bash
ai-feature doctor
```

The doctor command will check CodeMachine CLI availability and report status.

## Configuration Reference

### Execution Settings

| Field                       | Type    | Default             | Description                |
| --------------------------- | ------- | ------------------- | -------------------------- |
| `execution.engine`          | string  | `"claude"`          | Execution engine type      |
| `execution.cli_path`        | string  | `"codemachine-cli"` | Path to CLI binary         |
| `execution.timeout_seconds` | number  | `300`               | Command timeout            |
| `execution.max_retries`     | number  | `3`                 | Retry attempts on failure  |
| `execution.dry_run`         | boolean | `false`             | Simulate without executing |

### Environment Variables

| Variable               | Description                |
| ---------------------- | -------------------------- |
| `CODEMACHINE_CLI_PATH` | Override CLI path          |
| `CODEMACHINE_API_KEY`  | API key for agent service  |
| `CODEMACHINE_TIMEOUT`  | Override timeout (seconds) |

## Engine Selection

The pipeline supports multiple execution engines:

### Claude (Default)

```json
{
  "execution": {
    "engine": "claude"
  }
}
```

Best for: Complex reasoning, code generation, multi-step tasks.

### Codex

```json
{
  "execution": {
    "engine": "codex"
  }
}
```

Best for: Code completion, simple transformations.

### OpenAI

```json
{
  "execution": {
    "engine": "openai"
  }
}
```

Best for: General-purpose tasks, GPT-4 compatibility.

## Troubleshooting

### CLI Not Found

**Symptom**: `codemachine-cli: command not found`

**Solutions**:

1. Verify installation:

   ```bash
   npm list -g codemachine-cli
   ```

2. Check PATH includes npm global bin:

   ```bash
   npm bin -g
   # Add to PATH if needed
   export PATH="$(npm bin -g):$PATH"
   ```

3. Use explicit path in config:
   ```json
   {
     "execution": {
       "cli_path": "/usr/local/bin/codemachine-cli"
     }
   }
   ```

### Timeout Errors

**Symptom**: `Error: Command timed out after 300 seconds`

**Solutions**:

1. Increase timeout:

   ```json
   {
     "execution": {
       "timeout_seconds": 600
     }
   }
   ```

2. Check agent endpoint health:

   ```bash
   curl -I $AGENT_ENDPOINT/health
   ```

3. Reduce task complexity or break into smaller steps.

### Permanent Failure

**Symptom**: `PermanentError: Task failed after 3 retries`

**Causes**:

- Invalid API credentials
- Malformed request payload
- Agent service unavailable

**Solutions**:

1. Verify credentials:

   ```bash
   echo $CODEMACHINE_API_KEY | head -c 10
   ```

2. Test with dry-run:

   ```bash
   codemachine-cli --dry-run --engine claude "Test prompt"
   ```

3. Check agent service logs.

### Queue Issues

**Symptom**: Tasks stuck in queue

**Solutions**:

1. Check queue status:

   ```bash
   ai-feature status --verbose
   ```

2. Validate queue files:

   ```bash
   ai-feature resume --validate-queue --dry-run
   ```

3. Force resume if safe:
   ```bash
   ai-feature resume --force
   ```

## Monitoring

### Health Checks

The `ai-feature doctor` command includes CodeMachine CLI checks:

```bash
ai-feature doctor --verbose
```

Output:

```
✓ CodeMachine CLI: codemachine-cli 1.2.3
  Path: /usr/local/bin/codemachine-cli
```

### Execution Metrics

Monitor execution via telemetry:

```bash
ai-feature status --show-costs
```

Metrics tracked:

- `execution_duration_ms` - Task execution time
- `execution_retries` - Retry count
- `execution_failures` - Failure count

### Logs

Execution logs are stored in:

```
.ai-feature-pipeline/runs/<feature-id>/logs/execution.ndjson
```

## Best Practices

1. **Always run doctor first**: Verify setup before starting features
2. **Use dry-run for testing**: Test commands without side effects
3. **Monitor rate limits**: Check `ai-feature rate-limits` regularly
4. **Keep CLI updated**: `npm update -g codemachine-cli`
5. **Set reasonable timeouts**: Balance between reliability and efficiency

## Related Documentation

- [Execution Flow](../requirements/execution_flow.md)
- [Agent Manifest Guide](./agent_manifest_guide.md)
- [Rate Limit Reference](./rate_limit_reference.md)
- [Doctor Reference](./doctor_reference.md)
