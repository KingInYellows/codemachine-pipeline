# Log Rotation Guide

## Overview

Automatic log rotation prevents disk space exhaustion during long-running feature executions. The system monitors log file size and rotates when configurable thresholds are exceeded, with optional gzip compression for archival.

## Architecture

### Components

**1. Size Monitor**
- Tracks log file size during execution
- Triggers rotation when threshold exceeded
- Implements zero-copy size checking

**2. Rotation Engine**
- Renames current log with numbered suffix
- Manages retention (keeps N rotated files)
- Deletes oldest files when limit exceeded

**3. Compression Layer**
- Optional gzip compression for rotated logs
- Async compression (non-blocking)
- Error handling with graceful degradation

**4. Structured Logging**
- Emits rotation events to NDJSON logs
- Includes metadata (timestamp, file size, compression status)
- Enables audit trail for log management

## Configuration

### RepoConfig Settings

Configure log rotation in `.ai-feature-pipeline/config.json`:

```json
{
  "execution": {
    "log_rotation_mb": 100,
    "log_rotation_keep": 3,
    "log_rotation_compress": false
  }
}
```

**Parameters:**
- `log_rotation_mb`: Rotation threshold in megabytes (range: 1-10240 MB, default: 100)
- `log_rotation_keep`: Number of rotated files to retain (range: 1-20, default: 3)
- `log_rotation_compress`: Enable gzip compression (default: false)

### Environment Variables

Override config values with environment variables:

```bash
# Set rotation threshold to 50MB
export AI_FEATURE_LOG_ROTATION_MB=50

# Keep 5 rotated files
export AI_FEATURE_LOG_ROTATION_KEEP=5

# Enable compression
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
```

### Runtime Defaults

If not configured, the system uses these defaults:

```typescript
const DEFAULT_LOG_ROTATION_MB = 100;
const DEFAULT_LOG_ROTATION_KEEP = 3;
const DEFAULT_LOG_ROTATION_COMPRESS = false;
```

## Behavior

### Rotation Trigger

**When rotation occurs:**
1. Log file size checked after each task execution
2. Rotation triggered when size exceeds `log_rotation_mb * 1024 * 1024` bytes
3. Current log renamed to `<log>.1`, existing files bumped up
4. New empty log created for continued writing
5. Oldest file (`.N`) deleted if count exceeds `log_rotation_keep`

**Rotation Algorithm:**
```typescript
// Pseudocode
async function rotateLogFiles(logPath, keep, compress) {
  // Delete oldest file (keep+1)
  await fs.rm(`${logPath}.${keep}`, { force: true });

  // Rename existing files (N -> N+1)
  for (let i = keep - 1; i >= 1; i--) {
    await fs.rename(`${logPath}.${i}`, `${logPath}.${i + 1}`);
  }

  // Rename current log to .1
  await fs.rename(logPath, `${logPath}.1`);

  // Compress if enabled
  if (compress) {
    await gzipFileInPlace(`${logPath}.1`);
  }

  // Create new empty log
  // (implicit on next write)
}
```

### Rotation Scheme

**Example with `log_rotation_keep=3`:**

```
Initial state:
  execution.log (50MB)

After first rotation (100MB threshold):
  execution.log (empty)
  execution.log.1 (100MB)

After second rotation:
  execution.log (empty)
  execution.log.1 (100MB, newest)
  execution.log.2 (100MB, older)

After third rotation:
  execution.log (empty)
  execution.log.1 (100MB, newest)
  execution.log.2 (100MB)
  execution.log.3 (100MB, oldest)

After fourth rotation:
  execution.log (empty)
  execution.log.1 (100MB, newest)
  execution.log.2 (100MB)
  execution.log.3 (100MB, oldest)
  # execution.log.4 deleted (exceeded keep=3)
```

**With compression enabled:**
```
After rotation with compression:
  execution.log (empty)
  execution.log.1.gz (10MB, compressed ~10:1)
  execution.log.2.gz (10MB)
  execution.log.3.gz (10MB)
```

### Structured Logging

**Rotation events logged to NDJSON:**
```json
{
  "level": "warn",
  "message": "Log rotation occurred",
  "task_id": "code-generation-001",
  "log_path": "/path/to/execution.log",
  "file_size_bytes": 104857600,
  "timestamp": "2024-01-20T10:30:00.000Z"
}
```

**Compression events:**
```json
{
  "level": "info",
  "message": "Log rotation compression completed",
  "task_id": "code-generation-001",
  "log_path": "/path/to/execution.log.1.gz",
  "compressed_size_bytes": 10485760,
  "compression_ratio": 10.0,
  "timestamp": "2024-01-20T10:30:01.000Z"
}
```

