<!-- anchor: verification-and-integration-strategy -->
## 6. Verification and Integration Strategy

*   **Testing Levels:**
    - Unit tests (vitest) for config loaders, HTTP client, adapters, planner, queue, approval registry, PRD/spec engines, resume logic; each new module must include positive/negative cases with fixture coverage.
    - Integration tests using fixture repos + mocked APIs for context aggregator, research coordinator, execution engine, GitHub/Linear adapters, deployment trigger module, export builder, cleanup command.
    - Smoke/E2E tests scripted via `scripts/smoke_cli.sh` to exercise `ai-feature init`, `start`, `plan`, `run`, `status`, `resume`, `pr`, `deploy`, `export`, and `cleanup` flows with deterministic artifacts.
    - Observability assertions verifying logs/metrics/traces/rate-limit ledgers exist per run; CLI commands must fail fast when telemetry missing.
*   **CI/CD:**
    - GitHub Actions pipeline running lint, test, build, smoke CLI, and Docker build on every PR; nightly job regenerates docs/diagrams from templates and verifies PlantUML/Mermaid renders.
    - Contract tests against recorded fixtures executed in CI to detect API drift; include `npm run refresh-fixtures` manual step with review gate.
    - Docker image publish job on tagged releases ensuring pinned Node v24 base and deterministic lockfile.
    - Release pipeline generates changelog + plan manifest snapshot for downstream automation.
*   **Code Quality Gates:**
    - ESLint + prettier required; tsconfig strictness enforced; coverage thresholds (80% unit, 70% integration) with trend reporting in KPIs.
    - Validation registry definitions must accompany module changes affecting lint/test/build commands; Schema validation scripts fail build if JSON schemas outdated.
    - Security scanning via `npm audit --production` and optional Snyk job; log redaction unit tests ensure sensitive tokens masked.
*   **Artifact Validation:**
    - Run-directory validator script verifying required files + hash manifests executed during smoke tests; `ai-feature export --verify` validates bundle completeness before success.
    - OpenAPI spec linted via Spectral; diagrams validated using CLI wrappers around PlantUML/Mermaid to catch syntax errors.
    - Rate-limit ledger parser ensures entries contain limit/remaining/reset and sorts by timestamp; resume guard rejects corrupted manifests.
*   **Integration Readiness:**
    - GitHub + Linear adapters rely on recorded fixtures plus sandbox tokens for manual verification; before release, run manual pilot hitting real APIs with fine-grained PAT + Linear API key.
    - Agent manifests tested using stub provider to ensure compatibility even when remote provider unavailable; fallback path documented and exercised.
    - Observability outputs shot into sample dashboards (Prometheus textfile importer) to confirm metrics clarity; watchers tested on homelab cron.
*   **Verification Governance:**
    - QA sign-off checklist mapping requirements FR/IR/NFR to tests before iteration closure; results logged in `.codemachine/reports/I[n]_summary.md`.
    - Regression suite executed after every iteration merges; failures escalate via notification adapter.

<!-- anchor: glossary -->
## 7. Glossary

*   **Approval Registry:** Service + file (`approvals.json`) storing gate decisions (artifact hash, signer, stage, timestamp) to enforce FR-11 across CLI workflows.
*   **Artifact Bundle:** Export produced by `ai-feature export/diagnostics` containing manifest, context manifests, PRD/spec/plan, logs, metrics, traces, diffs, API transcripts, and compliance metadata.
*   **Context Manifest:** JSON listing files, hashes, token costs, redaction flags, retrieval timestamps used for agent prompts; resides under each run directory.
*   **ExecutionTask:** Planned unit of work (code generation, validation, PR, deployment) stored in `plan.json` and executed via queue/engine with retry policy + dependencies.
*   **Feature Run Directory:** `.ai-feature-pipeline/<feature_id>/` folder containing deterministic artifacts, telemetry, approvals, rate-limit ledgers, bundles, and traces enabling resumability.
*   **HTTP Ledger:** `rate_limits.json` file capturing provider limit/remaining/reset/backoff info enabling rate-limit aware retries.
*   **Observer Report:** Output of `ai-feature observe` summarizing KPIs, anomalies, merged runs, backlog tasks for ops review.
*   **Plan Checksum:** Hash stored with `plan.json` to detect modifications, ensuring resume + execution engine operate on verified DAG.
*   **Validation Registry:** Config describing lint/test/build/typecheck commands, env vars, gating semantics referenced by execution engine before PR/deploy operations.
*   **Workflow Dispatch:** GitHub Action invocation triggered via adapter/CLI to start deployment automation after PR approval.
