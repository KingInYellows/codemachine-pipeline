# Stable Release v1.0.0 Roadmap

**Project:** codemachine-pipeline
**Timeline:** 6 weeks (3 milestones)
**Linear Project:** [Stable Release](https://linear.app/kinginyellow/project/stable-release-27784972aa31)

---

## Overview

```
Week 1-2: Milestone 1 - Stabilize Core (Data Safety)
Week 3-4: Milestone 2 - Hardening (Reliability)
Week 5-6: Milestone 3 - Release Prep (Polish)
```

---

## Milestone 1: Stabilize Core (Week 1-2)

**Goal:** Fix critical data safety issues that could cause data loss.

### Issues

| ID | Title | Priority | Effort |
|----|-------|----------|--------|
| [CDMCH-67](https://linear.app/kinginyellow/issue/CDMCH-67) | Add fsync after queue snapshot and manifest writes | P0/Urgent | Medium |
| [CDMCH-68](https://linear.app/kinginyellow/issue/CDMCH-68) | Audit and fix silent catch blocks | P0/Urgent | Large |
| [CDMCH-69](https://linear.app/kinginyellow/issue/CDMCH-69) | Add queue integrity verification on startup | P0/Urgent | Medium |
| [CDMCH-70](https://linear.app/kinginyellow/issue/CDMCH-70) | Add queue migration rollback test | P0/Urgent | Small |

### Dependencies

```
CDMCH-67 (fsync) ─┐
                  ├─> CDMCH-69 (integrity check)
CDMCH-70 (test)  ─┘

CDMCH-68 (silent catches) - Independent
```

### Files Modified

| File | Changes |
|------|---------|
| `src/workflows/queueStore.ts` | fsync, integrity verification |
| `src/persistence/runDirectoryManager.ts` | fsync after manifest write |
| `src/workflows/queueSnapshotManager.ts` | fsync after snapshot |
| `src/cli/commands/doctor.ts` | Fix silent catches |
| `src/workflows/queueMigration.ts` | Fix silent catches |
| `tests/integration/queueMigration.spec.ts` | New rollback test |

### Success Criteria

- [ ] Power loss during queue write does not corrupt data
- [ ] Zero silent catch blocks (or documented exceptions)
- [ ] Corrupted queue detected on load with clear error message
- [ ] Migration rollback tested and working

---

## Milestone 2: Hardening (Week 3-4)

**Goal:** Improve reliability and operator experience.

### Issues

| ID | Title | Priority | Effort |
|----|-------|----------|--------|
| [CDMCH-71](https://linear.app/kinginyellow/issue/CDMCH-71) | Reduce stale lock threshold to 60 seconds | P1/High | Small |
| [CDMCH-72](https://linear.app/kinginyellow/issue/CDMCH-72) | Add CLI command error path coverage | P1/High | Large |
| [CDMCH-73](https://linear.app/kinginyellow/issue/CDMCH-73) | Invalidate memory cache on queue migration | P1/High | Small |
| [CDMCH-74](https://linear.app/kinginyellow/issue/CDMCH-74) | Add crash recovery E2E test | P1/High | Medium |
| [CDMCH-75](https://linear.app/kinginyellow/issue/CDMCH-75) | Add log rotation to StructuredLogger | P2/Medium | Medium |
| [CDMCH-76](https://linear.app/kinginyellow/issue/CDMCH-76) | Convert sync file reads to async in config loader | P2/Medium | Medium |

### Dependencies

```
CDMCH-73 (cache invalidation) - Depends on M1 migration work
CDMCH-74 (crash E2E) - Depends on M1 integrity checks

CDMCH-71 (lock threshold) - Independent
CDMCH-72 (CLI tests) - Independent
CDMCH-75 (log rotation) - Independent
CDMCH-76 (async config) - Independent
```

### Files Modified

| File | Changes |
|------|---------|
| `src/persistence/runDirectoryManager.ts` | Lock threshold |
| `src/workflows/queueMigration.ts` | Cache invalidation call |
| `src/telemetry/logger.ts` | Log rotation |
| `src/core/config/RepoConfig.ts` | Async conversion |
| `test/commands/*.test.ts` | CLI error tests |
| `tests/e2e/crashRecovery.spec.ts` | New E2E test |

### Success Criteria

- [ ] Lock recovery in 60 seconds (not 5 minutes)
- [ ] 70% CLI command test coverage
- [ ] Cache correctly invalidated after migration
- [ ] Crash recovery E2E test passing
- [ ] Logs rotate at 10MB
- [ ] Config loads async (no NFS hangs)

---

## Milestone 3: Release Prep (Week 5-6)

**Goal:** Final polish, documentation, and release.

### Issues

| ID | Title | Priority | Effort |
|----|-------|----------|--------|
| [CDMCH-77](https://linear.app/kinginyellow/issue/CDMCH-77) | Add health check command | P2/Medium | Small |
| [CDMCH-78](https://linear.app/kinginyellow/issue/CDMCH-78) | Create homelab quickstart guide | P2/Medium | Small |
| [CDMCH-79](https://linear.app/kinginyellow/issue/CDMCH-79) | Run full readiness checklist | P2/Medium | Medium |
| [CDMCH-80](https://linear.app/kinginyellow/issue/CDMCH-80) | Update CHANGELOG and tag v1.0.0 | P2/Medium | Small |
| [CDMCH-81](https://linear.app/kinginyellow/issue/CDMCH-81) | Add Docker smoke test to CI | P2/Medium | Small |

### Dependencies

```
All M1 and M2 issues ─> CDMCH-79 (readiness checklist)
CDMCH-79 ─> CDMCH-80 (tag release)

CDMCH-77 (health) - Independent
CDMCH-78 (quickstart) - Independent
CDMCH-81 (Docker CI) - Independent
```

### Files Modified/Created

| File | Changes |
|------|---------|
| `src/cli/commands/health.ts` | New command |
| `docs/quickstart.md` | New guide |
| `CHANGELOG.md` | v1.0.0 entry |
| `.github/workflows/ci.yml` | Docker smoke test |

### Success Criteria

- [ ] `codepipe health` executes in <1 second
- [ ] Quickstart guide completable in 5 minutes
- [ ] All readiness checks pass
- [ ] CHANGELOG updated with all changes
- [ ] Docker builds in CI

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| P0 fixes take longer than expected | Medium | High | Start immediately, can slip M2 items |
| Silent catch audit reveals more issues | High | Medium | Time-box to 2 days, document remaining |
| Async config breaks callers | Low | Medium | Do in M2, plenty of buffer |
| E2E test flaky in CI | Medium | Low | Mark as optional in CI initially |

---

## Weekly Checkpoints

### Week 1
- [ ] CDMCH-67 (fsync) complete
- [ ] CDMCH-68 (catches) started

### Week 2
- [ ] CDMCH-68 (catches) complete
- [ ] CDMCH-69 (integrity) complete
- [ ] CDMCH-70 (rollback test) complete
- [ ] Milestone 1 review

### Week 3
- [ ] CDMCH-71 (lock threshold) complete
- [ ] CDMCH-73 (cache invalidation) complete
- [ ] CDMCH-72 (CLI tests) in progress

### Week 4
- [ ] CDMCH-72 (CLI tests) complete
- [ ] CDMCH-74 (crash E2E) complete
- [ ] CDMCH-75 (log rotation) complete
- [ ] CDMCH-76 (async config) complete
- [ ] Milestone 2 review

### Week 5
- [ ] CDMCH-77 (health command) complete
- [ ] CDMCH-78 (quickstart) complete
- [ ] CDMCH-81 (Docker CI) complete

### Week 6
- [ ] CDMCH-79 (readiness) complete
- [ ] CDMCH-80 (tag release) complete
- [ ] v1.0.0 released

---

## Resource Allocation

This is a **single-maintainer** project. Estimated effort per milestone:

| Milestone | Effort | Focus |
|-----------|--------|-------|
| M1: Stabilize | 8-12 hours | Critical fixes, must complete |
| M2: Hardening | 10-15 hours | Tests and reliability |
| M3: Release | 4-6 hours | Polish and release |

**Total:** ~25-35 hours over 6 weeks

---

## Communication Plan

### Status Updates
- Update Linear issues as work progresses
- Tag issues with milestone labels

### Blockers
- Document in Linear issue comments
- Escalate if blocking M1 critical path

### Release Announcement
- Update README with v1.0.0 badge
- Post release notes

---

## Appendix: Issue Summary Table

| ID | Title | Priority | Milestone | Status |
|----|-------|----------|-----------|--------|
| CDMCH-67 | fsync after writes | P0 | M1 | Triage |
| CDMCH-68 | Silent catch audit | P0 | M1 | Triage |
| CDMCH-69 | Queue integrity check | P0 | M1 | Triage |
| CDMCH-70 | Migration rollback test | P0 | M1 | Triage |
| CDMCH-71 | Lock threshold 60s | P1 | M2 | Triage |
| CDMCH-72 | CLI test coverage | P1 | M2 | Triage |
| CDMCH-73 | Cache invalidation | P1 | M2 | Triage |
| CDMCH-74 | Crash E2E test | P1 | M2 | Triage |
| CDMCH-75 | Log rotation | P2 | M2 | Triage |
| CDMCH-76 | Async config | P2 | M2 | Triage |
| CDMCH-77 | Health command | P2 | M3 | Triage |
| CDMCH-78 | Quickstart guide | P2 | M3 | Triage |
| CDMCH-79 | Readiness checklist | P2 | M3 | Triage |
| CDMCH-80 | Tag v1.0.0 | P2 | M3 | Triage |
| CDMCH-81 | Docker CI | P2 | M3 | Triage |

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-27 | Initial roadmap |
