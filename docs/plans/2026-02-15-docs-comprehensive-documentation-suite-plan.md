---
title: Create Comprehensive Documentation Suite for v1.0.0+
type: docs
date: 2026-02-15
deepened: 2026-02-15
priority: high
milestone: Cycle 8
---

# Create Comprehensive Documentation Suite for v1.0.0+

## Enhancement Summary

**Deepened on:** 2026-02-15
**Research agents used:** 11 (learnings, MkDocs, oclif, technical writing, factual accuracy, simplicity, patterns, architecture, security, additional gaps)
**Sections enhanced:** 7 phases + critical corrections

### Key Improvements from Research

1. **Critical Factual Errors Corrected**
   - Fixed phantom environment variables (`CODEMACHINE_CLI_PATH` → `CODEMACHINE_BIN_PATH`, removed non-existent `CODEMACHINE_LOG_LEVEL`)
   - Corrected config.json schema structure (nested, not flat)
   - Added missing `CODEPIPE_*` family of override environment variables

2. **MkDocs Material Production Configuration**
   - Enhanced mkdocs.yml with 15+ best-practice plugins
   - Navigation optimization (tabs + sticky + instant loading)
   - Performance targets: Lighthouse 95+, FCP <1.5s, search <100ms

3. **Security Enhancements**
   - Added comprehensive credential security section
   - AI API key cost protection guidance
   - Emergency response procedures for leaked credentials
   - Binary integrity verification documentation
   - Created SECURITY.md specification

4. **Simplified Architecture**
   - Consolidated directory structure: 16 → 7 top-level directories
   - Established clear progressive disclosure: Guide → Reference → Playbooks
   - Eliminated DRY violations (single source of truth for config, CLI, troubleshooting)

5. **31 Additional Gaps Identified**
   - Team collaboration workflows (multi-user, approval delegation)
   - Enterprise deployment patterns (org-wide config, compliance)
   - Disaster recovery procedures (queue corruption, system crashes)
   - Migration/upgrade paths (pre-v1.0 → v1.0+)
   - Performance tuning guidance (large repos, bandwidth constraints)

6. **Documentation Quality Automation**
   - CI validation for factual accuracy (command tables, engine lists)
   - Automated link checking and code example testing
   - Drift prevention strategy with programmatic verification

### New Considerations Discovered

**Critical (Must Address):**

- Team collaboration requires locking documentation (queue file access patterns)
- Enterprise config inheritance mechanism undefined (blocks org-wide rollout)
- Queue corruption recovery lacks clear procedures (data loss risk)
- AI API key cost protection is security-critical (leaked keys = $1000s in charges)

**Important (Significant UX Impact):**

- Migration guide needed for pre-v1.0 → v1.0+ upgrades
- Platform-specific quirks (Windows paths, macOS filesystem) require dedicated section
- Performance tuning for large repositories (>10GB) needs documentation
- Advanced error recovery scenarios (stale locks, deadlocks) not covered

**Time Impact:** +3.5 days (was 11.5 days, now **15 days / 3 weeks**) due to:

- Phase 0: Architecture restructuring (+2 days)
- Security enhancements (+1 day)
- Additional gap documentation (+0.5 days)

## Overview

Create a complete, self-service documentation suite covering installation, setup, configuration, and user guide for codemachine-pipeline. The documentation will serve as the single source of truth for users at all experience levels, from first-time installation through advanced configuration and troubleshooting.

**Target State**: Any user should be able to install, configure, and use codemachine-pipeline successfully without external support, with clear answers to common questions and comprehensive reference material for advanced scenarios.

## Problem Statement

**Current State:**

- Documentation exists but is fragmented across README.md, docs/, and CLI help
- Recent v1.0.0 release (2026-02-11) included Cycle 9 CodeMachine-CLI integration, but docs haven't been fully audited
- No consolidated installation guide covering all resolution paths (env vars, optionalDeps, PATH)
- Configuration documentation doesn't explain required vs optional fields
- User guide doesn't cover complete workflows with real examples
- Troubleshooting section is minimal

**Pain Points:**

- New users don't know which installation method to use
- Configuration errors are cryptic due to Zod validation without friendly explanations
- CodeMachine CLI resolution has 3 paths but priority order isn't documented
- Users don't understand the approval workflow mechanics
- No error catalog with remediation steps
- Architecture concepts (queue, workflow, agent, engine) are undefined

**SpecFlow Analysis Identified 34 Original Gaps + 31 Additional Gaps = 65 Total:**

**Original Gaps:**

- **Critical (6)**: Node version requirement, config file discovery, CodeMachine CLI resolution priority, approval mechanics, required vs optional config fields, LINEAR_API_KEY requirement
- **Important (7)**: Execution engine comparison, error recovery, concurrent execution, credential precedence, debug logging, command output format, platform support
- **Nice-to-have (7)**: Monorepo support, offline installation, proxy config, workflow cancellation, queue recovery, GitHub rate limits, doc versioning

**Additional Gaps Discovered During Deepening:**

- **Critical (15)**: Team collaboration locking, enterprise config inheritance, queue corruption recovery, disaster recovery procedures, AI API key cost protection, binary integrity verification, secret rotation, multi-user approval delegation, queue backup/restore, stale lock recovery, secret management integration, migration pre-v1.0 → v1.0+, cross-repo dependencies, compliance auditing, pipeline handoff scenarios
- **Important (11)**: Performance tuning (large repos), platform-specific quirks, advanced error recovery, in-place upgrades, downgrade procedures, concurrent pipeline execution, network bandwidth optimization, partial PR conflicts, permission management, API quota sharing, version compatibility
- **Nice-to-have (5)**: Internationalization, accessibility (a11y), circular dependency deadlock detection, keyboard-only navigation, Braille display support

## 🚨 Critical Corrections Required

**Factual errors found by cross-referencing against codebase:**

1. **WRONG Environment Variable Name** (Lines 231, 433, 269)
   - ❌ Plan documents: `CODEMACHINE_CLI_PATH`
   - ✅ Actual variable: `CODEMACHINE_BIN_PATH` (from `src/adapters/codemachine/binaryResolver.ts:57`)
   - **Fix all occurrences**

2. **Non-Existent Environment Variable** (Line 233, 433)
   - ❌ Plan documents: `CODEMACHINE_LOG_LEVEL`
   - ✅ Reality: This variable does not exist in codebase
   - **Remove or replace with actual debug method**

3. **Incomplete Environment Variable List**
   - ❌ Plan omits entire `CODEPIPE_*` family of override variables
   - ✅ Missing: `CODEPIPE_GITHUB_TOKEN`, `CODEPIPE_LINEAR_API_KEY`, `CODEPIPE_RUNTIME_AGENT_ENDPOINT`, `CODEPIPE_EXECUTION_CLI_PATH`, etc. (from `RepoConfig.ts:509-596`)
   - **Add comprehensive table in Phase 3.2**

4. **Incorrect Config Schema Structure** (Lines 244-253)
   - ❌ Plan shows flat structure: `"executionEngine": "claude"`
   - ✅ Actual structure is nested: `"execution": { "default_engine": "claude" }`
   - **Correct example structure**

5. **Aspirational Engine Comparison Data** (Lines 278-288)
   - ❌ Plan shows speculative cost/speed/model data
   - ✅ Codebase only has enum `['claude', 'codex', 'openai']` without metadata
   - **Add disclaimer or source from CodeMachine CLI docs**

6. **Unverified Config Discovery Algorithm** (Line 217)
   - ❌ Plan assumes "Git root only" without evidence
   - **Phase 1 must verify actual implementation**

## Proposed Solution

Create a multi-format documentation suite with clear organization, progressive disclosure, and comprehensive coverage:

### Documentation Formats

1. **README.md** (Primary Entry Point)
   - Quick overview and value proposition
   - 5-minute quick start guide
   - Links to detailed documentation
   - Badge matrix (CI status, version, license)

2. **docs/ Directory Structure** (Organized by Topic)

   ```
   docs/
   ├── getting-started/
   │   ├── installation.md          # Platform-specific install instructions
   │   ├── quick-start.md            # 5-min first workflow
   │   └── prerequisites.md          # Node version, tools, accounts
   ├── configuration/
   │   ├── overview.md               # Config file discovery, precedence
   │   ├── environment-variables.md  # Complete env var reference
   │   ├── config-file.md            # .codepipe/config.json schema
   │   ├── codemachine-cli.md        # 3 resolution paths, priorities
   │   └── execution-engines.md      # Claude, Codex, OpenAI comparison
   ├── user-guide/
   │   ├── workflows.md              # Core workflows (init → start → approve → resume)
   │   ├── commands/
   │   │   ├── init.md               # Per-command documentation with examples
   │   │   ├── start.md
   │   │   ├── approve.md
   │   │   └── ... (all 17 commands)
   │   └── advanced-usage.md         # CI/CD integration, monorepos
   ├── troubleshooting/
   │   ├── common-errors.md          # Error catalog with solutions
   │   ├── debugging.md              # Debug mode, verbose logging
   │   └── faq.md                    # Frequently asked questions
   ├── architecture/
   │   ├── overview.md               # High-level architecture
   │   ├── concepts.md               # Glossary (queue, workflow, agent, engine)
   │   ├── components.md             # Component interaction diagrams
   │   └── data-flow.md              # Pipeline execution flow
   └── reference/
       ├── cli-reference.md          # Auto-generated from oclif.manifest.json
       ├── api-reference.md          # Public APIs (if applicable)
       └── schema-reference.md       # Config JSON schema documentation
   ```

