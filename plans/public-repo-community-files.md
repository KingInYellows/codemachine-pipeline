# Feature: Add Missing Community Files for Public Release

## Overview

The public repository transition plan (`plans/public-repository-transition.md`)
deferred `CODE_OF_CONDUCT.md` and did not include a PR template. Both are
standard community health files that signal a welcoming, well-maintained project.
Add them before the public announcement.

## Current State

- `CODE_OF_CONDUCT.md` — absent (explicitly deferred in transition plan item 3.4)
- `.github/pull_request_template.md` — absent (not in transition plan)
- All other community files are in place: LICENSE (MIT), README, CONTRIBUTING,
  SECURITY, issue templates (bug, feature, config.yml)

## Implementation Plan

- [x] **Step 1:** Create `CODE_OF_CONDUCT.md` at repo root
  - Use Contributor Covenant v2.1 (industry standard, adopted by Node.js, Rust,
    etc.)
  - Set contact method to GitHub Security Advisories (consistent with
    SECURITY.md)
  - Reference: https://www.contributor-covenant.org/version/2/1/code_of_conduct/

- [x] **Step 2:** Create `.github/pull_request_template.md`
  - Keep lightweight — match the project's existing issue template style
  - Sections: Summary (what/why), Test plan (how verified), Checklist
    (formatting, lint, tests, docs)
  - Reference existing CONTRIBUTING.md pre-submission checklist (format:check,
    lint, test, docs:links:check, build)

- [x] **Step 3:** Commit both files on a single branch and submit PR

## Acceptance Criteria

- `CODE_OF_CONDUCT.md` exists at repo root with Contributor Covenant v2.1 text
- `.github/pull_request_template.md` exists and renders correctly on new PRs
- No CI regressions (both are markdown-only, but verify docs-validation passes)

## References

- Transition plan: `plans/public-repository-transition.md` (items 3.4, 3.6)
- Existing issue templates: `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`
- CONTRIBUTING.md pre-submit checklist (lines 225-232)
- Contributor Covenant: https://www.contributor-covenant.org/version/2/1/code_of_conduct/
