# Specification Composer Blueprint

## Overview

The Specification Composer converts an approved Product Requirements Document (PRD) plus research findings into a structured engineering specification (`spec.md`) that includes technical constraints, test plans, rollout strategies, and risk assessments. This blueprint describes the architecture, data flows, and integration points for the spec authoring workflow.

## Purpose

- **Transform PRD to Spec**: Bridge product requirements and engineering implementation
- **Enforce Approval Gates**: Ensure PRD approval before spec generation (ADR-5)
- **Enable Traceability**: Maintain links from PRD goals → spec sections → execution tasks (FR-9)
- **Surface Unknowns**: Detect incomplete sections and trigger additional research (FR-6)
- **Support Iterative Refinement**: Enable CLI editing loops with change log tracking

## Architecture

### Core Components

#### 1. Specification Composer (`src/workflows/specComposer.ts`)

**Responsibilities:**
- Validate PRD approval status before composition
- Load PRD metadata and markdown content
- Extract structured sections (problem, goals, acceptance criteria, risks)
- Generate technical constraints from repo config and context
- Transform PRD risks into risk assessments with severity levels
- Build test plans from acceptance criteria
- Generate rollout plans based on risk profile
- Detect unknowns (TODO/TBD markers, unresolved questions)
- Persist spec artifacts (spec.md, spec.json, spec_metadata.json)
- Record approvals with hash verification

**Key Functions:**
- `composeSpecification(config, logger, metrics) → SpecComposerResult`
- `recordSpecApproval(runDir, featureId, options, logger, metrics) → ApprovalRecord`
- `loadSpecMetadata(runDir) → SpecMetadata | null`
- `isSpecApproved(runDir) → boolean`

#### 2. Specification Model (`src/core/models/Specification.ts`)

**Responsibilities:**
- Define zod schema for Specification entities
- Validate spec JSON structure
- Provide serialization/deserialization helpers
- Support change log management (`addChangeLogEntry`)
- Track reviewer info and approval status

**Key Helpers:**
- `createSpecification(specId, featureId, title, content, options) → Specification`
- `addChangeLogEntry(spec, author, description, version) → Specification`
- `isFullyApproved(spec) → boolean`
- `formatSpecificationValidationErrors(errors) → string`

### Data Flows

```
┌─────────────┐
│ CLI Command │ (codepipe start --spec)
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ Verify PRD Approval     │ (isPRDApproved)
└──────┬──────────────────┘
       │ ✓ Approved
       ▼
┌─────────────────────────┐
│ Load PRD Metadata       │ (prd_metadata.json, prd.md)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Extract PRD Sections    │ (problem, goals, risks, etc.)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Generate Components:    │
│ - Constraints           │ (from RepoConfig + Context)
│ - Risk Assessments      │ (from PRD + ResearchTasks)
│ - Test Plan             │ (from Acceptance Criteria)
│ - Rollout Plan          │ (based on Risk Severity)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Build Spec Content      │ (Markdown + Structured JSON)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Detect Unknowns         │ (TODO/TBD markers, open questions)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Persist Artifacts:      │
│ - spec.md               │
│ - spec.json             │
│ - spec_metadata.json    │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Compute SHA-256 Hash    │ (for approval verification)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Return Diagnostics      │ (unknowns, warnings, citations)
└─────────────────────────┘
```

### Approval Workflow

```
┌─────────────┐
│ User Review │ (reads spec.md)
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ CLI Approval Command    │ (codepipe approve spec)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Load Spec Metadata      │ (spec_metadata.json)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Verify Hash Match       │ (current hash vs. metadata hash)
└──────┬──────────────────┘
       │ ✓ Match
       ▼
┌─────────────────────────┐
│ Create Approval Record  │ (APR-<timestamp>-<id>.json)
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Update Metadata         │ (approvalStatus: 'approved')
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Append to approvals.json│
└─────────────────────────┘
```

## Spec Content Structure

### Generated `spec.md` Sections

1. **Document Information**
   - Spec ID, Feature ID, timestamps
   - Status, PRD hash reference

2. **Specification Overview**
   - Problem statement
   - Goals and non-goals
   - Acceptance criteria

3. **Technical Constraints**
   - Repo-level policies (rate limits, allowed commands)
   - Performance requirements (P95 latency)
   - Scalability targets (concurrent users)
   - Quality gates (test coverage, security)
   - Backward compatibility requirements

4. **Test Plan**
   - Unit tests (per constraint)
   - Integration tests (per acceptance criterion)
   - End-to-end tests
   - Test IDs, types, and acceptance criteria

5. **Rollout Plan**
   - Strategy (canary, gradual, all_at_once, blue_green)
   - Phases (percentage, duration)
   - Rollback plan

6. **Risk Assessment**
   - Risk descriptions
   - Severity levels (low, medium, high, critical)
   - Mitigation strategies
   - Risk owners

7. **Referenced File Globs**
   - Context-derived directory globs (e.g., `src/**/*.ts`)
   - RepoConfig `project.context_paths` and safety allowlist patterns
   - Input for ExecutionTask path scoping

8. **Referenced Files**
   - Specific context files cited (top N paths for review convenience)

9. **Change Log**
   - Version history
   - Author, timestamp, description

10. **Traceability**
   - PRD hash linkage
   - PRD trace ID
   - Execution plan reference (post-approval)

## Integration with ExecutionTask Mapping

After spec approval, the Task Planner (I2.T6) consumes `spec.json` to generate `plan.json`:

