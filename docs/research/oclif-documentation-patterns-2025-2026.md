---
title: oclif CLI Documentation Patterns Research (2025-2026)
type: research
date: 2026-02-15
tags: [oclif, documentation, cli, best-practices]
status: complete
---

# oclif CLI Documentation Patterns Research (2025-2026)

## Executive Summary

This research document provides comprehensive findings on oclif v4 documentation best practices for 2025-2026, with specific recommendations for enhancing codemachine-pipeline's CLI documentation suite (Phase 4: Auto-Generated Documentation & Phase 3.3: User Guide - Commands).

**Key Findings:**

- oclif v4.0+ (released June 2024, latest: v4.5.1 as of Jan 2025) provides mature auto-documentation features
- The framework separates command metadata (description, examples, flags) from implementation
- Auto-generation via `oclif manifest` creates `oclif.manifest.json` with complete command metadata
- Industry leaders (Heroku CLI, Salesforce CLI) demonstrate documentation patterns at scale

**Current codemachine-pipeline Status:**

- ✅ Already uses oclif v4.0.30
- ✅ Custom `generate_cli_reference.js` script generates `docs/ops/cli-reference.md` from manifest
- ✅ Manifest generation automated in `postbuild` hook
- ⚠️ Missing: Examples in some commands, rich flag descriptions, error message conventions
- ⚠️ Missing: MkDocs integration, per-command deep-dive docs

---

## 1. oclif v4 Documentation Features

### 1.1 Core Framework Capabilities