3. **CLI --help Text** (Built-in Help)
   - Leverage oclif framework's built-in help system
   - Ensure each command has accurate description and examples
   - Validate via `npm run docs:cli:check`

4. **MkDocs Material Site** (Interactive Web Documentation)
   - Searchable documentation with Material theme
   - Navigation sidebar matching docs/ structure
   - Code syntax highlighting
   - Copy-to-clipboard for code examples
   - Version switcher (future)

## Technical Approach

### Phase 0: Architecture Foundation & Critical Corrections (2 days) **NEW**

**Tasks:**

1. **Correct Factual Errors in Plan**
   - [x] Replace all `CODEMACHINE_CLI_PATH` with `CODEMACHINE_BIN_PATH`
   - [x] Remove `CODEMACHINE_LOG_LEVEL` or replace with actual debug method
   - [x] Fix config.json examples to use nested structure
   - [ ] Verify all file paths and line numbers are accurate

2. **Restructure docs/ Directory** (Architecture Review Recommendation)
   - [ ] Consolidate from 16 → 7 top-level directories:
     ```
     docs/
     ├── guide/           # Consolidates getting-started + user-guide (Tier 1: Learn)
     ├── reference/       # Detailed specs: cli/, config/, architecture/, api/ (Tier 2: Reference)
     ├── playbooks/       # Operations procedures (Tier 3: How-To)
     ├── adr/             # Keep existing (Architecture Decision Records)
     ├── solutions/       # Keep existing (Troubleshooting KB)
     ├── diagrams/        # Keep existing (Visual assets)
     └── templates/       # Keep existing (Document templates)
     ```
   - [ ] Create migration map: existing files → new structure
   - [ ] Archive transient docs (brainstorms, plans, research) to `docs/archive/`

3. **Establish Link Validation CI**
   - [ ] Create `.github/workflows/docs-validation.yml`
   - [ ] Configure markdown-link-check with `.github/markdown-link-check.json`
   - [ ] Add factual accuracy checks (engine lists, command counts)

**Deliverable:**

- Restructured docs/ directory
- Migration map documenting all file moves
- CI validation workflow
- Corrected plan document

### Phase 1: Critical Questions & Requirements Clarification (2 days)

**MUST answer before proceeding with content creation:**

**Original Critical Questions:**

| #   | Question                             | Current Assumption            | Validation Method                                       | Answer Found                            |
| --- | ------------------------------------ | ----------------------------- | ------------------------------------------------------- | --------------------------------------- |
| 1   | Node.js version requirement?         | >=24.0.0                      | Check `package.json` engines field                      | ✅ Verified: >=24.0.0                   |
| 2   | Config file discovery algorithm?     | Git root only                 | Read `src/core/config/RepoConfig.ts` loader logic       | ❓ MUST VERIFY                          |
| 3   | CodeMachine CLI resolution priority? | env var → optionalDeps → PATH | Read `src/adapters/codemachine/binaryResolver.ts`       | ✅ Verified (corrected)                 |
| 4   | Approval workflow mechanics?         | GitHub PR approval            | Read `src/cli/commands/approve.ts` implementation       | ❓ MUST VERIFY                          |
| 5   | Required vs optional config fields?  | Reverse-engineer from Zod     | Extract from `src/core/config/RepoConfig.ts` Zod schema | ❓ MUST VERIFY                          |
| 6   | LINEAR_API_KEY required or optional? | Optional                      | Read config validation logic                            | ✅ Optional (warning if Linear enabled) |

**NEW Critical Questions from Gap Analysis:**

| #   | Question                                                     | Why Critical                                   | Validation Method                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------- |
| 7   | Multi-user queue locking mechanism?                          | Team collaboration - prevents queue corruption | Read queue file access patterns           |
| 8   | Can `.codepipe/` be committed to git for team collaboration? | Determines team workflow guidance              | Check .gitignore defaults                 |
| 9   | Queue backup/restore mechanism?                              | Disaster recovery requirement                  | Check for backup commands                 |
| 10  | Credential precedence: env vars vs config.json?              | Security - users must know which wins          | Read credential loading order             |
| 11  | Debug logging enablement method?                             | Troubleshooting - essential for bug reports    | Find actual debug flag/env var            |
| 12  | AI API keys: which env vars control them?                    | Cost protection - leaked keys = $1000s         | Read execution engine credential handling |
| 13  | Migration path from pre-v1.0?                                | Upgrade guidance - users stuck without it      | Check for migration scripts or guides     |
| 14  | Concurrent pipeline execution support?                       | Prevents data corruption                       | Read locking implementation               |
| 15  | Platform support matrix?                                     | Installation instructions vary                 | Check package.json platforms              |

**Additional Important Questions:**

- Execution engine feature comparison (capabilities, cost, speed) - **Mark as speculative or source externally**
- Error recovery mechanism (can `resume` handle mid-execution failures?)
- Command output format (`--json` support?) - **Verify per-command**

**Deliverable:**

- `docs/adr/adr-009-documentation-architecture.md` - Answers to all critical questions
- Decision log in planning document

### Phase 2: Content Audit & Structure (1 day)

**Tasks:**

1. **Audit existing documentation**
   - [ ] Read current README.md (note sections to preserve, rewrite, deprecate)
   - [ ] Inventory docs/ directory (75+ files - categorize by status)
   - [ ] Review CLI help text for all 17 commands
   - [ ] Check oclif.manifest.json for auto-generated CLI reference

2. **Identify content to preserve**
   - [ ] ADRs (Architecture Decision Records) - keep all
   - [ ] Solution docs (docs/solutions/) - keep, potentially reorganize
   - [ ] Operational guides (docs/ops/) - audit for accuracy against v1.0.0
   - [ ] Templates (docs/templates/) - keep, document usage

3. **Identify content to archive**
   - [ ] Pre-v1.0.0 stale docs (use named branch: `archive/post-v1.0.0-stale`)
   - [ ] Aspirational features not implemented (docs-as-code tense rule)
   - [ ] Redundant documentation (violates DRY principle)

4. **Create information architecture**
   - [ ] Sitemap for MkDocs site (navigation.yml)
   - [ ] Content mapping matrix (which doc lives where?)
   - [ ] Cross-reference strategy (linking between formats)
   - [ ] Progressive disclosure hierarchy (quick start → guide → reference)

**Deliverable:**

- `docs/plans/content-audit-findings.md` - Audit results with recommendations
- `mkdocs.yml` - Initial site structure
- Archive branch: `archive/post-v1.0.0-stale` (if needed)

### Phase 3: Content Creation (5 days)

#### 3.1 Getting Started Documentation (1 day)

**Files:**

- `docs/getting-started/prerequisites.md`
- `docs/getting-started/installation.md`
- `docs/getting-started/quick-start.md`

**Content Requirements:**

**prerequisites.md**

- [ ] Node.js version requirement (>=24.0.0 from MEMORY.md)
- [ ] Required tools (git, npm, GitHub account)
- [ ] Optional tools (Linear account for issue tracking)
- [ ] API key acquisition steps (GitHub PAT, Linear API key)
- [ ] Platform support matrix (Windows, macOS, Linux)
- [ ] Network requirements (firewall/proxy configuration if needed)

**installation.md**

- [ ] Installation method comparison table (global vs local vs npx)
- [ ] Recommended installation path (npm install -g for most users)
- [ ] Platform-specific instructions:
  - macOS: `brew install` if available, else npm
  - Linux: npm (include notes for different distros)
  - Windows: npm (PowerShell vs Command Prompt vs WSL)
- [ ] Installation verification (`codepipe --version`)
- [ ] Post-install troubleshooting (PATH issues, permissions)
- [ ] Offline/air-gapped installation (if supported, else document "not supported")

**quick-start.md**

- [ ] Target: 5 minutes to first successful workflow
- [ ] Assumes installation already complete
- [ ] Step-by-step walkthrough:
  1. Navigate to git repository
  2. Run `codepipe init` (show expected output)
  3. Review generated `.codepipe/config.json`
  4. Set environment variables (minimal: GITHUB_TOKEN)
  5. Run `codepipe start --prompt "Add README badge"`
  6. Wait for PRD generation
  7. Run `codepipe approve prd`
  8. Check generated PR
  9. Success criteria and next steps
- [ ] Real example with actual command output
- [ ] Common pitfalls callout boxes

#### 3.2 Configuration Documentation (1.5 days)

**Files:**

- `docs/configuration/overview.md`
- `docs/configuration/environment-variables.md`
- `docs/configuration/config-file.md`
- `docs/configuration/codemachine-cli.md`
- `docs/configuration/execution-engines.md`

**Content Requirements:**

**overview.md**

- [ ] Configuration file discovery algorithm (current dir → git root → home?)
- [ ] Precedence order (env vars > config.json > defaults)
- [ ] Minimal configuration example
- [ ] Validation process (Zod runtime validation)
- [ ] How to validate config (`codepipe validate config` if exists)

**environment-variables.md**

- [ ] Complete environment variable reference table (CORRECTED):

**User-Facing Environment Variables:**

