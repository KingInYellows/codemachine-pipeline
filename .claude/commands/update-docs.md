---
name: update-docs
description: Full documentation update, organization, and generation for the project
argument-hint: "[scope: all|readme|user|dev|tech|diagrams|api] [--audit-only]"
---

# Documentation Update and Organization

Comprehensive documentation update workflow covering README, user-facing docs, developer docs, technical docs, diagrams, and API documentation.

## Arguments

- **scope**: What to update (default: `all`)
  - `all` - Full documentation audit and update
  - `readme` - README.md only
  - `user` - User-facing documentation (quickstart, guides, tutorials)
  - `dev` - Developer documentation (contributing, architecture, codebase)
  - `tech` - Technical documentation (requirements, specifications, schemas)
  - `diagrams` - Architecture and flow diagrams
  - `api` - API reference and CLI documentation
- **--audit-only**: Only audit and report issues without making changes

## Workflow

### Phase 1: Documentation Audit

1. **Inventory Current Documentation**
   - Scan all `.md` files in the project (excluding node_modules)
   - Catalog existing docs by category:
     - `docs/` - Main documentation directory
     - `README.md` - Project entry point
     - `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` - Standard files
     - `.codemachine/artifacts/` - Generated artifacts
     - `examples/` - Example configurations and usage

2. **Analyze Documentation Quality**
   For each document, check:
   - [ ] Has proper frontmatter/title structure
   - [ ] Internal links are valid (no broken links)
   - [ ] Code examples are up-to-date and work
   - [ ] No TODOs or placeholder content
   - [ ] Consistent formatting and style
   - [ ] Appropriate for its audience (user vs developer)

3. **Cross-Reference with Codebase**
   - Compare CLI commands documented vs implemented in `src/cli/commands/`
   - Verify API endpoints match documentation
   - Check configuration options match JSON schemas
   - Ensure examples use current syntax

4. **Generate Audit Report**
   Create a summary of:
   - Missing documentation
   - Outdated documentation
   - Broken links
   - Inconsistencies between docs and code
   - Recommended improvements

### Phase 2: README.md Update

1. **Verify Essential Sections**
   - [ ] Project title and description
   - [ ] Badges (build status, npm version, license)
   - [ ] Features/highlights
   - [ ] Installation instructions (npm, source, Docker)
   - [ ] Quick start guide
   - [ ] Command reference
   - [ ] Configuration overview
   - [ ] Project structure
   - [ ] Development setup
   - [ ] Testing instructions
   - [ ] Contributing guidelines
   - [ ] License
   - [ ] Support/contact info

2. **Update Command Reference**
   - Parse `src/cli/commands/*.ts` for command implementations
   - Extract options, descriptions, examples from code/decorators
   - Ensure README matches actual CLI behavior
   - Add planned/upcoming commands with clear (Planned) markers

3. **Sync Configuration Documentation**
   - Read `config/schemas/repo_config.schema.json`
   - Update configuration section to match schema
   - Ensure example config is valid against schema

### Phase 3: User Documentation

Target audience: End users who want to use the CLI

1. **Structure** (`docs/guides/` or `docs/user/`)
   ```
   docs/
   ├── getting-started.md       # First-time setup
   ├── quickstart.md            # 5-minute intro
   ├── guides/
   │   ├── installation.md
   │   ├── configuration.md
   │   ├── github-integration.md
   │   ├── linear-integration.md
   │   └── troubleshooting.md
   └── tutorials/
       ├── first-feature.md
       └── ci-cd-integration.md
   ```

2. **Content Requirements**
   - Clear, jargon-free language
   - Step-by-step instructions with screenshots/terminal output
   - Common use cases and examples
   - FAQ and troubleshooting
   - Environment variable reference

### Phase 4: Developer Documentation

Target audience: Contributors and maintainers