## Monitoring

### Disk Usage Tracking

**Monitor log directory size:**
```bash
# Current log size
ls -lh .ai-feature-pipeline/runs/*/logs/execution.log

# Total log directory size
du -sh .ai-feature-pipeline/runs/*/logs/

# Rotated files count
ls -1 .ai-feature-pipeline/runs/*/logs/execution.log.* | wc -l
```

**Expected disk usage:**
- Without compression: `log_rotation_mb * (log_rotation_keep + 1)` MB
- With compression: `log_rotation_mb * (log_rotation_keep + 1) / 10` MB (typical 10:1 ratio)

**Example:**
```bash
# Config: log_rotation_mb=100, log_rotation_keep=3, compress=false
# Max disk usage: 100MB * (3 + 1) = 400MB

# Config: log_rotation_mb=100, log_rotation_keep=3, compress=true
# Max disk usage: 100MB * (3 + 1) / 10 = 40MB
```

### Rotation Events

**Query rotation history:**
```bash
# Count rotations
grep "Log rotation occurred" \
  .ai-feature-pipeline/runs/*/logs/execution.ndjson | wc -l

# View rotation timeline
grep "Log rotation occurred" \
  .ai-feature-pipeline/runs/*/logs/execution.ndjson | \
  jq -r '[.timestamp, .file_size_bytes] | @tsv'

# Check compression success rate
grep "compression" \
  .ai-feature-pipeline/runs/*/logs/execution.ndjson | \
  jq -s 'group_by(.level) | map({level: .[0].level, count: length})'
```

### Compression Ratio

**Measure compression effectiveness:**
```bash
# Compare original vs compressed sizes
for file in .ai-feature-pipeline/runs/*/logs/execution.log.*.gz; do
  original_size=$(stat -f%z "${file%.gz}" 2>/dev/null || echo "N/A")
  compressed_size=$(stat -f%z "$file")
  echo "Original: ${original_size}B, Compressed: ${compressed_size}B"
done
```

**Typical compression ratios:**
- NDJSON logs: 8-12x compression
- Plain text logs: 10-15x compression
- Binary logs: 2-5x compression

## Troubleshooting

### Rotation Failures

**Symptom**: Logs grow unbounded, rotation not occurring

**Common Causes:**
1. File permissions (cannot rename/delete files)
2. Disk full (cannot create new files)
3. Rotation threshold too high

**Resolution:**
```bash
# Step 1: Check file permissions
ls -la .ai-feature-pipeline/runs/*/logs/

# Step 2: Fix permissions
chmod 700 .ai-feature-pipeline/runs/
chmod 600 .ai-feature-pipeline/runs/*/logs/*

# Step 3: Check disk space
df -h .ai-feature-pipeline/

# Step 4: Manually rotate
mv .ai-feature-pipeline/runs/FEATURE-ID/logs/execution.log \
   .ai-feature-pipeline/runs/FEATURE-ID/logs/execution.log.manual

# Step 5: Verify rotation in logs
grep "Log rotation" \
  .ai-feature-pipeline/runs/*/logs/execution.ndjson
```

**Prevention:**
- Set appropriate file permissions (600 for logs)
- Monitor disk space with alerts (<20% free)
- Use reasonable rotation thresholds (50-200MB)

### Disk Space Warnings

**Symptom**: Disk space exhausted despite rotation

**Common Causes:**
1. `log_rotation_keep` too high (retaining too many files)
2. Compression disabled (large uncompressed logs)
3. Multiple concurrent features

**Resolution:**
```bash
# Step 1: Identify large log directories
du -sh .ai-feature-pipeline/runs/*/logs/ | sort -h

# Step 2: Reduce retention
export AI_FEATURE_LOG_ROTATION_KEEP=1
ai-feature resume

# Step 3: Enable compression
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
ai-feature resume

# Step 4: Archive old features
tar -czf old-features.tar.gz .ai-feature-pipeline/runs/FEATURE-*
rm -rf .ai-feature-pipeline/runs/FEATURE-*
```

**Prevention:**
- Enable compression for long-running features
- Set `log_rotation_keep=1-3` for disk-constrained environments
- Regularly archive completed features

### Compression Errors

**Symptom**: Compression failures logged, uncompressed files retained

**Common Causes:**
1. gzip not installed
2. File system errors
3. Insufficient disk space during compression

