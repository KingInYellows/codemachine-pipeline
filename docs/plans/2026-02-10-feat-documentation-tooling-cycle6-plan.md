---
title: "feat: Documentation tooling for Cycle 6 (CDMCH-58, CDMCH-59, CDMCH-62)"
type: feat
date: 2026-02-10
linear_cycle: 6
linear_issues: [CDMCH-58, CDMCH-59, CDMCH-62]
github_issues: ["#211", "#212", "#215", "#424"]
brainstorm: docs/brainstorms/2026-02-10-documentation-tooling-decisions-brainstorm.md
---

# feat: Documentation Tooling for Cycle 6

## Overview

Implement documentation tooling for the 3 remaining Linear Cycle 6 issues within a 2-day window (Feb 11-13). This covers auto-generated CLI reference, architecture diagram integration, and API reference documentation. All output stays as GitHub-rendered markdown in-repo with semi-automated maintenance.

This plan also resolves GitHub #424 ("Plan documentation tooling decisions") since the brainstorm captured all tooling choices.

## Problem Statement / Motivation

The project has 22 CLI commands, rich Zod-validated config schemas, and 8 architecture diagrams, but:
- The existing `docs/ops/cli-reference.md` (1187 lines) is **hand-written and drifts** from source
- Architecture diagrams in `docs/diagrams/` are **not embedded** in any documentation
- There is **no API reference** for configuration schema or key types
- Contributors and users lack a single source of truth for CLI usage, config shape, and system architecture

## Proposed Solution

Three deliverables, each as an independent PR:

| PR | Issue | Deliverable | Approach |
|----|-------|-------------|----------|
| 1 | CDMCH-58 | CLI reference auto-generation | Node script reads `oclif.manifest.json` → `docs/ops/cli-reference.md` |
| 2 | CDMCH-59 | Architecture diagram integration | Inline Mermaid in markdown docs, convert PlantUML where feasible |
| 3 | CDMCH-62 | API reference documentation | Hand-written markdown + Zod schema extraction for config |

## Technical Considerations

### Build Order & Manifest Timing

- `oclif.manifest.json` is generated during `postbuild` (`node scripts/tooling/oclif_manifest.js`)
- The CLI reference script **must run after build** — it reads from the committed manifest
- Script should fail fast with a clear error if manifest is missing (not silently generate empty output)
- `npm run docs:cli` should NOT depend on `npm run build` — it uses the **committed** manifest, not a freshly built one. The CI drift check regenerates after build.

### Fully Auto-Generated CLI Reference (No Manual Edits)

- `docs/ops/cli-reference.md` will be **100% auto-generated** — manual edits will be overwritten
- Custom notes, tips, or caveats belong in command source code (JSDoc, `description`, `examples`)
- The file will include a header comment: `<!-- AUTO-GENERATED. Do not edit. Run: npm run docs:cli -->`

### PlantUML Conversion Strategy

The 3 `.puml` files:
| File | Diagram Type | Mermaid Feasibility |
|------|-------------|-------------------|
| `component_overview.puml` | Layered architecture (6 layers) | Hard — Mermaid lacks layered packages. Keep as `.puml` with render link |
| `deployment_resume_state.puml` | State machine | Easy — Mermaid `stateDiagram-v2` |
| `execution_flow.puml` | Flow diagram | Easy — Mermaid `flowchart TD` |

Decision: Convert 2 feasible `.puml` files to Mermaid. Keep `component_overview.puml` as-is with a link to PlantUML online renderer. Keep all original `.puml`/`.mmd` source files in `docs/diagrams/` as source of truth.

### CI Drift Check Pattern

Follow `scripts/tooling/check_circular_deps.js` pattern:
- Exit 0: no drift
- Exit 1: drift detected (CI fail)
- Exit 2: tool error
- Print actionable fix command: `Run 'npm run docs:cli' and commit the updated file`

### Zod Schema Scope for API Reference

Primary schema: `RepoConfig` from `src/core/config/RepoConfig.ts` — the user-facing configuration.
Key types to document (from `src/core/models/`): `Feature`, `ResearchTask`, `PlanArtifact`, `ExecutionTask`, `ApprovalRecord`.
Config examples in **JSON format** (matches `.codepipe/config.json` usage pattern).