1. **Structure** (`docs/dev/` or `CONTRIBUTING.md`)
   ```
   docs/
   ├── architecture/
   │   ├── component_index.md   # Module overview
   │   ├── data-flow.md         # How data moves through system
   │   └── decisions/           # ADRs (Architecture Decision Records)
   ├── dev/
   │   ├── setup.md             # Local development setup
   │   ├── testing.md           # Testing strategy and commands
   │   ├── debugging.md         # Debug tips and tools
   │   └── releasing.md         # Release process
   └── CONTRIBUTING.md          # Contribution guidelines
   ```

2. **Content Requirements**
   - Architecture overview with diagrams
   - Module responsibilities and dependencies
   - Testing strategy (unit, integration, e2e, smoke)
   - Code style and linting rules
   - PR and review process
   - Release workflow

### Phase 5: Technical Documentation

Target audience: Deep technical reference

1. **Structure** (`docs/requirements/` and `docs/ops/`)
   - Already well-organized in this project
   - Ensure index/navigation exists

2. **Create/Update Index Files**
   - `docs/README.md` - Documentation hub with links to all sections
   - `docs/requirements/README.md` - Requirements index
   - `docs/ops/README.md` - Operations index

3. **Schema Documentation**
   - Generate docs from JSON schemas
   - Document all configuration options
   - Provide examples for each config section

### Phase 6: Diagrams

1. **Inventory Existing Diagrams**
   - Check `docs/diagrams/` for `.mmd` (Mermaid) and `.puml` (PlantUML)
   - Verify diagrams match current architecture

2. **Required Diagrams**
   - [ ] Component/Architecture Overview (high-level)
   - [ ] Execution Flow (state machine)
   - [ ] Data Model (entities and relationships)
   - [ ] Sequence Diagrams (key flows)
   - [ ] Deployment/Infrastructure (if applicable)

3. **Diagram Standards**
   - Use Mermaid for GitHub-native rendering
   - Include both source (`.mmd`) and rendered (`.png/.svg`) versions
   - Add alt-text and captions

### Phase 7: API/CLI Reference

1. **CLI Command Reference**
   - Generate from source or maintain manually
   - Include all commands, options, examples, exit codes
   - Document environment variables

2. **Configuration Schema Reference**
   - Generate from JSON Schema
   - Document all fields with types and defaults
   - Provide migration guides for schema changes

### Phase 8: Documentation Infrastructure

1. **Navigation and Discovery**
   - Create `docs/README.md` as documentation index
   - Add navigation links between related docs
   - Consider adding a sidebar/table of contents

2. **Maintenance Automation**
   - Add link checker to CI (e.g., `markdown-link-check`)
   - Add spell checker (e.g., `cspell`)
   - Consider doc generation from code comments

## Execution Steps

```markdown
1. Run audit
   - Glob for all *.md files
   - Check each file for issues
   - Generate audit report

2. Based on scope, update documentation:
   - readme: Update README.md
   - user: Create/update user guides
   - dev: Create/update developer docs
   - tech: Organize technical docs
   - diagrams: Review and update diagrams
   - api: Generate CLI/API reference
   - all: Do everything above

3. Verify changes
   - Run markdown linting
   - Check for broken links
   - Validate code examples if possible

4. Summarize changes
   - List files created/modified
   - Highlight key improvements
   - Note any remaining TODOs
```

## Success Criteria

- [ ] All documentation is current with codebase
- [ ] No broken internal links
- [ ] README accurately describes all implemented features
- [ ] Clear separation between user/dev/technical docs
- [ ] Diagrams reflect current architecture
- [ ] Documentation index exists at `docs/README.md`
- [ ] Code examples are valid and work
- [ ] Consistent formatting across all docs

## Tools to Use

- **Glob**: Find all markdown files
- **Read**: Analyze existing documentation
- **Grep**: Find references and patterns
- **Edit/Write**: Update documentation
- **Bash**: Run linters, validate links
- **Task (Explore agent)**: Understand codebase structure
- **WebSearch**: Research documentation best practices if needed

## Output

Provide a summary including:
1. Documentation audit results
2. Files created or modified
3. Remaining issues or recommendations
4. Suggested next steps for ongoing maintenance