| Variable               | Required? | Default | Description                                                         | Example                                   |
| ---------------------- | --------- | ------- | ------------------------------------------------------------------- | ----------------------------------------- |
| `GITHUB_TOKEN`         | Yes       | -       | GitHub Personal Access Token                                        | `ghp_EXAMPLE_DO_NOT_USE_1234567890abcdef` |
| `LINEAR_API_KEY`       | No\*      | -       | Linear API key for issue tracking                                   | `lin_api_EXAMPLE_PLACEHOLDER_abc123xyz`   |
| `ANTHROPIC_API_KEY`    | No\*\*    | -       | Anthropic Claude API key                                            | `sk-ant-EXAMPLE_PLACEHOLDER_123456`       |
| `OPENAI_API_KEY`       | No\*\*    | -       | OpenAI API key (GPT-4, Codex)                                       | `sk-EXAMPLE_DO_NOT_USE_abcdef123456`      |
| `CODEMACHINE_BIN_PATH` | No        | -       | Override CodeMachine CLI binary path (3-path resolution Priority 1) | `/usr/local/bin/codemachine`              |

\*Required only if Linear integration enabled (`config.linear.enabled = true`)
\*\*Required for respective execution engine (claude requires ANTHROPIC_API_KEY, openai/codex require OPENAI_API_KEY)

**⚠️ SECURITY NOTE**: All examples above use placeholder tokens with `EXAMPLE`, `PLACEHOLDER`, or `DO_NOT_USE` markers. **NEVER use real API keys in documentation.**

**Advanced: `CODEPIPE_*` Override Environment Variables:**

| Variable                                | Default             | Description                       | When to Use                           |
| --------------------------------------- | ------------------- | --------------------------------- | ------------------------------------- |
| `CODEPIPE_GITHUB_TOKEN`                 | -                   | Override GitHub token from config | CI/CD with secret injection           |
| `CODEPIPE_LINEAR_API_KEY`               | -                   | Override Linear API key           | Multi-environment deployments         |
| `CODEPIPE_RUNTIME_AGENT_ENDPOINT`       | (Anthropic default) | Override AI agent endpoint        | Self-hosted models, proxy             |
| `CODEPIPE_RUNTIME_MAX_CONCURRENT_TASKS` | 3                   | Max parallel task execution       | Resource-constrained environments     |
| `CODEPIPE_RUNTIME_TIMEOUT_MINUTES`      | 30                  | Global execution timeout          | Cost control, CI time limits          |
| `CODEPIPE_EXECUTION_CLI_PATH`           | `codemachine`       | Legacy CLI path override          | Backward compatibility                |
| `CODEPIPE_EXECUTION_DEFAULT_ENGINE`     | `claude`            | Override execution engine         | Switch engines without editing config |
| `CODEPIPE_EXECUTION_TIMEOUT_MS`         | 1800000             | Per-task timeout                  | Fine-grained timeout control          |

**Source**: `src/core/config/RepoConfig.ts:509-596`

- [ ] **Comprehensive Security Best Practices Section** (Critical Addition)
  - [ ] ⚠️ CRITICAL: Never commit secrets to git
    - Verify `.gitignore` includes `.env`, `.env.local`, `.codepipe/config.json` (if it contains secrets)
    - Check existing commits for leaks: `git log --all --full-history -- .env`
  - [ ] Secure credential storage
    - Local development: `touch .env && chmod 600 .env` (owner read/write only)
    - CI/CD: Use GitHub Secrets (Settings → Secrets → Actions)
    - Cloud environments: Use cloud-specific secret managers (AWS Secrets Manager, not ~/.bashrc)
  - [ ] AI API key cost protection (CRITICAL)
    - Set monthly spend limits ($100 recommended for testing)
    - Leaked keys can incur $1000s in charges within hours
    - Enable spend alerts at 50%, 80%, 100% of budget
    - Monitor usage daily during development
  - [ ] Credential rotation procedures
    - Rotate every 90 days (compliance requirement)
    - Immediate rotation if committed, logged, or shared
    - GitHub token rotation: Settings → Developer settings → Personal access tokens
    - Test after rotation: `codepipe doctor --validate-credentials` (if exists)
  - [ ] Emergency response for leaked credentials
    - Revoke compromised token IMMEDIATELY (<5 minutes)
    - Check GitHub security log for unauthorized access
    - Use `git filter-repo` or BFG to purge from git history
    - Rotate ALL related credentials (defense in depth)
  - [ ] Credential scope minimization
    - GitHub: Use minimal scopes (`repo`, `workflow` only - never `admin:org`, `delete_repo`)
    - Linear: Use read-only API key if only linking issues
    - AI providers: Use project-scoped keys (not org-scoped) for isolated billing
  - [ ] File permissions requirements
    - `.env`: `chmod 600` (owner read/write only)
    - `.codepipe/`: `chmod 700` (owner access only)
    - `.codepipe/config.json`: `chmod 600` if contains secrets
- [ ] Platform-specific env var setting (Windows vs macOS/Linux)

**config-file.md**

- [ ] `.codepipe/config.json` structure documentation
- [ ] Required vs optional fields (extracted from Zod schema)
- [ ] Field-by-field reference with examples (using correct nested structure):
  ```json
  {
    "execution": {
      "default_engine": "claude" // Required: claude | codex | openai
    },
    "project": {
      "id": "my-project", // Required: Project identifier
      "repo_url": "https://github.com/my-org/my-repo.git" // Required: Repository URL
    },
    "github": {
      "enabled": true, // Required: Enable GitHub integration
      "token_env_var": "GITHUB_TOKEN" // Optional: Env var name for token (default: GITHUB_TOKEN)
    },
    "linear": {
      "team": "ENG", // Optional: Linear team key (if using Linear)
      "enabled": true // Optional: Enable Linear integration
    },
    "research": {
      "enabled": true // Optional: Enable research phase (default: true)
    },
    "approval": {
      "gates": ["prd", "spec"] // Optional: Approval gates (default: all)
    }
  }
  ```
- [ ] Complete configuration examples for common scenarios:
  - Minimal config (claude engine, GitHub only)
  - Full config (all options specified)
  - Multi-repo config (monorepo scenario if supported)
  - CI/CD config (non-interactive mode)
- [ ] Configuration validation error examples with solutions
- [ ] Schema reference (link to auto-generated schema docs)

**codemachine-cli.md**

- [ ] CodeMachine CLI integration overview
- [ ] Binary resolution algorithm (3 paths with priority):
  1. `CODEMACHINE_BIN_PATH` environment variable (allowlist-validated)
  2. npm optionalDependency (platform-specific packages)
  3. PATH search
- [ ] How to verify which CLI is being used
- [ ] Installation scenarios:
  - Development: Use `CODEMACHINE_BIN_PATH` to point to local build
  - Production: Use optionalDependency or global install
  - CI/CD: Use PATH from Docker image or action setup
- [ ] Troubleshooting CLI resolution issues
- [ ] Version compatibility matrix (codemachine-pipeline version → CodeMachine CLI version)

**execution-engines.md**

- [ ] Execution engine comparison table:

| Feature              | claude                            | codex                     | openai                 |
| -------------------- | --------------------------------- | ------------------------- | ---------------------- |
| **Provider**         | Anthropic                         | OpenAI                    | OpenAI                 |
| **Model**            | Claude 3 Opus                     | Codex                     | GPT-4                  |
| **Cost (1M tokens)** | ~$15                              | ~$0.002                   | ~$30                   |
| **Speed**            | Medium                            | Fast                      | Medium                 |
| **Code Quality**     | Excellent                         | Good                      | Excellent              |
| **Context Window**   | 200K                              | 8K                        | 128K                   |
| **Best For**         | Complex refactoring, architecture | Quick fixes, autocomplete | General-purpose coding |

- [ ] How to switch engines (edit config.json, restart pipeline)
- [ ] API key requirements per engine
- [ ] Rate limit behavior per engine
- [ ] Model versioning and selection (if supported)

#### 3.3 User Guide Documentation (1.5 days)

**Files:**

- `docs/user-guide/workflows.md`
- `docs/user-guide/commands/init.md`
- `docs/user-guide/commands/start.md`
- `docs/user-guide/commands/approve.md`
- `docs/user-guide/commands/resume.md`
- `docs/user-guide/commands/doctor.md`
- `docs/user-guide/commands/health.md`
- `docs/user-guide/commands/status.md` (if exists)
- `docs/user-guide/commands/pr-create.md`
- ... (all 17 commands)
- `docs/user-guide/advanced-usage.md`

**Content Requirements:**

**workflows.md**

- [ ] Core pipeline workflow walkthrough (end-to-end):
  1. **Initialize**: `codepipe init` (creates .codepipe/, config.json)
  2. **Start**: `codepipe start --prompt "..."` (generates PRD, runs research)
  3. **Approve PRD**: `codepipe approve prd` (manual gate)
  4. **Continue**: Pipeline auto-resumes after approval
  5. **Approve Spec**: `codepipe approve spec` (manual gate)
  6. **Implementation**: Agent executes tasks, creates PR
  7. **Review**: Manual code review
  8. **Merge**: Complete workflow
- [ ] Approval workflow mechanics detailed explanation (how gates work)
- [ ] Resume after errors (when to use `codepipe resume`)
- [ ] Workflow state diagram (pending → running → completed/failed)
- [ ] Real-world example with actual command output and screenshots

**Per-command documentation** (template for all 17 commands):

- [ ] Command purpose and when to use it
- [ ] Syntax: `codepipe <command> [flags]`
- [ ] Flags/options reference table
- [ ] 2-3 real examples with output
- [ ] Common use cases
- [ ] Troubleshooting tips specific to this command
- [ ] Related commands (e.g., `init` links to `doctor`)

**Example structure for `commands/start.md`:**

````markdown
# codepipe start

Start a new feature pipeline by providing a feature description prompt.

## Syntax

