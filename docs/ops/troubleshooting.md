# Troubleshooting Guide

**Version:** 1.0.0
**Last Updated:** 2026-01-26
**Owner:** Platform Engineering
**Issue:** CDMCH-52

---

## Overview

This guide provides solutions for common issues encountered when operating the AI Feature Pipeline. Use it to diagnose and resolve problems with queue operations, integrations, execution failures, and configuration issues.

**Quick Links:**
- [Common Issues](#common-issues)
- [Diagnostic Commands](#diagnostic-commands)
- [Log Analysis](#log-analysis)
- [Recovery Procedures](#recovery-procedures)
- [Getting Help](#getting-help)

---

## Common Issues

### Queue Problems

#### "Queue V1 format no longer supported"

**Symptom:** Error message indicating the queue format is outdated when running `codepipe resume` or `codepipe status`.

**Cause:** The queue system was upgraded from V1 (simple JSONL) to V2 (snapshot + WAL architecture) for O(1) performance. Old queue files need migration.

**Resolution:**

1. **Automatic Migration (Recommended)**

   Migration happens automatically when you run any queue operation:
   ```bash
   codepipe resume <feature_id>
   ```

   The system will:
   - Detect V1 format (`queue.jsonl`)
   - Create V2 snapshot (`queue_snapshot.json`) and WAL (`queue_operations.log`)
   - Backup V1 files as `queue.jsonl.v1backup`
   - Log migration details

2. **Manual Migration (If Automatic Fails)**

   ```bash
   # Check current queue format
   ls -la .codepipe/runs/<feature_id>/queue/

   # If you see queue.jsonl without queue_snapshot.json, migration is needed
   # Force resume to trigger migration
   codepipe resume <feature_id> --validate-queue

   # Verify migration succeeded
   ls -la .codepipe/runs/<feature_id>/queue/
   # Should now see: queue_snapshot.json, queue_operations.log
   ```

3. **Rollback If Migration Fails**

   If migration causes issues, restore V1 backup:
   ```bash
   cd .codepipe/runs/<feature_id>/queue/
   rm queue_snapshot.json queue_operations.log queue_sequence.txt 2>/dev/null
   mv queue.jsonl.v1backup queue.jsonl
   ```

**Prevention:**
- Set `CODEPIPE_QUEUE_BACKUP_V1=true` to always create backups before migration
- Test migration in development environments first

---

#### Queue Corruption Recovery

**Symptom:** Queue operations fail with validation errors, checksum mismatches, or "corrupted JSON" messages.

**Cause:** Queue files may become corrupted due to:
- Disk full during write
- Process crash during atomic operation
- Manual file editing
- File system corruption

**Resolution:**

1. **Validate Queue Integrity**
   ```bash
   codepipe queue validate <feature_id>
   ```
   This shows specific corruption details (line numbers, field errors).

2. **Rebuild from Plan (Preferred)**
   ```bash
   # Create backup first
   cp -r .codepipe/runs/<feature_id>/queue/ \
         .codepipe/runs/<feature_id>/queue.corrupted.bak

   # Rebuild queue from execution plan
   codepipe queue rebuild <feature_id> --from-plan
   ```

3. **Restore from Snapshot (If Available)**
   ```bash
   # List available snapshots
   ls -la .codepipe/runs/<feature_id>/queue/queue_snapshot.json*

   # Restore from most recent valid snapshot
   cp queue_snapshot.json.1705401234 queue_snapshot.json

   # Replay any WAL operations since snapshot
   codepipe resume <feature_id> --validate-queue
   ```

4. **Force Compaction to Clean WAL**
   ```bash
   export CODEPIPE_QUEUE_FORCE_COMPACT=true
   codepipe resume <feature_id>
   ```

**Prevention:**
- Enable periodic snapshots: `CODEPIPE_QUEUE_SNAPSHOT_INTERVAL=100`
- Monitor disk space before long runs
- Never manually edit queue files

---

#### Stuck Tasks (Running State After Crash)

**Symptom:** Tasks show `running` status but no process is actively executing them. Pipeline cannot make progress.

**Cause:** Process crashed or was terminated while tasks were being executed, leaving them in `running` state.

**Resolution:**

1. **Verify No Process is Running**
   ```bash
   ps aux | grep codepipe
   pgrep -f "codepipe"
   ```

2. **Check for Stale Lock Files**
   ```bash
   ls -la .codepipe/runs/<feature_id>/run.lock

   # If lock is older than 5 minutes and no process exists:
   rm .codepipe/runs/<feature_id>/run.lock
   ```

3. **Reset Stuck Tasks to Pending**
   ```bash
   # List tasks in running state
   codepipe queue list <feature_id> --status running

   # Reset individual task
   codepipe task reset <feature_id> <task_id>

   # Or reset all stuck tasks
   codepipe queue reset-stuck <feature_id>
   ```

4. **Resume Execution**
   ```bash
   codepipe resume <feature_id>
   ```

**Prevention:**
- Use process supervisors (systemd, pm2) for long-running pipelines
- Enable graceful shutdown handling
- Configure task timeouts to prevent indefinite hangs

---

### Integration Issues

#### GitHub Rate Limiting and Cooldown

**Symptom:**
- HTTP 429 errors in logs
- Operations failing with "rate limit exceeded"
- `in_cooldown: true` in status output

**Cause:** GitHub API rate limit (5,000 requests/hour for authenticated users) has been exceeded.

**Resolution:**

1. **Check Current Rate Limit Status**
   ```bash
   codepipe status <feature_id> --verbose

   # Or directly query GitHub
   curl -H "Authorization: Bearer $GITHUB_TOKEN" \
        https://api.github.com/rate_limit | jq '.rate'
   ```

2. **Wait for Rate Limit Reset**
   ```bash
   # Check when rate limit resets
   cat .codepipe/runs/<feature_id>/rate_limits.json | \
     jq '.providers.github.state.reset' | xargs -I {} date -d @{}
   ```

3. **Clear Cooldown After Reset**
   ```bash
   # Manual cooldown clear (only after reset time has passed)
   jq '.providers.github.state.inCooldown = false |
       del(.providers.github.state.cooldownUntil)' \
     .codepipe/runs/<feature_id>/rate_limits.json > temp.json && \
     mv temp.json .codepipe/runs/<feature_id>/rate_limits.json
   ```

4. **Resume After Cooldown**
   ```bash
   codepipe resume <feature_id>
   ```

**Prevention:**
- Configure conservative rate limits in config:
  ```json
  {
    "rate_limits": {
      "github": {
        "requests_per_minute": 30,
        "cooldown_threshold": 100
      }
    }
  }
  ```
- Avoid running multiple pipelines with the same token
- Use separate tokens for different environments

---

#### Linear API Authentication Failures

**Symptom:**
- HTTP 401 Unauthorized errors
- "Invalid API key" messages
- Linear issue updates failing

**Cause:** Linear API key is missing, expired, or lacks required permissions.

**Resolution:**

1. **Verify API Key is Set**
   ```bash
   # Check if environment variable is set
   echo ${LINEAR_API_KEY:+set}

   # Run doctor to check credential status
   codepipe doctor
   ```

2. **Test API Key Validity**
   ```bash
   curl -H "Authorization: $LINEAR_API_KEY" \
        https://api.linear.app/graphql \
        -d '{"query": "{ viewer { id name } }"}' | jq .
   ```

3. **Regenerate API Key**
   - Go to https://linear.app/settings/api
   - Click "Create new API key"
   - Set new key: `export LINEAR_API_KEY=lin_api_...`

4. **Verify Key Permissions**

   The API key needs scopes for:
   - Reading issues
   - Updating issue state
   - Creating comments

**Prevention:**
- Store API keys in a secrets manager
- Rotate keys regularly
- Use key expiration monitoring

---

#### Agent Endpoint Connection Errors

**Symptom:**
- Connection refused errors
- Timeout waiting for agent response
- "Agent endpoint not reachable" messages

**Cause:** Agent service is down, misconfigured, or network is blocking connections.

**Resolution:**

1. **Verify Endpoint Configuration**
   ```bash
   # Check config
   cat .codepipe/config.json | jq '.runtime.agent_endpoint'

   # Or environment variable
   echo $AGENT_ENDPOINT
   ```

2. **Test Endpoint Connectivity**
   ```bash
   # Basic connectivity
   curl -I "$AGENT_ENDPOINT/health" 2>/dev/null || echo "Connection failed"

   # DNS resolution
   host $(echo "$AGENT_ENDPOINT" | sed 's|https://||' | cut -d/ -f1)
   ```

3. **Check Firewall/Proxy**
   ```bash
   # If behind proxy
   echo $HTTP_PROXY
   echo $HTTPS_PROXY

   # Test with explicit proxy bypass if needed
   curl --noproxy '*' "$AGENT_ENDPOINT/health"
   ```

4. **Update Endpoint in Config**
   ```bash
   # Set via environment variable
   export AGENT_ENDPOINT=https://new-agent-endpoint.example.com

   # Or update config.json
   jq '.runtime.agent_endpoint = "https://new-agent-endpoint.example.com"' \
     .codepipe/config.json > temp.json && \
     mv temp.json .codepipe/config.json
   ```

**Prevention:**
- Configure health check monitoring
- Use agent endpoint failover if available
- Set appropriate timeouts

---

### Execution Problems

#### Task Timeout Handling

**Symptom:** Tasks fail with timeout errors, execution takes longer than expected.

**Cause:** Task execution time exceeded configured timeout limit (default: 30 minutes).

**Resolution:**

1. **Check Timeout Configuration**
   ```bash
   cat .codepipe/config.json | jq '.runtime.task_timeout_ms'
   ```

2. **Increase Timeout for Long Tasks**
   ```bash
   # Via environment variable (milliseconds)
   export CODEPIPE_EXECUTION_TIMEOUT_MS=3600000  # 1 hour

   # Or in config.json
   jq '.runtime.task_timeout_ms = 3600000' \
     .codepipe/config.json > temp.json && \
     mv temp.json .codepipe/config.json
   ```

3. **Retry Timed-Out Task**
   ```bash
   codepipe task retry <feature_id> <task_id>
   ```

4. **Investigate Slow Tasks**
   ```bash
   # Check task logs for bottlenecks
   grep "<task_id>" .codepipe/runs/<feature_id>/logs/execution.ndjson | \
     jq -s 'sort_by(.timestamp)'
   ```

**Prevention:**
- Set realistic timeouts per task type
- Break large tasks into smaller subtasks
- Monitor task duration metrics

---

#### Failed Task Retry Behavior

**Symptom:** Tasks fail and need to be retried, unclear how retry logic works.

**Understanding Retry Behavior:**

| Error Type | Automatic Retry | Manual Action |
|------------|-----------------|---------------|
| Rate limit (429) | Yes, with backoff | Wait for reset |
| Network timeout | Yes, up to max_retries | Check connectivity |
| Validation error | No | Fix input and retry |
| Agent failure | Depends on error | Check agent logs |
| Permission denied | No | Fix permissions |

**Resolution:**

1. **Check Task Status and Error**
   ```bash
   codepipe task status <feature_id> <task_id>
   ```

2. **Manual Retry**
   ```bash
   codepipe task retry <feature_id> <task_id>
   ```

3. **Skip Failed Task (If Non-Critical)**
   ```bash
   codepipe task skip <feature_id> <task_id>
   ```

4. **Mark Task Complete (After Manual Fix)**
   ```bash
   # If you manually completed the work
   codepipe task complete <feature_id> <task_id>
   ```

---

#### Dependency Resolution Failures

**Symptom:** Tasks fail because dependent tasks are not completed, circular dependency detected.

**Resolution:**

1. **Visualize Dependency Graph**
   ```bash
   codepipe status <feature_id> --show-dag
   ```

2. **Check for Circular Dependencies**
   ```bash
   codepipe queue validate <feature_id>
   # Will report circular dependency errors
   ```

3. **Fix Circular Dependencies**

   If plan has circular dependencies, replan:
   ```bash
   codepipe replan <feature_id>
   ```

4. **Manually Unblock Tasks**
   ```bash
   # If dependency task cannot complete, mark it done
   codepipe task complete <feature_id> <blocking_task_id>
   ```

---

### Configuration Issues

#### Invalid config.json Errors

**Symptom:** Commands fail with schema validation errors for config.json.

**Resolution:**

1. **Run Validation with Details**
   ```bash
   codepipe init --validate-only
   ```

2. **Common Validation Errors**

   | Error | Cause | Fix |
   |-------|-------|-----|
   | Invalid schema_version | Not semver format | Use `"1.0.0"` format |
   | Invalid repo_url | Not a valid URL | Use `https://github.com/...` |
   | Invalid datetime | ISO 8601 expected | Use `"2025-01-15T12:00:00Z"` |
   | Missing required field | Field not present | Add required field |
   | Unknown field | Typo or deprecated | Remove or rename field |

3. **Validate JSON Syntax**
   ```bash
   cat .codepipe/config.json | jq . > /dev/null && echo "Valid JSON" || echo "Invalid JSON"
   ```

4. **Reset to Default Config**
   ```bash
   # Backup current config
   cp .codepipe/config.json .codepipe/config.json.bak

   # Re-initialize
   codepipe init --force
   ```

---

#### Environment Variable Not Set

**Symptom:** Doctor command reports missing credentials or configuration.

**Resolution:**

1. **Check Required Variables**
   ```bash
   codepipe doctor
   ```

2. **Set Missing Variables**
   ```bash
   # GitHub token
   export GITHUB_TOKEN=ghp_your_token_here

   # Linear API key
   export LINEAR_API_KEY=lin_api_your_key_here

   # Agent endpoint
   export AGENT_ENDPOINT=https://agent.example.com
   ```

3. **Persist Variables**
   ```bash
   # Add to shell profile
   echo 'export GITHUB_TOKEN=ghp_your_token' >> ~/.bashrc
   source ~/.bashrc

   # Or use .env file (if supported)
   echo 'GITHUB_TOKEN=ghp_your_token' >> .env
   ```

4. **Verify Variables Are Set**
   ```bash
   codepipe doctor --verbose
   ```

---

#### Schema Validation Failures

**Symptom:** Data files (manifests, artifacts) fail schema validation during load.

**Resolution:**

1. **Identify Failed Schema**
   ```bash
   # Check manifest
   codepipe status <feature_id> --validate

   # Check specific artifact
   cat .codepipe/runs/<feature_id>/artifacts/spec.json | \
     npx ajv validate -s spec-schema.json -d -
   ```

2. **Common Schema Issues**

   | Artifact | Common Issues |
   |----------|---------------|
   | manifest.json | Invalid status enum, missing feature_id |
   | queue_snapshot.json | Invalid task status, missing task_id |
   | approvals.json | Invalid approval_type, malformed timestamp |
   | rate_limits.json | Invalid provider name, missing state fields |

3. **Regenerate Corrupted Artifacts**
   ```bash
   # If manifest is corrupted, may need to restart feature
   codepipe abort <feature_id>
   codepipe start <new_feature_id> --from-linear <issue_id>
   ```

---

## Diagnostic Commands

Use these commands to diagnose issues:

```bash
# Comprehensive environment check
codepipe doctor

# Verbose doctor with detailed output
codepipe doctor --verbose

# JSON output for automation
codepipe doctor --json

# Pipeline status with integration details
codepipe status <feature_id> --verbose

# Status with cost tracking
codepipe status <feature_id> --show-costs

# Rate limit inspection
codepipe rate-limits

# Rate limit details for specific provider
codepipe rate-limits --provider github

# Configuration validation
codepipe validate --init

# Queue validation
codepipe queue validate <feature_id>

# Dry-run resume to check blockers
codepipe resume --dry-run <feature_id>
```

### Exit Code Reference

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | None needed |
| 10 | Validation error | Fix config.json or input data |
| 20 | Environment issue | Install missing tools, fix permissions |
| 30 | Credential issue | Set required tokens/keys |

---

## Log Analysis

### Log Location

Logs are stored in run directories:
```
.codepipe/runs/<feature-id>/logs/
```

### Log Files

| File | Contents |
|------|----------|
| `execution.ndjson` | Main execution log |
| `logs.ndjson` | General pipeline logs |
| `network_errors.ndjson` | Network failure details |
| `validation_errors.ndjson` | Schema validation errors |
| `git_errors.ndjson` | Git operation failures |
| `integrity_failures.ndjson` | Hash verification failures |

### Log Format

Logs use NDJSON format (one JSON object per line):

```json
{
  "timestamp": "2025-01-15T12:30:45.123Z",
  "level": "error",
  "component": "queue",
  "message": "Task update failed",
  "context": {
    "task_id": "task-001",
    "error_code": "VALIDATION_ERROR",
    "details": "Invalid status transition"
  }
}
```

### Key Log Fields

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `level` | Log level: `debug`, `info`, `warn`, `error` |
| `component` | System component: `queue`, `agent`, `github`, `linear` |
| `message` | Human-readable message |
| `context` | Structured context object |
| `request_id` | Unique request ID for tracing |
| `feature_id` | Associated feature identifier |
| `task_id` | Associated task identifier (if applicable) |

### Useful Log Queries

```bash
# Find all errors
grep '"level":"error"' .codepipe/runs/<feature_id>/logs/execution.ndjson | jq .

# Find rate limit events
grep 'rate' .codepipe/runs/<feature_id>/logs/execution.ndjson | jq .

# Find events for specific task
grep '<task_id>' .codepipe/runs/<feature_id>/logs/execution.ndjson | jq .

# Count errors by component
grep '"level":"error"' .codepipe/runs/<feature_id>/logs/execution.ndjson | \
  jq -r '.component' | sort | uniq -c | sort -rn

# Timeline of task state changes
grep 'task_status_change' .codepipe/runs/<feature_id>/logs/execution.ndjson | \
  jq -s 'sort_by(.timestamp) | .[] | {time: .timestamp, task: .context.task_id, status: .context.new_status}'

# Find failed requests with details
grep '"level":"error"' .codepipe/runs/<feature_id>/logs/execution.ndjson | \
  jq 'select(.context.error_code != null) | {message, error: .context.error_code, details: .context.details}'
```

---

## Recovery Procedures

### How to Resume a Failed Pipeline

1. **Diagnose the Failure**
   ```bash
   codepipe resume --dry-run <feature_id>
   ```

2. **Review Blockers**
   ```bash
   codepipe status <feature_id> --verbose
   ```

3. **Address Blockers by Type**

   | Blocker Type | Resolution |
   |--------------|------------|
   | Rate limit cooldown | Wait for reset or clear manually |
   | Pending approval | Grant approval |
   | Hash mismatch | Restore artifacts or regenerate |
   | Git conflict | Resolve conflicts manually |
   | Failed task | Retry, skip, or fix manually |

4. **Resume Execution**
   ```bash
   codepipe resume <feature_id>
   ```

5. **Monitor Progress**
   ```bash
   tail -f .codepipe/runs/<feature_id>/logs/execution.ndjson | jq .
   ```

---

### How to Reset a Stuck Queue

1. **Backup Current State**
   ```bash
   cp -r .codepipe/runs/<feature_id>/queue/ \
         .codepipe/runs/<feature_id>/queue.backup/
   ```

2. **Validate Queue**
   ```bash
   codepipe queue validate <feature_id>
   ```

3. **Reset Stuck Tasks**
   ```bash
   # Reset tasks stuck in 'running' state
   codepipe queue reset-stuck <feature_id>
   ```

4. **If Queue is Corrupted, Rebuild**
   ```bash
   codepipe queue rebuild <feature_id> --from-plan
   ```

5. **Force Compaction**
   ```bash
   export CODEPIPE_QUEUE_FORCE_COMPACT=true
   codepipe resume <feature_id>
   ```

---

### How to Clear Rate Limit Cooldown

1. **Verify Rate Limit Has Reset**
   ```bash
   # Check reset time
   cat .codepipe/runs/<feature_id>/rate_limits.json | \
     jq '.providers.github.state.reset' | xargs -I {} date -d @{}

   # Compare to current time
   date
   ```

2. **Clear Cooldown State**
   ```bash
   # Edit ledger to clear cooldown
   jq '.providers.github.state.inCooldown = false |
       del(.providers.github.state.cooldownUntil)' \
     .codepipe/runs/<feature_id>/rate_limits.json > temp.json && \
     mv temp.json .codepipe/runs/<feature_id>/rate_limits.json
   ```

3. **Verify Cooldown Cleared**
   ```bash
   cat .codepipe/runs/<feature_id>/rate_limits.json | \
     jq '.providers.github.state'
   ```

4. **Resume Pipeline**
   ```bash
   codepipe resume <feature_id>
   ```

---

## Getting Help

### GitHub Issues

Report bugs and request features:
https://github.com/your-org/codemachine-pipeline/issues

### Log Files to Include When Reporting Bugs

When opening an issue, include:

1. **Environment Information**
   ```bash
   codepipe doctor --json > doctor-report.json
   ```

2. **Relevant Logs**
   ```bash
   # Last 100 error entries
   grep '"level":"error"' .codepipe/runs/<feature_id>/logs/execution.ndjson | \
     tail -100 > error-logs.ndjson
   ```

3. **Configuration (Redacted)**
   ```bash
   # Remove sensitive values
   cat .codepipe/config.json | \
     jq 'del(.credentials) | del(.tokens)' > config-redacted.json
   ```

4. **Manifest State**
   ```bash
   cat .codepipe/runs/<feature_id>/manifest.json | \
     jq '{status, current_step, last_error: .execution.last_error}'
   ```

5. **Steps to Reproduce**
   - Commands executed
   - Expected behavior
   - Actual behavior
   - Error messages

### Additional Resources

- [Doctor Reference](./doctor_reference.md) - Environment diagnostics
- [Rate Limit Reference](./rate_limit_reference.md) - API rate limit handling
- [Resume Playbook](../requirements/resume_playbook.md) - Crash recovery procedures
- [Queue V2 Operations](../operations/queue-v2-operations.md) - Queue architecture and maintenance
- [CLI Surface](../requirements/cli_surface.md) - Command reference

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-26 | Initial troubleshooting guide for CDMCH-52 |
