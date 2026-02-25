/**
 * Specification Markdown Generation
 *
 * Pure functions for generating spec content components from PRD and research:
 * risk assessments, test plans, rollout plans, and the final markdown document.
 */

import type { ResearchTask } from '../core/models/ResearchTask';
import type {
  Specification,
  RiskAssessment,
  TestPlanItem,
  RolloutPlan,
} from '../core/models/Specification';

// ============================================================================
// Specification Content Generation
// ============================================================================

/**
 * Generate risk assessments from PRD risks and completed research tasks
 */
export function generateRiskAssessments(
  prdRisks: string[],
  researchTasks: ResearchTask[]
): RiskAssessment[] {
  const risks: RiskAssessment[] = [];

  for (const riskText of prdRisks) {
    if (!riskText || riskText.includes('TODO')) continue;

    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (/critical|severe|blocker/i.test(riskText)) severity = 'critical';
    else if (/high|major/i.test(riskText)) severity = 'high';
    else if (/low|minor/i.test(riskText)) severity = 'low';

    const mitigationMatch = riskText.match(/mitigation:?\s*(.+)/i);
    const mitigation = mitigationMatch ? mitigationMatch[1].trim() : undefined;
    const description = riskText.replace(/mitigation:?\s*.+/i, '').trim();

    risks.push({ description, severity, mitigation });
  }

  for (const task of researchTasks) {
    if (task.status !== 'completed' || !task.results) continue;

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
 * Generate test plan items from acceptance criteria and constraints
 */
export function generateTestPlan(
  acceptanceCriteria: string[],
  constraints: string[]
): TestPlanItem[] {
  const testPlan: TestPlanItem[] = [];

  constraints.forEach((constraint, index) => {
    if (!constraint || constraint.includes('TODO')) return;
    testPlan.push({
      test_id: `T-UNIT-${(index + 1).toString().padStart(3, '0')}`,
      description: `Verify constraint: ${constraint.substring(0, 100)}`,
      test_type: 'unit',
      acceptance_criteria: [constraint],
    });
  });

  acceptanceCriteria.forEach((criterion, index) => {
    if (!criterion || criterion.includes('TODO')) return;
    testPlan.push({
      test_id: `T-INT-${(index + 1).toString().padStart(3, '0')}`,
      description: `Verify acceptance criterion: ${criterion.substring(0, 100)}`,
      test_type: 'integration',
      acceptance_criteria: [criterion],
    });
  });

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
 * Generate rollout plan based on risk severity
 */
export function generateRolloutPlan(risks: RiskAssessment[]): RolloutPlan {
  const hasHighRisks = risks.some((r) => r.severity === 'high' || r.severity === 'critical');
  const strategy = hasHighRisks ? 'canary' : 'gradual';

  const phases = hasHighRisks
    ? [
        { phase_id: 'phase-1', description: 'Canary deployment to 1% of users', percentage: 1, duration: '24 hours' },
        { phase_id: 'phase-2', description: 'Expand to 10% of users if stable', percentage: 10, duration: '48 hours' },
        { phase_id: 'phase-3', description: 'Expand to 50% of users', percentage: 50, duration: '72 hours' },
        { phase_id: 'phase-4', description: 'Full rollout to 100% of users', percentage: 100, duration: 'ongoing' },
      ]
    : [
        { phase_id: 'phase-1', description: 'Initial rollout to 25% of users', percentage: 25, duration: '48 hours' },
        { phase_id: 'phase-2', description: 'Expand to 75% of users', percentage: 75, duration: '48 hours' },
        { phase_id: 'phase-3', description: 'Full rollout to 100% of users', percentage: 100, duration: 'ongoing' },
      ];

  return {
    strategy,
    phases,
    rollback_plan: 'Feature flag toggle or revert deployment; monitor metrics for anomalies',
  };
}

// ============================================================================
// Markdown Generation
// ============================================================================

/**
 * Generate full markdown specification document from a structured specification
 */
export function generateSpecMarkdown(
  specification: Specification,
  prdMetadata: { prdHash: string; traceId?: string },
  constraints: string[],
  referencedFiles: string[],
  referencedFileGlobs: string[]
): string {
  const lines: string[] = [];
  const sanitize = (value: string): string => value.replace(/[\n\r]/g, ' ');

  lines.push('---');
  lines.push(`spec_id: ${sanitize(specification.spec_id)}`);
  lines.push(`feature_id: ${sanitize(specification.feature_id)}`);
  lines.push(`title: ${sanitize(specification.title)}`);
  lines.push(`status: ${sanitize(specification.status)}`);
  lines.push(`created_at: ${sanitize(specification.created_at)}`);
  lines.push('---', '');

  lines.push(`# Engineering Specification: ${specification.title}`, '');
  lines.push('## Document Information', '');
  lines.push(`- **Spec ID:** \`${specification.spec_id}\``);
  lines.push(`- **Feature ID:** \`${specification.feature_id}\``);
  lines.push(`- **Created:** ${specification.created_at}`);
  lines.push(`- **Last Updated:** ${specification.updated_at}`);
  lines.push(`- **Status:** ${specification.status}`);
  lines.push(`- **Based on PRD:** Hash \`${prdMetadata.prdHash.substring(0, 16)}...\``, '');

  lines.push('## Specification Overview', '');
  lines.push(specification.content, '');

  lines.push('## Technical Constraints', '');
  if (constraints.length > 0) {
    constraints.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  } else {
    lines.push('_No specific constraints identified._');
  }
  lines.push('');

  lines.push('## Test Plan', '');
  if (specification.test_plan.length > 0) {
    specification.test_plan.forEach((test) => {
      lines.push(`### ${test.test_id}: ${test.description}`, '');
      lines.push(`- **Type:** ${test.test_type}`);
      lines.push('- **Acceptance Criteria:**');
      test.acceptance_criteria.forEach((c) => lines.push(`  - ${c}`));
      lines.push('');
    });
  } else {
    lines.push('_Test plan to be defined._', '');
  }

  lines.push('## Rollout Plan', '');
  if (specification.rollout_plan) {
    const rollout = specification.rollout_plan;
    lines.push(`**Strategy:** ${rollout.strategy}`, '');
    lines.push('**Phases:**', '');
    rollout.phases.forEach((phase) => {
      lines.push(`- **${phase.phase_id}:** ${phase.description}`);
      if (phase.percentage !== undefined) lines.push(`  - Coverage: ${phase.percentage}%`);
      if (phase.duration) lines.push(`  - Duration: ${phase.duration}`);
    });
    lines.push('');
    if (rollout.rollback_plan) lines.push(`**Rollback Plan:** ${rollout.rollback_plan}`, '');
  } else {
    lines.push('_Rollout plan to be defined._', '');
  }

  lines.push('## Risk Assessment', '');
  if (specification.risks.length > 0) {
    specification.risks.forEach((risk, index) => {
      lines.push(`### Risk ${index + 1}: ${risk.description}`, '');
      lines.push(`- **Severity:** ${risk.severity}`);
      if (risk.mitigation) lines.push(`- **Mitigation:** ${risk.mitigation}`);
      if (risk.owner) lines.push(`- **Owner:** ${risk.owner}`);
      lines.push('');
    });
  } else {
    lines.push('_No risks identified._', '');
  }

  lines.push('## Referenced File Globs', '');
  if (referencedFileGlobs.length > 0) {
    referencedFileGlobs.forEach((glob) => lines.push(`- \`${glob}\``));
  } else {
    lines.push('_No referenced file globs provided._');
  }
  lines.push('');

  lines.push('## Referenced Files', '');
  if (referencedFiles.length > 0) {
    referencedFiles.forEach((file) => lines.push(`- \`${file}\``));
  } else {
    lines.push('_No specific files referenced._');
  }
  lines.push('');

  lines.push('## Change Log', '');
  if (specification.change_log.length > 0) {
    specification.change_log.forEach((entry) => {
      lines.push(`### ${entry.version || 'Unversioned'} - ${entry.timestamp}`, '');
      lines.push(`**Author:** ${entry.author}`, '');
      lines.push(entry.description, '');
    });
  } else {
    lines.push('_Initial version._', '');
  }

  lines.push('## Traceability', '');
  lines.push(`- **PRD Hash:** \`${prdMetadata.prdHash}\``);
  lines.push(`- **PRD Trace ID:** \`${prdMetadata.traceId || 'N/A'}\``);
  lines.push('- **Execution Plan:** _Pending spec approval_', '');

  return lines.join('\n');
}
