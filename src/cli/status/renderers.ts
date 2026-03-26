/**
 * Human-readable renderers for the status dashboard.
 *
 * Converts a {@link StatusPayload} into formatted terminal output, section by
 * section. Used by `codepipe status` when `--json` is not set.
 *
 * @module
 */

import type { StatusPayload, StatusFlags, StatusBranchProtectionPayload } from './types';

/** Callbacks for emitting output lines and warnings. */
export interface RenderCallbacks {
  /** Write an informational line to stdout. */
  log: (msg: string) => void;
  /** Write a warning line to stderr or a highlighted stream. */
  warn: (msg: string) => void;
}

/**
 * Render the full status dashboard as human-readable terminal output.
 *
 * Iterates through every section (header, queue, approvals, context, plan,
 * validation, traceability, branch protection, rate limits, integrations,
 * research, footer) and writes formatted lines via the provided callbacks.
 *
 * @param payload - Fully assembled status data.
 * @param flags - CLI flags controlling verbosity and cost display.
 * @param callbacks - Output callbacks for log and warn lines.
 */
export function renderHumanReadable(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  renderHeaderSection(payload, callbacks);
  renderQueueSection(payload, flags, callbacks);
  renderApprovalsSection(payload, flags, callbacks);
  renderContextSection(payload, flags, callbacks);
  renderPlanSection(payload, flags, callbacks);
  renderValidationSection(payload, callbacks);
  renderTraceabilitySection(payload, flags, callbacks);

  if (payload.branch_protection) {
    renderBranchProtection(payload.branch_protection, flags, callbacks);
  }

  renderRateLimitsSection(payload, flags, callbacks);
  renderIntegrationsSection(payload, flags, callbacks);
  renderResearchSection(payload, callbacks);
  renderFooterSection(payload, flags, callbacks);
}

function renderHeaderSection(payload: StatusPayload, callbacks: RenderCallbacks): void {
  const { log } = callbacks;

  log('');
  log(`Feature: ${payload.feature_id ?? '(none detected)'}`);
  if (payload.title) {
    log(`Title: ${payload.title}`);
  }
  if (payload.source) {
    log(`Source: ${payload.source}`);
  }
  log(`Manifest: ${payload.manifest_path}`);
  log(`Status: ${payload.status}`);
  log(`Last step: ${payload.last_step ?? 'not recorded'}`);

  if (payload.last_error) {
    log(
      `Last error: ${payload.last_error.step} — ${payload.last_error.message} (${payload.last_error.recoverable ? 'recoverable' : 'fatal'})`
    );
  } else {
    log('Last error: none recorded');
  }
}

function renderQueueSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log } = callbacks;

  if (payload.queue) {
    log(
      `Queue: pending=${payload.queue.pending_count} completed=${payload.queue.completed_count} failed=${payload.queue.failed_count}`
    );
    if (flags.verbose && payload.queue.sqlite_index) {
      log(`Queue SQLite index: ${payload.queue.sqlite_index.database}`);
    }
  } else {
    log('Queue: manifest data unavailable');
  }
}

function renderApprovalsSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (!payload.approvals) return;

  log(
    `Approvals: pending=${payload.approvals.pending.length} completed=${payload.approvals.completed.length}`
  );

  if (payload.approvals.pending.length > 0) {
    log('');
    warn('\u26a0 Pending approvals required:');
    payload.approvals.pending.forEach((gate) => {
      warn(
        `  \u2022 ${gate.toUpperCase()} - Review artifact and run: codepipe approve ${gate} --signer "<your-email>"`
      );
    });
  }

  if (flags.verbose && payload.approvals.completed.length > 0) {
    log('Completed approvals:');
    payload.approvals.completed.forEach((gate) => {
      log(`  \u2022 ${gate.toUpperCase()}`);
    });
  }
}

function renderContextSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (!payload.context) return;

  if (payload.context.error) {
    warn(`Context summaries unavailable: ${payload.context.error}`);
  } else {
    log(
      `Context: files=${payload.context.files ?? 0} summaries=${payload.context.summaries ?? 0} total_tokens=${payload.context.total_tokens ?? 0}`
    );
    if (payload.context.budget_warnings && payload.context.budget_warnings.length > 0) {
      warn(`Context budget warnings: ${payload.context.budget_warnings.join(' | ')}`);
    }
    if (payload.context.warnings && payload.context.warnings.length > 0) {
      warn(`Context summarization warnings: ${payload.context.warnings.join(' | ')}`);
    }
    if (
      flags.verbose &&
      payload.context.summaries_preview &&
      payload.context.summaries_preview.length > 0
    ) {
      log('Context summary preview:');
      for (const preview of payload.context.summaries_preview) {
        log(`  - ${preview.file_path} (${preview.chunk_id}): ${preview.summary}`);
      }
    }
  }
}

function renderPlanSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log } = callbacks;

  if (!payload.plan) return;

  if (payload.plan.plan_exists) {
    log(
      `Plan: ${payload.plan.total_tasks} tasks (${payload.plan.entry_tasks} entry, ${payload.plan.blocked_tasks} blocked)`
    );
    if (payload.plan.dag_metadata) {
      log(
        `DAG: parallel_paths=${payload.plan.dag_metadata.parallel_paths ?? 'N/A'} depth=${payload.plan.dag_metadata.critical_path_depth ?? 'N/A'}`
      );
    }
    if (flags.verbose && payload.plan.task_type_breakdown) {
      log('Task types:');
      for (const [taskType, count] of Object.entries(payload.plan.task_type_breakdown)) {
        log(`  \u2022 ${taskType}: ${count}`);
      }
    }
    if (flags.verbose && payload.plan.checksum) {
      log(`Plan checksum: ${payload.plan.checksum.substring(0, 16)}...`);
    }
  } else {
    log('Plan: not generated yet');
  }
}

function renderValidationSection(payload: StatusPayload, callbacks: RenderCallbacks): void {
  const { log, warn } = callbacks;

  if (!payload.validation) return;

  const validationParts: string[] = [];
  if (payload.validation.queue_valid !== undefined) {
    validationParts.push(`queue=${payload.validation.queue_valid ? '\u2713' : '\u2717'}`);
  }
  if (payload.validation.plan_valid !== undefined) {
    validationParts.push(`plan=${payload.validation.plan_valid ? '\u2713' : '\u2717'}`);
  }
  if (validationParts.length > 0) {
    log(`Validation: ${validationParts.join(' ')}`);
  }
  if (payload.validation.integrity_warnings && payload.validation.integrity_warnings.length > 0) {
    warn('Integrity warnings:');
    payload.validation.integrity_warnings.forEach((warning) => {
      warn(`  \u2022 ${warning}`);
    });
  }
}

function renderTraceabilitySection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (!payload.traceability) return;

  log(
    `Traceability: ${payload.traceability.total_links} links (${payload.traceability.prd_goals_mapped} PRD goals \u2192 ${payload.traceability.spec_requirements_mapped} spec requirements \u2192 ${payload.traceability.execution_tasks_mapped} tasks)`
  );
  log(`Last updated: ${payload.traceability.last_updated}`);
  if (payload.traceability.outstanding_gaps > 0) {
    warn(`Outstanding gaps: ${payload.traceability.outstanding_gaps}`);
  } else {
    log('Outstanding gaps: None');
  }
  if (flags.verbose) {
    log(`Trace file: ${payload.traceability.trace_path}`);
  }
}

function renderRateLimitsSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (!payload.rate_limits) return;

  const rl = payload.rate_limits;
  log('');
  log(
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
  );
  log('API Ledger (Rate Limits)');
  log(
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
  );

  if (Object.keys(rl.providers).length === 0) {
    log('No rate limit data recorded yet.');
  } else {
    for (const [providerName, providerData] of Object.entries(rl.providers)) {
      log(`\n${providerName}:`);
      log(`  Remaining: ${providerData.remaining}`);
      log(`  Reset: ${providerData.reset_at}`);
      log(`  In Cooldown: ${providerData.in_cooldown ? 'Yes' : 'No'}`);

      if (providerData.manual_ack_required) {
        warn(
          `  \u26a0 Manual Acknowledgement Required (${providerData.recent_hit_count} consecutive hits)`
        );
      }

      if (flags.verbose) {
        log(`  Recent Hits: ${providerData.recent_hit_count}`);
      }
    }
  }

  if (rl.warnings.length > 0) {
    log('\nRate Limit Warnings:');
    rl.warnings.forEach((warning) => {
      warn(`  \u26a0 ${warning}`);
    });
  }

  log(
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'
  );
}

function renderIntegrationsSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (!payload.integrations) return;

  const integrations = payload.integrations;
  log('');
  log('Integration Status:');

  const renderIntegration = (
    name: string,
    data: {
      enabled: boolean;
      rate_limit?: { remaining: number; reset_at: string; in_cooldown: boolean };
      warnings: string[];
    },
    renderStatus: () => void
  ) => {
    log(`  ${name}:`);
    log(`    Enabled: ${data.enabled ? 'Yes' : 'No'}`);
    if (data.rate_limit) {
      log(`    Rate Limit: ${data.rate_limit.remaining} remaining`);
      if (data.rate_limit.in_cooldown) {
        warn(`    \u26a0 In cooldown until ${data.rate_limit.reset_at}`);
      }
    }
    renderStatus();
    data.warnings.forEach((warning) => warn(`    \u26a0 ${warning}`));
  };

  if (integrations.github) {
    renderIntegration('GitHub', integrations.github, () => {
      const githubIntegration = integrations.github;
      if (githubIntegration?.pr_status) {
        const pr = githubIntegration.pr_status;
        log(`    PR #${pr.number}: ${pr.state}`);
        log(`    Mergeable: ${pr.mergeable === null ? 'Unknown' : pr.mergeable ? 'Yes' : 'No'}`);
        if (flags.verbose && pr.url) {
          log(`    URL: ${pr.url}`);
        }
      }
    });
  }

  if (integrations.linear) {
    renderIntegration('Linear', integrations.linear, () => {
      if (integrations.linear?.issue_status) {
        const issue = integrations.linear.issue_status;
        log(`    Issue: ${issue.identifier} (${issue.state})`);
        if (flags.verbose && issue.url) {
          log(`    URL: ${issue.url}`);
        }
      }
    });
  }
}

