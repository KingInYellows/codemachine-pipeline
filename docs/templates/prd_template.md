---
# PRD Metadata
feature_id: {{FEATURE_ID}}
title: {{TITLE}}
created_at: {{CREATED_AT}}
updated_at: {{UPDATED_AT}}
status: draft
version: 1.0.0
---

# Product Requirements Document: {{TITLE}}

## Document Information

- **Feature ID:** `{{FEATURE_ID}}`
- **Created:** {{CREATED_AT}}
- **Last Updated:** {{UPDATED_AT}}
- **Status:** {{STATUS}}
- **Author:** {{AUTHOR}}

## Problem Statement

<!-- Describe the problem or opportunity this feature addresses. Include:
- What is the current pain point or gap?
- Who is experiencing this problem?
- What is the business or user impact?
- What happens if we don't solve this? -->

{{PROBLEM_STATEMENT}}

## Goals

<!-- List the primary objectives this feature aims to achieve. Each goal should be:
- Specific and measurable
- Aligned with business or product strategy
- Achievable within scope
- Time-bound where appropriate -->

{{GOALS}}

## Non-Goals

<!-- Explicitly state what this feature will NOT address. This helps set boundaries and manage expectations. Include:
- Related features that are out of scope
- Adjacent problems that won't be solved
- Future enhancements that are deferred -->

{{NON_GOALS}}

## Success Criteria & Acceptance Criteria

<!-- Define how we will measure success and know when the feature is complete. Include:
- Quantitative metrics (e.g., adoption rate, performance benchmarks)
- Qualitative criteria (e.g., user satisfaction, usability goals)
- Technical acceptance criteria (e.g., test coverage, performance targets)
- Functional acceptance criteria (e.g., specific behaviors, workflows) -->

{{ACCEPTANCE_CRITERIA}}

## Risks & Mitigations

<!-- Identify potential risks and how they will be mitigated. Consider:
- Technical risks (e.g., complexity, dependencies, scalability)
- Business risks (e.g., adoption, timeline, resource constraints)
- Operational risks (e.g., maintenance, support burden)
- Security/compliance risks
For each risk, propose mitigation strategies. -->

{{RISKS}}

## Open Questions

<!-- List unresolved questions that require research or stakeholder input. These will be tracked as ResearchTasks. Include:
- Technical unknowns requiring investigation
- Design decisions pending stakeholder input
- Dependencies on external systems or teams
- Assumptions that need validation -->

{{OPEN_QUESTIONS}}

## Context & Research Citations

<!-- Reference context documents and research outputs that informed this PRD. This section is auto-populated by the PRD authoring engine. -->

### Context Sources

{{CONTEXT_CITATIONS}}

### Research Tasks

{{RESEARCH_CITATIONS}}

## Traceability

<!-- Links to related artifacts and requirements. Auto-populated by the system. -->

- **Trace ID:** `{{TRACE_ID}}`
- **Related Specifications:** {{SPEC_LINKS}}
- **Related Tasks:** {{TASK_LINKS}}

## Approval

<!-- Approval metadata is recorded in approvals.json. This section provides a human-readable summary. -->

- **Approval Status:** {{APPROVAL_STATUS}}
- **Approved By:** {{APPROVED_BY}}
- **Approval Date:** {{APPROVAL_DATE}}
- **Approval Hash:** `{{APPROVAL_HASH}}`

---

**Instructions for Reviewers:**

1. Review all sections for completeness and clarity
2. Verify that goals are achievable and acceptance criteria are measurable
3. Check that all open questions are captured (these will become ResearchTasks)
4. Validate that risks are identified and mitigations are reasonable
5. To request changes, use the CLI command: `codepipe prd edit --request "your feedback"`
6. To approve, use the CLI command: `codepipe approve prd`

**Template Version:** 1.0.0
**Last Updated:** 2024-01-15