```bash
codepipe start --prompt "<feature description>" [options]
```
````

## Options

| Flag            | Alias | Required? | Description                | Default |
| --------------- | ----- | --------- | -------------------------- | ------- |
| `--prompt`      | `-p`  | Yes       | Feature description prompt | -       |
| `--no-research` | -     | No        | Skip research phase        | false   |
| `--json`        | -     | No        | Output in JSON format      | false   |

## Examples

### Basic feature request

```bash
codepipe start --prompt "Add user authentication with OAuth"
```

### Skip research phase (faster but less context)

```bash
codepipe start --prompt "Fix typo in README" --no-research
```

### JSON output for CI/CD

```bash
codepipe start --prompt "Update dependencies" --json
```

## How It Works

1. **Context aggregation**: Scans repository for relevant context
2. **Research detection**: Identifies knowledge gaps (if enabled)
3. **PRD authoring**: Generates Product Requirements Document
4. **Approval gate**: Waits for `codepipe approve prd`

## Troubleshooting

**Error: "Invalid prompt: too short"**

- Prompts must be at least 10 characters
- Provide more detail about the desired feature

**Error: "GITHUB_TOKEN not found"**

- Set GITHUB_TOKEN environment variable
- See [Configuration](/configuration/environment-variables.md)

## Related Commands

- [`codepipe approve`](/user-guide/commands/approve.md) - Approve generated artifacts
- [`codepipe resume`](/user-guide/commands/resume.md) - Resume after errors

````

**advanced-usage.md**
- [ ] CI/CD integration examples (GitHub Actions, GitLab CI)
- [ ] Monorepo configuration (if supported, else document "not supported")
- [ ] Custom agent prompts (if configurable)
- [ ] Workflow automation strategies
- [ ] Multiple repository management

#### 3.4 Troubleshooting Documentation (1 day)

**Files:**
- `docs/troubleshooting/common-errors.md`
- `docs/troubleshooting/debugging.md`
- `docs/troubleshooting/faq.md`
- `docs/troubleshooting/security.md` **NEW** - Security incident response
- `docs/troubleshooting/disaster-recovery.md` **NEW** - Queue corruption, system crashes
- `docs/user-guide/team-collaboration.md` **NEW** - Multi-user workflows
- `docs/configuration/enterprise-deployment.md` **NEW** - Org-wide patterns
- `docs/getting-started/migration-guide.md` **NEW** - Pre-v1.0 → v1.0+ upgrade
- `docs/advanced/performance-tuning.md` **NEW** - Large repo optimization
- `docs/reference/platform-specific.md` **NEW** - Windows/macOS/Linux quirks
- `SECURITY.md` **NEW** - Responsible disclosure policy (root of repo)

**Content Requirements:**

**common-errors.md**
- [ ] Error catalog with solutions (minimum 20 common errors):

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `GITHUB_TOKEN not found` | Missing env var | Set GITHUB_TOKEN: `export GITHUB_TOKEN=ghp_...` |
| `Invalid config.json schema` | Zod validation failed | Run `codepipe validate config`, check required fields |
| `CodeMachine CLI not found` | Binary not in PATH | Check resolution paths, set CODEMACHINE_BIN_PATH |
| `Execution engine rate limit` | API quota exceeded | Wait 60s, or switch engine temporarily |
| `Queue integrity check failed` | Corrupted queue state | Delete `.codepipe/queue/`, run `codepipe resume` |
| `Approval gate timeout` | No approval within 24h | Run `codepipe approve <gate>` to proceed |
| `Git repository not found` | Not in git repo | Run `git init` or cd to repo root |
| `Permission denied: .codepipe/` | File permissions issue | `chmod -R 755 .codepipe/` |
| `Network timeout: agent endpoint` | Firewall blocking API | Check proxy config, verify AGENT_ENDPOINT |
| `Linear API key invalid` | Wrong API key | Regenerate Linear API key, update env var |

- [ ] Error code reference (if errors have codes)
- [ ] How to read stack traces
- [ ] When to file a bug report vs. configuration issue

