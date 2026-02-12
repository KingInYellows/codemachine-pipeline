---
title: Documentation Tooling Decisions
type: decision
date: 2026-02-10
related_issues:
  - "#424 (GitHub) — Plan documentation tooling decisions"
  - "CDMCH-58 (Linear) — CLI reference auto-generation"
  - "CDMCH-59 (Linear) — Architecture diagrams"
  - "CDMCH-62 (Linear) — Public API reference"
status: decided
---

# Documentation Tooling Decisions

## What We're Building

Documentation tooling for three deliverables within a 2-day cycle (Feb 11–13):

1. **Auto-generated CLI reference** at `docs/ops/cli-reference.md`
2. **Architecture diagrams** integrated into existing docs
3. **API reference** covering configuration schema, CLI commands, and key types

**Audience**: Both new contributors (onboarding) and CLI users (engineers, SREs).
**Hosting**: GitHub-rendered markdown in-repo — no docs site.
**Maintenance model**: Semi-automated — auto-generate what's mechanical, hand-write what needs narrative.

## Key Decisions

### Decision 1: CLI Reference — Custom oclif manifest script

**Chosen**: Write a Node script that reads `oclif.manifest.json` (already generated post-build) and emits `docs/ops/cli-reference.md`.

- Add `npm run docs:cli` script
- Add CI drift check (compare generated output to committed file)
- Zero new dependencies — uses existing manifest infrastructure

**Rejected alternatives**:
- `@oclif/plugin-readme`: targets README, opinionated format, adds dependency
- Hand-written: drifts immediately, defeats purpose

### Decision 2: Architecture Diagrams — Mermaid inline in markdown

**Chosen**: Inline Mermaid diagrams as fenced code blocks in documentation files. GitHub renders these natively.

- 5 existing `.mmd` files in `docs/diagrams/` ready to inline
- 3 existing `.puml` files need conversion to Mermaid (or kept as-is with link to rendered view)
- No build step, no rendered images in git

**Rejected alternatives**:
- Rendered images committed to repo: binary blobs, CI complexity, drift

### Decision 3: API Reference — Hand-written markdown + Zod schema extraction

**Chosen**: Hand-written `docs/ops/api-reference.md` covering:
- Configuration schema (extracted from existing Zod validators in `src/validation/`)
- CLI commands (cross-reference to auto-generated CLI reference)
- Key TypeScript types (manually curated, focused on what users interact with)

CI check validates config examples against Zod schemas to catch drift.

**Rejected alternatives**:
- TypeDoc: verbose output for internal-heavy codebase, format mismatch with markdown docs

## Current State

| Asset | Exists? | Notes |
|-------|---------|-------|
| `docs/` structure | Yes | 70+ files, well-organized |
| `oclif.manifest.json` | Yes | Generated post-build |
| Mermaid diagrams | Yes | 5 `.mmd` files in `docs/diagrams/` |
| PlantUML diagrams | Yes | 3 `.puml` files in `docs/diagrams/` |
| Zod validators | Yes | `src/validation/` (validateOrThrow, validateOrResult) |
| TypeDoc | No | Not installed, not needed |
| CLI commands | Yes | 22 endpoints across `src/cli/commands/` |
| `docs/ops/cli-reference.md` | No | To be generated |
| `docs/ops/api-reference.md` | No | To be written |

## Open Questions

- Should PlantUML diagrams be converted to Mermaid or kept as `.puml` with external render links?
- Which specific types from the codebase should be included in the API reference? (Likely: config types, CLI option types, adapter interfaces)
- Should the CI drift check for CLI reference be a hard fail or a warning?

## Implementation Sequence

1. **CDMCH-58**: CLI reference script (foundation — other docs reference it)
2. **CDMCH-59**: Diagram integration (standalone, can parallel with #1)
3. **CDMCH-62**: API reference (depends on CLI reference being done)
