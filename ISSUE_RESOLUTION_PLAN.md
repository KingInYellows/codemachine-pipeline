# Issue Resolution Plan

## Selected Issue
- ID: 6
- Title: Update outdated major dependencies
- Labels: maintenance
- Selected via: Priority 3 (oldest open issue; skipping #3 fixed-pending-review)
- Source: gh issue list --search "sort:created-asc"

## Status
- Phase 0: Selected issue
- Phase 1: Stack plan created
- Phase 2: In progress (layer 3)
- Phase 3: Pending submission
- Phase 4: Pending verification

## Stack Progress
- Layer 1 (chore/eslint-9-migration): Complete
- Layer 2 (chore/zod-4-upgrade): Complete
- Layer 3 (chore/jest-30-upgrade): Pending

## Discovery Notes
- Issue requires sequencing: ESLint 9 migration, then Zod 4, then Jest 30.
- Current ESLint config uses .eslintrc.json with @typescript-eslint parser/plugin.

<stack_plan>
{
  "issue_id": 6,
  "estimated_complexity": "MEDIUM",
  "stack_strategy": [
    {
      "order": 1,
      "branch": "chore/eslint-9-migration",
      "intent": "Upgrade ESLint 9 and related tooling (eslint-config-prettier, @typescript-eslint, @types/node) and adjust lint config.",
      "files": [
        "package.json",
        "package-lock.json",
        ".eslintrc.json",
        "tsconfig.eslint.json"
      ]
    },
    {
      "order": 2,
      "branch": "chore/zod-4-upgrade",
      "intent": "Upgrade zod to 4.x and adapt schema usage/tests.",
      "files": [
        "package.json",
        "package-lock.json",
        "src/**",
        "tests/**"
      ]
    },
    {
      "order": 3,
      "branch": "chore/jest-30-upgrade",
      "intent": "Upgrade jest/ts-jest/@types/jest and adjust Jest config/tests.",
      "files": [
        "package.json",
        "package-lock.json",
        "jest.config.js",
        "test/**",
        "tests/**"
      ]
    }
  ]
}
</stack_plan>
