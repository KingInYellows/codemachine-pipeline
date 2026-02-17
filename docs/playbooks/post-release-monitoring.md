# Post-Release Monitoring Guide - v1.0.0

**Last Updated:** 2026-02-15
**Applies To:** v1.0.0 and later

## Overview

This guide provides monitoring procedures for codemachine-pipeline installations, particularly for production/homelab deployments. Includes health check automation, baseline metrics, and alerting.

---

## Health Check Script

### Installation

```bash
# Create health check script on homelab/server
cat > /usr/local/bin/codepipe-health-check.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/codepipe-health.log"
TIMESTAMP=$(date -Iseconds)

echo "$TIMESTAMP - Running health check" >> "$LOG_FILE"

# Run doctor and capture results
if codepipe doctor --json > /tmp/codepipe-doctor.json 2>&1; then
  EXIT_CODE=$(jq -r '.exit_code' /tmp/codepipe-doctor.json)
  FAILED=$(jq -r '.summary.failed' /tmp/codepipe-doctor.json)

  echo "$TIMESTAMP - PASS: doctor exited $EXIT_CODE, $FAILED failed checks" >> "$LOG_FILE"

  if [ "$FAILED" -gt 0 ]; then
    echo "$TIMESTAMP - WARNING: Doctor has failed checks" >> "$LOG_FILE"
    jq -r '.checks[] | select(.status=="fail") | "\(.name): \(.remediation)"' /tmp/codepipe-doctor.json >> "$LOG_FILE"
  fi
else
  EXIT_CODE=$?
  echo "$TIMESTAMP - FAIL: doctor exited with code $EXIT_CODE" >> "$LOG_FILE"
  cat /tmp/codepipe-doctor.json >> "$LOG_FILE" 2>/dev/null || echo "No doctor output" >> "$LOG_FILE"

  # Send alert (implement based on your infrastructure)
  # Examples:
  # - echo "CodePipe health check failed" | mail -s "Alert" admin@example.com
  # - curl -X POST https://your-webhook-url -d "health check failed"
  # - notify-send "CodePipe Alert" "Health check failed"
fi

# Verify version stability
CURRENT_VERSION=$(codepipe --version 2>/dev/null | head -1 || echo "unknown")
EXPECTED_VERSION="codemachine-pipeline/1.0.0"

if [[ ! "$CURRENT_VERSION" =~ "1.0.0" ]]; then
  echo "$TIMESTAMP - WARN: version mismatch (expected 1.0.0, got $CURRENT_VERSION)" >> "$LOG_FILE"
fi

# Check disk space for .codepipe/ directory
if [ -d .codepipe ]; then
  DISK_USAGE=$(du -sm .codepipe 2>/dev/null | cut -f1)
  if [ "$DISK_USAGE" -gt 1000 ]; then
    echo "$TIMESTAMP - WARN: .codepipe/ using ${DISK_USAGE}MB (>1GB threshold)" >> "$LOG_FILE"
  fi
fi
EOF

chmod +x /usr/local/bin/codepipe-health-check.sh
```

---

## Monitoring Schedule

### First 24 Hours (Intensive Monitoring)

```bash
# Add to crontab: every 6 hours
crontab -e

# Add this line:
0 */6 * * * /usr/local/bin/codepipe-health-check.sh
```

**Purpose:** Catch immediate post-installation issues

### After 24 Hours (Daily Monitoring)

```bash
# Update crontab: daily at midnight
0 0 * * * /usr/local/bin/codepipe-health-check.sh
```

**Purpose:** Ongoing health validation

---

## Baseline Metrics Collection

### Capture Performance Baseline

