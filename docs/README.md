# Documentation Index

**AI Feature Pipeline Documentation**

This index provides a centralized navigation hub for all documentation in the codemachine-pipeline project. Use this guide to quickly locate architecture references, operational playbooks, requirements specifications, and development guides.

> **Archive branches:** Pre-v1.0.0 historical documentation (certification comments, phase plans, issue tracking,
> release audits) is on [`archive/pre-v1.0.0-docs`](https://github.com/KingInYellows/codemachine-pipeline/tree/archive/pre-v1.0.0-docs).
> Post-v1.0.0 stale docs (completed plans, audit reports, security fix records, aspirational playbooks)
> are on [`archive/post-v1.0.0-stale`](https://github.com/KingInYellows/codemachine-pipeline/tree/archive/post-v1.0.0-stale).

---

## Quick Links

| Task                | Document                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Getting Started** | [Quickstart](guide/quick-start.md) / [Init Playbook](playbooks/init_playbook.md)                        |
| **CLI Reference**   | [CLI Reference](reference/cli/cli-reference.md)                                                         |
| **Configuration**   | [RepoConfig Schema](reference/config/RepoConfig_schema.md)                                              |
| **Troubleshooting** | [Doctor Reference](reference/cli/doctor_reference.md) / [Troubleshooting](playbooks/troubleshooting.md) |
| **System Status**   | [CLI Surface Requirements](reference/cli/cli_surface.md)                                                |
| **API Reference**   | [API Reference](reference/api/api-reference.md)                                                         |

---

## Documentation Structure

```
docs/
├── guide/            # Getting started guides
├── adr/              # Architecture Decision Records
├── diagrams/         # Visual diagrams (Mermaid, PlantUML)
├── playbooks/        # Operational guides and runbooks
├── plans/            # Active implementation plans
├── reference/        # Technical specifications and references
│   ├── api/          # API reference
│   ├── architecture/ # Architecture documentation
│   ├── cli/          # CLI command references
│   └── config/       # Configuration references
├── research/         # Research and analysis documents
├── solutions/        # Known issue resolutions
└── templates/        # Document templates
```

---

## Architecture Documentation

Core system design documents describing the pipeline's layered architecture, component relationships, and execution flows.

| Document                                                     | Description                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [Component Index](reference/architecture/component_index.md) | Centralized navigation hub for all architecture artifacts, diagrams, and ADR references |
| [Execution Flow](reference/architecture/execution_flow.md)   | CLIExecutionEngine architecture, strategy pattern, and CodeMachine integration          |

---

## Architecture Decision Records (ADRs)

Documented architectural decisions with context, rationale, and consequences.

| Document                                                                       | Description                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [ADR-6: Linear Integration](adr/ADR-6-linear-integration.md)                   | Linear integration strategy and adapter design               |
| [ADR-7: Validation Policy](adr/ADR-7-validation-policy.md)                     | Zod runtime validation policy and schema validation approach |
| [ADR-8: CodeMachine CLI Integration](adr/ADR-8-codemachine-cli-integration.md) | CodeMachine CLI adapter design and binary resolution         |

---

## Requirements & Specifications

Detailed specifications for features, data models, adapters, and validation policies.

### Core Specifications

| Document                                                    | Description                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [CLI Surface](reference/cli/cli_surface.md)                 | Command-line interface requirements including JSON output formats and automation support |
| [Data Model Dictionary](reference/data_model_dictionary.md) | Field-by-field reference for all data models (Feature, RunArtifact, PlanArtifact, Tasks) |
| [Spec Blueprint](reference/spec_blueprint.md)               | Specification generation workflow and template structure                                 |
| [Run Directory Schema](reference/run_directory_schema.md)   | Directory structure for feature run artifacts and state persistence                      |
| [Context Manifest](reference/context_manifest.md)           | Context document structure and manifest format                                           |
| [Context Summarization](reference/context_summarization.md) | Context compression and summarization strategies                                         |

### Adapter Specifications

| Document                                                                   | Description                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [GitHub Adapter](reference/config/github_adapter.md)                       | GitHub API integration, PR automation, and branch management  |
| [Linear Adapter](reference/config/linear_adapter.md)                       | Linear issue tracking integration and synchronization         |
| [Agent Capability Contract](reference/agent_capability_contract.md)        | Agent provider interface contracts and capability negotiation |
| [CodeMachine Adapter Guide](reference/config/codemachine_adapter_guide.md) | CodeMachine CLI integration and execution strategy            |

### Configuration & Security

| Document                                                          | Description                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| [RepoConfig Schema](reference/config/RepoConfig_schema.md)        | Repository configuration file schema and validation rules |
| [Config Migrations](reference/config/config_migrations.md)        | Configuration version migration procedures                |
| [Security Advisories](reference/security_advisories.md)           | Security vulnerability handling and disclosure policies   |
| [GitHub Branch Protection](reference/github_branch_protection.md) | Branch protection rule requirements and enforcement       |

---

## Operational Guides

Runbooks and operational procedures for pipeline administration and troubleshooting.

### Core Operations

| Document                                                | Description                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| [Init Playbook](playbooks/init_playbook.md)             | Repository initialization with `codepipe init` command        |
| [Doctor Reference](reference/cli/doctor_reference.md)   | Environment diagnostics and prerequisite validation           |
| [CLI Reference](reference/cli/cli-reference.md)         | CLI command reference and usage guide (auto-generated)        |
| [API Reference](reference/api/api-reference.md)         | Configuration schema, domain models, and validation utilities |
| [Troubleshooting](playbooks/troubleshooting.md)         | Common issues and troubleshooting procedures                  |
| [Smoke Test Guide](reference/smoke_test_guide.md)       | Quick validation tests for deployment verification            |
| [Integration Testing](reference/integration_testing.md) | End-to-end integration test procedures                        |

### Workflow Playbooks

| Document                                                    | Description                                          |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| [Research Playbook](playbooks/research_playbook.md)         | Research task execution and artifact collection      |
| [PR Playbook](playbooks/pr_playbook.md)                     | Pull request creation and management workflow        |
| [Resume Playbook](playbooks/resume_playbook.md)             | Failed execution recovery and safe resume procedures |
| [Validation Playbook](playbooks/validation_playbook.md)     | Queue integrity and plan consistency validation      |
| [Write Action Playbook](playbooks/write_action_playbook.md) | File write operations and artifact persistence       |
| [Traceability Playbook](playbooks/traceability_playbook.md) | Audit trail and provenance tracking                  |
| [PRD Playbook](playbooks/prd_playbook.md)                   | Product Requirements Document generation workflow    |
| [Patch Playbook](playbooks/patch_playbook.md)               | Patch application and hotfix procedures              |

### Approval & Review

| Document                                            | Description                                 |
| --------------------------------------------------- | ------------------------------------------- |
| [Approval Playbook](playbooks/approval_playbook.md) | Human approval workflow and gate management |
| [Approval Gates](playbooks/approval_gates.md)       | Gate configuration and bypass policies      |

### Adapters

| Document                                                  | Description                                      |
| --------------------------------------------------------- | ------------------------------------------------ |
| [Agent Manifest Guide](playbooks/agent_manifest_guide.md) | Agent provider configuration and manifest format |

---

## Runtime Operations

Guides for managing runtime components including queues, logging, and parallel execution.

| Document                                                | Description                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Queue V2 Operations](reference/queue-v2-operations.md) | Queue V2 architecture (WAL, HNSW indexing), monitoring, and maintenance |
| [Log Rotation](playbooks/log-rotation.md)               | Log management, rotation policies, and retention                        |
| [Parallel Execution](reference/parallel-execution.md)   | Concurrent task execution and resource management                       |

---

## Execution & Monitoring

| Document                                                              | Description                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Execution Telemetry](playbooks/execution_telemetry.md)               | Telemetry collection, metrics, and trace formats                  |
| [Observability Baseline](playbooks/observability_baseline.md)         | Monitoring, logging, and alerting configuration                   |
| [Rate Limit Reference](reference/cli/rate_limit_reference.md)         | API rate limit management and cooldown procedures                 |
| [Rate Limit Dashboard](reference/rate_limit_dashboard.md)             | Rate limit observability surfaces and Grafana dashboard templates |
| [Branch Protection Playbook](playbooks/branch_protection_playbook.md) | Operational guide for configuring branch protection               |

