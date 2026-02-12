# Documentation Index

**AI Feature Pipeline Documentation**

This index provides a centralized navigation hub for all documentation in the codemachine-pipeline project. Use this guide to quickly locate architecture references, operational playbooks, requirements specifications, and development guides.


> **Note:** Pre-v1.0.0 historical documentation (certification comments, phase plans, issue tracking,
> release audits) has been archived on the [`archive/pre-v1.0.0-docs`](https://github.com/KingInYellows/codemachine-pipeline/tree/archive/pre-v1.0.0-docs) branch.

---

## Quick Links

| Task | Document |
|------|----------|
| **Getting Started** | [Init Playbook](ops/init_playbook.md) |
| **Configuration** | [RepoConfig Schema](requirements/RepoConfig_schema.md) |
| **Troubleshooting** | [Doctor Reference](ops/doctor_reference.md) |
| **CLI Usage** | [CLI Patterns](ui/cli_patterns.md) |
| **System Status** | [CLI Surface Requirements](requirements/cli_surface.md) |

---

## Documentation Structure

```
docs/
├── adr/              # Architecture Decision Records
├── architecture/     # System design and component documentation
├── archive/          # Historical documents (plans, brainstorms, specs)
├── audit/            # Documentation audit reports
├── development/      # Developer workflows and guidelines
├── diagrams/         # Visual diagrams (Mermaid, PlantUML)
├── ops/              # Operational guides and runbooks
├── plans/            # Active implementation plans
├── requirements/     # Specifications, schemas, and playbooks
├── security/         # Security fix documentation
├── solutions/        # Known issue resolutions
├── templates/        # Document templates
└── ui/               # CLI and user interface patterns
```

---

## Architecture Documentation

Core system design documents describing the pipeline's layered architecture, component relationships, and execution flows.

| Document | Description |
|----------|-------------|
| [Component Index](architecture/component_index.md) | Centralized navigation hub for all architecture artifacts, diagrams, and ADR references |
| [Execution Flow](architecture/execution_flow.md) | CLIExecutionEngine architecture, strategy pattern, and CodeMachine integration |

---

## Architecture Decision Records (ADRs)

Documented architectural decisions with context, rationale, and consequences.

| Document | Description |
|----------|-------------|
| [ADR-6: Linear Integration](adr/ADR-6-linear-integration.md) | Linear integration strategy and adapter design |
| [ADR-7: Validation Policy](adr/ADR-7-validation-policy.md) | Zod runtime validation policy and schema validation approach |

---

## Requirements & Specifications

Detailed specifications for features, data models, adapters, and validation policies.

### Core Specifications

| Document | Description |
|----------|-------------|
| [CLI Surface](requirements/cli_surface.md) | Command-line interface requirements including JSON output formats and automation support |
| [Data Model Dictionary](requirements/data_model_dictionary.md) | Field-by-field reference for all data models (Feature, RunArtifact, PlanArtifact, Tasks) |
| [Execution Flow](requirements/execution_flow.md) | Task execution lifecycle, queue processing, and result handling |
| [Spec Blueprint](requirements/spec_blueprint.md) | Specification generation workflow and template structure |
| [Run Directory Schema](requirements/run_directory_schema.md) | Directory structure for feature run artifacts and state persistence |

### Adapter Specifications

| Document | Description |
|----------|-------------|
| [GitHub Adapter](requirements/github_adapter.md) | GitHub API integration, PR automation, and branch management |
| [Linear Adapter](requirements/linear_adapter.md) | Linear issue tracking integration and synchronization |
| [Agent Capability Contract](requirements/agent_capability_contract.md) | Agent provider interface contracts and capability negotiation |

### Configuration & Security

| Document | Description |
|----------|-------------|
| [RepoConfig Schema](requirements/RepoConfig_schema.md) | Repository configuration file schema and validation rules |
| [Config Migrations](requirements/config_migrations.md) | Configuration version migration procedures |
| [Security Advisories](requirements/security_advisories.md) | Security vulnerability handling and disclosure policies |
| [GitHub Branch Protection](requirements/github_branch_protection.md) | Branch protection rule requirements and enforcement |
| [Branch Protection Playbook](requirements/branch_protection_playbook.md) | Operational guide for configuring branch protection |

### Workflow Playbooks

| Document | Description |
|----------|-------------|
| [Context Manifest](requirements/context_manifest.md) | Context document structure and manifest format |
| [Context Summarization](requirements/context_summarization.md) | Context compression and summarization strategies |
| [Research Playbook](requirements/research_playbook.md) | Research task execution and artifact collection |
| [PR Playbook](requirements/pr_playbook.md) | Pull request creation and management workflow |
| [Resume Playbook](requirements/resume_playbook.md) | Failed execution recovery and safe resume procedures |
| [Validation Playbook](requirements/validation_playbook.md) | Queue integrity and plan consistency validation |
| [Write Action Playbook](requirements/write_action_playbook.md) | File write operations and artifact persistence |
| [Traceability Playbook](requirements/traceability_playbook.md) | Audit trail and provenance tracking |
| [Deployment Playbook](requirements/deployment_playbook.md) | Deployment procedures and environment management |
| [Rate Limit Dashboard](requirements/rate_limit_dashboard.md) | API rate limiting monitoring and budget management |

---

## Operational Guides

Runbooks and operational procedures for pipeline administration and troubleshooting.

### Core Operations

| Document | Description |
|----------|-------------|
| [Init Playbook](ops/init_playbook.md) | Repository initialization with `codepipe init` command |
| [Doctor Reference](ops/doctor_reference.md) | Environment diagnostics and prerequisite validation |
| [CLI Reference](ops/cli-reference.md) | CLI command reference and usage guide (auto-generated) |
| [API Reference](ops/api-reference.md) | Configuration schema, domain models, and validation utilities |
| [Troubleshooting](ops/troubleshooting.md) | Common issues and troubleshooting procedures |
| [Smoke Test Guide](ops/smoke_test_guide.md) | Quick validation tests for deployment verification |
| [Integration Testing](ops/integration_testing.md) | End-to-end integration test procedures |

### Execution & Monitoring

| Document | Description |
|----------|-------------|
| [Execution Telemetry](ops/execution_telemetry.md) | Telemetry collection, metrics, and trace formats |
| [Observability Baseline](ops/observability_baseline.md) | Monitoring, logging, and alerting configuration |
| [Rate Limit Reference](ops/rate_limit_reference.md) | API rate limit management and cooldown procedures |

### Approval & Review

| Document | Description |
|----------|-------------|
| [Approval Playbook](ops/approval_playbook.md) | Human approval workflow and gate management |
| [Approval Gates](ops/approval_gates.md) | Gate configuration and bypass policies |
| [PRD Playbook](ops/prd_playbook.md) | Product Requirements Document generation workflow |
| [Patch Playbook](ops/patch_playbook.md) | Patch application and hotfix procedures |

### Adapters

| Document | Description |
|----------|-------------|
| [Agent Manifest Guide](ops/agent_manifest_guide.md) | Agent provider configuration and manifest format |
| [CodeMachine Adapter Guide](ops/codemachine_adapter_guide.md) | CodeMachine CLI integration and execution strategy |

---

## Runtime Operations

Guides for managing runtime components including queues, logging, and parallel execution.

| Document | Description |
|----------|-------------|
| [Queue V2 Operations](ops/queue-v2-operations.md) | Queue V2 architecture (WAL, HNSW indexing), monitoring, and maintenance |
| [Log Rotation](ops/log-rotation.md) | Log management, rotation policies, and retention |
| [Parallel Execution](ops/parallel-execution.md) | Concurrent task execution and resource management |

---

## Development Guides

Contributor guidelines, workflows, and development best practices.

| Document | Description |
|----------|-------------|
| [Testing Practices](development/testing.md) | Test framework (Vitest), patterns, mocking, CI integration |
| [Submission Workflow](development/submission-workflow.md) | PR submission workflow using Graphite (`gt`) commands |
| [NPM Warnings](development/npm-warnings.md) | Common npm warning resolutions and package management |

---

## Diagrams

Visual representations of system architecture, data flows, and sequences.

### Documentation

| Document | Description |
|----------|-------------|
| [Component Overview](diagrams/component_overview.md) | Narrative companion explaining the component architecture diagram |

### Mermaid Diagrams

| Diagram | Description |
|---------|-------------|
| [Data Model](diagrams/data_model.mmd) | Entity relationship diagram for core data models |
| [Spec Flow](diagrams/spec_flow.mmd) | Specification generation workflow sequence |
| [Context Research Sequence](diagrams/context_research_sequence.mmd) | Research task execution sequence diagram |
| [Run Directory Schema](diagrams/run_directory_schema.mmd) | Visual representation of run directory structure |
| [PR Automation Sequence](diagrams/pr_automation_sequence.mmd) | Pull request automation workflow sequence |

---

## Templates

Reusable document templates for consistent artifact generation.

| Template | Description |
|----------|-------------|
| [PRD Template](templates/prd_template.md) | Product Requirements Document template with YAML frontmatter |

---

## Solutions & Troubleshooting

Known issues and their resolutions organized by category.

### Integration Issues

| Document | Description |
|----------|-------------|
| [Graphite Restack Conflicts](solutions/integration-issues/graphite-restack-conflicts-after-main-advanced.md) | Resolving merge conflicts when main advances during PR lifecycle |

---

## UI & CLI Patterns

User interface design patterns and CLI output format specifications.

| Document | Description |
|----------|-------------|
| [CLI Patterns](ui/cli_patterns.md) | CLI command surface, JSON output schemas, and terminal display patterns |

---

## Security

Security vulnerability documentation and remediation records.

| Document | Description |
|----------|-------------|
| [Security Fix CVE-HIGH-1](security/SECURITY-FIX-CVE-HIGH-1.md) | High-severity CVE remediation documentation |
| [Security Fix Summary](security/SECURITY-FIX-SUMMARY.md) | Security vulnerability fix summary report |

---

## CI & Operations

| Document | Description |
|----------|-------------|
| [CI Stability](ci-stability.md) | CI pipeline stability guidelines and monitoring |

---

## Audit Reports

| Document | Description |
|----------|-------------|
| [Documentation Audit Report](audit/AUDIT_REPORT.md) | Comprehensive documentation audit with 6-agent cross-verification |

---

## Plans

Active implementation plans.

| Document | Description |
|----------|-------------|
| [Release Branch Readiness](plans/2026-02-12-chore-release-branch-readiness-execution-plan.md) | v1.0.0 release branch readiness execution plan |

Historical plans and brainstorms are archived in [`archive/`](archive/).

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
