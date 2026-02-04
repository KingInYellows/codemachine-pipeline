# Stable Release v1.0.0 Definition

**Project:** ai-feature-pipeline
**Target Version:** 1.0.0
**Context:** Personal homelab software (single maintainer)
**Date:** 2026-01-27

---

## Release Philosophy

This is **PERSONAL HOMELAB** software. Optimize for:
- **Reliability** over feature completeness
- **Maintainability** over enterprise overhead
- **Operator experience** over scalability

---

## Supported Install Methods

### Required (Must Work)

| Method | Command | Status |
|--------|---------|--------|
| npx | `npx ai-feature-pipeline@1.0.0 --help` | Required |
| Docker | `docker run ai-feature-pipeline:1.0.0 --help` | Required |
| npm link | Clone repo, `npm link`, run `ai-feature` | Required |

### Not Supported (v1.0.0)

- Windows native (use WSL2)
- Node.js < 24
- Global npm install without npx

---

## Minimum Viable Configuration

v1.0.0 **MUST** work with this minimal config (offline mode, no integrations):

```json
{
  "schema_version": "1.0.0",
  "project": {
    "id": "my-project",
    "repo_url": "https://github.com/example/repo",
    "default_branch": "main"
  },
  "github": {
    "enabled": false
  },
  "linear": {
    "enabled": false
  },
  "runtime": {
    "run_directory": ".ai-feature-pipeline/runs"
  },
  "safety": {
    "redact_secrets": true
  }
}
```

**Key Constraint:** v1.0.0 works in **OFFLINE MODE** with zero integrations enabled.

---

## Core User Journeys (Must Work)

### Journey 1: Initialize Project

```bash
# Action
ai-feature init

# Expected Result
- Creates .ai-feature-pipeline/config.json
- Creates .ai-feature-pipeline/runs/ directory
- Exit code 0
```

**Acceptance Test:**
```bash
rm -rf .ai-feature-pipeline
ai-feature init
test -f .ai-feature-pipeline/config.json && echo "PASS" || echo "FAIL"
```

---

### Journey 2: Start Feature (Local Mode)

```bash
# Action
ai-feature start --prompt "Add a hello world endpoint" --skip-execution

# Expected Result
- Creates run directory with unique ID
- Creates PRD artifact
- Creates manifest.json
- Exit code 0
```

**Acceptance Test:**
```bash
FEATURE_ID=$(ai-feature start --prompt "Test feature" --skip-execution --json | jq -r '.feature_id')
test -f .ai-feature-pipeline/runs/$FEATURE_ID/manifest.json && echo "PASS" || echo "FAIL"
```

---

### Journey 3: Check Status

```bash
# Action
ai-feature status --feature <feature_id>

# Expected Result
- Shows feature status (pending/in_progress/completed/failed)
- Shows task counts
- Shows last step
- Exit code 0
```

**Acceptance Test:**
```bash
ai-feature status --feature $FEATURE_ID --json | jq -e '.status' && echo "PASS" || echo "FAIL"
```

---

### Journey 4: Resume After Failure

```bash
# Action
ai-feature resume --feature <feature_id>

# Expected Result
- Resumes from last successful step
- Recovers from crash (stale lock handling)
- Exit code 0 on completion
```

**Acceptance Test:**
```bash
# Simulate crash by creating stale lock
touch .ai-feature-pipeline/runs/$FEATURE_ID/run.lock
sleep 65  # Wait for lock to become stale (60s threshold)
ai-feature resume --feature $FEATURE_ID --dry-run && echo "PASS" || echo "FAIL"
```

---

### Journey 5: Run Diagnostics

```bash
# Action
ai-feature doctor

# Expected Result
- Checks environment (Node.js version, Git)
- Checks configuration validity
- Checks credentials (warns if missing)
- Exit code 0 if healthy, non-zero if issues
```

**Acceptance Test:**
```bash
ai-feature doctor --json | jq -e '.checks' && echo "PASS" || echo "FAIL"
```

---

## Non-Goals (Explicitly Deferred)

The following are **NOT** requirements for v1.0.0:

| Feature | Reason |
|---------|--------|
| Multi-user access control | Single maintainer, not needed |
| `ai-feature deploy` command | Out of scope for v1 |
| Linear sync (auto-enabled) | Disabled by default, optional |
| Auto-merge | Disabled by default, risky |
| Windows native support | Use WSL2 |
| Node.js 24+ required | Only v24 LTS or higher supported |
| Distributed execution | Single machine homelab |
| High availability | Not a server, runs on demand |

---

## Quality Bar

### Test Coverage

| Area | Minimum | Target |
|------|---------|--------|
| Overall | 65% | 70% |
| Config validation | 90% | 95% |
| Queue operations | 90% | 95% |
| CLI smoke tests | 70% | 80% |
| Integration tests | 50% | 60% |

### Code Quality

| Metric | Requirement |
|--------|-------------|
| TypeScript strict | Enabled |
| ESLint errors | 0 |
| Silent catch blocks | 0 (or commented) |
| npm audit vulnerabilities | 0 critical/high |

### Observability

| Requirement | Status |
|-------------|--------|
| NDJSON structured logs | Required |
| Run manifest with status | Required |
| Task execution traces | Required |
| Prometheus metrics | Optional (nice to have) |

---

## Upgrade Story

### From v0.x to v1.0.0

| Component | Migration |
|-----------|-----------|
| Run directories | Preserved as-is |
| Config.json | Schema v1.0.0 compatible |
| Queue V1 | Auto-migrated to V2 |
| Queue V2 | No migration needed |

**Key Guarantee:** Existing run directories from v0.x will work with v1.0.0.

---

## Release Checklist

### Pre-Release

- [ ] All P0 issues closed (CDMCH-67, 68, 69, 70)
- [ ] All P1 issues closed (CDMCH-71, 72, 73, 74)
- [ ] P2 issues triaged (some may defer to v1.1)
- [ ] All 5 user journeys pass
- [ ] Test coverage meets minimum
- [ ] npm audit clean
- [ ] Docker build works
- [ ] CHANGELOG.md updated

### Release

- [ ] Version bump in package.json
- [ ] Git tag v1.0.0
- [ ] npm publish (if publishing)
- [ ] Docker image tagged
- [ ] Release notes published

### Post-Release

- [ ] Monitor for issues
- [ ] Update documentation links
- [ ] Close Linear project

---

## Success Criteria

v1.0.0 is successful when:

1. **All 5 core journeys work** - Initialize, start, status, resume, doctor
2. **No data loss on crash** - Fsync, integrity checks, tested rollback
3. **Operator can diagnose issues** - Logs, troubleshooting guide, error messages
4. **Single command install** - `npx ai-feature-pipeline@1.0.0` just works
5. **Offline mode works** - No GitHub/Linear required

---

## Appendix: Exit Code Reference

| Code | Meaning | User Action |
|------|---------|-------------|
| 0 | Success | None |
| 1 | General error | Check stderr |
| 10 | Validation error | Fix config.json |
| 20 | Environment issue | Install missing tools |
| 30 | Credential issue | Set required tokens |
| 40 | Queue corruption | Run queue repair |

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-27 | Initial definition |
