# Component Overview Documentation

**Version:** 1.0.0
**Status:** Active
**Last Updated:** 2025-12-15

## Overview

This document provides a comprehensive narrative companion to the Component Overview Diagram (`component_overview.puml`). It explains the architecture of the AI Feature Pipeline system by detailing each component's responsibilities, dependencies, and relationships with other system elements.

## Purpose

The Component Overview Diagram serves multiple purposes:

- **Architectural Communication:** Enables developers, architects, and stakeholders to understand system structure at a glance
- **Boundary Definition:** Clearly delineates layers and their responsibilities (CLI, Orchestration, Adapters, Persistence, Observability)
- **Extension Point Identification:** Highlights where the system can be extended (custom agents, deployment triggers, notification channels)
- **ADR Traceability:** Links components to the Architectural Decision Records that govern their design
- **Onboarding:** Provides new team members with a visual mental model of the system

## Diagram Scope and Modeling Choices

### Architectural Style

The diagram follows the **Modular Layered Orchestrator with Pluggable Adapters** pattern mandated by the blueprint (Section 3.1). Key modeling choices include:

1. **Layered Organization:** Components are grouped into five distinct layers (CLI Presentation, Orchestration Core, Adapter Boundary, Persistence & Storage, Observability & Security)
2. **Dependency Direction:** Dependencies flow downward and outward—CLI commands invoke orchestration services, orchestration services coordinate adapters, adapters handle external communication
3. **Adapter Isolation:** All external API calls are routed through adapter interfaces, never invoked directly by orchestration logic
4. **Extension Points:** Dashed borders and notes indicate where custom implementations can be plugged in

### PlantUML Conventions

- **Package Grouping:** Each layer is represented as a PlantUML package with distinct colors
- **Component Stereotypes:** Components include emoji prefixes (📱 CLI, 🎯 Orchestration, 🔌 Adapters, 💾 Persistence, 🔍 Observability, 🌐 External)
- **Relationship Types:**
  - Solid arrows (`-->`) indicate direct dependencies
  - Dashed arrows (`..>`) indicate indirect/logging relationships
  - Labels describe the nature of the relationship
- **ADR Annotations:** Components reference relevant ADRs using `[[ADR-N]]` notation
- **Color Coding:** Consistent color palette aids visual scanning

## Component Catalog by Layer

### 1. CLI Presentation Layer (📱)

#### 1.1 CLI Orchestrator (oclif)

**Responsibilities:**
- Parse user commands (`init`, `start`, `status`, `resume`, `pr`, `deploy`, `export`, `cleanup`, `observe`)
- Route commands to appropriate orchestration workflows
- Maintain in-memory run context referencing disk artifacts
- Act as approval gatekeeper for human-in-the-loop decisions
- Provide `$EDITOR` integration for artifact editing
- Expose hooks for telemetry and user prompts

**Upstream Dependencies:**
- RepoConfig Manager (reads configuration)
- All Orchestration Core services (invokes workflows)
- Run Directory Manager (creates/reads run state)
- Observability Hub (emits CLI events)

**Downstream Dependencies:**
- User terminal (input/output)
- Operating system shell

**Related ADRs:**
- ADR-1: Agent Execution (defines CLI command semantics)
- ADR-2: State Persistence (CLI reads/writes run state)

**Blueprint References:**
- Section 4.0: CLI Orchestrator
- Section 3.2: Technology Stack (oclif, POSIX semantics)

---

#### 1.2 RepoConfig Manager

**Responsibilities:**
- Detect git repository root
- Discover or scaffold `.codepipe/config.json`
- Validate configuration schema using Zod
- Store integration settings (GitHub, Linear, agent providers)
- Perform sanity checks (repo accessibility, token validity, Node version)
- Publish read-only config snapshot to other modules

**Upstream Dependencies:**
- File system (reads/writes `config.json`)
- Git Adapter (validates git root detection)

**Downstream Dependencies:**
- CLI Orchestrator (provides config to all commands)