**Resolution:**
```bash
# Step 1: Check gzip availability
which gzip

# Step 2: Install gzip if missing
# Debian/Ubuntu:
sudo apt-get install gzip

# macOS:
brew install gzip

# Step 3: Verify compression works
echo "test" | gzip -c > /tmp/test.gz && echo "gzip OK"

# Step 4: Retry compression
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
ai-feature resume

# Step 5: Check compression logs
grep "compression failed" \
  .ai-feature-pipeline/runs/*/logs/execution.ndjson
```

**Prevention:**
- Verify gzip installation in `ai-feature doctor`
- Monitor disk space before enabling compression
- Test compression on smaller files first

### File Permission Issues

**Symptom**: Rotation fails with permission errors

**Common Causes:**
1. Logs owned by different user
2. Directory permissions too restrictive
3. SELinux/AppArmor policies

**Resolution:**
```bash
# Step 1: Check ownership
ls -la .ai-feature-pipeline/runs/*/logs/

# Step 2: Fix ownership
sudo chown -R $(whoami):$(id -gn) .ai-feature-pipeline/runs/

# Step 3: Set correct permissions
chmod -R u+rwX .ai-feature-pipeline/runs/

# Step 4: Check for extended attributes
ls -Z .ai-feature-pipeline/runs/*/logs/  # SELinux
getfacl .ai-feature-pipeline/runs/*/logs/  # ACLs

# Step 5: Test rotation
AI_FEATURE_LOG_ROTATION_MB=1 ai-feature resume
```

**Prevention:**
- Run pipeline as consistent user (avoid sudo)
- Set umask 077 for private log files
- Document permission requirements

## Maintenance

### Manual Rotation

**Force rotation for testing:**
```bash
# Set low threshold to trigger rotation
AI_FEATURE_LOG_ROTATION_MB=1 ai-feature resume

# Verify rotation occurred
ls -lh .ai-feature-pipeline/runs/*/logs/execution.log.*
```

### Archive Old Logs

**Compress and archive logs for long-term storage:**
```bash
# Archive all rotated logs
tar -czf logs-archive-$(date +%Y%m%d).tar.gz \
  .ai-feature-pipeline/runs/*/logs/*.log.*

# Remove archived logs
find .ai-feature-pipeline/runs/*/logs/ -name "*.log.*" -delete

# Verify archive
tar -tzf logs-archive-*.tar.gz | head
```

### Cleanup Strategy

**Recommended cleanup schedule:**
- **Daily**: Remove logs from completed features (>24h old)
- **Weekly**: Compress and archive rotated logs (>7d old)
- **Monthly**: Delete compressed archives (>30d old)

**Automated cleanup script:**
```bash
#!/bin/bash
# cleanup-logs.sh

# Remove logs from old completed features
find .ai-feature-pipeline/runs/ -name "state.json" -mtime +1 \
  -exec grep -l '"phase":"completed"' {} \; | \
  xargs -I{} rm -rf "$(dirname {})/logs/"

# Archive old rotated logs
find .ai-feature-pipeline/runs/*/logs/ -name "*.log.*" -mtime +7 \
  -exec tar -czf logs-archive-$(date +%Y%m%d).tar.gz {} +

# Delete old archives
find . -name "logs-archive-*.tar.gz" -mtime +30 -delete
```

### Performance Tuning

**Optimize for different scenarios:**

**High-volume logging (>1GB/day):**
```bash
export AI_FEATURE_LOG_ROTATION_MB=50
export AI_FEATURE_LOG_ROTATION_KEEP=2
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
```

**Long-running features (>7 days):**
```bash
export AI_FEATURE_LOG_ROTATION_MB=200
export AI_FEATURE_LOG_ROTATION_KEEP=5
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
```

**Disk-constrained environments (<10GB available):**
```bash
export AI_FEATURE_LOG_ROTATION_MB=25
export AI_FEATURE_LOG_ROTATION_KEEP=1
export AI_FEATURE_LOG_ROTATION_COMPRESS=true
```

## References

### Implementation Files
- **Log Rotation**: `src/workflows/codeMachineRunner.ts:44-388`
- **Structured Logging**: `src/telemetry/logger.ts`
- **Log Writers**: `src/telemetry/logWriters.ts`

### Test Files
- **Unit Tests**: `tests/unit/codeMachineRunner.runner.spec.ts:1164-1225`
- **Integration Tests**: `tests/integration/codeMachineRunner.spec.ts`

### Configuration Schema
- **RepoConfig Schema**: `config/schemas/repo_config.schema.json`
- **Execution Config**: Section `execution` in repo config

### Related Documentation
- [Execution Telemetry](./execution_telemetry.md) - Logging and metrics
- [Doctor Reference](./doctor_reference.md) - Environment validation
- [Observability Baseline](./observability_baseline.md) - Monitoring best practices
