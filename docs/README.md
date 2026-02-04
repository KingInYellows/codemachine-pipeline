# Documentation Index

**AI Feature Pipeline Documentation**

This index provides a centralized navigation hub for all documentation in the codemachine-pipeline project. Use this guide to quickly locate architecture references, operational playbooks, requirements specifications, and development guides.

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
├── architecture/     # System design and component documentation
├── requirements/     # Specifications, schemas, and playbooks
├── ops/              # Operational guides and runbooks
├── operations/       # Runtime operations (queue, logs, parallel execution)
├── development/      # Developer workflows and guidelines
├── diagrams/         # Visual diagrams (Mermaid, PlantUML)
├── templates/        # Document templates
├── solutions/        # Known issue resolutions
├── plans/            # Release and implementation plans
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
| [Init Playbook](ops/init_playbook.md) | Repository initialization with `ai-feature init` command |
| [Doctor Reference](ops/doctor_reference.md) | Environment diagnostics and prerequisite validation |
| [CLI Reference](ops/cli-reference.md) | CLI command reference and usage guide |
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
| [Queue V2 Operations](operations/queue-v2-operations.md) | Queue V2 architecture (WAL, HNSW indexing), monitoring, and maintenance |
| [Log Rotation](operations/log-rotation.md) | Log management, rotation policies, and retention |
| [Parallel Execution](operations/parallel-execution.md) | Concurrent task execution and resource management |

---

## Development Guides

Contributor guidelines, workflows, and development best practices.

| Document | Description |
|----------|-------------|
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

## Plans & Reports

Release planning, implementation tracking, and verification reports.

### Release Plans

| Document | Description |
|----------|-------------|
| [Alpha Release Readiness](plans/2025-12-31-alpha-release-readiness.md) | Alpha release milestone tracking and readiness criteria |
| [Stable Release Audit](stable-release-audit.md) | Stable release audit checklist and results |
| [Stable Release Definition](stable-release-definition.md) | Stable release criteria and definition of done |
| [Stable Release Roadmap](stable-release-roadmap.md) | Roadmap and timeline for stable release milestones |
| [CI Stability](ci-stability.md) | CI pipeline stability guidelines and monitoring |

### Implementation Reports

| Document | Description |
|----------|-------------|
| [Issue Resolution Plan](ISSUE_RESOLUTION_PLAN.md) | Systematic issue triage and resolution tracking |
| [Issue Closures](ISSUE_CLOSURES.md) | Completed issue closure records |
| [GitHub Issue Closures](GITHUB_ISSUE_CLOSURES.md) | GitHub-specific issue closure documentation |
| [Implementation Summary](IMPLEMENTATION_SUMMARY.md) | High-level implementation progress summary |
| [Orchestration Final Summary](ORCHESTRATION_FINAL_SUMMARY.md) | Orchestration layer implementation completion report |

### Phase Plans

| Document | Description |
|----------|-------------|
| [Phase 1 Verification Report](PHASE1_VERIFICATION_REPORT.md) | Phase 1 completion verification and acceptance criteria |
| [Phase 2 Implementation Plan](PHASE2_IMPLEMENTATION_PLAN.md) | Phase 2 feature scope and implementation schedule |
| [Phase 3 Implementation Plan](PHASE3_IMPLEMENTATION_PLAN.md) | Phase 3 feature scope and implementation schedule |

### PR Reviews

| Document | Description |
|----------|-------------|
| [PR Review Plan](PR_REVIEW_PLAN.md) | Pull request review process and checklist |
| [Certification Comments](CERTIFICATION_COMMENT_149.md) | PR #149 certification review notes |

### Security

| Document | Description |
|----------|-------------|
| [Security Fix CVE-HIGH-1](SECURITY-FIX-CVE-HIGH-1.md) | High-severity CVE remediation documentation |
| [Security Fix Summary](SECURITY-FIX-SUMMARY.md) | Security vulnerability fix summary report |

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