**Related ADRs:**
- ADR-2: State Persistence (config.json schema)
- ADR-3: Adapter Boundary (integration settings)

**Blueprint References:**
- Section 4.0: RepoConfig Manager
- Section 2.1: Configuration Schema

---

### 2. Orchestration Core (🎯)

#### 2.1 Context Aggregator

**Responsibilities:**
- Collect README, documentation, and configured `context_paths`
- Analyze git history diffs for relevant changes
- Summarize large files with token budgeting
- Generate and record hash manifests
- Cache results to avoid re-gathering unchanged context
- Detect context drift on resume

**Upstream Dependencies:**
- Git Adapter (reads git history)
- Run Directory Manager (caches context snapshots)

**Downstream Dependencies:**
- Agent Adapter Layer (provides context for prompts)
- PRD/Spec generation workflows

**Related ADRs:**
- **ADR-4: Context Gathering** (primary responsibility)
- ADR-2: State Persistence (context caching)

**Blueprint References:**
- Section 4.0: Context Aggregator
- Section 2.2: Repository Intelligence

---

#### 2.2 Research Coordinator

**Responsibilities:**
- Generate ResearchTasks from PRD/spec unknowns
- Assign tasks to agents or humans with objectives and cache keys
- Store results in markdown plus structured metadata
- Mark stale tasks for refresh based on freshness requirements
- Track research provenance for audit trails

**Upstream Dependencies:**
- Agent Adapter Layer (executes research queries)
- Run Directory Manager (stores research artifacts)

**Downstream Dependencies:**
- PRD Authoring Engine (fills knowledge gaps)
- Specification Composer (resolves unknowns)

**Related ADRs:**
- ADR-1: Agent Execution (research task delegation)
- ADR-2: State Persistence (research artifact storage)

**Blueprint References:**
- Section 4.0: Research Coordinator
- Section 2.4: Research Subsystem

---

#### 2.3 PRD Authoring Engine

**Responsibilities:**
- Use agent adapters to propose Product Requirements Documents
- Fall back to templates when agents unavailable
- Maintain review loop capturing edits and approvals
- Map PRD goals to specification requirements for traceability
- Support iterative refinement with human feedback

**Upstream Dependencies:**
- Agent Adapter Layer (generates draft PRDs)
- Research Coordinator (incorporates research findings)
- Run Directory Manager (stores PRD artifacts)

**Downstream Dependencies:**
- Specification Composer (consumes PRD as input)

**Related ADRs:**
- ADR-1: Agent Execution (PRD generation strategy)
- ADR-5: Approval Workflows (review loop implementation, pending)

**Blueprint References:**
- Section 4.0: PRD Authoring Engine
- Section 2.5: Artifact Authoring

---

#### 2.4 Specification Composer

**Responsibilities:**
- Convert PRD + research into engineering specifications
- Define constraints, acceptance criteria, and rollout plans
- Generate test plans with coverage requirements
- Identify unknowns requiring additional ResearchTasks
- Reference file paths, tests, and rollout toggles explicitly
- Assess risks and mitigation strategies

**Upstream Dependencies:**
- PRD Authoring Engine (consumes PRD)
- Research Coordinator (incorporates research)
- Agent Adapter Layer (generates structured specs)
- Run Directory Manager (stores spec artifacts)

**Downstream Dependencies:**
- Task Planner (consumes spec for task breakdown)

**Related ADRs:**
- ADR-1: Agent Execution (spec generation)
- ADR-2: State Persistence (spec artifact schema)

**Blueprint References:**
- Section 4.0: Specification Composer
- Section 2.5: Specification Schema

---

#### 2.5 Task Planner

**Responsibilities:**
- Break specifications into ExecutionTasks with dependency edges
- Apply heuristics to group safe parallel tasks
- Honor gating steps and capability tags
- Generate directed acyclic graph (DAG) representation
- Write `plan.json` consumed by Execution Engine
- Validate plan completeness before execution

