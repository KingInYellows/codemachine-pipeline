---
status: ready
priority: p2
issue_id: debt-018
category: architecture
severity: high
effort: large
confidence: 0.90
tags:
  - technical-debt
  - architecture
  - high
linear_issue_id: CDMCH-177
---

# God module start ts 950 LOC orchestration overload

## Category
architecture

## Severity / Effort
high / large (confidence: 0.90)

## Affected Files
- src/cli/commands/start.ts (lines 1-950)

## Description
start.ts is 950 lines and directly orchestrates the entire pipeline with 35+ import statements spanning every layer. Acts as a de facto workflow orchestrator rather than a thin CLI command.

## Suggested Remediation
Extract a PipelineOrchestrator class in src/workflows/. start.ts should parse flags, load config, delegate to the orchestrator, and format output.