**debugging.md**
- [ ] How to enable debug logging (method TBD - verify actual implementation):
  ```bash
  # TODO: Verify actual debug logging mechanism
  # Potential options: --verbose flag, DEBUG env var, or config setting
  codepipe start --prompt "..." --verbose
````

- [ ] Log file locations (`.codepipe/logs/`)
- [ ] What to include in bug reports (version, config, logs)
- [ ] Verbose mode (`--verbose` flag if exists)
- [ ] Trace mode for deep debugging (if exists)
- [ ] How to test configuration in isolation:
  ```bash
  codepipe validate config --verbose
  codepipe doctor --json
  ```

**faq.md**

- [ ] Frequently asked questions with answers:
  - Q: Which execution engine should I choose?
  - Q: How much does it cost to run a pipeline?
  - Q: Can I run multiple workflows in parallel?
  - Q: How do I cancel a running workflow?
  - Q: What happens if my system crashes mid-workflow?
  - Q: Can I use this in a monorepo?
  - Q: How do I upgrade from pre-1.0 versions?
  - Q: Is my API key secure?
  - Q: How do I configure a corporate proxy?
  - Q: Can I use this offline?

#### 3.5 Architecture & Concepts Documentation (1 day)

**Files:**

- `docs/architecture/overview.md`
- `docs/architecture/concepts.md`
- `docs/architecture/components.md`
- `docs/architecture/data-flow.md`

**Content Requirements:**

**overview.md**

- [ ] High-level architecture diagram (components and interactions)
- [ ] System design philosophy
- [ ] Technology stack (Node.js, TypeScript, oclif, Zod)
- [ ] External dependencies (GitHub, Linear, CodeMachine CLI, AI APIs)

**concepts.md**

- [ ] Glossary of key terms:
  - **Pipeline**: End-to-end workflow from prompt to PR
  - **Queue**: Persistent task queue in `.codepipe/queue/`
  - **Workflow**: Orchestrated sequence of pipeline stages
  - **Agent**: AI system executing implementation tasks
  - **Engine**: AI model provider (claude, codex, openai)
  - **Gate**: Manual approval checkpoint (prd, spec)
  - **Run Directory**: State storage for a single pipeline execution
  - **Research Coordinator**: Context gathering and knowledge detection
  - **PRD**: Product Requirements Document
  - **Spec**: Technical specification document

**components.md**

- [ ] Component interaction diagram
- [ ] Core components:
  - CLI Commands (`src/cli/commands/`)
  - Configuration (`src/core/config/`)
  - Workflows (`src/workflows/`)
  - Adapters (`src/adapters/` - GitHub, Linear, CodeMachine)
  - Persistence (`src/persistence/`)
  - Telemetry (`src/telemetry/`)
  - Validation (`src/validation/`)
- [ ] Adapter architecture (ADR-8: CodeMachine CLI integration)

**data-flow.md**

- [ ] Pipeline execution flow diagram:
  ```
  Initialize → Specify → Plan → Implement → Review → Deploy
  ```
- [ ] State machine diagram:
  ```
  pending → running → completed
                   → failed (recoverable) → retry → running
                   → failed (permanent) → skipped
  ```
- [ ] Data persistence strategy (run directory structure)
- [ ] Queue integrity and recovery mechanisms

### Phase 4: Auto-Generated Documentation (1 day)

**Tasks:**

1. **CLI Reference Auto-Generation**
   - [ ] Verify `npm run docs:cli` command works
   - [ ] Update script to include examples from command implementations
   - [ ] Enhance oclif command descriptions if lacking
   - [ ] Add usage examples to each command's `examples` array
   - [ ] Test CI validation: `npm run docs:cli:check`

2. **Schema Reference Auto-Generation** (if not already automated)
   - [ ] Create script to generate markdown from Zod schemas
   - [ ] Include field descriptions, types, defaults, constraints
   - [ ] Generate examples for each schema
   - [ ] Link from config documentation

3. **API Reference** (if public APIs exist)
   - [ ] Identify public APIs (if any)
   - [ ] Generate API docs from JSDoc comments
   - [ ] Include usage examples
   - [ ] Version compatibility notes

**Deliverable:**

- `docs/reference/cli-reference.md` (auto-generated)
- `docs/reference/schema-reference.md` (auto-generated if applicable)
- `docs/reference/api-reference.md` (if applicable)

### Phase 5: MkDocs Material Setup (1 day)

**Tasks:**

1. **Install and Configure MkDocs** (Enhanced Configuration from Research)
   - [ ] Add to Python requirements: `mkdocs-material`, `mkdocstrings`, `mkdocs-git-revision-date-localized-plugin`, `mkdocs-minify-plugin`, `mkdocs-redirects`, `mike`
   - [ ] Create production-ready `mkdocs.yml` configuration:

     ```yaml
     # Site information
     site_name: Codemachine Pipeline
     site_url: https://kinginyellow.github.io/codemachine-pipeline/ # REQUIRED for plugins
     site_description: AI-powered code pipeline automation for GitHub repositories
     site_author: Kinginyellow
     repo_name: kinginyellow/codemachine-pipeline
     repo_url: https://github.com/kinginyellow/codemachine-pipeline
     edit_uri: edit/main/docs/

     # Theme Configuration (Material Design with Dark Mode)
     theme:
       name: material
       palette:
         # Light mode
         - media: '(prefers-color-scheme: light)'
           scheme: default
           primary: indigo
           accent: deep purple
           toggle:
             icon: material/brightness-7
             name: Switch to dark mode
         # Dark mode
         - media: '(prefers-color-scheme: dark)'
           scheme: slate
           primary: indigo
           accent: deep purple
           toggle:
             icon: material/brightness-4
             name: Switch to light mode

       font:
         text: Roboto
         code: Roboto Mono

       # Navigation Features (Best Practices for Developer Docs)
       features:
         - navigation.instant # SPA-like navigation (fast page loads)
         - navigation.instant.progress # Loading progress bar
         - navigation.tracking # Update URL on scroll
         - navigation.tabs # Top-level sections as tabs
         - navigation.tabs.sticky # Tabs stay visible when scrolling
         - navigation.sections # Group sections in sidebar
         - navigation.expand # Expand all by default
         - navigation.path # Breadcrumb navigation
         - navigation.indexes # Section index pages
         - navigation.top # Back to top button
         - navigation.footer # Prev/next links
         - search.suggest # Search suggestions
         - search.highlight # Highlight search terms
         - search.share # Deep-link search results
         - toc.follow # TOC follows scroll
         - toc.integrate # Integrate TOC into sidebar
         - content.code.copy # Copy button for code blocks
         - content.code.select # Double-click to select
         - content.code.annotate # Code annotations
         - content.tabs.link # Link content tabs across pages
         - content.tooltips # Glossary tooltips

       icon:
         repo: fontawesome/brands/github
         logo: material/library
       favicon: assets/favicon.png

     # Plugins (Production Essentials)
     plugins:
       - search:
           lang: en
           separator: '[\s\-\.]+'
           pipeline:
             - stemmer
             - stopWordFilter
             - trimmer

       - git-revision-date-localized:
           enable_creation_date: true
           type: timeago
           fallback_to_build_date: true

       - minify:
           minify_html: true
           minify_js: true
           minify_css: true
           htmlmin_opts:
             remove_comments: true

       - redirects:
           redirect_maps:
             'ops/cli-reference.md': 'reference/cli/README.md'
             'ops/troubleshooting.md': 'troubleshooting/common-errors.md'

       - meta # Per-directory metadata

     # Markdown Extensions (Full Developer Toolkit)
     markdown_extensions:
       - abbr # Abbreviations with tooltips
       - admonition # Callouts/alerts
       - attr_list # HTML/CSS attributes
       - def_list # Definition lists
       - footnotes # Footnote syntax
       - md_in_html # Markdown inside HTML
       - tables # Table support
       - toc:
           permalink: true
           toc_depth: 3

       # PyMdown Extensions
       - pymdownx.betterem:
           smart_enable: all
       - pymdownx.caret # Superscript
       - pymdownx.mark # Highlighting
       - pymdownx.tilde # Subscript
       - pymdownx.critic # Track changes
       - pymdownx.details # Collapsible sections
       - pymdownx.emoji:
           emoji_index: !!python/name:material.extensions.emoji.twemoji
           emoji_generator: !!python/name:material.extensions.emoji.to_svg
       - pymdownx.highlight:
           anchor_linenums: true
           line_spans: __span
           pygments_lang_class: true
       - pymdownx.inlinehilite
       - pymdownx.keys # Keyboard key styling
       - pymdownx.magiclink:
           repo_url_shorthand: true
           user: kinginyellow
           repo: codemachine-pipeline
       - pymdownx.smartsymbols
       - pymdownx.snippets
       - pymdownx.superfences:
           custom_fences:
             - name: mermaid
               class: mermaid
               format: !!python/name:pymdownx.superfences.fence_code_format
       - pymdownx.tabbed:
           alternate_style: true
       - pymdownx.tasklist:
           custom_checkbox: true

     # Extra Configuration
     extra:
       social:
         - icon: fontawesome/brands/github
           link: https://github.com/kinginyellow/codemachine-pipeline
       version:
         provider: mike
         default: stable
       analytics:
         feedback:
           title: Was this page helpful?
           ratings:
             - icon: material/emoticon-happy-outline
               name: This page was helpful
               data: 1
             - icon: material/emoticon-sad-outline
               name: This page could be improved
               data: 0

     copyright: Copyright &copy; 2026 Kinginyellow

     # Navigation (Restructured per Architecture Review)
     nav:
       - Home: index.md
       - Guide:
           - guide/index.md
           - Prerequisites: guide/prerequisites.md
           - Installation: guide/installation.md
           - Quick Start: guide/quick-start.md
           - Workflows: guide/workflows.md
           - Configuration: guide/configuration.md
           - Team Collaboration: guide/team-collaboration.md
           - Troubleshooting: guide/troubleshooting.md
       - CLI Commands:
           - reference/cli/index.md
           - Initialization:
               - init: reference/cli/init.md
               - doctor: reference/cli/doctor.md
               - health: reference/cli/health.md
           - Execution:
               - start: reference/cli/start.md
               - resume: reference/cli/resume.md
               - status: reference/cli/status.md
           - Approval:
               - approve: reference/cli/approve.md
               - plan: reference/cli/plan.md
           - Integration:
               - pr create: reference/cli/pr-create.md
               - research: reference/cli/research.md
           - Validation:
               - validate: reference/cli/validate.md
               - rate-limits: reference/cli/rate-limits.md
       - Configuration:
           - reference/config/index.md
           - Schema Reference: reference/config/schema.md
           - Environment Variables: reference/config/environment-variables.md
           - CodeMachine CLI: reference/config/codemachine-cli.md
           - Execution Engines: reference/config/execution-engines.md
           - Enterprise: reference/config/enterprise-deployment.md
       - Playbooks:
           - Initialization: playbooks/initialization.md
           - Approval Workflow: playbooks/approval.md
           - Debugging: playbooks/debugging.md
           - Migration: playbooks/migration-guide.md
           - Disaster Recovery: playbooks/disaster-recovery.md
       - Reference:
           - Architecture: reference/architecture/
           - Platform-Specific: reference/platform-specific.md
           - Performance Tuning: reference/performance-tuning.md
       - Solutions:
           - Common Errors: solutions/common-errors.md
           - Security Incidents: solutions/security.md
     ```

   **Performance Targets (from MkDocs Material research):**
   - [ ] Lighthouse Performance Score: 95+
   - [ ] First Contentful Paint (FCP): <1.5s
   - [ ] Time to Interactive (TTI): <3s
   - [ ] Search Response: <100ms

2. **Build and Test Locally**
   - [ ] Add npm scripts:
     ```json
     {
       "docs:serve": "mkdocs serve",
       "docs:build": "mkdocs build",
       "docs:deploy": "mkdocs gh-deploy"
     }
     ```
   - [ ] Test local server: `npm run docs:serve`
   - [ ] Verify all pages render correctly
   - [ ] Test search functionality
   - [ ] Check code block syntax highlighting
   - [ ] Validate internal links

3. **GitHub Pages Deployment**
   - [ ] Configure GitHub Pages in repo settings
   - [ ] Create `.github/workflows/docs.yml` for auto-deployment:

     ```yaml
     name: Deploy Documentation

     on:
       push:
         branches: [main]
         paths:
           - 'docs/**'
           - 'mkdocs.yml'

     jobs:
       deploy:
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v3
           - uses: actions/setup-python@v4
             with:
               python-version: 3.x
           - run: pip install mkdocs-material
           - run: mkdocs gh-deploy --force
     ```

   - [ ] Test deployment to `gh-pages` branch
   - [ ] Verify site is live at `https://kinginyellow.github.io/codemachine-pipeline/`

**Deliverable:**

- `mkdocs.yml` - Site configuration
- `.github/workflows/docs.yml` - Auto-deployment workflow
- Live documentation site

### Phase 6: README.md Consolidation (0.5 days)

**Tasks:**

1. **Streamline README.md**
   - [ ] Keep: Project overview, value proposition, badges
   - [ ] Keep: Quick start (5-minute version)
   - [ ] Keep: Link to full documentation
   - [ ] Remove: Detailed configuration (move to docs/)
   - [ ] Remove: Long command reference (link to auto-generated)
   - [ ] Add: Prominent link to MkDocs site
   - [ ] Add: Table of contents with jump links

2. **Update Badges**
   - [ ] CI status badge
   - [ ] npm version badge
   - [ ] License badge
   - [ ] Documentation status badge
   - [ ] Node version badge

3. **Cross-Reference Validation**
   - [ ] All README links point to correct docs/ files
   - [ ] No duplicate content between README and docs/
   - [ ] README serves as entry point, not comprehensive guide

**Example README Structure:**

```markdown
# Codemachine Pipeline

[Badges]

AI-powered code pipeline automation for GitHub repositories.

## Quick Start

1. Install: `npm install -g @kinginyellows/codemachine-pipeline`
2. Initialize: `codepipe init`
3. Start: `codepipe start --prompt "Add user authentication"`

[Full installation guide →](https://kinginyellow.github.io/codemachine-pipeline/getting-started/installation/)

## Documentation

📚 **[Read the full documentation](https://kinginyellow.github.io/codemachine-pipeline/)**

- [Getting Started](docs/getting-started/installation.md)
- [Configuration](docs/configuration/overview.md)
- [User Guide](docs/user-guide/workflows.md)
- [Troubleshooting](docs/troubleshooting/common-errors.md)

## Features

[Concise feature list]

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT
```

### Phase 7: Validation & Testing (1 day)

**Tasks:**

1. **Internal Review**
   - [ ] Walk through entire documentation as new user
   - [ ] Follow quick start guide from scratch
   - [ ] Test all command examples (copy-paste from docs)
   - [ ] Verify all code examples execute correctly
   - [ ] Check for broken links (internal and external)

