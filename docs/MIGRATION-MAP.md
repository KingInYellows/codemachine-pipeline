# Documentation Directory Migration Map

**Date**: 2026-02-15
**Purpose**: Track file moves during docs restructuring (16 → 7 top-level directories)
**Related**: Phase 0 of Comprehensive Documentation Suite Plan

## Directory Structure Changes

### Before (16 top-level directories)

```
docs/
├── adr/
├── announcements/
├── architecture/
├── development/
├── diagrams/
├── ops/
├── plans/
├── requirements/
├── solutions/
├── templates/
├── testing/
├── ui/
└── [standalone files]
```

### After (7 top-level directories)

```
docs/
├── guide/           # Tier 1: Learn (getting started, tutorials)
├── reference/       # Tier 2: Reference (CLI, config, architecture, API)
│   ├── cli/
│   ├── config/
│   ├── architecture/
│   └── api/
├── playbooks/       # Tier 3: How-To (operational procedures)
├── adr/             # Architecture Decision Records (kept)
├── solutions/       # Troubleshooting KB (kept)
├── diagrams/        # Visual assets (kept)
├── templates/       # Document templates (kept)
└── archive/         # Transient content (announcements, plans, etc.)
    ├── announcements/
    ├── plans/
    ├── development/
    └── ui/
```

## File Migrations

### Archived (Transient Content)

| Original Location                        | New Location             | Reason                  |
| ---------------------------------------- | ------------------------ | ----------------------- |
| `announcements/v1.0.0-release.md`        | `archive/announcements/` | Time-bound announcement |
| `development/npm-warnings.md`            | `archive/development/`   | Development notes       |
| `development/release-branch-strategy.md` | `archive/development/`   | Internal process doc    |
| `development/submission-workflow.md`     | `archive/development/`   | Internal process doc    |
| `development/testing.md`                 | `archive/development/`   | Development notes       |
| `ui/cli_patterns.md`                     | `archive/ui/`            | Design exploration doc  |

### Moved to reference/ (Technical Specifications)

| Original Location                           | New Location                                    | Category                                  |
| ------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| `architecture/component_index.md`           | `reference/architecture/`                       | Architecture                              |
| `architecture/execution_flow.md`            | `reference/architecture/`                       | Architecture                              |
| `ops/cli-reference.md`                      | `reference/cli/`                                | CLI Reference                             |
| `ops/api-reference.md`                      | `reference/api/`                                | API Reference                             |
| `ops/doctor_reference.md`                   | `reference/cli/`                                | CLI Reference                             |
| `ops/rate_limit_reference.md`               | `reference/cli/`                                | CLI Reference                             |
| `ops/codemachine_adapter_guide.md`          | `reference/config/`                             | Configuration                             |
| `requirements/RepoConfig_schema.md`         | `reference/config/`                             | Schema                                    |
| `requirements/agent_manifest_schema.json`   | `reference/`                                    | Schema                                    |
| `requirements/run_directory_schema.md`      | `reference/`                                    | Schema                                    |
| `requirements/data_model_dictionary.md`     | `reference/`                                    | Schema                                    |
| `requirements/github_adapter.md`            | `reference/config/`                             | Configuration                             |
| `requirements/linear_adapter.md`            | `reference/config/`                             | Configuration                             |
| `requirements/agent_capability_contract.md` | `reference/`                                    | Specification                             |
| `requirements/cli_surface.md`               | `reference/cli/`                                | CLI Reference                             |
| `requirements/config_migrations.md`         | `reference/config/`                             | Configuration                             |
| `requirements/context_manifest.md`          | `reference/`                                    | Specification                             |
| `requirements/context_summarization.md`     | `reference/`                                    | Specification                             |
| `requirements/execution_flow.md`            | `reference/architecture/execution_flow_spec.md` | Architecture (renamed to avoid collision) |
| `requirements/github_branch_protection.md`  | `reference/`                                    | Specification                             |
| `requirements/rate_limit_dashboard.md`      | `reference/`                                    | Specification                             |
| `requirements/security_advisories.md`       | `reference/`                                    | Specification                             |
| `requirements/spec_blueprint.md`            | `reference/`                                    | Specification                             |
| `ops/execution_telemetry.md`                | `reference/`                                    | Specification                             |
| `ops/integration_testing.md`                | `reference/`                                    | Specification                             |
| `ops/parallel-execution.md`                 | `reference/`                                    | Specification                             |
| `ops/queue-v2-operations.md`                | `reference/`                                    | Specification                             |
| `ops/smoke_test_guide.md`                   | `reference/`                                    | Specification                             |
| `testing/e2e-test-report-v1.0.0.md`         | `reference/`                                    | Test Report                               |
| `ci-stability.md`                           | `reference/`                                    | Specification                             |