**Upstream Dependencies:**
- Specification Composer (consumes spec)
- GitHub Adapter (checks repo state for task feasibility)
- Linear Adapter (fetches ticket context if applicable)
- Run Directory Manager (stores plan.json)

**Downstream Dependencies:**
- Execution Engine (consumes plan.json)

**Related ADRs:**
- ADR-1: Agent Execution (task granularity)
- ADR-2: State Persistence (plan.json schema)

**Blueprint References:**
- Section 4.0: Task Planner
- Section 2.6: Execution Planning

---

#### 2.6 Execution Engine

**Responsibilities:**
- Apply allowlisted code diffs using `git apply` dry runs
- Run validations (lint, test, typecheck, build) defined in config
- Record command outputs, statuses, and artifacts in logs
- Track task state transitions (pending → running → completed/failed)
- Enforce safety policies (no direct pushes, validation gates)
- Support rollback on validation failure

**Upstream Dependencies:**
- Task Planner (consumes plan.json)
- Git Adapter (applies patches)
- Validation Registry (runs validation commands)
- Run Directory Manager (writes execution logs)

**Downstream Dependencies:**
- Deployment Adapter (triggers after validation success)
- PR creation workflows

**Related ADRs:**
- **ADR-1: Agent Execution** (primary responsibility)
- ADR-2: State Persistence (execution logs)
- ADR-5: Approval Workflows (validation gates, pending)

**Blueprint References:**
- Section 4.0: Execution Engine
- Section 2.7: Patch-Based Execution

---

#### 2.7 Resume Coordinator

**Responsibilities:**
- Read `last_step`, `last_error`, and queue files
- Determine safe resumption point based on approval status
- Validate artifact integrity via hash manifests before restarting
- Offer diagnostic summaries when resume is blocked
- Support manual intervention checkpoints
- Handle stale lock recovery

**Upstream Dependencies:**
- Run Directory Manager (loads manifests)
- Validation Registry (re-validates before resume)

**Downstream Dependencies:**
- Execution Engine (restarts from safe point)

**Related ADRs:**
- ADR-2: State Persistence (resumability design)
- ADR-5: Approval Workflows (approval recovery, pending)

**Blueprint References:**
- Section 4.0: Resume Coordinator
- Section 2.8: Resumability

---

#### 2.8 Validation Registry

**Responsibilities:**
- Store configured validation commands (lint, test, typecheck, build)
- Define required environment variables per validation
- Determine which validations are mandatory per feature
- Provide dry-run capability to preview commands
- Support custom validation scripts

**Upstream Dependencies:**
- RepoConfig Manager (reads validation config)

**Downstream Dependencies:**
- Execution Engine (runs validations)
- Resume Coordinator (re-validates on resume)

**Related ADRs:**
- ADR-1: Agent Execution (validation policies)
- ADR-2: State Persistence (validation results)

**Blueprint References:**
- Section 4.0: Validation Command Registry
- Section 2.9: Validation Policies

---

### 3. Adapter Boundary Layer (🔌)

#### 3.1 GitHub Adapter

**Responsibilities:**
- Provide repository information and metadata
- Create and manage branches
- Create, update, and merge pull requests
- Request reviewers and handle review workflows
- Introspect status checks and branch protections
- Enable auto-merge when repository settings allow
- Support GraphQL queries for efficiency

**Upstream Dependencies:**
- Shared HTTP Client (rate-limited API calls)

**Downstream Dependencies:**
- GitHub API (api.github.com)

**Related ADRs:**
- **ADR-3: Adapter Boundary** (primary responsibility)
- ADR-1: Agent Execution (PR automation)

**Blueprint References:**
- Section 4.0: GitHub Adapter
- Section 3.2: Technology Stack (undici, headers)

---

#### 3.2 Linear Adapter

**Responsibilities:**
- Fetch issue metadata and snapshots
- Respect rate limits with offline cache fallback
- Update Linear issues with status summaries when allowed
- Support Developer Preview agents via experimental flags
- Handle Linear's GraphQL API conventions