---

## Diagrams

Visual representations of system architecture, data flows, and sequences.

### Documentation

| Document                                             | Description                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [Component Overview](diagrams/component_overview.md) | Narrative companion explaining the component architecture diagram |

### Mermaid Diagrams

| Diagram                                                             | Description                                      |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| [Data Model](diagrams/data_model.mmd)                               | Entity relationship diagram for core data models |
| [Spec Flow](diagrams/spec_flow.mmd)                                 | Specification generation workflow sequence       |
| [Context Research Sequence](diagrams/context_research_sequence.mmd) | Research task execution sequence diagram         |
| [Run Directory Schema](diagrams/run_directory_schema.mmd)           | Visual representation of run directory structure |
| [PR Automation Sequence](diagrams/pr_automation_sequence.mmd)       | Pull request automation workflow sequence        |

---

## Templates

Reusable document templates for consistent artifact generation.

| Template                                  | Description                                                  |
| ----------------------------------------- | ------------------------------------------------------------ |
| [PRD Template](templates/prd_template.md) | Product Requirements Document template with YAML frontmatter |

---

## Solutions & Troubleshooting

Known issues and their resolutions organized by category.

### Integration Issues

| Document                                                                                                     | Description                                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Graphite Restack Conflicts](solutions/integration-issues/graphite-restack-conflicts-after-main-advanced.md) | Resolving merge conflicts when main advances during PR lifecycle |

### Code Review

| Document                                                                            | Description                                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Reviewing Documentation PRs](solutions/code-review/reviewing-documentation-prs.md) | Agent selection, factual accuracy verification, and archive strategy for docs PRs |

### Linting

| Document                                                                                                  | Description                                                     |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [ESLint Index Signature Evasion](solutions/linting/eslint-no-restricted-types-index-signature-evasion.md) | Workaround for `no-restricted-types` rule with index signatures |

---

## CI & Operations

| Document                                  | Description                                     |
| ----------------------------------------- | ----------------------------------------------- |
| [CI Stability](reference/ci-stability.md) | CI pipeline stability guidelines and monitoring |

---

## Plans

Active implementation plans.

| Document                                                                      | Description                      |
| ----------------------------------------------------------------------------- | -------------------------------- |
| [Documentation Cleanup](plans/2026-02-12-chore-documentation-cleanup-plan.md) | Clean and organize documentation |

---

## Document Conventions

- **Playbooks**: Step-by-step operational procedures with commands and examples
- **References**: Comprehensive technical specifications and API documentation
- **Guides**: Conceptual explanations with practical examples
- **Schemas**: Data structure definitions with validation rules

## Contributing

When adding new documentation:

1. Place files in the appropriate subdirectory based on document type
2. Update this README.md with a link and description
3. Use consistent markdown formatting and frontmatter
4. Include version, status, and last-updated metadata in document headers
