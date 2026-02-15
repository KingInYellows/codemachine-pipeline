---
title: oclif Documentation Patterns - Quick Reference
type: quick-reference
date: 2026-02-15
---

# oclif Documentation Patterns - Quick Reference

> Companion to: [oclif-documentation-patterns-2025-2026.md](./oclif-documentation-patterns-2025-2026.md)

## Immediate Action Items (Priority Order)

### 1. Add `summary` Fields (30 min)

```typescript
// Before (oclif v3 pattern)
static description = 'Start a new feature development pipeline'

// After (oclif v4 best practice)
static summary = 'Start a new feature development pipeline'
static description = `
  Initiates a feature development workflow from a prompt, Linear issue, or spec file.

  The pipeline includes context aggregation, research detection, PRD authoring,
  and task execution. Use --skip-execution to review PRD before code generation.
`
```

**Impact:** Improves `--help` readability, aligns with oclif v4 standards

---

### 2. Add Example Descriptions (60 min)

```typescript
// Before (minimal examples)
static examples = [
  '<%= config.bin %> <%= command.id %>',
  '<%= config.bin %> <%= command.id %> --force',
]

// After (contextual examples)
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
    description: 'Non-interactive initialization (CI/CD workflows)',
    command: '<%= config.bin %> <%= command.id %> --yes',
  },
]
```

**Impact:** Users understand *when* to use each flag combination

---

### 3. Add `helpGroup` to Flags (45 min)

```typescript
static flags = {
  approve: Flags.boolean({
    char: 'a',
    summary: 'Grant approval for this gate',
    description: 'Approve the PRD and proceed to code execution.',
    helpGroup: 'APPROVAL OPTIONS',  // ← Group related flags
  }),
  deny: Flags.boolean({
    char: 'd',
    summary: 'Deny approval for this gate',
    description: 'Reject the PRD and halt pipeline execution.',
    helpGroup: 'APPROVAL OPTIONS',
  }),
  json: Flags.boolean({
    summary: 'Output results in JSON format',
    helpGroup: 'OUTPUT OPTIONS',
  }),
  'dry-run': Flags.boolean({
    summary: 'Preview changes without execution',
    helpGroup: 'EXECUTION OPTIONS',
  }),
}
```

**Impact:** `--help` output is scannable, flags organized by concern

---

### 4. Add Topic Descriptions to package.json (15 min)

```json
// package.json
"oclif": {
  "bin": "codepipe",
  "dirname": "codepipe",
  "commands": "./dist/cli/commands",
  "topicSeparator": " ",
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

**Impact:** `codepipe pr --help` shows clear topic description

---

## Script Enhancements

### Generate Per-Command Markdown Files

**New script:** `scripts/tooling/generate_command_pages.js`

```javascript
#!/usr/bin/env node
'use strict';

const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');
const MANIFEST_PATH = resolve(ROOT, 'oclif.manifest.json');
const OUTPUT_DIR = resolve(ROOT, 'docs', 'user-guide', 'commands');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [id, cmd] of Object.entries(manifest.commands)) {
  const filename = id.replace(/:/g, '-') + '.md';
  const content = renderCommandPage(cmd);
  writeFileSync(resolve(OUTPUT_DIR, filename), content);
}

console.log(`✔ Generated ${Object.keys(manifest.commands).length} command pages`);