**Upstream Dependencies:**
- Shared HTTP Client (rate-limited API calls)

**Downstream Dependencies:**
- Linear API (api.linear.app)

**Related ADRs:**
- **ADR-3: Adapter Boundary** (primary responsibility)

**Blueprint References:**
- Section 4.0: Linear Adapter
- Section 3.2: Technology Stack (Linear GraphQL)

---

#### 3.3 Agent Adapter Layer

**Responsibilities:**
- Support OpenAI-compatible endpoints
- Enable local model integrations
- Negotiate capabilities (context window, tools, streaming) via manifests
- Handle retries and cost estimation
- Implement deterministic prompting strategies
- Track token usage and agent costs

**Upstream Dependencies:**
- Shared HTTP Client (for remote agents)
- Security & Credential Vault (token management)

**Downstream Dependencies:**
- Agent Providers (OpenAI, Anthropic, local models)

**Related ADRs:**
- **ADR-1: Agent Execution** (primary responsibility)
- **ADR-3: Adapter Boundary** (provider abstraction)

**Blueprint References:**
- Section 4.0: Agent Adapter Layer
- Section 3.2: Technology Stack (agent manifests)

**Extension Point:** Custom agent providers can be added by implementing the adapter interface and providing capability manifests.

---

#### 3.4 Git Adapter

**Responsibilities:**
- Perform local git operations (status, diff, log)
- Apply patches with dry-run validation
- Manage branch operations (create, checkout, delete)
- Generate diffs for review workflows
- Ensure git command safety (no force operations without approval)

**Upstream Dependencies:**
- Local git binary

**Downstream Dependencies:**
- Git Repository (.git/ directory)

**Related ADRs:**
- ADR-1: Agent Execution (patch application)
- ADR-2: State Persistence (git history capture)

**Blueprint References:**
- Section 4.0: GitHub Adapter (git operations)
- Section 3.2: Technology Stack (git CLI)

---

#### 3.5 Deployment Adapter

**Responsibilities:**
- Control auto-merge settings on PRs
- Trigger GitHub Actions workflow dispatch for deployments
- Verify status checks before deployment
- Record deployment results and evidence
- Support custom CD system integrations (Graphite, etc.)

**Upstream Dependencies:**
- GitHub Adapter (orchestrates GitHub features)

**Downstream Dependencies:**
- GitHub API (deployment endpoints)

**Related ADRs:**
- **ADR-3: Adapter Boundary** (deployment abstraction)
- ADR-5: Approval Workflows (deployment gates, pending)

**Blueprint References:**
- Section 4.0: Deployment Trigger Module
- Section 3.2: Technology Stack (GitHub Actions)

**Extension Point:** Custom deployment systems (Graphite, custom CD) can be integrated by implementing the deployment adapter interface.

---

#### 3.6 Notification Adapter

**Responsibilities:**
- Dispatch notifications to Slack, Discord, email
- Trigger webhooks for custom integrations
- Support templated messages
- Handle notification failures gracefully (non-blocking)

**Upstream Dependencies:**
- Shared HTTP Client (for webhooks)

**Downstream Dependencies:**
- Notification services (Slack, Discord, etc.)

**Related ADRs:**
- ADR-3: Adapter Boundary (notification abstraction)

**Blueprint References:**
- Section 4.0: Observability Hub (notification integration)

**Extension Point:** Custom notification channels can be added by registering webhook endpoints or implementing adapter plugins.

---

#### 3.7 Shared HTTP Client

**Responsibilities:**
- Centralize all HTTP/HTTPS requests
- Extract and persist rate limit envelopes
- Implement exponential backoff with jitter for retries
- Enforce required headers (Accept, Authorization, API versions, tracing IDs)
- Provide request/response logging and redaction
- Support multiple providers (GitHub, Linear, Graphite, CodeMachine, custom)

**Upstream Dependencies:**
- undici (HTTP engine)
- Observability Hub (logs requests)
- Security & Credential Vault (token redaction)