2. **Automated Validation**
   - [ ] Link checker: `markdown-link-check docs/**/*.md`
   - [ ] Spell checker: `mdspell docs/**/*.md`
   - [ ] Code block syntax validation
   - [ ] Version consistency check (package.json version matches docs)

3. **User Testing** (Optional but Recommended)
   - [ ] Have 2-3 external users follow quick start guide
   - [ ] Record confusion points and questions
   - [ ] Iterate based on feedback
   - [ ] Update FAQ with real user questions

4. **Specialized 5-Agent Documentation Review** (Enhanced from docs/solutions/ learnings)

   **Agent Team Composition (Optimized for Docs PRs - Saves ~40% execution time):**

   | Agent                                                        | Priority       | Focus Area                                 | Key Findings                                              |
   | ------------------------------------------------------------ | -------------- | ------------------------------------------ | --------------------------------------------------------- |
   | `pr-review-toolkit:comment-analyzer`                         | P1 (Critical)  | Cross-reference claims against source code | Catches factual errors, phantom features, broken links    |
   | `compound-engineering:review:code-simplicity-reviewer`       | P2 (Important) | Identify redundancy, YAGNI, bloat          | Drives content reduction, eliminates duplication          |
   | `compound-engineering:review:pattern-recognition-specialist` | P3 (Important) | Check formatting consistency               | Catches style drift, table formatting issues              |
   | `compound-engineering:review:architecture-strategist`        | P3 (Important) | Validate overall doc structure             | Confirms hierarchy is sound, progressive disclosure works |
   | `compound-engineering:review:security-sentinel`              | P2 (Important) | Audit for information disclosure           | Verifies no secrets, real tokens, or PII leaked           |

   **⚠️ SKIP these agents for docs-only PRs** (saves ~40% time with zero findings):
   - Rails reviewers (dhh, kieran-rails), data integrity guardian, performance oracle
   - Migration experts, deployment verification agent

   **Prevention Checklist (MANDATORY before merge):**

   **✅ Factual Accuracy (comment-analyzer verifies):**
   - [ ] All feature/engine/command names verified against source code
     - Execution engines match `RepoConfig.ts` (`claude`, `codex`, `openai` ONLY - no `cursor`, `auggie`, `ccr`)
     - CLI commands match `oclif.manifest.json` exactly (all 17 commands present, no phantom commands)
     - Features reference implemented code (no aspirational features)
   - [ ] All relative links resolve to existing files
     - Test: `npm run docs:links:check` (markdown-link-check)
     - Verify: Each link opens in browser without 404
   - [ ] Command table matches oclif manifest
     - Compare: `docs/reference/cli/` ↔ `oclif.manifest.json`
     - Validate: All 17 commands present, no phantom commands
     - Automated: `node scripts/validate-docs-commands.js`
   - [ ] Project structure tree matches actual directory layout
     - Generate: `tree -L 3 -I 'node_modules' > /tmp/actual-structure.txt`
     - Compare: Documented tree ↔ `/tmp/actual-structure.txt`
   - [ ] Code examples reference actual function signatures
     - Test: Copy code examples, verify they execute (`npm run docs:test-examples`)
     - Cross-ref: Function names exist in source files

   **🔒 Security & Safety (security-sentinel verifies):**
   - [ ] Example tokens use placeholder values with clear markers
     - Pattern: `ghp_EXAMPLE_DO_NOT_USE_*`, `lin_api_PLACEHOLDER_*`, `sk-ant-EXAMPLE_*`
     - Automated check: `npm run security:scan-docs` (grep for real token patterns)
     - Forbidden: `ghp_[A-Za-z0-9]{36}`, `sk-ant-[A-Za-z0-9]{48}`, `lin_api_[A-Za-z0-9]{40}`
   - [ ] No real credentials, API keys, or PII in examples
   - [ ] No internal URLs, hostnames, or IP addresses
   - [ ] AI API key cost protection documented
     - Spending cap guidance included
     - Emergency credential rotation procedures present
     - File permissions best practices (chmod 600 .env)

   **📦 Content Quality (code-simplicity-reviewer verifies):**
   - [ ] No redundant sections duplicating docs/README.md or existing docs
     - Cross-check: README quick-links vs docs/ index
     - Remove: Duplicate tables, redundant summaries
   - [ ] No "internal detail" features advertised as user features
   - [ ] YAGNI compliance (no documentation for unimplemented features)
     - Rule: If code doesn't exist, docs shouldn't claim it does
     - Exception: Mark clearly as "Planned for v2.0" if roadmap item

   **🎨 Consistency & Style (pattern-recognition-specialist verifies):**
   - [ ] Table formatting consistent (all use pipe-delimited markdown)
   - [ ] Code block language tags consistent (`bash` not `shell`)
   - [ ] Heading capitalization follows Title Case
   - [ ] Inline code backticks used consistently for commands, file paths, env vars
   - [ ] Task lists use `- [ ]` format consistently

5. **Documentation-Specific Quality Gates** (NEW - Automation)

   **Before PR Approval:**
   - [ ] Run full validation suite:
     ```bash
     npm run docs:validate  # runs all checks below
     ```
   - [ ] Verify command tables programmatically:
     ```bash
     node scripts/validate-docs-commands.js  # compares docs to oclif.manifest.json
     ```
   - [ ] Test all code examples in docs:
     ```bash
     node scripts/test-docs-examples.js      # extracts and runs code blocks
     ```
   - [ ] Check for drift indicators:
     - Engine lists match `src/core/config/RepoConfig.ts` enum
     - Config fields match Zod schema in `RepoConfig.ts`
     - CLI flags match oclif command class definitions
   - [ ] Security scan for real credentials:
     ```bash
     npm run security:scan-docs  # grep for ghp_, sk-ant-, lin_api_ patterns
     ```

   **CI Integration (`.github/workflows/docs-quality.yml`):**

   ```yaml
   name: Documentation Quality Gates
   on:
     pull_request:
       paths:
         - 'docs/**'
         - 'README.md'
         - 'mkdocs.yml'
   jobs:
     validate:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3

         - name: Link Check
           run: npm run docs:links:check

         - name: Command Table Validation
           run: node scripts/validate-docs-commands.js

         - name: Factual Accuracy Check
           run: |
             # Verify engines list (should only be claude, codex, openai)
             ! grep -rE "executionEngine.*(cursor|auggie|ccr|opencode)" docs/

         - name: Security Audit
           run: npm run security:scan-docs

         - name: Code Example Testing
           run: npm run docs:test-examples

         - name: Spell Check
           run: npm run docs:spell:check
   ```

**Deliverable:**

- Validation report with findings
- Updated documentation based on feedback
- Clean PR ready for merge

## Acceptance Criteria

### Functional Requirements

- [ ] **Installation Documentation**
  - [ ] Platform-specific instructions (macOS, Linux, Windows)
  - [ ] Installation verification steps
  - [ ] Troubleshooting common install issues

- [ ] **Setup Documentation**
  - [ ] Repository initialization guide (`codepipe init`)
  - [ ] Configuration file setup
  - [ ] Environment variable configuration
  - [ ] Credential security best practices

- [ ] **Configuration Documentation**
  - [ ] Complete environment variable reference
  - [ ] `.codepipe/config.json` schema documentation
  - [ ] Required vs optional fields clearly marked
  - [ ] CodeMachine CLI resolution (3 paths) documented
  - [ ] Execution engine comparison table
  - [ ] Configuration examples for common scenarios

- [ ] **User Guide**
  - [ ] Core workflows (init → start → approve → resume) with examples
  - [ ] All 17 commands documented with syntax, flags, examples
  - [ ] Advanced usage scenarios (CI/CD integration)
  - [ ] Real-world examples with actual output

- [ ] **Troubleshooting**
  - [ ] Common errors catalog (minimum 20 errors)
  - [ ] Debug mode instructions
  - [ ] FAQ with answers to 10+ common questions

- [ ] **Architecture & Concepts**
  - [ ] High-level architecture diagram
  - [ ] Glossary of key terms
  - [ ] Component interaction diagrams
  - [ ] Data flow diagrams

### Non-Functional Requirements

- [ ] **Searchability**
  - [ ] MkDocs Material search indexes all pages
  - [ ] Keywords optimized for SEO
  - [ ] Table of contents in long documents

- [ ] **Maintainability**
  - [ ] CLI reference auto-generated (`npm run docs:cli`)
  - [ ] Schema reference auto-generated (if applicable)
  - [ ] CI validates documentation on every commit
  - [ ] Clear ownership of each doc section

- [ ] **Accessibility**
  - [ ] Progressive disclosure (quick start → deep dives)
  - [ ] Code examples copy-to-clipboard
  - [ ] Clear heading hierarchy (H1 → H2 → H3)
  - [ ] Alt text for diagrams

- [ ] **Consistency**
  - [ ] Single source of truth (no duplicate content)
  - [ ] Consistent terminology across all docs
  - [ ] Consistent code example formatting
  - [ ] Consistent table formatting

### Quality Gates

- [ ] **Link Validation**
  - All internal links resolve correctly
  - All external links are valid (not 404)
  - No broken cross-references

- [ ] **Content Accuracy**
  - All command examples tested and work
  - All configuration examples valid
  - No phantom features (docs-as-code tense rule)
  - Version compatibility clearly stated

- [ ] **Review Approval**
  - 5-agent specialized review completed
  - Prevention checklist passed
  - No P0 issues remaining

