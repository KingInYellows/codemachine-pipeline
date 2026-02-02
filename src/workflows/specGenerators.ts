/**
 * Specification Content Generators
 *
 * Pure functions for generating risk assessments, test plans, and rollout plans
 * from PRD data and research tasks. Extracted from specComposer.ts.
 *
 * Implements:
 * - FR-10 (Specification Authoring): Risk, test, and rollout plan generation
 */

import type { ResearchTask } from '../core/models/ResearchTask';
import type { RiskAssessment, TestPlanItem, RolloutPlan } from '../core/models/Specification';

// ============================================================================
// Specification Content Generation
// ============================================================================

/**
 * Generate risk assessments from PRD and research
 */
export function generateRiskAssessments(
  prdRisks: string[],
  researchTasks: ResearchTask[]
): RiskAssessment[] {
  const risks: RiskAssessment[] = [];

  // Process PRD risks
  for (const riskText of prdRisks) {
    if (!riskText || riskText.includes('TODO')) {
      continue;
    }

    // Parse risk severity from text (simple heuristics)
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (/critical|severe|blocker/i.test(riskText)) {
      severity = 'critical';
    } else if (/high|major/i.test(riskText)) {
      severity = 'high';
    } else if (/low|minor/i.test(riskText)) {
      severity = 'low';
    }

    // Extract mitigation if present
    const mitigationMatch = riskText.match(/mitigation:?\s*(.+)/i);
    const mitigation = mitigationMatch ? mitigationMatch[1].trim() : undefined;

    const description = riskText.replace(/mitigation:?\s*.+/i, '').trim();

    risks.push({
      description,
      severity,
      mitigation,
    });
  }

  // Add risks from research tasks
  for (const task of researchTasks) {
    if (task.status !== 'completed' || !task.results) {
      continue;
    }

    // Check if research identifies risks
    const summary = task.results.summary || '';
    if (/risk|concern|issue|problem/i.test(summary)) {
      risks.push({
        description: `Research finding: ${summary.substring(0, 200)}`,
        severity: 'medium',
        mitigation: 'Requires further investigation and validation',
        owner: 'Research Team',
      });
    }
  }

  return risks;
}

/**
 * Generate test plan from acceptance criteria and constraints
 */
export function generateTestPlan(acceptanceCriteria: string[], constraints: string[]): TestPlanItem[] {
  const testPlan: TestPlanItem[] = [];

  // Generate unit tests for each constraint
  constraints.forEach((constraint, index) => {
    if (!constraint || constraint.includes('TODO')) {
      return;
    }

    testPlan.push({
      test_id: `T-UNIT-${(index + 1).toString().padStart(3, '0')}`,
      description: `Verify constraint: ${constraint.substring(0, 100)}`,
      test_type: 'unit',
      acceptance_criteria: [constraint],
    });
  });

  // Generate integration tests for acceptance criteria
  acceptanceCriteria.forEach((criterion, index) => {
    if (!criterion || criterion.includes('TODO')) {
      return;
    }

    testPlan.push({
      test_id: `T-INT-${(index + 1).toString().padStart(3, '0')}`,
      description: `Verify acceptance criterion: ${criterion.substring(0, 100)}`,
      test_type: 'integration',
      acceptance_criteria: [criterion],
    });
  });

  // Add end-to-end test placeholder
  if (acceptanceCriteria.length > 0) {
    testPlan.push({
      test_id: 'T-E2E-001',
      description: 'End-to-end workflow validation',
      test_type: 'e2e',
      acceptance_criteria: acceptanceCriteria,
    });
  }

  return testPlan;
}

/**
 * Generate rollout plan based on risks and constraints
 */
export function generateRolloutPlan(risks: RiskAssessment[]): RolloutPlan {
  const hasHighRisks = risks.some((r) => r.severity === 'high' || r.severity === 'critical');

  const strategy = hasHighRisks ? 'canary' : 'gradual';

  const phases = hasHighRisks
    ? [
        {
          phase_id: 'phase-1',
          description: 'Canary deployment to 1% of users',
          percentage: 1,
          duration: '24 hours',
        },
        {
          phase_id: 'phase-2',
          description: 'Expand to 10% of users if stable',
          percentage: 10,
          duration: '48 hours',
        },
        {
          phase_id: 'phase-3',
          description: 'Expand to 50% of users',
          percentage: 50,
          duration: '72 hours',
        },
        {
          phase_id: 'phase-4',
          description: 'Full rollout to 100% of users',
          percentage: 100,
          duration: 'ongoing',
        },
      ]
    : [
        {
          phase_id: 'phase-1',
          description: 'Initial rollout to 25% of users',
          percentage: 25,
          duration: '48 hours',
        },
        {
          phase_id: 'phase-2',
          description: 'Expand to 75% of users',
          percentage: 75,
          duration: '48 hours',
        },
        {
          phase_id: 'phase-3',
          description: 'Full rollout to 100% of users',
          percentage: 100,
          duration: 'ongoing',
        },
      ];

  return {
    strategy,
    phases,
    rollback_plan: 'Feature flag toggle or revert deployment; monitor metrics for anomalies',
  };
}
