# Issue Resolution Plan

## Selected Issue
- ID: 43
- Title: [v2] Log file rotation (100MB threshold, retention, gzip)
- Labels: Backend, Feature

## Source
```
## Overview

Implement log file rotation to prevent disk exhaustion.

## Background

v1 streams logs to a single file without rotation. This issue adds rotation when log files exceed 100MB.

## Requirements

* Rotate log files when they exceed 100MB
* Keep last N rotated files (configurable, default 3)
* Compress rotated files with gzip
* Warn user when rotation occurs

## Acceptance Criteria

- [ ] Log files rotate at 100MB threshold
- [ ] Rotated files named `<taskId>.log.1`, `<taskId>.log.2`, etc.
- [ ] Optional gzip compression for rotated files
- [ ] Config option: `execution.log_rotation_mb` (default 100)
- [ ] Config option: `execution.log_rotation_keep` (default 3)
- [ ] Warning logged when rotation occurs

## Dependencies

Requires v1 execution engine (CDMCH-15 through CDMCH-21)
```

## Stack Plan
- Status: PLANNED
- Stack Strategy:
```json
{
  "issue_id": 43,
  "estimated_complexity": "MEDIUM",
  "stack_strategy": [
    {
      "order": 1,
      "branch": "log-rotation-config",
      "intent": "feat: add execution log rotation config defaults",
      "changes": [
        "Add execution.log_rotation_mb and execution.log_rotation_keep to RepoConfig schema",
        "Add defaults in repo config initialization"
      ]
    },
    {
      "order": 2,
      "branch": "log-rotation-impl",
      "intent": "feat: rotate task log files on size threshold",
      "changes": [
        "Add rotation handling to CodeMachineRunner log streaming",
        "Emit warning when rotation occurs",
        "Support optional gzip compression for rotated logs"
      ],
      "depends_on": "log-rotation-config"
    },
    {
      "order": 3,
      "branch": "log-rotation-tests",
      "intent": "test: cover log rotation behavior",
      "changes": [
        "Add unit tests for log rotation threshold and retention"
      ],
      "depends_on": "log-rotation-impl"
    }
  ]
}
```

## Progress
- [x] Phase 1: Stack planning complete
- [ ] Phase 2: Stack implementation in progress
- [ ] Phase 3: Submission complete
- [ ] Phase 4: Final verification complete

## Stack Execution
- [x] Layer 1: log-rotation-config
- [x] Layer 2: log-rotation-impl
- [ ] Layer 3: log-rotation-tests