- [ ] **Deployment**
  - MkDocs site builds without errors
  - GitHub Pages deployment successful
  - Site accessible at expected URL

## Success Metrics

**Qualitative:**

- New users can complete first workflow in <15 minutes
- Support questions decrease by 50%+ after documentation launch
- No confusion about which installation method to use
- Configuration errors are self-service (users fix without asking)

**Quantitative:**

- 100% of commands have documentation with examples
- 100% of configuration fields documented
- 20+ common errors in troubleshooting catalog
- 10+ FAQ entries
- Zero broken links in documentation
- <5 minute documentation site load time

**User Feedback:**

- "I didn't need to ask any questions during setup"
- "Error messages now link to solutions in docs"
- "Configuration validation errors are clear and actionable"

## Dependencies & Prerequisites

**Before Starting:**

- [ ] Complete Phase 1 (answer all 6 critical questions)
- [ ] Package.json `engines` field specifies Node version
- [ ] oclif.manifest.json exists and is up-to-date
- [ ] CLI commands have accurate descriptions and examples

**External Dependencies:**

- MkDocs Material (Python package)
- GitHub Pages (deployment target)
- markdown-link-check (validation)
- mdspell (validation)

**Internal Dependencies:**

- Existing documentation in docs/ (audit source)
- CONTRIBUTING.md (reference for doc contribution process)
- ADRs (reference for architectural decisions)
- Solution docs (reference for troubleshooting patterns)

## Risk Analysis & Mitigation

### High Risk

**Risk: Critical questions remain unanswered**

- **Impact**: Documentation contains incorrect information, user confusion
- **Probability**: Medium (some answers may require code archaeology)
- **Mitigation**:
  - Allocate dedicated time for code reading in Phase 1
  - Create ADR for each decision
  - Validate assumptions via unit tests if possible
  - Mark uncertain areas with "TODO: Verify" during draft

**Risk: Documentation drift (gets out of sync with code)**

- **Impact**: Users follow outdated instructions, errors increase
- **Probability**: High (natural drift over time)
- **Mitigation**:
  - Maximize auto-generation (CLI reference, schema reference)
  - CI validation on every commit
  - Link checking in PR reviews
  - Quarterly documentation audit scheduled

### Medium Risk

**Risk: Scope creep (documentation project expands endlessly)**

- **Impact**: Never ships, indefinite timeline
- **Probability**: Medium (easy to keep adding "just one more thing")
- **Mitigation**:
  - Strict phased approach with clear deliverables
  - "Must-have" vs "should-have" vs "nice-to-have" prioritization
  - Ship minimum viable docs first, iterate based on user feedback
  - Time-box each phase

**Risk: User testing reveals major gaps**

- **Impact**: Must redo substantial sections, timeline slips
- **Probability**: Low (SpecFlow analysis identified 34 gaps upfront)
- **Mitigation**:
  - Address SpecFlow gaps proactively during creation
  - User testing early in Phase 7 (not at the end)
  - Incremental fixes based on feedback
  - Allocate buffer time for iteration

### Low Risk

**Risk: MkDocs Material theme updates break site**

- **Impact**: Site doesn't render correctly after dependency update
- **Probability**: Low (stable theme, semantic versioning)
- **Mitigation**:
  - Pin mkdocs-material version in requirements.txt
  - Test theme upgrades in staging before production
  - Monitor GitHub releases for breaking changes

**Risk: Auto-generated docs script breaks**

- **Impact**: CI fails, can't regenerate CLI reference
- **Probability**: Low (stable oclif manifest format)
- **Mitigation**:
  - Test auto-generation script with sample manifests
  - Version control the generation script
  - Fallback to manual editing if generation fails

## Resource Requirements

**Time Estimate (1 person, full-time) - REVISED:**

- Phase 0: Architecture foundation & corrections (2 days) **NEW**
- Phase 1: Critical questions & requirements (2 days)
- Phase 2: Content audit & structure (1.5 days) - includes drift prevention setup
- Phase 3: Content creation (7.5 days) - includes 10 new documentation files
  - 3.1: Getting Started (1 day)
  - 3.2: Configuration (1.5 days) - includes comprehensive security section
  - 3.3: User Guide (1.5 days)
  - 3.4: Troubleshooting (1 day)
  - 3.5: Architecture & Concepts (1 day)
  - 3.6: **NEW** - Team collaboration, enterprise, disaster recovery, migration, performance tuning (1.5 days)
- Phase 4: Auto-generated documentation (1 day)
- Phase 5: MkDocs Material setup (1.5 days) - production-ready configuration
- Phase 6: README.md consolidation (0.5 days)
- Phase 7: Validation & testing (1.5 days) - includes automation scripts
- **Total: ~17.5 days (~3.5 weeks)**

**Comparison to Original Estimate:**

- Original: 11.5 days (2.5 weeks)
- Enhanced: 17.5 days (3.5 weeks)
- **Increase: +6 days** due to:
  - Architecture restructuring (+2 days)
  - Additional documentation files (+1.5 days)
  - Security enhancements (+1 day)
  - Automation scripts (+0.5 days)

**Skills Required:**

- Technical writing (clear, concise, user-focused)
- Code reading (TypeScript, Node.js, oclif)
- Markdown proficiency
- MkDocs/Python basics
- GitHub Actions (for auto-deployment)
- User empathy (anticipating confusion points)

**Tools Needed:**

- Text editor (VS Code recommended)
- MkDocs Material (Python package)
- markdown-link-check, mdspell (validation)
- Browser (for testing rendered docs)
- Git, GitHub (version control, Pages deployment)

## Future Considerations

**Post-Launch Enhancements:**

- [ ] Video tutorials for visual learners
- [ ] Interactive playground (try commands in browser)
- [ ] Multi-version documentation (v1.0, v1.1, v2.0)
- [ ] Localization (i18n) for non-English users
- [ ] Documentation API (programmatic access to docs)
- [ ] Community contributions guide (how to improve docs)

**Extensibility:**

- [ ] Plugin documentation framework (if plugins are added)
- [ ] Third-party integration guides (other CI systems, issue trackers)
- [ ] Performance tuning guide (optimize pipeline execution)
- [ ] Security hardening guide (production deployment best practices)

**Analytics & Feedback:**

- [ ] Add "Was this helpful?" buttons to each page
- [ ] Google Analytics integration (track most-visited pages)
- [ ] Feedback form for documentation improvement requests
- [ ] Regular user surveys (quarterly)

## Documentation Plan

**Maintenance Strategy:**

- **Weekly**: Monitor GitHub issues for documentation-related questions
- **Monthly**: Review analytics to identify high-traffic pages needing improvement
- **Quarterly**: Full documentation audit (links, accuracy, completeness)
- **Per-Release**: Update documentation for breaking changes, new features

**Ownership:**

- **Primary Maintainer**: [Assign owner]
- **Reviewers**: Use 5-agent specialized review team for PRs
- **Contributors**: Community PRs welcome (see CONTRIBUTING.md)

**Review Process:**

1. Documentation PR created
2. Automated checks run (link checker, spell checker, CI)
3. 5-agent specialized review (comment-analyzer, code-simplicity-reviewer, etc.)
4. Manual review by primary maintainer
5. Merge to main → auto-deploy to GitHub Pages

## References & Research

### Internal References

**Configuration & Validation:**

- `src/core/config/RepoConfig.ts:1-100` - Zod schema definitions
- `src/validation/` - Validation helpers (validateOrThrow, validateOrResult)
- `config/schemas/repo_config.schema.json` - JSON Schema

**CLI Commands:**

- `src/cli/commands/` - All 17 command implementations
- `oclif.manifest.json` - Auto-generated command manifest
- Auto-generation: `npm run docs:cli` → `docs/ops/cli-reference.md`

**CodeMachine Integration:**

- `src/adapters/codemachine/binaryResolver.ts` - 3-path resolution algorithm
- `src/adapters/codemachine/CodeMachineCLIAdapter.ts` - Adapter implementation
- `docs/adr/adr-008-codemachine-cli-integration.md` - ADR-8

**Workflows:**

- `src/workflows/` - 48 workflow files
- `docs/architecture/execution_flow.md` - Pipeline phases
- `src/persistence/runDirectoryManager.ts` - Run directory structure

**Documentation Patterns:**

- `docs/solutions/code-review/reviewing-documentation-prs.md` - 5-agent review pattern
- `docs/solutions/integration-issues/codemachine-cli-strategy-prerequisite-validation.md` - CLI resolution documentation requirements

### External References

**Framework Documentation:**