### Moved to playbooks/ (Operational Procedures)

| Original Location                            | New Location | Purpose               |
| -------------------------------------------- | ------------ | --------------------- |
| `ops/agent_manifest_guide.md`                | `playbooks/` | How-to guide          |
| `ops/approval_gates.md`                      | `playbooks/` | Operational guide     |
| `ops/approval_playbook.md`                   | `playbooks/` | Operational procedure |
| `ops/init_playbook.md`                       | `playbooks/` | Operational procedure |
| `ops/patch_playbook.md`                      | `playbooks/` | Operational procedure |
| `ops/prd_playbook.md`                        | `playbooks/` | Operational procedure |
| `ops/troubleshooting.md`                     | `playbooks/` | Operational guide     |
| `ops/log-rotation.md`                        | `playbooks/` | Operational procedure |
| `ops/observability_baseline.md`              | `playbooks/` | Operational guide     |
| `ops/post-release-monitoring.md`             | `playbooks/` | Operational procedure |
| `requirements/branch_protection_playbook.md` | `playbooks/` | Operational procedure |
| `requirements/pr_playbook.md`                | `playbooks/` | Operational procedure |
| `requirements/research_playbook.md`          | `playbooks/` | Operational procedure |
| `requirements/resume_playbook.md`            | `playbooks/` | Operational procedure |
| `requirements/traceability_playbook.md`      | `playbooks/` | Operational procedure |
| `requirements/validation_playbook.md`        | `playbooks/` | Operational procedure |
| `requirements/write_action_playbook.md`      | `playbooks/` | Operational procedure |

### Moved to guide/ (User-Facing Guides)

| Original Location | New Location           | Purpose              |
| ----------------- | ---------------------- | -------------------- |
| `quickstart.md`   | `guide/quick-start.md` | Quick start tutorial |

## Statistics

- **Total files migrated**: 54
- **Directories archived**: 4 (announcements, development, ui, plans content)
- **Directories consolidated**: 5 (ops, requirements, architecture, testing)
- **Empty directories removed**: 7
- **New directories created**: 9

## Rationale

### Progressive Disclosure Hierarchy

1. **guide/** - Tier 1: Learn (Getting Started, Tutorials)
   - Target: New users, quick wins
   - Content: Prerequisites, Installation, Quick Start, Workflows

2. **reference/** - Tier 2: Reference (Detailed Specifications)
   - Target: Users seeking specific information
   - Content: CLI commands, Config schema, Architecture, API

3. **playbooks/** - Tier 3: How-To (Operational Procedures)
   - Target: Users performing specific tasks
   - Content: Initialization, Approval workflow, Debugging, Monitoring

### Kept Unchanged

- **adr/** - Architecture Decision Records (historical context)
- **solutions/** - Troubleshooting knowledge base (searchable solutions)
- **diagrams/** - Visual assets (referenced from multiple docs)
- **templates/** - Document templates (reusable)

### Archived

- **archive/** - Transient content (time-bound announcements, planning docs, design explorations)

## Benefits

1. **Reduced cognitive load**: 7 directories instead of 16
2. **Clear purpose**: Each directory has distinct role (Learn/Reference/How-To)
3. **Easier navigation**: Users know where to look
4. **DRY compliance**: Single source of truth (no duplication across ops/requirements/etc.)
5. **Scalability**: New content fits into clear categories

## Next Steps

After this migration:

1. Create guide/index.md (landing page)
2. Create reference/index.md (reference landing page)
3. Create playbooks/index.md (playbooks landing page)
4. Update mkdocs.yml navigation to match new structure
5. Update internal links (many will need updating)
6. Run link validation: `markdown-link-check docs/**/*.md`

## Validation

To verify the migration was successful:

```bash
# Check new structure
tree -L 2 -d docs/

# Count files in each category
find docs/guide -type f | wc -l
find docs/reference -type f | wc -l
find docs/playbooks -type f | wc -l
find docs/archive -type f | wc -l

# Verify no files left in old directories
ls docs/{ops,requirements,architecture,announcements,development,testing,ui} 2>&1
```

---

**Created**: 2026-02-15
**Author**: Claude Sonnet 4.5 (via Claude Code)
