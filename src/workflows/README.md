# Workflows

Core business logic for the codemachine pipeline. Orchestrates execution
strategies, context aggregation, spec composition, task planning, resume
coordination, write actions, and queue management.

## Key Exports

The barrel (`index.ts`) exports only the public strategy contract:

- `ExecutionStrategy` — pluggable execution strategy interface
- `ExecutionContext` — context passed to strategy `execute()`
- `ExecutionStrategyResult` — result shape with status, recoverable flag
- `CodeMachineCLIStrategy` / `createCodeMachineCLIStrategy` — primary execution strategy
- `CodeMachineEngineTypeSchema` / `CODEMACHINE_STRATEGY_NAMES` — strategy type definitions

Most internal modules are imported by direct path (not through the barrel).

## Structure

### Execution Engine

- `cliExecutionEngine.ts` — main execution engine orchestrating task runs
- `executionDependencyResolver.ts` — resolves task execution order and parallelism
- `executionTelemetryRecorder.ts` — records telemetry during execution
- `executionArtifactCapture.ts` — captures execution artifacts
- `executionStrategy.ts` — strategy interface definitions
- `executionStrategyBuilder.ts` — builds strategy instances from config
- `codeMachineStrategy.ts` — legacy CodeMachine strategy (fallback)
- `codeMachineCLIStrategy.ts` — preferred CLI-based strategy
- `strategyHelpers.ts` — shared strategy utilities

### Resume

- `resumeCoordinator.ts` — coordinates resume from interrupted runs
- `runStateVerifier.ts` — verifies run state consistency
- `resumeIntegrityChecker.ts` — validates integrity before resume
- `resumeQueueRecovery.ts` — recovers queue state during resume
- `resumeTypes.ts` — resume-specific type definitions

### Context

- `contextAggregator.ts` — aggregates context from multiple sources
- `contextSummarizer.ts` — summarizes large context for LLM consumption
- `contextBudget.ts` — manages token budget allocation
- `contextRanking.ts` — ranks context items by relevance
- `contextDocumentBuilder.ts` — builds structured context documents
- `contextFileDiscovery.ts` — discovers relevant files for context

### Queue

- `queue/` — 8-file queue subsystem
  - `queueStore.ts` — persistent queue storage
  - `queueTaskManager.ts` — task lifecycle management
  - `queueV2Api.ts` — V2 queue API
  - `queueMemoryIndex.ts` — in-memory index for fast lookups
  - `queueOperationsLog.ts` — operation audit log
  - `queueSnapshotManager.ts` — queue state snapshots
  - `queueCompactionEngine.ts` — log compaction
  - `queueTypes.ts` — queue type definitions

### Spec

- `specComposer.ts` — composes specification documents
- `specParsing.ts` — parses spec format
- `specMetadata.ts` — spec metadata extraction
- `specMarkdown.ts` — markdown rendering for specs
- `specStore.ts` — spec persistence

### Task Planning

- `taskPlanner.ts` — high-level task planning
- `plannerDAG.ts` — directed acyclic graph for task dependencies
- `plannerPersistence.ts` — plan state persistence
- `taskPlannerGraph.ts` — graph-based planning
- `taskPlannerTypes.ts` — planning type definitions
- `taskMapper.ts` — maps tasks between representations
- `planDiffer.ts` — diffs plan changes

### Other

- `pipelineOrchestrator.ts` — top-level pipeline orchestration
- `commandRunner.ts` — shell command execution
- `summaryOrchestration.ts` — context chunk processing
- `summaryStore.ts` — summary persistence
- `summarizerClients/` — LLM summarizer client implementations
- `deployment/` — deployment-related workflows
- `writeActionQueue.ts` / `writeActionStore.ts` / `writeActionRateLimiter.ts` — write action management
- `branchManager.ts` / `branchComplianceChecker.ts` / `branchProtectionReporter.ts` — branch management
- `approvalRegistry.ts` — approval gate tracking
- `validationRegistry.ts` / `validationStore.ts` — validation management
- `traceabilityMapper.ts` — maps artifacts to traceability links
- `linearIssueLoader.ts` — loads Linear issue context
- `researchCoordinator.ts` / `researchDetection.ts` — research task coordination
- `prdStore.ts` / `prdAuthoringEngine.ts` — PRD management
- `autoFixEngine.ts` — automated fix application
- `resultNormalizer.ts` — normalizes execution results
- `patchManager.ts` — manages code patches

## Dependencies

Imports from: `core`, `utils`, `validation`, `telemetry`, `persistence`, `adapters`

Depended on by: `cli`