**Downstream Dependencies:**
- GitHub API, Linear API, Agent Providers

**Related ADRs:**
- ADR-3: Adapter Boundary (centralized HTTP layer)
- ADR-2: State Persistence (rate limit ledgers)

**Blueprint References:**
- Section 3.2: Technology Stack (undici, rate limits)
- Section 3.0: Rate Limit Discipline

**Related Documentation:**
- `docs/ops/rate_limit_reference.md` (operational guide)

---

### 4. Persistence & Storage Layer (💾)

#### 4.1 Run Directory Manager

**Responsibilities:**
- Generate feature IDs (ULID/UUIDv7)
- Scaffold deterministic directory structures
- Manage file locks to prevent concurrent writes
- Ensure cross-platform path normalization
- Support cleanup on failure
- Provide atomic write patterns (temp-then-rename)
- Seed optional SQLite WAL indexes for observers

**Upstream Dependencies:**
- File System (creates directories and files)

**Downstream Dependencies:**
- All modules that read/write run artifacts

**Related ADRs:**
- **ADR-2: State Persistence** (primary responsibility)

**Blueprint References:**
- Section 4.0: Run Directory Manager
- Section 2.1: Directory Structure

**Related Documentation:**
- `docs/requirements/run_directory_schema.md` (schema spec)
- `docs/diagrams/run_directory_schema.mmd` (visual representation)

---

#### 4.2 Artifact Bundle Service

**Responsibilities:**
- Package prompts, tickets, context, PRD/spec, plan, logs, diffs, rate-limit ledger, PR info
- Support multiple export formats (JSON, Markdown)
- Validate completeness before marking run as archival-ready
- Generate audit trail manifests
- Compress artifacts for efficient storage

**Upstream Dependencies:**
- Run Directory Manager (reads artifacts)
- File System (writes export bundles)

**Downstream Dependencies:**
- `codepipe export` command

**Related ADRs:**
- ADR-2: State Persistence (export schema)

**Blueprint References:**
- Section 4.0: Artifact Bundle Service
- Section 2.10: Export & Audit

---

#### 4.3 File System Operations

**Responsibilities:**
- Physical storage of all artifacts
- Maintain `.codepipe/` directory structure
- Store run directories under `runs/<feature_id>/`
- Persist `config.json` at repository root
- Provide logs, artifacts, telemetry subdirectories

**Upstream Dependencies:**
- Operating system file system

**Downstream Dependencies:**
- All persistence services

**Related ADRs:**
- ADR-2: State Persistence (directory layout)

**Blueprint References:**
- Section 3.0: Directory Structure
- Section 4.0: Core Architectural Principle (local-first)

**Future Enhancement:** Remote sync to S3/GCS for distributed teams (not yet implemented).

---

### 5. Observability & Security (🔍)

#### 5.1 Observability Hub

**Responsibilities:**
- Aggregate logs, metrics, and traces from all modules
- Apply redaction filters to prevent secret leakage
- Write to run directory telemetry files
- Support optional remote sink forwarding
- Emit alerts when retries exceed thresholds
- Detect and warn about secrets in logs

**Upstream Dependencies:**
- All modules (emit events)
- Security & Credential Vault (redaction rules)
- Telemetry Writers (persistence)

**Downstream Dependencies:**
- Operators (via CLI commands)
- Optional remote telemetry systems (OTLP)

**Related ADRs:**
- ADR-2: State Persistence (telemetry storage)

**Blueprint References:**
- Section 4.0: Observability Hub
- Section 3.2: Technology Stack (OpenTelemetry)

---

#### 5.2 Security & Credential Vault

**Responsibilities:**
- Validate tokens for minimum scopes and expiration
- Provide token masking utilities to other modules
- Track credential usage for rotation policies
- Enforce security policies (no tokens in logs)
- Support multiple authentication methods

**Upstream Dependencies:**
- RepoConfig Manager (reads token configuration)

**Downstream Dependencies:**
- All adapters (consume tokens)
- Observability Hub (redaction rules)

