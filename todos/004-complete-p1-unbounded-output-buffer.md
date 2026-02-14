---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, performance, reliability, pr-466]
dependencies: []
---

# Unbounded Output Buffer in CodeMachineCLIAdapter

## Problem Statement

`CodeMachineCLIAdapter` accumulates stdout/stderr into arrays without any size limit, while the older `codeMachineRunner.ts` has a bounded buffer with `maxBuffer` check (lines 340-343, 404-416). A long-running CodeMachine process producing large output could cause OOM.

## Findings

- **Performance Oracle OPT-4**: No maxBuffer equivalent in adapter
- **Architecture Strategist**: Old runner has bounded buffer pattern that should be replicated

## Proposed Solutions

### Option A: Port maxBuffer pattern from codeMachineRunner (Recommended)
- Add `totalBufferSize` tracking and `bufferLimitReached` flag (same as runner lines 338-343)
- When limit reached, stop accumulating in-memory and log warning
- Use same `DEFAULT_MAX_BUFFER_SIZE` (10 MB) or configurable via `ExecutionConfig.max_log_buffer_size`
- **Pros**: Consistent with existing pattern, prevents OOM
- **Cons**: Truncates output on large runs
- **Effort**: Small
- **Risk**: Low

### Option B: Stream to file, read back on completion
- Always write to log file, only keep last N bytes in memory
- **Pros**: No data loss
- **Cons**: More complex, requires log path always be available
- **Effort**: Medium
- **Risk**: Low

## Technical Details

- **Affected files**: `src/adapters/codemachine/CodeMachineCLIAdapter.ts`
- **Reference**: `src/workflows/codeMachineRunner.ts:338-416` for existing bounded buffer pattern

## Acceptance Criteria

- [ ] Output buffer has configurable size limit
- [ ] Warning logged when limit reached
- [ ] Process continues executing even after buffer limit
- [ ] Tests verify buffer limiting behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #466 review | Old runner already solved this — port the pattern |
| 2026-02-13 | Approved during triage | Batch-approved all 16 findings |

## Resources

- PR: #466
- Files: `CodeMachineCLIAdapter.ts`, `codeMachineRunner.ts:338-416`
