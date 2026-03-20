/**
 * Cycle Command Types
 *
 * Flag definitions and payload types for the cycle CLI command.
 */

export interface CycleFlags {
  cycle?: string | undefined;
  'plan-only': boolean;
  'fail-fast': boolean;
  'dry-run': boolean;
  json: boolean;
  verbose: boolean;
  'max-issues': number;
}

export interface CyclePayloadIssue {
  identifier: string;
  title: string;
  priority: number;
  state: string;
  willSkip: boolean;
  skipReason?: string | undefined;
}

export interface CyclePayload {
  cycleId: string;
  cycleName: string;
  cycleNumber: number;
  orderedIssues: CyclePayloadIssue[];
  hasCycles: boolean;
  cycleInvolvedIds: string[];
}

export function getCyclePayloadCounts(payload: CyclePayload): {
  totalIssues: number;
  processable: number;
  skipped: number;
} {
  const skipped = payload.orderedIssues.filter((i) => i.willSkip).length;
  return {
    totalIssues: payload.orderedIssues.length,
    processable: payload.orderedIssues.length - skipped,
    skipped,
  };
}
