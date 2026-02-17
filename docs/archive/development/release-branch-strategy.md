# Release Branch Strategy

## Overview

The `release` branch contains a clean, publishable version of the codebase. It is derived from `main` with development-only artifacts removed.

## Branch Model

```
main (default)              release
  │                            │
  │  ← all development         │  ← clean, publishable
  │  ← AI tooling configs      │  ← no dev artifacts
  │  ← plans, brainstorms      │  ← npm publish source
  │                            │
```

- **`main`**: Primary development branch. Contains all code, tests, documentation, and development tooling configs (CLAUDE.md, .serena/, .codemachine/, etc.).
- **`release`**: Clean branch for publishing. Contains only production code, essential config, and user-facing documentation.

## Included on `release`

| Category      | Files                                                     |
| ------------- | --------------------------------------------------------- |
| Source code   | `src/`, `bin/`                                            |
| Build config  | `package.json`, `tsconfig.json`                           |
| Build output  | `dist/` (generated)                                       |
| CLI manifest  | `oclif.manifest.json` (generated)                         |
| Documentation | `README.md`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md` |
| Docker        | `Dockerfile`, `.dockerignore`                             |
| CI            | `.github/`                                                |
| Config        | `.npmrc`, `.npmignore`, `.gitignore`                      |
| Tests         | `tests/`, `vitest.config.ts`                              |
| Docs          | `docs/`                                                   |
| Scripts       | `scripts/`                                                |
| Examples      | `examples/`                                               |

## Excluded from `release`

| Category      | Files                     | Reason                         |
| ------------- | ------------------------- | ------------------------------ |
| AI tooling    | `CLAUDE.md`               | Claude Code configuration      |
| AI artifacts  | `.codemachine/`           | Development planning artifacts |
| IDE plugin    | `.serena/`                | Serena IDE cache               |
| Claude config | `.claude/`                | Claude Code settings           |
| MCP config    | `.mcp.json`               | MCP server config              |
| Claude Flow   | `claude-flow.config.json` | Claude Flow config             |
| Dep baseline  | `.deps/`                  | Circular dependency baseline   |
| Legacy tools  | `tools/`                  | Superseded by scripts/tooling/ |
| Original spec | `specification.md`        | Archived to docs/archive/      |

## Creating the Release Branch

```bash
# Start from latest main
git checkout main && git pull origin main

# Create release branch
git checkout -b release

# Remove excluded files
git rm CLAUDE.md
git rm -r .codemachine/ .serena/ .claude/ .deps/ tools/ 2>/dev/null
git rm .mcp.json claude-flow.config.json 2>/dev/null
git rm specification.md 2>/dev/null

# Commit
git commit -m "chore: create clean release branch for v1.0.0"

# Verify
npm run build && npm run lint && npm test && npm run smoke
npm pack --dry-run  # Should show only bin/, dist/, oclif.manifest.json, package.json, README.md, LICENSE

# Push
git push -u origin release
```

## Syncing Release with Main

Periodically rebuild `release` from `main` to pick up new features and fixes:

```bash
# Update main
git checkout main && git pull origin main

# Delete and recreate release
git branch -D release
git checkout -b release

# Remove excluded files (same as initial creation)
git rm CLAUDE.md
git rm -r .codemachine/ .serena/ .claude/ .deps/ tools/ 2>/dev/null
git rm .mcp.json claude-flow.config.json 2>/dev/null
git rm specification.md 2>/dev/null

git commit -m "chore: sync release branch with main"

# Verify and force-push
npm run build && npm test
git push --force-with-lease origin release
```

## Hotfix Workflow

For urgent fixes that need to reach `release` before a full sync:

1. Create hotfix branch from `release`
2. Apply fix and test
3. Merge to `release` via PR
4. Cherry-pick the same fix to `main`

```bash
git checkout release
git checkout -b hotfix/critical-bug
# ... fix and test ...
# PR to release, then cherry-pick to main
```

## npm Publishing

Publish from the `release` branch:

```bash
git checkout release
npm run build
npm publish
```

The `package.json` `"files"` field ensures only `bin/`, `dist/`, and `oclif.manifest.json` are included in the published package regardless of branch.
