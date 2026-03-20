# Codemachine Pipeline Documentation

Welcome to the canonical documentation for `codemachine-pipeline` — an AI-powered
feature pipeline that orchestrates code generation, research, and PR automation.

## Start Here

| Task | Document |
|---|---|
| **Getting Started** | [Quick Start](guide/quick-start.md) |
| **Initialize a Repo** | [Init Playbook](playbooks/init_playbook.md) |
| **CLI Commands** | [CLI Reference](reference/cli/cli-reference.md) |
| **Configuration** | [RepoConfig Schema](reference/config/RepoConfig_schema.md) |
| **Troubleshooting** | [Doctor Reference](reference/cli/doctor_reference.md) |

## Architecture

The pipeline follows a layered architecture with strict dependency direction:

- **cli** — oclif commands and status rendering (top layer)
- **workflows** — execution strategies, context aggregation, task planning
- **adapters** — GitHub, Linear, agent provider, and HTTP boundaries
- **persistence** — run directories, manifests, locks, hash verification
- **telemetry** — logging, metrics, tracing, cost tracking
- **core** — shared types, domain models, configuration schemas
- **validation** — Zod schema validation and CLI path safety
- **utils** — error handling, redaction, atomic writes, process management

See [Component Index](reference/architecture/component_index.md) and
[Execution Flow](reference/architecture/execution_flow.md) for details.

## Playbooks

### Core Operations

- [Init Playbook](playbooks/init_playbook.md) — repository initialization
- [Resume Playbook](playbooks/resume_playbook.md) — recover from interrupted runs
- [Troubleshooting](playbooks/troubleshooting.md) — common issues and fixes

### Workflows

- [Research Playbook](playbooks/research_playbook.md) — research task execution
- [PR Playbook](playbooks/pr_playbook.md) — pull request creation and management
- [PRD Playbook](playbooks/prd_playbook.md) — product requirements generation
- [Write Action Playbook](playbooks/write_action_playbook.md) — file write operations
- [Validation Playbook](playbooks/validation_playbook.md) — queue and plan validation
- [Traceability Playbook](playbooks/traceability_playbook.md) — audit trail tracking
- [Patch Playbook](playbooks/patch_playbook.md) — patch application

### Approval & Monitoring

- [Approval Playbook](playbooks/approval_playbook.md) — human approval workflow
- [Approval Gates](playbooks/approval_gates.md) — gate configuration
- [Execution Telemetry](playbooks/execution_telemetry.md) — metrics and traces
- [Observability Baseline](playbooks/observability_baseline.md) — monitoring setup
- [Branch Protection Playbook](playbooks/branch_protection_playbook.md) — branch rules

## Reference

- [API Reference](reference/api/api-reference.md) — domain models and schemas
- [Parallel Execution](reference/parallel-execution.md) — concurrent task execution
- [Queue V2 Operations](reference/queue-v2-operations.md) — queue architecture
- [Rate Limit Dashboard](reference/rate_limit_dashboard.md) — rate limit monitoring

## Full Documentation Index

For a comprehensive listing of all documents, see [README.md](README.md).

## Notes

- Some pages are marked as TODO in `mkdocs.yml` — these will be added in a future content phase.
- If you're troubleshooting a specific issue, start in `solutions/`.