## Acceptance Criteria

### CDMCH-58: CLI Reference Auto-Generation
- [x] `scripts/tooling/generate_cli_reference.js` reads `oclif.manifest.json` and writes `docs/ops/cli-reference.md`
- [x] Generated markdown matches existing doc style: tables for flags, code blocks for examples, `##` per command
- [x] `npm run docs:cli` script added to `package.json`
- [x] `npm run docs:cli:check` script added (drift detection)
- [x] CI step added to `.github/workflows/ci.yml` after build step
- [x] Script fails fast with clear error if `oclif.manifest.json` is missing
- [x] Script warns to stderr for commands missing descriptions or examples
- [x] Auto-generated header comment in output file
- [x] All 17 commands documented with: description, usage, flags table, args, examples

### CDMCH-59: Architecture Diagram Integration
- [x] 5 Mermaid diagrams inlined in relevant `docs/architecture/` markdown files
- [x] 2 PlantUML diagrams converted to Mermaid and inlined (`deployment_resume_state`, `execution_flow`)
- [x] `component_overview.puml` linked with PlantUML render URL
- [x] All inlined Mermaid diagrams render correctly on GitHub (verified in PR preview)
- [x] Original source files kept in `docs/diagrams/` (not deleted)
- [x] Cross-references updated in affected docs

### CDMCH-62: API Reference Documentation
- [x] `docs/ops/api-reference.md` created with sections: Configuration Schema, CLI Commands (cross-ref), Key Types
- [x] Configuration schema documented with: field names, types, defaults, validation rules
- [x] 6 key domain types documented (Feature, ExecutionTask, PlanArtifact, ResearchTask, ApprovalRecord, Specification)
- [x] JSON config example validates against `RepoConfig` Zod schema
- [x] Cross-references to `cli-reference.md` and architecture docs
- [x] `scripts/tooling/validate_api_examples.js` validates config examples against Zod schemas
- [x] CI step validates API reference examples

## Success Metrics

- All 3 Linear Cycle 6 issues (`CDMCH-58`, `CDMCH-59`, `CDMCH-62`) moved to Done
- GitHub issues `#211`, `#212`, `#215`, `#424` closed
- CI passes with new drift checks enabled
- Generated CLI reference covers all 22 commands
- Zero broken cross-references between documentation files

## Dependencies & Risks

### Dependencies
- `oclif.manifest.json` must exist (generated by `npm run build` → `postbuild`)
- Zod schemas in `src/core/config/RepoConfig.ts` must be importable from script context

### Risks
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PlantUML conversion takes longer than expected | Medium | Only convert 2 easy ones, keep 1 as external link |
| 2-day timeline is tight for 3 PRs | Medium | Independent PRs — merge what's ready, defer remainder |
| Mermaid rendering issues on GitHub | Low | Test in PR preview before merge |
| `oclif.manifest.json` schema changes on oclif upgrade | Low | Script validates expected structure, fails gracefully |

### Priority if timeline slips
1. **CDMCH-58** — CLI reference (highest automation value, enables CI drift guard)
2. **CDMCH-62** — API reference (critical for contributors)
3. **CDMCH-59** — Diagram integration (nice-to-have improvement)

## Implementation Files

### New Files
| File | Purpose |
|------|---------|
| `scripts/tooling/generate_cli_reference.js` | CLI reference generator (reads manifest, writes markdown) |
| `scripts/tooling/validate_api_examples.js` | Validates JSON examples in API reference against Zod schemas |
| `docs/ops/api-reference.md` | API reference documentation |

### Modified Files
| File | Change |
|------|--------|
| `docs/ops/cli-reference.md` | Replaced with auto-generated version |
| `package.json` | Add `docs:cli` and `docs:cli:check` scripts |
| `.github/workflows/ci.yml` | Add docs drift check + API example validation steps |
| `docs/architecture/execution_flow.md` | Inline Mermaid diagram |
| `docs/architecture/component_index.md` | Inline Mermaid diagrams + PlantUML link |
| Various `docs/**/*.md` files | Inline remaining Mermaid diagrams |
| `CONTRIBUTING.md` | Add `npm run docs:cli` guidance for contributors |