function renderResearchSection(payload: StatusPayload, callbacks: RenderCallbacks): void {
  const { log, warn } = callbacks;

  if (!payload.research) return;

  const research = payload.research;
  log('');
  log('Research Tasks:');
  log(`  Total: ${research.total_tasks}`);
  log(`  Pending: ${research.pending_tasks}, In Progress: ${research.in_progress_tasks}`);
  log(`  Completed: ${research.completed_tasks}, Failed: ${research.failed_tasks}`);
  log(`  Cached: ${research.cached_tasks}, Stale: ${research.stale_tasks}`);
  log(`  Research Directory: ${research.research_dir}`);
  log(`  Snapshot: ${research.tasks_file}`);

  if (research.warnings.length > 0) {
    research.warnings.forEach((warning) => {
      warn(`  \u26a0 ${warning}`);
    });
  }
}

function renderFooterSection(
  payload: StatusPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;

  if (payload.manifest_error) {
    warn(`Manifest read warning: ${payload.manifest_error}`);
  }

  if (flags['show-costs']) {
    if (payload.telemetry?.costs_file) {
      log(`Telemetry (costs): ${payload.telemetry.costs_file}`);
    } else {
      log('Telemetry (costs): not recorded in manifest');
    }
  }

  if (flags.verbose) {
    if (payload.timestamps) {
      const start = payload.timestamps.started_at
        ? ` started=${payload.timestamps.started_at}`
        : '';
      const complete = payload.timestamps.completed_at
        ? ` completed=${payload.timestamps.completed_at}`
        : '';
      log(`Timestamps: created=${payload.timestamps.created_at}${start}${complete}`);
    }

    if (payload.config_errors.length > 0) {
      warn(`Config validation issues: ${payload.config_errors.join(' | ')}`);
    }

    if (payload.config_warnings.length > 0) {
      log(`Config warnings: ${payload.config_warnings.join(' | ')}`);
    }

    log(`Manifest schema: ${payload.manifest_schema_doc}`);
    log(`Manifest template: ${payload.manifest_template}`);
  }

  log('');
  for (const note of payload.notes) {
    log(`\u2022 ${note}`);
  }
  log('');
}

function renderBranchProtection(
  bp: StatusBranchProtectionPayload,
  flags: StatusFlags,
  callbacks: RenderCallbacks
): void {
  const { log, warn } = callbacks;
  log('');
  log('Branch Protection:');
  log(`  Protected: ${bp.protected ? 'Yes' : 'No'}`);
  log(`  Compliant: ${bp.compliant ? 'Yes' : 'No'}`);

  if (bp.blockers_count > 0) {
    warn(`  Blockers (${bp.blockers_count}):`);
    bp.blockers.forEach((blocker) => warn(`    \u2022 ${blocker}`));
  }

  if (bp.missing_checks.length > 0) {
    log(`  Missing Checks:`);
    bp.missing_checks.forEach((check) => log(`    - ${check}`));
  }

  log(
    `  Reviews: ${bp.reviews_status.completed}/${bp.reviews_status.required} (${bp.reviews_status.satisfied ? 'satisfied' : 'not satisfied'})`
  );
  log(`  Branch Up-to-date: ${bp.branch_status.up_to_date ? 'Yes' : 'No'}`);
  log(`  Auto-merge Allowed: ${bp.auto_merge.allowed ? 'Yes' : 'No'}`);

  if (bp.validation_mismatch) {
    const { missing_in_registry, extra_in_registry, recommendations } = bp.validation_mismatch;
    if (missing_in_registry.length === 0 && extra_in_registry.length === 0) {
      log('  Validation Alignment: ExecutionTask validations cover all required checks');
    } else {
      log('  Validation Alignment:');
      if (missing_in_registry.length > 0) {
        warn(`    Missing ExecutionTask validations for: ${missing_in_registry.join(', ')}`);
      }
      if (extra_in_registry.length > 0) {
        log(
          `    Extra validations not required by branch protection: ${extra_in_registry.join(', ')}`
        );
      }
      if (flags.verbose && recommendations.length > 0) {
        log('    Recommendations:');
        recommendations.forEach((rec) => log(`      \u2022 ${rec}`));
      }
    }
  }

  if (flags.verbose && bp.evaluated_at) {
    log(`  Last Evaluated: ${bp.evaluated_at}`);
  }
}

/**
 * Truncate a summary string, appending an ellipsis if it exceeds the limit.
 *
 * @param summary - The full summary text.
 * @param maxLength - Maximum character length (default 240).
 * @returns The original string if within the limit, or a truncated version.
 */
export function truncateSummary(summary: string, maxLength = 240): string {
  if (summary.length <= maxLength) {
    return summary;
  }
  return `${summary.slice(0, maxLength - 1)}\u2026`;
}
