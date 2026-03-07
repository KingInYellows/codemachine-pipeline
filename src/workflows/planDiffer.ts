/**
 * Plan Differ
 *
 * Compares plan state against spec metadata to detect spec changes requiring task regeneration.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadPlanMetadata } from './taskPlanner';
import { loadSpecMetadata } from './specComposer';
import { safeJsonParse } from '../utils/safeJson';

/**
 * Plan diff result
 */
export interface PlanDiff {
  /** Whether any changes detected */
  has_changes: boolean;
  /** Whether spec hash changed */
  spec_hash_changed: boolean;
  /** Previous spec hash from plan metadata */
  previous_spec_hash?: string;
  /** Current spec hash from spec metadata */
  current_spec_hash?: string;
  /** List of changed fields */
  changed_fields: string[];
  /** Human-readable recommendation */
  recommendation?: string;
  /** Timestamp of analysis */
  analyzed_at: string;
}

/**
 * Compare current plan against spec metadata to detect changes
 */
export async function comparePlanDiff(runDir: string): Promise<PlanDiff> {
  const analyzedAt = new Date().toISOString();

  // Load plan metadata
  const planMetadata = await loadPlanMetadata(runDir);
  if (!planMetadata) {
    return {
      has_changes: true,
      spec_hash_changed: false,
      changed_fields: ['plan_metadata_missing'],
      recommendation: 'Plan metadata not found. Generate plan first.',
      analyzed_at: analyzedAt,
    };
  }

  // Load spec metadata
  const specMetadata = await loadSpecMetadata(runDir);
  if (!specMetadata) {
    return {
      has_changes: true,
      spec_hash_changed: false,
      changed_fields: ['spec_metadata_missing'],
      recommendation: 'Spec metadata not found. Generate spec first.',
      analyzed_at: analyzedAt,
    };
  }

  const changedFields: string[] = [];
  let specHashChanged = false;

  // Compare spec hashes
  if (planMetadata.spec_hash !== specMetadata.specHash) {
    changedFields.push('spec_hash');
    specHashChanged = true;
  }

  // Check if plan.json still exists and matches stored hash
  const planPath = path.join(runDir, 'plan.json');
  try {
    const planContent = await fs.readFile(planPath, 'utf-8');
    const plan = safeJsonParse<{ checksum?: string }>(planContent);
    if (!plan) {
      changedFields.push('plan_file_invalid');
    } else if (plan.checksum !== planMetadata.plan_hash) {
      changedFields.push('plan_checksum_mismatch');
    }
  } catch {
    changedFields.push('plan_file_missing');
  }

  const hasChanges = changedFields.length > 0;
  let recommendation: string | undefined;

  if (hasChanges) {
    if (specHashChanged) {
      recommendation =
        'Specification changed. Re-run plan generation with: codepipe plan --regenerate';
    } else if (changedFields.includes('plan_checksum_mismatch')) {
      recommendation = 'Plan file modified externally. Verify integrity or regenerate plan.';
    } else if (changedFields.includes('plan_file_missing')) {
      recommendation = 'Plan file missing. Regenerate plan.';
    } else {
      recommendation = 'Plan metadata inconsistency detected. Review artifacts.';
    }
  }

  const result: PlanDiff = {
    has_changes: hasChanges,
    spec_hash_changed: specHashChanged,
    previous_spec_hash: planMetadata.spec_hash,
    current_spec_hash: specMetadata.specHash,
    changed_fields: changedFields,
    analyzed_at: analyzedAt,
  };

  if (recommendation !== undefined) {
    result.recommendation = recommendation;
  }

  return result;
}
