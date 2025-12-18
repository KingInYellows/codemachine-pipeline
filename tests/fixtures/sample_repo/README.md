# Sample Fixture Repository

This is a minimal fixture repository used for smoke testing the AI feature pipeline execution flows.

## Purpose

This repository serves as a deterministic test environment for validating:
- Context gathering from repository structure
- PRD generation from minimal prompts
- Spec generation from PRD artifacts
- Plan generation from spec artifacts
- Patch application workflows
- Validation command execution
- Resume/recovery flows

## Structure

- `.ai-feature-pipeline/config.json` - Repository configuration
- `package.json` - Basic Node.js project manifest
- `src/` - Stub source code directory
- `docs/` - Stub documentation directory