| Spec Section          | ExecutionTask Category   | Dependency Logic                          |
|-----------------------|--------------------------|-------------------------------------------|
| Technical Constraints | `validation`             | Run before code_generation                |
| Test Plan (unit)      | `testing`                | Run after code_generation                 |
| Test Plan (e2e)       | `testing`                | Run after integration tests               |
| Rollout Plan Phase 1  | `deployment`             | Requires all tests to pass                |
| Rollout Plan Phase N  | `deployment`             | Sequential, gated by previous phase       |
| Referenced Files      | `code_generation` inputs | File paths inform agent prompts           |

## CLI Commands

### Generate Specification
```bash
codepipe start --spec
# OR
codepipe spec draft
```

**Effects:**
- Checks PRD approval (exit code 30 if unapproved)
- Generates `spec.md`, `spec.json`, `spec_metadata.json`
- Logs diagnostics (unknowns, warnings)

### Approve Specification
```bash
codepipe approve spec --signer <user> --rationale "Reviewed and approved"
```

**Effects:**
- Verifies hash match
- Creates `APR-<id>.json` approval record
- Updates `spec_metadata.json` approval status
- Enables next stage (Task Planner)

### Edit Specification
```bash
codepipe spec edit --section constraints --add "New constraint"
```

**Effects:**
- Updates `spec.md` content
- Adds change log entry
- Recomputes hash
- Resets approval status to `pending` (requires re-approval)

### Status Check
```bash
codepipe status --json
```

**Output includes:**
- Spec approval status
- Detected unknowns
- Change log summary
- Hash references

## Error Handling

| Error Condition                     | Exit Code | Message                                                |
|-------------------------------------|-----------|--------------------------------------------------------|
| PRD not approved                    | 30        | "PRD must be approved before generating specification" |
| PRD metadata missing                | 20        | "PRD metadata not found. Generate PRD first."          |
| Spec hash mismatch on approval      | 40        | "Spec content changed. Regenerate or update metadata." |
| Invalid spec schema                 | 50        | "Specification validation failed: <errors>"            |
| File I/O errors                     | 60        | "Failed to write spec artifacts: <reason>"             |

## Performance Characteristics

- **Latency**: Spec composition typically completes in < 2 seconds (no external API calls)
- **Storage**: Spec artifacts consume ~50-200 KB (depends on content size)
- **Concurrency**: Uses `withLock` to ensure atomic writes to run directory
- **Caching**: Not applicable (spec is generated once per PRD approval)

## Testing Strategy

### Unit Tests (`tests/unit/specComposer.spec.ts`)

1. **PRD Approval Gate**
   - ✓ Throws error when PRD unapproved
   - ✓ Proceeds when PRD approved

2. **Section Extraction**
   - ✓ Extracts problem statement from PRD markdown
   - ✓ Parses goals, non-goals, acceptance criteria
   - ✓ Handles malformed markdown gracefully

3. **Constraint Generation**
   - ✓ Includes repo config constraints
   - ✓ Infers performance/scalability requirements
   - ✓ Adds default quality gates

4. **Risk Assessment**
   - ✓ Converts PRD risks to structured assessments
   - ✓ Assigns severity levels correctly
   - ✓ Incorporates research findings

5. **Test Plan Generation**
   - ✓ Creates unit tests for constraints
   - ✓ Creates integration tests for acceptance criteria
   - ✓ Adds E2E test placeholder

6. **Rollout Plan**
   - ✓ Uses canary strategy for high-risk features
   - ✓ Uses gradual strategy for low-risk features
   - ✓ Includes rollback plan

7. **Unknown Detection**
   - ✓ Detects TODO/TBD markers
   - ✓ Flags unresolved PRD questions
   - ✓ Returns suggested research objectives

8. **Approval Recording**
   - ✓ Verifies hash match before approval
   - ✓ Creates approval record with metadata
   - ✓ Updates spec_metadata.json status
   - ✓ Rejects approval if hash mismatched

9. **File Persistence**
   - ✓ Writes spec.md with correct structure
   - ✓ Writes spec.json with valid schema
   - ✓ Writes spec_metadata.json with hash
   - ✓ Uses withLock for atomicity

### Integration Tests (Future)

- Test full PRD → Spec → Plan pipeline
- Verify traceability links persist correctly
- Test resume behavior after spec editing

## Security Considerations

- **Hash Verification**: SHA-256 hashes prevent tampering between generation and approval
- **Approval Immutability**: Once approved, spec hash is locked; edits require re-approval
- **Secret Redaction**: Spec content must not include raw secrets from context/research
- **File Path Validation**: Referenced files must be within repo root (prevent path traversal)

## Future Enhancements

1. **Agent-Assisted Drafting**: Use LLM to generate spec prose from PRD outline
2. **Constraint Templates**: Pre-defined constraint sets for common patterns (REST API, CLI, library)
3. **Test Plan Automation**: Generate test skeletons in target files based on test plan
4. **Rollout Simulation**: Model rollout phases with synthetic traffic data
5. **Diff Visualization**: Show before/after changes when editing spec sections

## Related Documents

- **ADR-5**: Approval Workflow (approval gates, hash verification)
- **FR-9**: Traceability (PRD → Spec → ExecutionTask mapping)
- **FR-10**: Specification Authoring (structured spec format)
- **02_System_Structure_and_Data.md**: Specification entity schema
- **01_Blueprint_Foundation.md**: Component responsibilities

## Revision History

| Version | Date       | Author       | Changes                          |
|---------|------------|--------------|----------------------------------|
| 1.0.0   | 2025-01-15 | AI Pipeline  | Initial blueprint specification  |