**Source:** [oclif Features Documentation](https://oclif.io/docs/features/)

oclif v4 provides:

1. **Automatic Help Text** - Every command gets `--help` flag automatically
   - Displays flag options and argument information
   - Formatted consistently across all commands
   - No manual documentation in code required beyond metadata

2. **Manifest-Based Documentation** - `oclif.manifest.json` centralizes command metadata
   - Generated during build process
   - Contains: description, examples, flags, args, aliases
   - Single source of truth for CLI reference generation

3. **README Auto-Generation** - `oclif readme` command
   - Reads manifest and generates command documentation
   - Injects into README.md between `<!-- commands -->` tags
   - Supports multi-page docs with `--multi` flag for topic-based CLIs

4. **Performance Optimization** - Manifest enables lazy loading
   - CLI doesn't load all command files on startup
   - Improves cold-start performance significantly
   - Critical for large CLIs (100+ commands like Salesforce CLI)

**Relevance to codemachine-pipeline:**

- Current custom script (`generate_cli_reference.js`) duplicates oclif's built-in `readme` command functionality
- Consider: Migrate to `oclif readme --multi` + post-processing for custom format
- Keep: Custom script provides more control over output format for MkDocs integration

---

## 2. Command Documentation Best Practices

### 2.1 Description and Summary Fields

**Source:** [oclif Command Flags Documentation](https://oclif.io/docs/flags/)

oclif v4 supports two levels of documentation:

- **`summary`** (new in v4): Brief one-liner for command/flag purpose
- **`description`**: In-depth overview, can be multi-paragraph

**Best Practice:**

```typescript
export default class Start extends Command {
  static summary = 'Start a new feature development pipeline';
  static description = `
    Initiates a new feature development workflow from a prompt, Linear issue, or spec file.

    The command performs context aggregation, research detection, PRD authoring, and
    task execution in a single pipeline. Each stage has configurable approval gates.

    Execution can be paused before code generation using --skip-execution for PRD review.
  `;
  // ...
}
```

**Current codemachine-pipeline Pattern:**

```typescript
// Current: Uses only description
static description = 'Start a new feature development pipeline'

// Recommendation: Add summary for concise help, expand description
static summary = 'Start a new feature development pipeline'
static description = `
  Initiates a feature development workflow from a prompt, Linear issue, or spec file.

  The pipeline includes:
  - Context aggregation (gather relevant codebase files)
  - Research detection (identify unknowns and create research tasks)
  - PRD authoring (generate Product Requirements Document)
  - Task execution (run code generation and validation loops)

  Use --skip-execution to review the generated PRD before code execution.
  Use --dry-run to preview the execution plan without making changes.
`
```

### 2.2 Flag Documentation Standards

**Source:** [oclif Command Flags Documentation](https://oclif.io/docs/flags/)

**Flag Properties (oclif v4):**

| Property      | Purpose                      | Example                                                                        |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `summary`     | Brief flag description       | `'Grant approval for this gate'`                                               |
| `description` | Detailed flag explanation    | `'Approve the PRD and proceed to code execution. Requires --signer identity.'` |
| `helpLabel`   | Custom display in help       | `'[-a] --approve'` (default format)                                            |
| `helpGroup`   | Group flags in help sections | `'APPROVAL OPTIONS'`                                                           |
| `char`        | Short flag version           | `'a'` for `-a`                                                                 |
| `aliases`     | Alternative flag names       | `['confirm', 'yes']`                                                           |
| `deprecated`  | Mark flag as deprecated      | `{ message: 'Use --approve instead', version: '2.0.0' }`                       |
| `hidden`      | Hide from help output        | `true` (for internal/experimental flags)                                       |

**Best Practice Example:**

```typescript
static flags = {
  approve: Flags.boolean({
    char: 'a',
    summary: 'Grant approval for this gate',
    description: 'Approve the PRD and proceed to code execution. Mutually exclusive with --deny. Requires --signer identity.',
    helpGroup: 'APPROVAL OPTIONS',
  }),
  signer: Flags.string({
    char: 's',
    summary: 'Signer identity (email or username)',
    description: 'Identity of the approver. Used for audit trail and approval record. Must be a valid email or username.',
    required: true,
    helpGroup: 'APPROVAL OPTIONS',
  }),
  'dry-run': Flags.boolean({
    summary: 'Preview changes without execution',
    description: 'Simulate the approval workflow without modifying approval state. Outputs the approval decision that would be made.',
    helpGroup: 'EXECUTION OPTIONS',
  }),
}
```

**Current codemachine-pipeline Pattern:**

- ✅ Uses `char` for common flags
- ✅ Uses `description` for all flags
- ⚠️ Missing: `summary` field (new in v4, improves help readability)
- ⚠️ Missing: `helpGroup` for logical flag grouping
- ⚠️ Missing: `deprecated` metadata for evolving flags

**Recommendation:**

1. Add `summary` to all flags for concise help text
2. Use `helpGroup` to organize flags by concern (e.g., "INPUT OPTIONS", "OUTPUT OPTIONS", "EXECUTION OPTIONS")
3. Add `deprecated` metadata for flags planned for removal (e.g., if transitioning API)

### 2.3 Command Examples

**Source:** [oclif Manifest Documentation](https://github.com/oclif/oclif/blob/main/docs/manifest.md)

**Best Practices:**

1. **Progressive Complexity** - Order examples from simple to advanced
2. **Real-World Scenarios** - Use realistic values, not placeholders
3. **Template Substitution** - Use `<%= config.bin %>` and `<%= command.id %>` for portability
4. **Comprehensive Coverage** - Include all major flag combinations

**Example Patterns:**

```typescript
static examples = [
  // 1. Simplest usage (no flags)
  '<%= config.bin %> <%= command.id %>',

  // 2. Common flag combinations
  '<%= config.bin %> <%= command.id %> --force',
  '<%= config.bin %> <%= command.id %> --validate-only',

  // 3. Real-world scenarios
  {
    description: 'Initialize with GitHub and Linear integration',
    command: '<%= config.bin %> <%= command.id %> --yes',
  },

  // 4. Advanced usage with multiple flags
  {
    description: 'Dry-run validation with JSON output',
    command: '<%= config.bin %> <%= command.id %> --dry-run --json',
  },

  // 5. Edge cases or important combinations
  {
    description: 'Force re-initialization and skip confirmations',
    command: '<%= config.bin %> <%= command.id %> --force --yes',
  },
]
```

**Current codemachine-pipeline Pattern:**

Looking at `src/cli/commands/init.ts`:

```typescript
static examples = [
  '<%= config.bin %> <%= command.id %>',
  '<%= config.bin %> <%= command.id %> --force',
  '<%= config.bin %> <%= command.id %> --validate-only',
  '<%= config.bin %> <%= command.id %> --dry-run --json',
  '<%= config.bin %> <%= command.id %> --yes',
];
```

**Assessment:**

- ✅ Good coverage of flag combinations
- ✅ Uses template substitution correctly
- ⚠️ Missing: Descriptions for each example (why/when to use)
- ⚠️ Missing: Examples with arguments (for commands that take args)

**Recommendation:**

```typescript
static examples = [
  {
    description: 'Initialize in current repository (interactive)',
    command: '<%= config.bin %> <%= command.id %>',
  },
  {
    description: 'Force re-initialization (overwrites existing config)',
    command: '<%= config.bin %> <%= command.id %> --force',
  },
  {
    description: 'Validate existing config without creating files',
    command: '<%= config.bin %> <%= command.id %> --validate-only',
  },
  {
    description: 'Preview config generation without file changes',
    command: '<%= config.bin %> <%= command.id %> --dry-run --json',
  },
  {
    description: 'Non-interactive initialization (CI/CD workflows)',
    command: '<%= config.bin %> <%= command.id %> --yes',
  },
];
```

**Warnings from `generate_cli_reference.js`:**

```javascript
// Line 173: Warns if command has no examples
if (cmd.examples && cmd.examples.length > 0) {
  // render examples
} else {
  process.stderr.write(`Warning: Command "${cmd.id}" has no examples.\n`);
}
```

**Action Items:**

1. Audit all 17 commands for missing examples
2. Add example descriptions for context
3. Include argument-based examples for commands with args (e.g., `approve GATE`)

---

## 3. Auto-Generated Documentation Workflows

### 3.1 Built-in `oclif readme` Command

**Source:** [oclif README Generation Docs](https://github.com/oclif/oclif/blob/main/docs/readme.md)

**Command:**

```bash
oclif readme [OPTIONS]
```

**Key Options:**

| Flag                    | Description                                   | Default     |
| ----------------------- | --------------------------------------------- | ----------- |
| `--output-dir`          | Output directory for docs                     | `docs`      |
| `--readme-path`         | README file path                              | `README.md` |
| `--dry-run`             | Print generated README without modifying      | -           |
| `--multi`               | Create separate markdown pages for each topic | Single file |
| `--nested-topics-depth` | Max topic nesting depth                       | No limit    |
| `--[no-]aliases`        | Include command aliases                       | Included    |

**Requirements:**

- README.md must contain injection tags: `<!-- usage -->`, `<!-- commands -->`
- Without tags, generation does nothing (silent failure)

**Example Integration:**

```json
{
  "scripts": {
    "docs:readme": "oclif readme",
    "docs:readme:check": "oclif readme --dry-run"
  }
}
```

**Current codemachine-pipeline Implementation:**

Uses **custom script** instead of `oclif readme`:

```javascript
// scripts/tooling/generate_cli_reference.js
const MANIFEST_PATH = resolve(ROOT, 'oclif.manifest.json');
const OUTPUT_PATH = resolve(ROOT, 'docs', 'ops', 'cli-reference.md');

// Reads manifest, formats as markdown, writes to docs/ops/cli-reference.md
```

**Trade-offs:**

| Approach           | Pros                                                                        | Cons                                                                         |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Custom Script**  | Full control over format, can match MkDocs structure, custom grouping logic | Must maintain script, may diverge from oclif standards                       |
| **`oclif readme`** | Official tool, automatic updates, standard format                           | Less flexible, requires README tags, default format may not match site theme |

**Recommendation:**

- **Keep custom script** for now (already mature, produces docs/ops/cli-reference.md)
- **Add validation** against `oclif readme --dry-run` output to detect drift
- **Consider hybrid**: Use `oclif readme --multi` to generate per-topic pages, then post-process for MkDocs

### 3.2 Manifest Generation Process

**Source:** [oclif Plugin Loading Documentation](https://oclif.io/docs/plugin_loading/)

**How Manifest Works:**

1. **Build Time:**

   ```bash
   npm run build         # Compiles TypeScript to dist/
   npm run postbuild     # Runs: node scripts/tooling/oclif_manifest.js
   ```

2. **Manifest Script (`scripts/tooling/oclif_manifest.js`):**

   ```javascript
   const oclif = require('@oclif/core');
   // Scans dist/cli/commands/ directory
   // Extracts static properties (description, examples, flags, args)
   // Writes oclif.manifest.json
   ```

3. **CLI Runtime:**
   - CLI reads manifest instead of loading all command files
   - Lazy-loads command classes only when executed
   - Improves startup performance (critical for 50+ command CLIs)

**Best Practices:**

- ✅ **Always generate manifest during build** (already done via `postbuild`)
- ✅ **Commit manifest to version control** (already done - 35KB file, 1141 lines)
- ✅ **Validate manifest in CI** (add: `npm run docs:cli:check` to CI)
- ⚠️ **Keep manifest in sync with code** (add pre-commit hook or CI check)

**Current codemachine-pipeline Status:**

- ✅ Manifest generated in `postbuild` hook
- ✅ Manifest committed to repo
- ✅ CI check exists: `npm run docs:cli:check` validates drift
- ⚠️ No pre-commit hook to prevent manifest drift

**Recommendation:**
Add to `.git/hooks/pre-commit` or use husky:

```bash
#!/bin/sh
npm run build --silent
npm run docs:cli:check || {
  echo "Error: CLI reference is out of sync. Run 'npm run docs:cli' and commit changes."
  exit 1
}
```

### 3.3 Multi-Page Documentation (`--multi` Flag)

**Source:** [oclif README Command](https://github.com/oclif/oclif/blob/v3.2.1/src/commands/readme.ts)

**Use Case:** Large CLIs with topic-based command organization

**Example:** Salesforce CLI

```
sf (base command)
sf config (topic)
  ├─ sf config set
  ├─ sf config get
  └─ sf config list
sf org (topic)
  ├─ sf org create
  ├─ sf org delete
  └─ sf org list
```

**With `--multi` Flag:**

```bash
oclif readme --multi --output-dir docs/commands
```

**Output Structure:**

```
docs/commands/
├── README.md           # Command index
├── config.md           # Topic: config commands
├── config_set.md       # Command: sf config set
├── config_get.md       # Command: sf config get
└── org.md              # Topic: org commands
```

**codemachine-pipeline Command Organization:**

Current structure (flat with some topics):

```
codepipe (base)
codepipe approve
codepipe doctor
codepipe init
codepipe start
codepipe context summarize    # Topic: context
codepipe pr create             # Topic: pr
codepipe pr status
codepipe research create       # Topic: research
codepipe research list
```

**Topics:** `context`, `pr`, `research`

**Recommendation:**

1. **For Phase 3.3 (User Guide - Commands):**
   - Use `--multi` to generate per-command markdown files
   - Post-process to add frontmatter for MkDocs (YAML header)
   - Organize in `docs/user-guide/commands/` directory

2. **Script Enhancement:**

   ```javascript
   // Option 1: Extend generate_cli_reference.js to output per-command files
   // Option 2: Use oclif readme --multi + post-processing script

   // Recommended: Hybrid approach
   // 1. Generate single-page reference: docs/ops/cli-reference.md (current)
   // 2. Generate per-command pages: docs/user-guide/commands/*.md (new)
   // 3. MkDocs navigation.yml links to per-command pages
   ```

3. **MkDocs Integration:**
   ```yaml
   # mkdocs.yml
   nav:
     - User Guide:
         - Commands:
             - Overview: user-guide/commands/index.md
             - Core Commands:
                 - init: user-guide/commands/init.md
                 - start: user-guide/commands/start.md
                 - approve: user-guide/commands/approve.md
             - Context Commands:
                 - summarize: user-guide/commands/context-summarize.md
   ```

---

## 4. Error Message Conventions

### 4.1 oclif Error Handling Architecture

**Source:** [oclif Error Handling Documentation](https://oclif.io/docs/error_handling/)

**Two-Level Error Handling:**

1. **Command.catch()** - Command-level error handler
   - Called first when error occurs during command execution
   - Can handle edge cases (help, version requests)
   - Must re-throw errors for framework handling

2. **bin/run.js catch handler** - Framework-level error handler
   - Catches errors from Command.catch()
   - Logs error to console
   - Sets exit code and terminates process

**Error Flow:**

```
Command.run()
  → throws Error
    → Command.catch() (re-throws)
      → bin/run.js catch (logs + exit)
```

**Custom Error Handling Pattern:**

```typescript
// In Command class
async catch(error: Error): Promise<void> {
  // Handle specific error types
  if (error instanceof CliError) {
    if (this.jsonEnabled()) {
      this.logJson(formatErrorJson(error));
    } else {
      this.log(formatErrorMessage(error));
    }
    process.exit(error.exitCode);
  }

  // Re-throw for framework handling
  throw error;
}
```

**Current codemachine-pipeline Pattern:**

Custom `CliError` class in `src/cli/utils/cliErrors.ts`:

```typescript
export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: CliErrorCode,
    public readonly exitCode: number,
    public readonly options?: {
      remediation?: string;
      howToFix?: string;
      commonFixes?: string[];
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'CliError';
  }
}
```

**Error Codes:**

- `VALIDATION_ERROR` (exit 10)
- `ENVIRONMENT_ERROR` (exit 20)
- `CREDENTIAL_ERROR` (exit 30)
- `EXECUTION_ERROR` (exit 40)

**Assessment:**

- ✅ **Rich error metadata** (remediation, howToFix, commonFixes)
- ✅ **Consistent exit codes** (aligned with Unix conventions)
- ✅ **JSON output support** (`formatErrorJson()`)
- ✅ **Cause chaining** (`{ cause: error }` per ESLint 10 rules)

**Recommendation:**
Document error conventions in:

1. **docs/troubleshooting/error-codes.md** - Error code catalog
2. **docs/architecture/error-handling.md** - Error handling architecture
3. **CLI help text** - Reference error docs in command descriptions

### 4.2 User-Friendly Error Messages

**Source:** [Heroku CLI Error Experience](https://blog.heroku.com/cli-flags-get-started-with-oclif)

**Best Practices:**

1. **Show Usage on Invalid Flags**

   ```
   Error: Unknown flag: --invalidflag
   See more help with --help
   ```

   - oclif does this automatically
   - No custom code needed

2. **Provide Remediation Steps**

   ```typescript
   throw new CliError('No .codepipe/config.json found', CliErrorCode.VALIDATION_ERROR, 10, {
     remediation: 'Initialize the repository first',
     howToFix: 'Run: codepipe init',
     commonFixes: [
       'Check you are in the repository root directory',
       'Verify git repository is initialized',
     ],
   });
   ```

3. **Surface Root Causes**
   - Use `{ cause: error }` for error chaining
   - Log stack traces in verbose mode
   - Include contextual information (file paths, config values)

**Current codemachine-pipeline Implementation:**

Excellent use of structured errors:

```typescript
// Example from src/cli/commands/init.ts
if (!isGitRepo) {
  throw new CliError(
    'Current directory is not a git repository',
    CliErrorCode.ENVIRONMENT_ERROR,
    20,
    {
      remediation: 'Initialize a git repository first',
      howToFix: 'Run: git init',
    }
  );
}
```

**Output Format:**

```
Error: Current directory is not a git repository

Remediation: Initialize a git repository first
How to Fix: Run: git init
```

**Recommendation:**

- ✅ Current pattern is excellent
- Add: Link to troubleshooting docs in error messages
  ```typescript
  remediation: 'Initialize a git repository first. See: https://docs.example.com/troubleshooting#git-init';
  ```

---

## 5. Configuration File Discovery Patterns

### 5.1 oclif Configuration Discovery

**Source:** [oclif Command Discovery Strategies](https://oclif.io/docs/command_discovery_strategies/)

**Config File Formats (oclif v4):**

oclif supports multiple configuration file formats (checked in order):

1. `.oclifrc` (JSON)
2. `.oclifrc.json`
3. `.oclifrc.js` (CommonJS)
4. `.oclifrc.mjs` (ESM)
5. `.oclifrc.cjs` (CommonJS explicit)
6. `oclif.config.js`
7. `oclif.config.mjs`
8. `oclif.config.cjs`
9. `package.json` (oclif section)

**Discovery Algorithm:**

1. Search current directory → parent → root
2. First match wins
3. Merge with `package.json` oclif section

**Performance Note:**

> "If you choose to use an rc file, there will be a slight performance hit due to needing to search for the rc file in addition to the package.json."

**Recommendation for oclif Configuration:**

- Use `package.json` oclif section (already done)
- Avoid separate rc files for oclif-specific config

### 5.2 Application Configuration Discovery

**codemachine-pipeline Config:**

File: `.codepipe/config.json`

**Current Discovery Logic** (from MEMORY.md plan assumptions):

- Git root only
- No upward traversal
- No environment variable override for config path

**Best Practice Patterns:**

1. **Hierarchical Discovery** (like ESLint, Prettier)
   - Search current directory → parent → root
   - Merge configs at each level
   - Closer configs override ancestors

2. **Environment Variable Override**

   ```bash
   CODEPIPE_CONFIG_PATH=/path/to/config.json codepipe start
   ```

3. **XDG Base Directory Specification** (Linux/macOS)
   - Global config: `~/.config/codepipe/config.json`
   - Per-repo config: `.codepipe/config.json`
   - Merge: global defaults + repo overrides

**Recommendation for Phase 1 (Requirements Clarification):**

Question 2: "Config file discovery algorithm?"

**Research needed:**

1. Read `src/core/config/RepoConfig.ts` loader logic
2. Determine if upward traversal is needed (monorepo support?)
3. Document actual behavior in `docs/configuration/overview.md`

**If implementing hierarchical discovery:**

```typescript
// Pseudocode
function findConfig(startDir: string): string | null {
  let dir = startDir;
  while (dir !== '/') {
    const configPath = path.join(dir, '.codepipe', 'config.json');
    if (existsSync(configPath)) return configPath;
    dir = path.dirname(dir);
  }

  // Fallback to global config
  const globalConfig = path.join(os.homedir(), '.config', 'codepipe', 'config.json');
  if (existsSync(globalConfig)) return globalConfig;

  return null;
}
```

---

## 6. Subcommand Organization (Topics)

### 6.1 oclif Topic System

**Source:** [oclif Topics Documentation](https://oclif.io/docs/topics/)

**What are Topics?**

- Organizational unit for grouping related commands
- Implemented as subdirectories in `src/commands/`
- Support nested topics (but max 1-2 levels recommended)

**Directory Structure:**

```
src/commands/
├── init.ts              # Top-level: codepipe init
├── start.ts             # Top-level: codepipe start
├── pr/
│   ├── create.ts        # Topic: codepipe pr create
│   ├── status.ts        # Topic: codepipe pr status
│   └── reviewers.ts     # Topic: codepipe pr reviewers
└── research/
    ├── create.ts        # Topic: codepipe research create
    └── list.ts          # Topic: codepipe research list
```

**Command Syntax:**

- Separator: space (configurable via `topicSeparator` in package.json)
- Example: `codepipe pr create` (space-separated, not colon)

**codemachine-pipeline Configuration:**

```json
// package.json
"oclif": {
  "bin": "codepipe",
  "dirname": "codepipe",
  "commands": "./dist/cli/commands",
  "topicSeparator": " "  // ✅ Uses space separator
}
```

**Current Topics:**

1. `context` - Context management commands
2. `pr` - Pull request commands
3. `research` - Research task commands
4. `status` - Status reporting (single command, could be top-level?)

**Topic Help Descriptions:**

From oclif docs:

> "The help descriptions will be the description of the first command within a directory. You can customize the help description by adding it to the package.json in the oclif configuration."

**Current Implementation:**

- No topic-level descriptions in package.json
- Uses first command's description (e.g., `pr/create.ts` describes `pr` topic)

**Recommendation:**

1. **Add topic descriptions to package.json:**

   ```json
   "oclif": {
     "topics": {
       "context": {
         "description": "Manage context aggregation and summaries"
       },
       "pr": {
         "description": "Create and manage GitHub pull requests"
       },
       "research": {
         "description": "Create and track research tasks for unknowns"
       }
     }
   }
   ```

2. **Consider topic reorganization:**
   - `status` topic has only one command (`status/index.ts`)
   - Could move to top-level: `src/commands/status.ts`
   - Simplifies command: `codepipe status` instead of `codepipe status` (same, but clearer)

3. **Document topic organization** in:
   - `docs/architecture/cli-structure.md`
   - `docs/user-guide/commands/index.md` (topic-based navigation)

### 6.2 Help Output Customization

**Source:** [oclif Topics Documentation](https://oclif.io/docs/topics/)

**Customizing Topic Help:**

Option 1: First command in directory defines topic description

```typescript
// src/commands/pr/create.ts
export default class PrCreate extends Command {
  static description = 'Create a pull request on GitHub for the feature branch';
  // This description appears for "codepipe pr --help" if no custom topic config
}
```

Option 2: Custom topic configuration in package.json

```json
"oclif": {
  "topics": {
    "pr": {
      "description": "Create and manage GitHub pull requests",
      "hidden": false
    }
  }
}
```

**Hidden Topics:**

```json
"topics": {
  "internal": {
    "description": "Internal debugging commands",
    "hidden": true  // Won't appear in "codepipe --help"
  }
}
```

**Recommendation:**

- Use package.json topic descriptions for clarity
- Reserve first-command descriptions for command-specific help
- Mark experimental topics as `hidden: true` during development

---

## 7. Recommendations for codemachine-pipeline

### 7.1 Immediate Actions (Phase 4 Focus)

**Priority 1: Enhance Command Metadata**

1. **Add `summary` fields to all commands**
   - Quick wins: 17 commands, 5 minutes each = ~90 minutes
   - Improves help readability in oclif v4

2. **Add example descriptions**
   - Audit `generate_cli_reference.js` warnings
   - Add description field to all examples
   - Target: 3-5 examples per command with context

3. **Add `helpGroup` to flags**
   - Group related flags (INPUT, OUTPUT, EXECUTION, etc.)
   - Improves `--help` scanability

**Priority 2: Improve Auto-Generation Script**

1. **Validate against `oclif readme`**

   ```bash
   npm run docs:cli:check  # Already exists, enhance
   # Add: Compare custom output with oclif readme --dry-run
   ```

2. **Generate per-command markdown files**
   - Extend script to output `docs/user-guide/commands/*.md`
   - Add frontmatter for MkDocs integration
   - Template:

     ```markdown
     ---
     title: codepipe init
     description: Initialize codemachine-pipeline with schema-validated configuration
     ---

     # codepipe init

     {{ auto-generated content }}

     ## Related Commands

     - [codepipe start](start.md)
     - [codepipe validate](validate.md)
     ```

3. **Add topic descriptions to package.json**
   - Define `oclif.topics` section
   - Document purpose of each topic

**Priority 3: Error Documentation**

1. **Create error code catalog**
   - File: `docs/troubleshooting/error-codes.md`
   - Format:

     ```markdown
     ## VALIDATION_ERROR (exit 10)

     **Causes:**

     - Missing required config fields
     - Invalid JSON in config file
     - Schema validation failure

     **Remediation:**

     - Run `codepipe init --validate-only` to check config
     - Review schema at docs/reference/schema-reference.md
     - Check for typos in .codepipe/config.json
     ```

2. **Link errors to documentation**
   - Add URL to `CliError.remediation` field
   - Example: `See: https://docs.example.com/troubleshooting/error-codes#validation-error`

### 7.2 Phase 3.3 Integration (User Guide - Commands)

**Goal:** Create per-command deep-dive documentation

**Approach:**

1. **Auto-generate baseline docs**

   ```bash
   npm run docs:commands  # New script
   # Generates docs/user-guide/commands/*.md from manifest
   ```

2. **Manual enhancement**
   - Add "Common Use Cases" section
   - Add "Advanced Examples" with explanations
   - Add "Troubleshooting" subsection per command
   - Add "Related Commands" cross-references

3. **MkDocs integration**
   ```yaml
   # mkdocs.yml
   nav:
     - User Guide:
         - Commands:
             - index: user-guide/commands/index.md
             - init: user-guide/commands/init.md
             - start: user-guide/commands/start.md
           # ... all 17 commands
   ```

**Template Structure:**

```markdown
---
title: codepipe start
description: Start a new feature development pipeline
tags: [workflow, execution, pipeline]
---

# codepipe start

{{ AUTO-GENERATED: Synopsis, arguments, flags, examples }}

## Common Use Cases

### Use Case 1: Start from Linear issue

...

### Use Case 2: Start from spec file

...

## Advanced Examples

### Example 1: Dry-run execution plan

...

## Troubleshooting

### Issue: "No context files found"

**Cause:** Empty repository or all files excluded by .gitignore
**Solution:** ...

## Related Commands

- [codepipe init](init.md) - Initialize before first use
- [codepipe approve](approve.md) - Approve PRD after generation
- [codepipe resume](resume.md) - Resume failed execution

## See Also

- [Workflows Guide](../workflows.md)
- [Configuration Reference](../../configuration/config-file.md)
```

### 7.3 Script Enhancements

**Current Script:** `scripts/tooling/generate_cli_reference.js`

**Enhancement 1: Per-Command File Generation**

```javascript
// Add new mode: --per-command
if (process.argv.includes('--per-command')) {
  const commandsDir = resolve(ROOT, 'docs', 'user-guide', 'commands');

  for (const cmd of commands) {
    const filename = cmd.id.replace(/:/g, '-') + '.md';
    const content = renderCommandPage(cmd); // New function
    writeFileSync(resolve(commandsDir, filename), content);
  }

  console.log(`✔ Generated ${commands.length} command pages`);
  process.exit(0);
}
```

**Enhancement 2: MkDocs Frontmatter**

```javascript
function renderCommandPage(cmd) {
  const lines = [];

  // Frontmatter
  lines.push('---');
  lines.push(`title: ${BIN_NAME} ${cmd.id.replace(/:/g, ' ')}`);
  lines.push(`description: ${cmd.description || 'No description'}`);
  lines.push(`tags: [${inferTags(cmd)}]`);
  lines.push('---');
  lines.push('');

  // Rest of content
  lines.push(renderCommandSection(cmd));

  return lines.join('\n');
}

function inferTags(cmd) {
  const tags = [];
  if (cmd.id.includes('pr')) tags.push('pull-request', 'github');
  if (cmd.id.includes('research')) tags.push('research', 'unknowns');
  // ... infer from command ID and flags
  return tags.join(', ');
}
```

**Enhancement 3: Validation Against oclif readme**

```javascript
// Add: --compare-oclif mode
if (process.argv.includes('--compare-oclif')) {
  const oclifOutput = execSync('oclif readme --dry-run').toString();
  const customOutput = generateDocument();

  // Compare structure (not exact match, but validate completeness)
  const oclifCommands = extractCommandList(oclifOutput);
  const customCommands = extractCommandList(customOutput);

  const missing = oclifCommands.filter((c) => !customCommands.includes(c));
  if (missing.length > 0) {
    console.error(`Missing commands: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log('✔ Custom output includes all oclif commands');
  process.exit(0);
}
```

### 7.4 CI/CD Integration

**Add to `.github/workflows/ci.yml`:**

```yaml
- name: Validate CLI documentation
  run: |
    npm run build
    npm run docs:cli:check
    npm run docs:commands:check  # New script

- name: Check for missing examples
  run: |
    node scripts/tooling/check_cli_examples.js  # New script
```

**New Script:** `scripts/tooling/check_cli_examples.js`

```javascript
#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const manifest = JSON.parse(readFileSync('oclif.manifest.json', 'utf8'));

let hasIssues = false;

for (const [id, cmd] of Object.entries(manifest.commands)) {
  // Check for examples
  if (!cmd.examples || cmd.examples.length === 0) {
    console.error(`❌ ${id}: No examples defined`);
    hasIssues = true;
  }

  // Check for example descriptions (if examples are objects)
  if (cmd.examples && cmd.examples.some((ex) => typeof ex === 'object' && !ex.description)) {
    console.error(`❌ ${id}: Some examples lack descriptions`);
    hasIssues = true;
  }

  // Check for description
  if (!cmd.description) {
    console.error(`❌ ${id}: No description defined`);
    hasIssues = true;
  }
}

if (hasIssues) {
  console.error('\nFix issues above and run: npm run build');
  process.exit(1);
} else {
  console.log('✔ All commands have examples and descriptions');
}
```

---

## 8. Reference Implementation Examples

### 8.1 Salesforce CLI

**Scale:** 100+ commands, 20+ topics

**Documentation Strategy:**

- Official docs site: [Salesforce CLI Plugin Developer Guide](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/conceptual-overview.html)
- Per-command reference pages
- Topic-based organization
- Rich examples with explanations

**Key Takeaways:**

- Topic descriptions in package.json
- Comprehensive examples (5-10 per command)
- Clear flag groupings (`helpGroup`)
- Error message conventions documented

### 8.2 Heroku CLI

**Scale:** 50+ commands, 10+ topics

**Documentation Strategy:**

- Heroku Dev Center: [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)
- Auto-generated from manifest
- Interactive help in terminal
- Web-based search

**Key Takeaways:**

- `oclif readme --multi` for per-topic pages
- Clear command descriptions with context
- Usage examples with real scenarios
- Error messages reference documentation

---

## 9. Resources and Sources

### Official oclif Documentation

1. [oclif Framework](https://github.com/oclif/oclif) - Main repository
2. [oclif Features](https://oclif.io/docs/features/) - Core features documentation
3. [Command Flags](https://oclif.io/docs/flags/) - Flag documentation standards
4. [Error Handling](https://oclif.io/docs/error_handling/) - Error handling conventions
5. [Topics](https://oclif.io/docs/topics/) - Subcommand organization
6. [Command Discovery Strategies](https://oclif.io/docs/command_discovery_strategies/) - Configuration patterns
7. [Manifest Documentation](https://github.com/oclif/oclif/blob/main/docs/manifest.md) - Manifest format
8. [README Generation](https://github.com/oclif/oclif/blob/main/docs/readme.md) - Auto-generation workflow

### Industry Examples

1. [Heroku CLI](https://www.heroku.com/blog/open-cli-framework/) - Open sourcing oclif blog post
2. [Salesforce CLI](https://developer.salesforce.com/blogs/2022/10/building-a-cli-application-with-oclif) - Building a CLI application
3. [oclif v4.0 Release](https://github.com/oclif/core/releases/tag/4.0.0) - Version 4 features

### Additional Resources

1. [CLI Flags Best Practices](https://blog.heroku.com/cli-flags-get-started-with-oclif) - Heroku blog
2. [Building CLIs with oclif](https://www.joshcanhelp.com/oclif/) - Tutorial
3. [oclif Tutorial](https://generalistprogrammer.com/tutorials/oclif-npm-package-guide) - Complete guide

---

## 10. Conclusion

### Summary of Key Findings

1. **oclif v4 provides mature documentation tooling** - codemachine-pipeline is already on v4.0.30
2. **Custom script is valid approach** - Provides control for MkDocs integration
3. **Low-hanging fruit:** Add `summary`, `helpGroup`, example descriptions (~2 hours work)
4. **Medium effort:** Generate per-command pages for user guide (~4 hours)
5. **High value:** Error code catalog with remediation steps (~8 hours)

### Immediate Next Steps

1. **Phase 1 (Requirements Clarification):**
   - Answer 6 critical questions by reading source code
   - Document findings in ADR-009

2. **Phase 4 (Auto-Generated Documentation):**
   - Enhance command metadata (summary, helpGroup)
   - Add example descriptions
   - Generate per-command markdown files
   - Integrate with MkDocs

3. **Phase 3.3 (User Guide - Commands):**
   - Manual enhancement of auto-generated pages
   - Add use cases, troubleshooting, cross-references
   - Create command index with topic-based navigation

### Success Metrics

- ✅ All 17 commands have examples with descriptions
- ✅ All flags use `helpGroup` for organization
- ✅ Per-command pages generated in `docs/user-guide/commands/`
- ✅ MkDocs site includes searchable command reference
- ✅ Error code catalog covers all `CliErrorCode` values
- ✅ CI validates documentation drift

---

**Document Status:** Complete
**Last Updated:** 2026-02-15
**Next Review:** After Phase 1 requirements clarification
