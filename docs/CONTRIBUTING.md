# Contributing to ai-feature-pipeline

Thank you for your interest in contributing. This guide covers the essentials for getting started.

## Prerequisites

- **Node.js >= 24** (Active LTS)
- **npm** (bundled with Node.js)
- **Git**
- **Graphite CLI** (`gt`) -- used for branch management and PR submission

## Setup

```bash
# Clone the repository
git clone <repo-url>
cd codemachine-pipeline

# Install dependencies (use ci for a clean, reproducible install)
npm ci

# Build the project
npm run build
```

## Development Workflow

### Building

```bash
npm run build        # Compile TypeScript
npm run clean        # Remove dist/
```

### Testing

Tests use [Vitest](https://vitest.dev/).

```bash
npm test             # Run all test suites (config, unit, integration, commands)
npm run test:config  # Config tests only
npm run test:http    # Unit tests only
npm run test:smoke   # Smoke tests
```

### Linting and Formatting

```bash
npm run lint          # Run ESLint
npm run lint:fix      # Auto-fix lint issues
npm run format        # Format with Prettier
npm run format:check  # Check formatting (CI uses this)
```

## Branch Strategy

This project uses **Graphite (`gt`)** for stacked PRs. Do not push directly to `main` or create PRs with `gh pr create`.

### Creating a branch

```bash
gt create <branch-name> --message "Brief description of change"
```

### Making changes

```bash
git add <files>
git commit -m "type: short description"
```

### Submitting

```bash
gt submit --no-edit
```

If your PR was created as a draft, mark it ready:

```bash
gh pr ready <PR-number>
```

See `docs/development/submission-workflow.md` for full details, including stack management and recovery from accidental direct pushes.

## Commit Conventions

Use conventional-style prefixes:

- `feat:` -- new feature
- `fix:` -- bug fix
- `refactor:` -- code restructuring without behavior change
- `test:` -- adding or updating tests
- `docs:` -- documentation only
- `chore:` -- tooling, CI, dependencies
- `ci:` -- CI/CD pipeline changes

Keep the subject line under 72 characters. Use the body for additional context when needed.

## Code Style

- **TypeScript** throughout (`src/` and `tests/`)
- Formatting enforced by Prettier (`npm run format:check`)
- Linting enforced by ESLint (`npm run lint`)
- Validation uses **Zod** for runtime schema checking

## PR Process

1. Create a Graphite branch and make your changes.
2. Ensure `npm run build`, `npm test`, `npm run lint`, and `npm run format:check` all pass locally.
3. Submit via `gt submit --no-edit`.
4. CI runs automatically (tests, security scans, Docker build, code quality).
5. Address review feedback, then the PR is merged through Graphite.

## Project Structure

```
src/           Source code (TypeScript)
tests/         Test files (Vitest)
docs/          Documentation
scripts/       Utility and tooling scripts
bin/           CLI entry points
```