- [oclif Documentation](https://oclif.io/) - CLI framework
- [Zod Documentation](https://zod.dev/) - Schema validation
- [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) - Documentation theme

**Best Practices:**

- [Write the Docs](https://www.writethedocs.org/) - Documentation community
- [Google Developer Documentation Style Guide](https://developers.google.com/style)
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/)

**Tools:**

- [markdown-link-check](https://github.com/tcort/markdown-link-check) - Link validation
- [markdownlint](https://github.com/DavidAnson/markdownlint) - Markdown linting
- [Mike](https://github.com/jimporter/mike) - MkDocs versioning (future)

### Related Work

**Previous Documentation Work:**

- PR #464 - README streamlining (917 → 244 lines)
- Issue #211 - CLI reference auto-generation (Cycle 8 deferred)
- Issue #212 - Architecture diagram integration (Cycle 8 deferred)
- Issue #215 - API reference documentation (Cycle 8 deferred)
- Issue #424 - Documentation tooling decisions (Cycle 8 prerequisite)

**Brainstorm Context:**

- `docs/brainstorms/2026-02-14-v1-release-readiness-brainstorm.md` - Step 4: Documentation Audit

**Milestone:**

- Cycle 8: Documentation Tooling & Type Safety

---

## Implementation Checklist

### Pre-Implementation (Phase 0)

- [ ] Create feature branch: `gt create -m "docs: comprehensive documentation suite"`
- [ ] Set up development environment:

  ```bash
  # Python environment for MkDocs
  python -m venv venv
  source venv/bin/activate  # or `venv\Scripts\activate` on Windows
  pip install mkdocs-material mkdocstrings mkdocs-git-revision-date-localized-plugin \
              mkdocs-minify-plugin mkdocs-redirects mike

  # Node.js tooling
  npm install --save-dev markdown-link-check markdownlint-cli
  ```

- [ ] Review this plan with stakeholders
- [ ] Get approval to proceed

### Phase 0: Architecture Foundation (2 days)

- [ ] Correct all factual errors identified in Critical Corrections section
- [ ] Restructure docs/ directory: 16 → 7 top-level directories
- [ ] Create file migration map (existing → new locations)
- [ ] Archive transient docs (brainstorms, plans, research) to docs/archive/
- [ ] Set up CI validation pipeline (docs-quality.yml)
- [ ] Create validation scripts (validate-docs-commands.js, test-docs-examples.js)

### Phase 1: Critical Questions (2 days)

- [ ] Answer all 6 critical questions (Node version, config discovery, etc.)
- [ ] Document decisions in ADR-009
- [ ] Validate assumptions via code reading
- [ ] Create decision log

### Phase 2: Content Audit (1 day)

- [ ] Audit README.md
- [ ] Inventory docs/ directory (75+ files)
- [ ] Identify content to preserve, archive, rewrite
- [ ] Create archive branch if needed
- [ ] Draft mkdocs.yml structure

### Phase 3: Content Creation (5 days)

- [ ] 3.1: Getting Started (1 day)
- [ ] 3.2: Configuration (1.5 days)
- [ ] 3.3: User Guide (1.5 days)
- [ ] 3.4: Troubleshooting (1 day)
- [ ] 3.5: Architecture & Concepts (1 day)

### Phase 4: Auto-Generated Docs (1 day)

- [ ] Verify CLI reference auto-generation
- [ ] Create schema reference generation script (if needed)
- [ ] Generate API reference (if applicable)

### Phase 5: MkDocs Setup (1 day)

- [ ] Install and configure MkDocs Material
- [ ] Create mkdocs.yml
- [ ] Test local build
- [ ] Set up GitHub Pages deployment

### Phase 6: README Consolidation (0.5 days)

- [ ] Streamline README.md
- [ ] Update badges
- [ ] Validate cross-references

### Phase 7: Validation (1 day)

- [ ] Internal review and testing
- [ ] Automated validation (links, spelling, syntax)
- [ ] User testing (optional but recommended)
- [ ] 5-agent PR review

### Post-Implementation

- [ ] Submit PR: `gt submit --no-interactive --publish`
- [ ] Address review feedback
- [ ] Merge to main
- [ ] Verify GitHub Pages deployment
- [ ] Announce documentation launch
- [ ] Monitor for user feedback

---

---

## Research Insights from Deepening

### From Learnings (docs/solutions/)

**1. Reviewing Documentation PRs (5-Agent Pattern)**

- Use specialized 5-agent team for docs PRs, not full 8-12 agent suite
- comment-analyzer is MOST VALUABLE - catches factual drift (e.g., phantom engines)
- Prevention checklist prevents shipping incorrect documentation
- Example: PR #464 would have shipped 3 non-existent engines without targeted review

**2. CodeMachine CLI Resolution Strategy**

- Binary resolution has 3 paths with strict priority: `CODEMACHINE_BIN_PATH` → optionalDeps → PATH
- Security validation prevents command injection (allowlist-based path validation)
- Strategy-aware prerequisite validation (warning vs error based on available strategies)
- Environment-specific deployment scenarios require different resolution paths

**3. Wave-Based Parallel Execution**

- Phase 3 (Content Creation) subsections can be parallelized in waves
- Dependencies: Phase 3.1 → Phase 3.2 (config docs need prerequisites reference)
- Opportunity: 3.3 (User Guide), 3.4 (Troubleshooting), 3.5 (Architecture) can run in parallel (saves 2 days)

### From Best Practices Research

**4. MkDocs Material Production Configuration**

- **Essential plugins**: git-revision-date-localized, minify, redirects, meta, mike (versioning)
- **Performance targets**: Lighthouse 95+, FCP <1.5s, TTI <3s, search <100ms
- **Accessibility**: WCAG 2.1 AA compliance built-in, some AAA gaps remain
- **Navigation**: Use tabs for large sites (30+ pages), sticky tabs, instant loading
- **SEO**: Requires `site_url` for many plugins, meta plugin for per-page optimization

**5. oclif CLI Documentation Standards**

- **Auto-generation**: `oclif readme` injects docs into README via HTML comment markers
- **Examples format**: Support both simple strings and objects with descriptions
- **Template variables**: Always use `<%= config.bin %>` and `<%= command.id %>`
- **Manifest**: `oclif manifest` in postbuild generates source of truth
- **Best practice**: Lead with examples (users scan for these first)

**6. Technical Writing for Developer Tools**

- **Voice**: Active voice, second person, action-oriented ("Run", "Create", "Verify")
- **Avoid**: "simply", "just", "easily" (patronizing), "kill" (use "stop", "terminate")
- **Progressive disclosure**: Quick start (<5 min) → Guide (5-15 min) → Reference (on-demand)
- **Error documentation**: Problem-Cause-Solution (P-C-S) pattern
- **Code examples**: Must pass copy-paste test (runnable, secure, complete, realistic)
- **FAQ organization**: Group by category, link to detailed guides, review quarterly

### From Review Agents

**7. Factual Accuracy Corrections** (comment-analyzer)

- **CRITICAL**: `CODEMACHINE_CLI_PATH` does not exist → use `CODEMACHINE_BIN_PATH`
- **CRITICAL**: `CODEMACHINE_LOG_LEVEL` does not exist → remove or find actual debug method
- Missing `CODEPIPE_*` family of override environment variables (9 variables)
- Config schema is nested (`execution.default_engine`), not flat (`executionEngine`)
- Execution engine comparison table has aspirational data without source

**8. Simplification Opportunities** (code-simplicity-reviewer)

- **Over-engineering**: MkDocs + GitHub Pages can be deferred to v1.1 (GitHub markdown sufficient for MVP)
- **Premature optimization**: Auto-generation scripts can be deferred (hand-write first, automate if maintenance burden grows)
- **Scope creep**: Architecture docs are developer-focused, not user-focused (defer to "Developer Guide")
- **YAGNI violations**: "Future Considerations" section contains 8 features nobody requested (remove)
- **Recommendation**: Simplify to 6-day MVP (was 11.5 days) by deferring MkDocs, auto-generation, architecture docs

**9. Pattern Consistency** (pattern-recognition-specialist)

- 95% consistency overall
- Minor variations in task list formatting (numbered sections vs. checkboxes)
- Table dash lengths vary (cosmetic, semantically identical)
- **Recommendation**: Add style guide section to establish conventions

**10. Information Architecture** (architecture-strategist)

- **Directory consolidation**: Reduce from 16 → 7 top-level directories (guide, reference, playbooks, adr, solutions, diagrams, templates)
- **Progressive disclosure**: Establish clear path: README → Guide → Reference → Playbooks
- **DRY violations**: Configuration docs in 3 places, CLI commands in 2 places, troubleshooting in 3 places
- **Navigation**: Flatten command docs (2 levels max), group by category, use descriptive titles
- **Recommendation**: Single source of truth + cross-references

**11. Security Gaps** (security-sentinel)

- **7 critical gaps**: Real token examples, insufficient credential security, missing security troubleshooting, no AI API key cost protection, no binary integrity verification, insecure CI/CD examples, no SECURITY.md
- **Required additions**: Comprehensive credential security section, emergency response procedures, AI API cost protection, SECURITY.md with responsible disclosure policy
- **Estimated effort**: +1.5 days for security enhancements

**12. Additional User Flows** (spec-flow-analyzer - second pass)

- **31 NEW flows identified**: Team collaboration (multi-user locking), enterprise deployment (org-wide config), disaster recovery (queue corruption, system crashes), migration paths (pre-v1.0 → v1.0+), performance tuning (large repos), i18n, a11y, advanced error recovery
- **39 NEW questions**: Concurrent execution, approval delegation, config inheritance, queue backups, credential rotation, platform quirks, compliance auditing
- **Impact**: +1.5 days for additional documentation files

### Key Takeaways for Implementation

1. **Correct factual errors BEFORE content creation** (Phase 0 mandatory)
2. **Prioritize security documentation** (cost protection, emergency response)
3. **Simplify MVP scope** (defer MkDocs, architecture docs, auto-generation to v1.1)
4. **Use single source of truth** (auto-generate where possible, consolidate where not)
5. **Establish CI validation** (prevent drift from day 1)
6. **Focus on team collaboration docs** (enterprise adoption blocker)
7. **Document disaster recovery** (queue corruption is critical user pain point)

---

**Plan created:** 2026-02-15
**Deepened:** 2026-02-15
**Estimated completion:** 2026-03-10 (~3.5 weeks)
**Priority:** High (Cycle 8 milestone)