function renderCommandPage(cmd) {
  const displayId = cmd.id.replace(/:/g, ' ');
  const lines = [];

  // Frontmatter for MkDocs
  lines.push('---');
  lines.push(`title: codepipe ${displayId}`);
  lines.push(`description: ${cmd.description || 'No description'}`);
  lines.push('---');
  lines.push('');

  // Command heading
  lines.push(`# codepipe ${displayId}`);
  lines.push('');

  // Description
  lines.push(cmd.description || '_No description available._');
  lines.push('');

  // Synopsis
  lines.push('## Synopsis');
  lines.push('');
  lines.push('```bash');
  lines.push(`codepipe ${displayId} [FLAGS]`);
  lines.push('```');
  lines.push('');

  // Flags (if any)
  if (cmd.flags && Object.keys(cmd.flags).length > 0) {
    lines.push('## Options');
    lines.push('');
    lines.push('| Option | Type | Description |');
    lines.push('|--------|------|-------------|');
    for (const flag of Object.values(cmd.flags)) {
      const name = `\`--${flag.name}\``;
      const type = flag.type;
      const desc = flag.description || '_No description_';
      lines.push(`| ${name} | ${type} | ${desc} |`);
    }
    lines.push('');
  }

  // Examples
  if (cmd.examples && cmd.examples.length > 0) {
    lines.push('## Examples');
    lines.push('');
    for (const ex of cmd.examples) {
      const exampleText = typeof ex === 'string' ? ex : ex.command || ex;
      const description = typeof ex === 'object' ? ex.description : null;

      if (description) {
        lines.push(`**${description}**`);
        lines.push('');
      }

      lines.push('```bash');
      lines.push(exampleText.replace(/<%= config.bin %>/g, 'codepipe').replace(/<%= command.id %>/g, displayId));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}
```

**Usage:**
```bash
# Add to package.json scripts
"docs:commands": "node scripts/tooling/generate_command_pages.js"

# Generate command pages
npm run docs:commands
```

---

## CI Validation

### Check for Missing Examples

**New script:** `scripts/tooling/check_cli_examples.js`

```javascript
#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const manifest = JSON.parse(readFileSync('oclif.manifest.json', 'utf8'));

let hasIssues = false;

for (const [id, cmd] of Object.entries(manifest.commands)) {
  if (!cmd.examples || cmd.examples.length === 0) {
    console.error(`❌ ${id}: No examples defined`);
    hasIssues = true;
  }

  if (!cmd.description) {
    console.error(`❌ ${id}: No description defined`);
    hasIssues = true;
  }

  // Check for example descriptions
  if (cmd.examples) {
    for (const ex of cmd.examples) {
      if (typeof ex === 'object' && !ex.description) {
        console.error(`❌ ${id}: Example lacks description`);
        hasIssues = true;
        break;
      }
    }
  }
}

if (hasIssues) {
  console.error('\nFix issues above and run: npm run build');
  process.exit(1);
} else {
  console.log('✔ All commands have examples and descriptions');
}
```

**Add to CI:**
```yaml
# .github/workflows/ci.yml
- name: Validate CLI documentation
  run: |
    npm run build
    npm run docs:cli:check
    node scripts/tooling/check_cli_examples.js
```

---

## oclif v4 Flag Properties Reference

| Property | Type | Purpose | Example |
|----------|------|---------|---------|
| `summary` | string | Brief flag description | `'Grant approval for this gate'` |
| `description` | string | Detailed explanation | `'Approve the PRD and proceed...'` |
| `char` | string | Short flag (`-a`) | `'a'` |
| `helpGroup` | string | Group in help output | `'APPROVAL OPTIONS'` |
| `aliases` | string[] | Alternative names | `['confirm', 'yes']` |
| `deprecated` | object | Deprecation notice | `{ message: 'Use --approve', version: '2.0.0' }` |
| `hidden` | boolean | Hide from help | `true` |
| `required` | boolean | Flag is required | `true` |

---

## Command Metadata Checklist

For each command, ensure:

- [ ] `summary` field (concise one-liner)
- [ ] `description` field (multi-paragraph explanation)
- [ ] At least 3 examples with descriptions
- [ ] All flags have `summary` and `description`
- [ ] Flags grouped with `helpGroup`
- [ ] Arguments documented (if any)
- [ ] Related commands referenced

---

## MkDocs Integration Pattern

### Command Page Template

```markdown
---
title: codepipe init
description: Initialize codemachine-pipeline with schema-validated configuration
tags: [setup, configuration, initialization]
---

# codepipe init

{{ AUTO-GENERATED: Synopsis, arguments, flags, examples }}

## Common Use Cases

### First-time setup
...

### Re-initialize after config changes
...

## Troubleshooting

### "Not a git repository"
**Cause:** ...
**Solution:** Run `git init` first

## Related Commands

- [codepipe start](start.md)
- [codepipe validate](validate.md)

## See Also

- [Configuration Guide](../../configuration/config-file.md)
- [Quick Start](../../getting-started/quick-start.md)
```

### MkDocs Navigation Structure

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
        - resume: user-guide/commands/resume.md
      - Pull Request Commands:
        - create: user-guide/commands/pr-create.md
        - status: user-guide/commands/pr-status.md
      - Research Commands:
        - create: user-guide/commands/research-create.md
        - list: user-guide/commands/research-list.md
```

---

## Error Documentation Template

### Error Code Catalog Structure

```markdown
# Error Code Reference

## VALIDATION_ERROR (exit 10)

**Description:** Configuration or input validation failed

**Common Causes:**
- Missing required config fields in `.codepipe/config.json`
- Invalid JSON syntax in config file
- Zod schema validation failure

**Remediation Steps:**
1. Run `codepipe init --validate-only` to check config
2. Review schema at [Schema Reference](../reference/schema-reference.md)
3. Check for typos in config file

**Example:**
\`\`\`
Error: Validation failed for field 'execution.maxConcurrentTasks'
Expected: number (1-10)
Received: "5" (string)

Remediation: Fix the config file
How to Fix: Change "5" to 5 (remove quotes)
\`\`\`

---

## ENVIRONMENT_ERROR (exit 20)

**Description:** Environment setup issue (missing tools, filesystem permissions)

...
```

---

## Comparison: Custom Script vs oclif readme

| Feature | Custom Script | oclif readme |
|---------|--------------|--------------|
| **Control** | Full control over format | Standard format |
| **Maintenance** | Manual updates needed | Auto-maintained |
| **Flexibility** | Can match MkDocs theme | Fixed structure |
| **Performance** | Single-purpose | Generic tool |
| **Validation** | Custom checks | Built-in checks |

**Recommendation:** Keep custom script, validate against `oclif readme --dry-run` for completeness

---

## Time Estimates

| Task | Time | Priority |
|------|------|----------|
| Add `summary` to 17 commands | 30 min | High |
| Add example descriptions | 60 min | High |
| Add `helpGroup` to flags | 45 min | Medium |
| Topic descriptions in package.json | 15 min | Medium |
| Generate per-command pages script | 2 hours | Medium |
| Error code catalog | 4 hours | Low |
| CI validation scripts | 1 hour | Low |

**Total:** ~9 hours for complete enhancement

---

## Resources

- **Full Research:** [oclif-documentation-patterns-2025-2026.md](./oclif-documentation-patterns-2025-2026.md)
- **oclif Docs:** https://oclif.io/docs/
- **Current Generator:** `/home/kinginyellow/projects/codemachine-pipeline/scripts/tooling/generate_cli_reference.js`
- **Plan:** `/home/kinginyellow/projects/codemachine-pipeline/docs/plans/2026-02-15-docs-comprehensive-documentation-suite-plan.md`

---

**Last Updated:** 2026-02-15
