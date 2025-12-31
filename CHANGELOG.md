# Changelog

All notable changes to the AI Feature Pipeline CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - 2025-12-31

### Overview

First alpha release of the AI Feature Pipeline CLI (`ai-feature`). This release provides core pipeline orchestration capabilities for PRD authoring, task planning, research, and PR automation with resumable execution.

**Status**: Alpha - Production-ready core features, comprehensive documentation, 6/16 CLI commands have integration tests (core workflows covered).

### Added

#### Core CLI Commands (8 total)

- `ai-feature init` - Initialize repository configuration
- `ai-feature start` - Start new feature pipeline (supports --prompt, --linear, --spec)
- `ai-feature plan` - Generate/view execution plan
- `ai-feature status` - Pipeline status with comprehensive reporting
- `ai-feature resume` - Resume interrupted features
- `ai-feature approve` - Approval gate management
- `ai-feature doctor` - Diagnostics and health checks
- `ai-feature validate` - Configuration validation with auto-fix

#### PR Workflow Commands (4 total)

- `ai-feature pr create` - Create pull request with reviewers
- `ai-feature pr status` - PR merge readiness checks
- `ai-feature pr reviewers` - Manage PR reviewers
- `ai-feature pr disable-auto-merge` - Disable auto-merge

#### Research & Context Commands (3 total)

- `ai-feature research create` - Create research tasks with caching
- `ai-feature research list` - List research tasks
- `ai-feature context summarize` - Summarize context with chunking

#### Utilities (1 total)

- `ai-feature rate-limits` - Rate limit monitoring and management

#### Infrastructure

- **Stateful Execution**: Run directory persistence for resumable workflows
- **Rate Limiting**: Built-in exponential backoff, retry-after headers, cost tracking
- **Telemetry**: Comprehensive logging, metrics (Prometheus format), distributed traces
- **Hash Verification**: SHA-256 manifests for deterministic artifact integrity
- **Approval Workflows**: Configurable approval gates for PRD, plan, code, PR stages
- **Branch Protection Awareness**: Detects GitHub branch protection, prevents force push
- **Multi-Provider Agents**: OpenAI-compatible agent endpoints (BYOA - Bring Your Own Agent)

#### Integrations

- **GitHub**: REST API v2022-11-28, PR automation, branch protection detection
- **Linear**: Developer Preview API, issue synchronization, agent integration
- **Agent Adapters**: HTTP-based agent communication with retry logic

### Documentation

#### Requirements (20+ documents)

- Complete API specifications for all adapters and workflows
- Data model dictionary with schema definitions
- Playbooks for all major operations (PRD, plan, PR, research, approval)
- Configuration migration guides

#### Operations Guides

- Init, doctor, smoke test guides
- Approval workflow playbook
- Rate limit reference
- Execution telemetry guide
- Integration testing guide

#### Architecture

- Component index with PlantUML diagrams
- Deployment state diagrams
- Execution flow diagrams
- PR automation sequence diagrams

### Testing

- **CLI Integration Tests**: 6/16 commands (init, start, plan, status, doctor, validate)
- **Test Coverage**: 92 passing tests (100% pass rate)
- **Smoke Tests**: Full pipeline smoke test suite passing
- **Integration Tests**: GitHub/Linear adapter regression tests with SHA-256 fixtures
- **Unit Tests**: Core workflows, rate limiting, telemetry, hash verification

### Configuration

- **Schema Version**: 1.0.0
- **Node.js Requirement**: >=24.0.0 (bleeding edge, most projects use LTS 18/20)
- **Package Manager**: npm (tested with npm 10+)
- **TypeScript**: ES2022 target, Node16 modules, strict type checking

### CI/CD

- **Self-Hosted Runners**: All GitHub Actions run on self-hosted infrastructure
- **Build Pipeline**: TypeScript compilation, oclif manifest generation, test suites
- **Code Quality**: ESLint, Prettier, dual test frameworks (Jest + Vitest)

### Known Limitations

#### Unimplemented Features (Documented but Not Built)

- `ai-feature deploy` - Deployment automation (206 documentation references)
- `ai-feature export` - Telemetry bundling (50+ documentation references)

These commands are extensively documented in playbooks but not yet implemented. Planned for beta release.

#### Test Coverage Gaps

- 10/16 commands lack CLI integration tests (not blocking - core workflows tested)
- Workflow integration tests deferred to beta
- 84-item readiness checklist not fully automated

### Breaking Changes

None (first release).

### Migration Guide

Not applicable (first release).

### Contributors

- YeonGyu Kim (@code-yeongyu) - Project author and maintainer

### Links

- **Repository**: https://github.com/KingInYellows/codemachine-pipeline
- **Documentation**: See `docs/` directory
- **Issues**: GitHub Issues
- **License**: See LICENSE file

---

## Release Notes

### What's Working

✅ **Core Pipeline**: PRD authoring → Plan generation → Research → PR creation → Approval gates
✅ **Resumability**: Interrupted pipelines resume from exact state with hash verification
✅ **Rate Limiting**: Comprehensive tracking across GitHub (5000/hr), Linear (1500/hr), Agent endpoints
✅ **Telemetry**: Metrics (Prometheus), traces (NDJSON), cost tracking, execution logs
✅ **CI/CD**: Self-hosted runners, automated builds, comprehensive test suites

### What's Next (Beta)

🔄 Implement `deploy` and `export` commands
🔄 Complete test coverage (remaining 10 commands)
🔄 Automate 84-item readiness checklist
🔄 Workflow integration tests
🔄 Documentation drift cleanup

### Installation

```bash
npm install -g ai-feature-pipeline  # (update with actual package name when published)
```

Or from source:

```bash
git clone https://github.com/KingInYellows/codemachine-pipeline.git
cd codemachine-pipeline
npm install
npm run build
npm link  # Makes `ai-feature` available globally
```

### Quick Start

```bash
# Initialize configuration
ai-feature init

# Start a feature pipeline
ai-feature start --prompt "Add user authentication"

# Check status
ai-feature status

# Get help
ai-feature --help
ai-feature <command> --help
```

### System Requirements

- **Node.js**: 24.0.0 or higher
- **Git**: Required for repository operations
- **npm**: 10.0.0 or higher
- **Docker** (optional): For containerized deployments
- **Environment Variables**:
  - `GITHUB_TOKEN` (required for GitHub integration)
  - `LINEAR_API_KEY` (optional, for Linear integration)
  - `AGENT_ENDPOINT` (optional, for custom agent endpoints)

---

**Full Changelog**: Initial alpha release