```bash
# Create baseline metrics file
cat > /var/log/codepipe-baseline.txt << EOF
CodePipe v1.0.0 Baseline Metrics
Captured: $(date -Iseconds)
Node.js: $(node --version)
Platform: $(uname -a)

Command Performance:
EOF

# Measure command execution times
echo "doctor: $(time codepipe doctor 2>&1 | grep real)" >> /var/log/codepipe-baseline.txt
echo "health: $(time codepipe health 2>&1 | grep real)" >> /var/log/codepipe-baseline.txt
echo "init: $(time (mkdir /tmp/baseline-test && cd /tmp/baseline-test && git init && codepipe init --yes) 2>&1 | grep real)" >> /var/log/codepipe-baseline.txt

# Disk usage baseline
echo "" >> /var/log/codepipe-baseline.txt
echo "Disk Usage:" >> /var/log/codepipe-baseline.txt
du -sh .codepipe/ 2>/dev/null >> /var/log/codepipe-baseline.txt || echo "No .codepipe/ directory" >> /var/log/codepipe-baseline.txt

# Package installation size
echo "" >> /var/log/codepipe-baseline.txt
echo "Installation Size:" >> /var/log/codepipe-baseline.txt
du -sh $(npm root -g)/@kinginyellows/codemachine-pipeline 2>/dev/null >> /var/log/codepipe-baseline.txt || \
  du -sh $(npm root -g)/codemachine-pipeline >> /var/log/codepipe-baseline.txt

cat /var/log/codepipe-baseline.txt
```

**Target Performance (from E2E testing):**

- `doctor`: < 3 seconds
- `health`: < 1 second
- `init`: < 5 seconds

---

## Alert Conditions

Configure alerts for these conditions:

| Condition                                       | Severity     | Action                         |
| ----------------------------------------------- | ------------ | ------------------------------ |
| doctor exits non-zero                           | **CRITICAL** | Immediate investigation        |
| doctor has failed checks (exit 0 with failures) | **HIGH**     | Review within 4 hours          |
| Version changes unexpectedly                    | **MEDIUM**   | Verify no unauthorized updates |
| Disk space > 90%                                | **MEDIUM**   | Clean up old runs              |
| .codepipe/ > 1GB                                | **LOW**      | Archive old feature runs       |
| Pipeline stuck > 24 hours                       | **MEDIUM**   | Check for hanging processes    |

---

## Status Dashboard

### Simple Status Check

```bash
#!/usr/bin/env bash
# /usr/local/bin/codepipe-status-dashboard.sh

echo "=== CodePipe Status Dashboard ==="
echo "Version: $(codepipe --version | head -1)"
echo ""

# Health check
if codepipe health > /dev/null 2>&1; then
  echo "Health: ✓ OK"
else
  echo "Health: ✗ FAIL"
fi

# Active features count
if [ -d .codepipe/runs ]; then
  ACTIVE=$(ls .codepipe/runs/ 2>/dev/null | wc -l)
  echo "Active Features: $ACTIVE"
fi

# Last health check
if [ -f /var/log/codepipe-health.log ]; then
  LAST_CHECK=$(tail -1 /var/log/codepipe-health.log | cut -d' ' -f1-2)
  echo "Last Health Check: $LAST_CHECK"
fi

# Disk usage
if [ -d .codepipe ]; then
  USAGE=$(du -sh .codepipe 2>/dev/null | cut -f1)
  echo "Disk Usage (.codepipe/): $USAGE"
fi

# Recent errors
if [ -f .codepipe/logs/codepipe.log ]; then
  ERRORS=$(grep -c '"level":"error"' .codepipe/logs/codepipe.log 2>/dev/null || echo 0)
  echo "Recent Errors (current log): $ERRORS"
fi

echo ""
echo "Run 'codepipe doctor' for detailed diagnostics"
```

Make executable:

```bash
chmod +x /usr/local/bin/codepipe-status-dashboard.sh
```

---

## Log Monitoring

### Log Locations

| Log Type          | Location                                    | Rotation              |
| ----------------- | ------------------------------------------- | --------------------- |
| **Pipeline Logs** | `.codepipe/logs/codepipe.log`               | 100MB, gzip           |
| **Health Checks** | `/var/log/codepipe-health.log`              | Manual (or logrotate) |
| **Feature Runs**  | `.codepipe/runs/<feature-id>/execution.log` | Per-feature           |

### Monitor for Errors

```bash
# Real-time error monitoring
tail -f .codepipe/logs/codepipe.log | grep '"level":"error"'

# Count errors in last 24 hours
jq -r 'select(.level=="error") | .timestamp' .codepipe/logs/codepipe.log | \
  awk -v d=$(date -d '24 hours ago' +%s) '$1 > d' | wc -l

# Find most common errors
jq -r 'select(.level=="error") | .message' .codepipe/logs/codepipe.log | \
  sort | uniq -c | sort -rn | head -10
```

---

## Metrics Tracking

### Pipeline Success Rate

