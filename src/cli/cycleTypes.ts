/**
 * Cycle Command Types
 *
 * Flag definitions and payload types for the cycle CLI command.
 */

export interface CycleFlags {
  cycle?: string;
  'plan-only': boolean;
  'fail-fast': boolean;
  'dry-run': boolean;
  json: boolean;
  verbose: boolean;
  'max-issues': number;
}

export interface CyclePayload {
  cycleId: string;
  cycleName: string;
  cycleNumber: number;
  totalIssues: number;
  processable: number;
  skipped: number;
  orderedIssues: Array<{
    identifier: string;
    title: string;
    priority: number;
    state: string;
    willSkip: boolean;
    skipReason?: string;
  }>;
  hasCycles: boolean;
  cycleInvolvedIds: string[];
}

export function getCyclePayloadCounts(payload: CyclePayload): {
  totalIssues: number;
  processable: number;
  skipped: number;
} {
  const total = payload.orderedIssues.length;
  const skipped = payload.orderedIssues.filter((i) => i.willSkip).length;
  return { totalIssues: total, processable: total - skipped, skipped };
}
