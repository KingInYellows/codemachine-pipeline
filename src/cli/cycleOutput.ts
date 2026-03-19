/**
 * Cycle Output Rendering
 *
 * Dashboard (live-updating during execution) and summary rendering
 * for the cycle command. Follows existing conventions from
 * src/cli/status/renderers.ts: Unicode box-drawing, check/cross marks,
 * 2-space indentation.
 */

import type { CycleIssueResult, CycleResult } from '../workflows/cycleTypes.js';
import type { CyclePayload } from './cycleTypes.js';

const CHECK = '\u2713';
const CROSS = '\u2717';
const ARROW = '\u2192';
const DASH = '\u2500';
const WARN = '\u26a0';

export interface OutputCallbacks {
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatPriority(priority: number): string {
  const map: Record<number, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };
  return map[priority] ?? `P${priority}`;
}

function statusIcon(status: 'completed' | 'failed' | 'skipped' | 'running' | 'pending'): string {
  switch (status) {
    case 'completed': return CHECK;
    case 'failed': return CROSS;
    case 'skipped': return DASH;
    case 'running': return ARROW;
    case 'pending': return ' ';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'done';
    case 'failed': return 'FAILED';
    case 'skipped': return 'skipped';
    case 'running': return 'running';
    case 'pending': return 'pending';
    default: return status;
  }
}

/**
 * Render the dry-run preview showing ordered issues.
 */
export function renderDryRun(payload: CyclePayload, callbacks: OutputCallbacks): void {
  const { log, warn } = callbacks;
  const line = DASH.repeat(60);

  log('');
  log(`Cycle: ${payload.cycleName} (${payload.cycleId})`);
  log(`Issues: ${payload.totalIssues} total | ${payload.processable} processable | ${payload.skipped} will skip`);
  log(line);
  log('');
  log('  #  Issue       Priority   State            Action');
  log('  ' + DASH.repeat(56));

  for (let i = 0; i < payload.orderedIssues.length; i++) {
    const issue = payload.orderedIssues[i];
    const num = String(i + 1).padStart(2);
    const id = issue.identifier.padEnd(10);
    const pri = formatPriority(issue.priority).padEnd(9);
    const state = issue.state.padEnd(15);
    const action = issue.willSkip ? `skip (${issue.skipReason})` : 'process';
    log(`  ${num}  ${id} ${pri} ${state}  ${action}`);
  }

  log('');

  if (payload.hasCycles) {
    warn(`${WARN} Dependency cycle detected involving: ${payload.cycleInvolvedIds.join(', ')}`);
    warn('  These issues were appended at the end, sorted by priority.');
    log('');
  }

  log(`${DASH.repeat(60)}`);
  log('  Dry run complete. No issues were processed.');
  log('');
}

/**
 * Render a live-updating dashboard line for a single issue.
 *
 * For TTY: uses ANSI cursor manipulation for in-place updates.
 * For non-TTY: emits single-line status updates.
 */
export function renderDashboardUpdate(
  result: CycleIssueResult,
  index: number,
  total: number,
  _elapsed: number,
  callbacks: OutputCallbacks
): void {
  const { log } = callbacks;
  const icon = statusIcon(result.status);
  const label = statusLabel(result.status);
  const duration = result.durationMs > 0 ? formatDuration(result.durationMs) : '-';

  if (process.stdout.isTTY) {
    // TTY: single-line progress update
    const progress = `[${index + 1}/${total}]`;
    const line = `  ${icon} ${progress} ${result.identifier.padEnd(12)} ${label.padEnd(8)} ${duration}`;
    process.stdout.write(`${line}\n`);
  } else {
    // Non-TTY: simple status line
    log(`  ${icon} ${result.identifier} ${label} ${duration}`);
  }
}

/**
 * Render the dashboard header at the start of execution.
 */
export function renderDashboardHeader(
  cycleName: string,
  cycleId: string,
  totalIssues: number,
  callbacks: OutputCallbacks
): void {
  const { log } = callbacks;
  const line = DASH.repeat(60);

  log('');
  log(`Cycle: ${cycleName} (${cycleId})`);
  log(`Issues: ${totalIssues} to process`);
  log(line);
  log('');
  log('  #  Issue        Status    Duration');
  log('  ' + DASH.repeat(40));
}

/**
 * Render the final summary table after cycle execution.
 */
export function renderCycleSummary(result: CycleResult, callbacks: OutputCallbacks): void {
  const { log, warn } = callbacks;
  const line = DASH.repeat(60);

  log('');
  log(line);
  log(`Cycle: ${result.cycleName}`);
  log(`Duration: ${formatDuration(result.durationMs)}`);
  log('');
  log(`  ${CHECK} Completed: ${result.completed}`);
  log(`  ${CROSS} Failed:    ${result.failed}`);
  log(`  ${DASH} Skipped:   ${result.skipped}`);
  log(`  Total:     ${result.totalIssues}`);

  // List failed issues
  const failedIssues = result.issues.filter((i) => i.status === 'failed');
  if (failedIssues.length > 0) {
    log('');
    warn('Needs attention:');
    for (const issue of failedIssues) {
      warn(`  ${CROSS} ${issue.identifier} - ${issue.title}`);
      if (issue.error) {
        warn(`    Error: ${issue.error}`);
      }
    }
  }

  // List completed issues
  const completedIssues = result.issues.filter((i) => i.status === 'completed');
  if (completedIssues.length > 0) {
    log('');
    log('Completed:');
    for (const issue of completedIssues) {
      log(`  ${CHECK} ${issue.identifier} - ${issue.title} (${formatDuration(issue.durationMs)})`);
    }
  }

  log(line);
  log('');
}

/**
 * Render result as JSON to stdout.
 */
export function renderCycleJson(result: CycleResult, callbacks: OutputCallbacks): void {
  callbacks.log(JSON.stringify(result, null, 2));
}