```bash
#!/usr/bin/env bash
# Calculate pipeline completion rate

RUNS_DIR=".codepipe/runs"

if [ ! -d "$RUNS_DIR" ]; then
  echo "No runs directory found"
  exit 1
fi

TOTAL=0
COMPLETED=0

for run in "$RUNS_DIR"/*; do
  if [ -f "$run/manifest.json" ]; then
    TOTAL=$((TOTAL + 1))
    STATUS=$(jq -r '.status' "$run/manifest.json")
    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "execution_complete" ]; then
      COMPLETED=$((COMPLETED + 1))
    fi
  fi
done

if [ $TOTAL -eq 0 ]; then
  echo "No pipeline runs found"
else
  SUCCESS_RATE=$((COMPLETED * 100 / TOTAL))
  echo "Pipeline Success Rate: $SUCCESS_RATE% ($COMPLETED/$TOTAL completed)"
fi
```

### Average Pipeline Duration

```bash
# Calculate average duration for completed pipelines
jq -s 'map(select(.status=="completed")) |
       map(.duration_ms) |
       add / length' .codepipe/runs/*/manifest.json
```

---

## Cleanup & Maintenance

### Archive Old Runs

```bash
# Archive runs older than 90 days
find .codepipe/runs -type d -mtime +90 -exec tar -czf {}.tar.gz {} \; -exec rm -rf {} \;

# Or move to archive directory
mkdir -p .codepipe/archive
find .codepipe/runs -type d -mtime +90 -exec mv {} .codepipe/archive/ \;
```

### Log Rotation

The pipeline auto-rotates logs at 100MB. To clean up old compressed logs:

```bash
# Keep only last 10 rotations (~1GB)
cd .codepipe/logs
ls -t codepipe.log.*.gz | tail -n +11 | xargs rm -f
```

---

## Troubleshooting

### Common Issues

**Issue:** Health check fails with exit code 20
**Cause:** Environment issues (missing git, wrong Node version, permission problems)
**Fix:** Run `codepipe doctor --verbose` to see specific failures

**Issue:** Doctor shows AGENT_ENDPOINT warning
**Cause:** Optional agent endpoint not configured
**Fix:** Either configure endpoint or ignore (non-blocking warning)

**Issue:** Pipeline stuck in "paused" state
**Cause:** Gate requires approval or previous step failed
**Fix:** Run `codepipe status` and `codepipe resume --dry-run` for analysis

**Issue:** .codepipe/ directory growing > 1GB
**Cause:** Multiple feature runs accumulating
**Fix:** Archive old runs (see Cleanup section above)

---

## Integration with External Monitoring

### Prometheus Metrics (Future Enhancement)

```bash
# Expose health check as Prometheus metric
# /etc/prometheus/node_exporter/textfile_collector/codepipe_health.prom

codepipe_health_status{version="1.0.0"} $(codepipe health && echo 1 || echo 0)
codepipe_doctor_passed_checks{version="1.0.0"} $(codepipe doctor --json | jq '.summary.passed')
codepipe_doctor_failed_checks{version="1.0.0"} $(codepipe doctor --json | jq '.summary.failed')
```

### Grafana Dashboard (Future)

Metrics to track:

- Health check success rate (%)
- Doctor check pass/fail counts
- Pipeline completion rate (%)
- Average pipeline duration (ms)
- Disk usage trend (MB)
- Error rate (errors/hour)

---

## Post-v1.0.0 Monitoring Checklist

**First Week:**

- [ ] Health checks running on schedule (verify cron)
- [ ] Baseline metrics captured
- [ ] No critical errors in logs
- [ ] Disk usage stable
- [ ] Version remains 1.0.0

**First Month:**

- [ ] Review health check logs for patterns
- [ ] Adjust cleanup schedule if needed
- [ ] Validate rotation working correctly
- [ ] Check for performance degradation
- [ ] Update baseline if usage patterns change

**Ongoing:**

- [ ] Monthly log review
- [ ] Quarterly disk cleanup
- [ ] Annual baseline refresh

---

## Support

For monitoring-related issues:

- Check `codepipe doctor --verbose` for diagnostic details
- Review `.codepipe/logs/codepipe.log` for error patterns
- Consult `docs/reference/cli/doctor_reference.md` for check interpretations
- Report persistent issues: https://github.com/KingInYellows/codemachine-pipeline/issues

---

**Version:** 1.0
**Maintained By:** CodeMachine Team
**Last Reviewed:** 2026-02-15