**Related ADRs:**
- ADR-3: Adapter Boundary (token management)

**Blueprint References:**
- Section 4.0: Security & Credential Vault
- Section 3.3: Security Policies

---

#### 5.3 Telemetry Writers

**Responsibilities:**
- Write `logs.ndjson` (newline-delimited JSON logs)
- Write `metrics.json` (performance metrics)
- Write `traces.json` (distributed traces)
- Write `costs.json` (agent cost estimates)
- Write `rate_limits.json` (rate limit ledgers)
- Ensure atomic writes and file locking

**Upstream Dependencies:**
- Observability Hub (receives telemetry data)
- File System (writes files)

**Downstream Dependencies:**
- CLI status commands (read telemetry)
- Export bundles (include telemetry)

**Related ADRs:**
- ADR-2: State Persistence (telemetry schema)

**Blueprint References:**
- Section 2.3: Telemetry & Cost Tracking

**Related Documentation:**
- `docs/ops/rate_limit_reference.md` (rate_limits.json schema)

---

### 6. External Systems (🌐)

#### 6.1 GitHub API

**Responsibilities:**
- Provide REST and GraphQL endpoints
- Enforce rate limits (5,000 req/hr authenticated)
- Require specific headers (X-GitHub-Api-Version, Accept)
- Support auto-merge, status checks, PR workflows

**Upstream Dependencies:**
- Internet connectivity

**Downstream Dependencies:**
- GitHub Adapter