### Reference Files (read-only)
| File | Used For |
|------|----------|
| `oclif.manifest.json` | Source data for CLI reference generation |
| `scripts/tooling/check_circular_deps.js` | CI drift check pattern reference |
| `src/core/config/RepoConfig.ts` | Zod schema extraction for API reference |
| `src/core/models/*.ts` | Key type definitions for API reference |
| `docs/diagrams/*.mmd` | Mermaid source for inlining |
| `docs/diagrams/*.puml` | PlantUML source for conversion/linking |

## Pseudo-Code

### `scripts/tooling/generate_cli_reference.js`

```javascript
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.resolve(__dirname, '../../oclif.manifest.json');
const OUTPUT_PATH = path.resolve(__dirname, '../../docs/ops/cli-reference.md');

// 1. Read and validate manifest
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('Error: oclif.manifest.json not found. Run "npm run build" first.');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// 2. Sort commands alphabetically, group by topic (pr, research, context, status, top-level)
const commands = Object.values(manifest.commands).sort((a, b) => a.id.localeCompare(b.id));

// 3. Generate markdown
let md = `<!-- AUTO-GENERATED from oclif.manifest.json. Do not edit manually. -->\n`;
md += `<!-- Run: npm run docs:cli to regenerate. -->\n\n`;
md += `# CLI Command Reference\n\n`;
md += `> Generated on ${new Date().toISOString().split('T')[0]} from oclif manifest.\n\n`;
md += generateTOC(commands);

for (const cmd of commands) {
  md += generateCommandSection(cmd);
}

// 4. Write output
fs.writeFileSync(OUTPUT_PATH, md);
console.log(`Generated ${OUTPUT_PATH} with ${commands.length} commands.`);

// -- Check mode (--check flag) --
if (process.argv.includes('--check')) {
  const committed = fs.readFileSync(OUTPUT_PATH, 'utf8');
  const fresh = md; // already generated above
  if (committed !== fresh) {
    console.error('Drift detected: docs/ops/cli-reference.md is out of date.');
    console.error('Run "npm run docs:cli" and commit the updated file.');
    process.exit(1);
  }
  console.log('No drift detected.');
  process.exit(0);
}
```

### `scripts/tooling/validate_api_examples.js`

```javascript
#!/usr/bin/env node
// 1. Read docs/ops/api-reference.md
// 2. Extract JSON code blocks tagged as config examples (between <!-- CONFIG_EXAMPLE --> markers)
// 3. Import RepoConfig Zod schema (from dist/ after build)
// 4. Validate each extracted example against schema
// 5. Report pass/fail per example, exit 1 if any fail
```

### CI integration in `.github/workflows/ci.yml`

```yaml
# After "Build project" step:
- name: Validate CLI reference (drift check)
  run: npm run docs:cli:check

- name: Validate API reference examples
  run: node scripts/tooling/validate_api_examples.js
```

### `package.json` additions

```json
{
  "scripts": {
    "docs:cli": "node scripts/tooling/generate_cli_reference.js",
    "docs:cli:check": "node scripts/tooling/generate_cli_reference.js --check"
  }
}
```

## References & Research

### Internal References
- Brainstorm: `docs/brainstorms/2026-02-10-documentation-tooling-decisions-brainstorm.md`
- CI check pattern: `scripts/tooling/check_circular_deps.js`
- oclif manifest generator: `scripts/tooling/oclif_manifest.js`
- Zod validation helpers: `src/validation/helpers.ts`
- Existing doc style: `docs/ops/init_playbook.md`, `docs/ops/doctor_reference.md`
- ADR-7: `docs/adr/ADR-7-validation-policy.md` (Zod usage patterns)

### Related Issues & PRs
- GitHub: #211, #212, #215, #424
- Linear: CDMCH-58, CDMCH-59, CDMCH-62
- Prior cycle: PR #422 (CONTRIBUTING.md), PR #423 (JSDoc)
