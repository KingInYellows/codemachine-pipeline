Orchestrator State Log
Last Sync: 2026-01-19T16:06:11Z

Active Queue
Priority | PR_ID | Branch_Name | Stack_Position | Status | Attempts
P1 | 85 | taskmapper-engine-guard | BASE | FAILED | 2
P2 | 86 | taskmapper-tests | LEAF | PENDING | 0
P2 | 84 | codemachine-runner-tests | LEAF | PENDING | 0
P2 | 87 | result-normalizer-tests | LEAF | PENDING | 0
P1 | 88 | log-rotation-config | BASE | FAILED | 2
P2 | 89 | log-rotation-impl | MIDDLE | PENDING | 0
P2 | 90 | log-rotation-tests | LEAF | PENDING | 0
P1 | 93 | parallel-exec-config | BASE | FAILED | 2
P2 | 94 | parallel-exec-engine | MIDDLE | PENDING | 0
P2 | 95 | parallel-exec-tests | LEAF | PENDING | 0
P1 | 96 | queue-append-format | BASE | PENDING | 3
P2 | 97 | queue-compaction | LEAF | PENDING | 0

Execution History
Synced with remote. Discovered 6 stacks.
Phase 1 complete for PR #85 (taskmapper-engine-guard).
npm test failed twice on taskmapper-engine-guard (codeMachineRunner.runner.spec.ts failures).
Phase 1 complete for PR #88 (log-rotation-config).
npm test failed twice on log-rotation-config (codeMachineRunner.runner.spec.ts failures).
Phase 1 complete for PR #93 (parallel-exec-config).
npm test failed twice on parallel-exec-config (codeMachineRunner.runner.spec.ts failures).
Phase 1 complete for PR #96 (queue-append-format).
npm test failed twice on queue-append-format (codeMachineRunner.runner.spec.ts failures).
Phase 3 complete for PR #85 (REJECTED; tests failed).
Phase 3 complete for PR #88 (REJECTED; tests failed).
Phase 3 complete for PR #93 (REJECTED; tests failed).
Phase 3 complete for PR #96 (REJECTED; tests failed).
Reopened PR #96 after fixing CodeMachineRunner env allowlist/buffer limit; npm test passed.
Submitted PR #96 update via gt submit --no-interactive.