**Related Documentation:**
- [GitHub REST API Docs](https://docs.github.com/en/rest)

---

#### 6.2 Linear API

**Responsibilities:**
- Provide GraphQL endpoint (api.linear.app)
- Enforce rate limits (1,500 req/hr standard, 60 req/min burst)
- Support Developer Preview features
- Provide issue metadata and status updates

**Upstream Dependencies:**
- Internet connectivity

**Downstream Dependencies:**
- Linear Adapter

**Related Documentation:**
- [Linear API Docs](https://developers.linear.app/docs/graphql/working-with-the-graphql-api)

---

#### 6.3 Agent Providers

**Responsibilities:**
- Expose OpenAI-compatible endpoints
- Provide model capabilities (context window, tools)
- Support streaming and cost estimation
- Handle authentication and rate limiting

**Upstream Dependencies:**
- Internet connectivity (for cloud providers)
- Local compute (for local models)

**Downstream Dependencies:**
- Agent Adapter Layer

**Related Documentation:**
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

---

#### 6.4 Local Git Repository

**Responsibilities:**
- Store git history and branches
- Support git CLI operations
- Maintain working tree and staging area

**Upstream Dependencies:**
- File system

**Downstream Dependencies:**
- Git Adapter

---

## Component Responsibilities Matrix

| Component | Primary Responsibility | Layer | ADR References |
|-----------|------------------------|-------|----------------|
| CLI Orchestrator | Command routing & lifecycle control | Presentation | ADR-1, ADR-2 |
| RepoConfig Manager | Configuration discovery & validation | Presentation | ADR-2, ADR-3 |
| Context Aggregator | Repository intelligence gathering | Orchestration | **ADR-4** |
| Research Coordinator | Knowledge gap resolution | Orchestration | ADR-1, ADR-2 |
| PRD Authoring Engine | Product requirements drafting | Orchestration | ADR-1, ADR-5 (pending) |
| Specification Composer | Engineering spec generation | Orchestration | ADR-1, ADR-2 |
| Task Planner | Execution plan DAG generation | Orchestration | ADR-1, ADR-2 |
| Execution Engine | Patch application & validation | Orchestration | **ADR-1**, ADR-2 |
| Resume Coordinator | State recovery | Orchestration | ADR-2, ADR-5 (pending) |
| Validation Registry | Validation policy catalog | Orchestration | ADR-1, ADR-2 |
| GitHub Adapter | GitHub API integration | Adapter Boundary | **ADR-3**, ADR-1 |
| Linear Adapter | Linear API integration | Adapter Boundary | **ADR-3** |
| Agent Adapter Layer | AI agent provider abstraction | Adapter Boundary | **ADR-1**, **ADR-3** |
| Git Adapter | Local git operations | Adapter Boundary | ADR-1, ADR-2 |
| Deployment Adapter | Deployment automation | Adapter Boundary | **ADR-3**, ADR-5 (pending) |
| Notification Adapter | Alert dispatching | Adapter Boundary | ADR-3 |
| Shared HTTP Client | Centralized HTTP with rate limiting | Adapter Boundary | ADR-3, ADR-2 |
| Run Directory Manager | Deterministic artifact persistence | Persistence | **ADR-2** |
| Artifact Bundle Service | Export & audit packaging | Persistence | ADR-2 |
| File System Operations | Physical storage | Persistence | ADR-2 |
| Observability Hub | Telemetry aggregation | Observability | ADR-2 |
| Security & Credential Vault | Secret governance | Observability | ADR-3 |
| Telemetry Writers | Telemetry file persistence | Observability | ADR-2 |

**Bold ADR references** indicate primary architectural decision ownership.

---

## Dependency Graph Summary

### Layer Dependencies (Top to Bottom)

```
CLI Presentation Layer
        ↓
Orchestration Core
        ↓
Adapter Boundary Layer
        ↓
External Systems
```

### Cross-Cutting Dependencies

- **Persistence Layer:** Used by all layers for state management
- **Observability Layer:** Receives events from all layers
- **Security Layer:** Provides token management to all adapters

---

## Extension Points and Customization

### 1. Custom Agent Providers

**Location:** Agent Adapter Layer

**How to Extend:**
1. Implement OpenAI-compatible endpoint
2. Create capability manifest (context window, tools, pricing)
3. Register provider in RepoConfig
4. Adapter automatically negotiates capabilities

**Use Cases:**
- Local LLMs (Ollama, LM Studio)
- Custom fine-tuned models
- Enterprise AI gateways

---

### 2. Custom Deployment Triggers

**Location:** Deployment Adapter

**How to Extend:**
1. Implement deployment adapter interface
2. Add configuration to RepoConfig
3. Trigger deployments via webhook or API call

**Use Cases:**
- Graphite integration
- Custom CI/CD systems (Jenkins, CircleCI)
- Kubernetes operators

---

### 3. Custom Notification Channels

**Location:** Notification Adapter

**How to Extend:**
1. Register webhook endpoint in RepoConfig
2. Configure message templates
3. Adapter dispatches notifications on events

**Use Cases:**
- Microsoft Teams
- Custom dashboards
- PagerDuty alerts

---

### 4. Remote Storage Sync (Future)

**Location:** File System Operations

**Planned Extension:**
- Replicate run directories to S3/GCS
- Enable distributed team collaboration
- Provide backup and archival

**Status:** Not yet implemented

---

## Update Checklist

When modifying the AI Feature Pipeline architecture, use this checklist to keep documentation synchronized:

### Adding New Components

- [ ] Add component to PlantUML diagram (`component_overview.puml`)
- [ ] Document responsibilities, dependencies, and ADRs in this file
- [ ] Update Component Responsibilities Matrix
- [ ] Add to relevant layer package in diagram
- [ ] Create ADR if architectural decision is significant
- [ ] Update related sequence diagrams (when available in I2+)

### Modifying Existing Components

- [ ] Update component description in PlantUML diagram
- [ ] Revise responsibilities section in this document
- [ ] Update dependency arrows in diagram
- [ ] Review ADR references for accuracy
- [ ] Check Component Responsibilities Matrix
- [ ] Update related documentation (run_directory_schema.md, rate_limit_reference.md, etc.)

### Adding New Adapters

- [ ] Add to Adapter Boundary Layer package in diagram
- [ ] Document adapter responsibilities and external system
- [ ] Add upstream dependency on Shared HTTP Client
- [ ] Document extension point if applicable
- [ ] Update Blueprint Section 4.0 (Key Components)
- [ ] Create ADR-3 addendum if patterns change

### Diagram Rendering Changes

- [ ] Test rendering with PlantUML CLI or CI
- [ ] Export PNG/SVG preview if scripted
- [ ] Update `component_index.md` with new artifacts
- [ ] Verify all ADR references resolve correctly

### Removing Components

- [ ] Remove from PlantUML diagram
- [ ] Remove from this documentation
- [ ] Update Component Responsibilities Matrix
- [ ] Document deprecation rationale in changelog
- [ ] Archive related ADRs with deprecation notice

---

## Related Documentation

### Architecture Documents
- **Blueprint Section 4.0:** Key Components & Services definition
- **Blueprint Section 3.1:** Architectural Style rationale
- **System Structure (Section 3.2):** Technology Stack details

### Architectural Decision Records (Pending Upload)
- **ADR-1:** Agent Execution (Execution Engine, Agent Adapter, PRD/Spec generation)
- **ADR-2:** State Persistence (Run Directory Manager, file schemas)
- **ADR-3:** Adapter Boundary (all adapter interfaces, HTTP client)
- **ADR-4:** Context Gathering (Context Aggregator strategies)
- **ADR-5:** Approval Workflows (pending - references noted as "pending")

### Diagrams
- `run_directory_schema.mmd` - Run directory structure visualization
- Sequence diagrams (planned for Iteration I2+)

### Operational Guides
- `rate_limit_reference.md` - Rate limit ledger operations
- `run_directory_schema.md` - Run directory specification

### Schemas
- RepoConfig schema (`.codepipe/config.json`)
- Run manifest schema (`manifest.json`)
- Rate limit ledger schema (`rate_limits.json`)

---

## Diagram Viewing Instructions

### Rendering PlantUML Locally

**Prerequisites:**
- Java Runtime Environment (JRE) 8+
- PlantUML JAR or CLI installed

**Command:**
```bash
# Using PlantUML JAR
java -jar plantuml.jar docs/diagrams/component_overview.puml

# Using PlantUML CLI (if installed via package manager)
plantuml docs/diagrams/component_overview.puml
```

**Output:**
- Generates `component_overview.png` in the same directory

### Rendering via CI (Future)

**Planned Implementation:**
```bash
npm run diagrams  # Renders all .puml files to PNG/SVG
```

**CI Integration:**
- GitHub Actions workflow renders diagrams on push
- Exports to `docs/diagrams/exports/`
- Fails CI if PlantUML syntax errors detected

### Online Viewing

**PlantUML Web Server:**
1. Copy contents of `component_overview.puml`
2. Visit [PlantUML Online Editor](http://www.plantuml.com/plantuml/uml/)
3. Paste and view rendered diagram

**VSCode Extension:**
- Install "PlantUML" extension by jebbs
- Open `component_overview.puml`
- Press `Alt+D` (Windows/Linux) or `Option+D` (Mac) to preview

---

## Change Log

| Version | Date       | Changes                                          |
|---------|------------|--------------------------------------------------|
| 1.0.0   | 2025-12-15 | Initial component diagram documentation for I1   |

---

## Future Enhancements

### Planned Diagrams (I2+)
- **Sequence Diagrams:** Detailed interaction flows for each command (`start`, `resume`, `pr`, `deploy`)
- **State Machine Diagrams:** Run status transitions, approval workflows
- **Data Flow Diagrams:** Context gathering, artifact generation pipelines

### Diagram Automation
- CI-based rendering with PNG/SVG exports
- Automatic ADR reference validation
- Link checking for cross-references

### Interactive Features
- Clickable SVG with links to code files
- Embedded tooltip documentation
- Zoomable component views

---

## Appendix: PlantUML Source

The PlantUML source for this diagram is located at:

**Path:** `docs/diagrams/component_overview.puml`

**Direct Link:** [component_overview.puml](./component_overview.puml)

**Git Blame:** Use `git blame docs/diagrams/component_overview.puml` to see component addition history.
