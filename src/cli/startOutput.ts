/**
 * Start Command Output
 *
 * Formatting functions for the start command's terminal and JSON output.
 */

import * as path from 'node:path';
import type { StartFlags } from './startHelpers.js';

export interface StartResultPayload {
  feature_id: string;
  run_dir: string;
  source: string;
  status: 'awaiting_prd_approval' | 'completed' | 'execution_complete';
  context: {
    files: number;
    total_tokens: number;
    warnings: string[];
  };
  research: {
    tasks_detected: number;
    pending: number;
  };
  prd: {
    path: string;
    hash: string;
    diagnostics: {
      incompleteSections: string[];
      warnings: string[];
    };
  };
  execution?: {
    total_tasks: number;
    completed: number;
    failed: number;
    duration_ms: number;
  };
  approvals: {
    required: boolean;
    pending: string[];
  };
}

type LogFn = (message: string) => void;

export function emitStartSummary(
  payload: StartResultPayload,
  jsonMode: boolean,
  log: LogFn,
  warn: LogFn
): void {
  if (jsonMode) {
    log(JSON.stringify(payload, null, 2));
    return;
  }

  log('');
  log(`🚀 Feature run created: ${payload.feature_id}`);
  log(`Run directory: ${path.relative(process.cwd(), payload.run_dir)}`);
  log(`Context files analyzed: ${payload.context.files}`);
  log(`Research tasks detected: ${payload.research.tasks_detected}`);
  log(`PRD written to: ${payload.prd.path}`);
  log(`PRD hash: ${payload.prd.hash}`);

  if (payload.context.warnings.length > 0) {
    log('\nContext warnings:');
    payload.context.warnings.forEach((w) => log(`  • ${w}`));
  }

  if (payload.prd.diagnostics.warnings.length > 0) {
    log('\nPRD warnings:');
    payload.prd.diagnostics.warnings.forEach((w) => log(`  • ${w}`));
  }

  if (payload.execution) {
    log('\nExecution results:');
    log(`  Total tasks: ${payload.execution.total_tasks}`);
    log(`  Completed: ${payload.execution.completed}`);
    log(`  Failed: ${payload.execution.failed}`);
    log(`  Duration: ${(payload.execution.duration_ms / 1000).toFixed(2)}s`);

    if (payload.execution.failed > 0) {
      warn(`${payload.execution.failed} task(s) failed. Use 'codepipe resume' to retry.`);
    }
  }

  if (payload.approvals.required) {
    log('\n✅ PRD draft created. Approval required before continuing.');
    log(`Review the document at ${payload.prd.path}, then run:`);
    log(`  codepipe approve prd --feature ${payload.feature_id} --signer "<email>"`);
    log('Need edits? Request revisions via: codepipe prd edit --request "<details>"');
    log('');
  } else if (!payload.execution) {
    log('\nPRD approved automatically based on configuration.');
    log('The --skip-execution flag was used or execution was skipped.');
  } else {
    log('\nPipeline execution completed.');
  }
}

export function outputDryRunPlan(flags: StartFlags, jsonMode: boolean, log: LogFn): void {
  const steps = [
    'Load repo configuration and verify git repository',
    'Create feature run directory and manifest',
    'Aggregate context files under configured globs',
    'Detect unknowns to queue research tasks',
    'Render PRD draft using configured PRD template',
    'Record PRD hash for approval workflow',
  ];

  if (!flags['skip-execution']) {
    steps.push('Execute queued tasks via CLIExecutionEngine');
    steps.push(`  - Max parallel tasks: ${flags['max-parallel'] ?? 1}`);
  }

  const plan = {
    status: 'dry_run',
    message: 'Dry-run mode previews the planned steps without creating artifacts.',
    planned_steps: steps,
    input: {
      prompt: flags.prompt,
      linear: flags.linear,
      spec: flags.spec,
      max_parallel: flags['max-parallel'],
      skip_execution: flags['skip-execution'],
    },
  };

  if (jsonMode) {
    log(JSON.stringify(plan, null, 2));
  } else {
    log('\nℹ️  Dry-run preview (no files written):\n');
    plan.planned_steps.forEach((step) => log(`  • ${step}`));
    log('');
  }
}
