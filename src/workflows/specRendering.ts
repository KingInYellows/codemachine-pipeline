/**
 * Specification Markdown Rendering
 *
 * Generates markdown representation of engineering specifications including
 * front matter, constraints, test plans, rollout plans, risk assessments,
 * and traceability information. Extracted from specComposer.ts.
 *
 * Implements:
 * - FR-10 (Specification Authoring): Spec document rendering
 * - FR-9 (Traceability): PRD hash and trace ID linking
 */

import type { Specification } from '../core/models/Specification';
import type { PRDMetadata } from './prdAuthoringEngine';

// Markdown Generation

/**
 * Generate markdown specification document
 */
export function generateSpecMarkdown(
  specification: Specification,
  prdMetadata: PRDMetadata,
  constraints: string[],
  referencedFiles: string[],
  referencedFileGlobs: string[]
): string {
  const lines: string[] = [];

  // Front matter
  lines.push('---');
  lines.push(`spec_id: ${specification.spec_id}`);
  lines.push(`feature_id: ${specification.feature_id}`);
  lines.push(`title: ${specification.title}`);
  lines.push(`status: ${specification.status}`);
  lines.push(`created_at: ${specification.created_at}`);
  lines.push('---');
  lines.push('');

  // Header
  lines.push(`# Engineering Specification: ${specification.title}`);
  lines.push('');
  lines.push('## Document Information');
  lines.push('');
  lines.push(`- **Spec ID:** \`${specification.spec_id}\``);
  lines.push(`- **Feature ID:** \`${specification.feature_id}\``);
  lines.push(`- **Created:** ${specification.created_at}`);
  lines.push(`- **Last Updated:** ${specification.updated_at}`);
  lines.push(`- **Status:** ${specification.status}`);
  lines.push(`- **Based on PRD:** Hash \`${prdMetadata.prdHash.substring(0, 16)}...\``);
  lines.push('');

  // Main content
  lines.push('## Specification Overview');
  lines.push('');
  lines.push(specification.content);
  lines.push('');

  // Constraints
  lines.push('## Technical Constraints');
  lines.push('');
  if (constraints.length > 0) {
    constraints.forEach((constraint, index) => {
      lines.push(`${index + 1}. ${constraint}`);
    });
  } else {
    lines.push('_No specific constraints identified._');
  }
  lines.push('');

  // Test Plan
  lines.push('## Test Plan');
  lines.push('');
  if (specification.test_plan.length > 0) {
    specification.test_plan.forEach((test) => {
      lines.push(`### ${test.test_id}: ${test.description}`);
      lines.push('');
      lines.push(`- **Type:** ${test.test_type}`);
      lines.push(`- **Acceptance Criteria:**`);
      test.acceptance_criteria.forEach((criterion) => {
        lines.push(`  - ${criterion}`);
      });
      lines.push('');
    });
  } else {
    lines.push('_Test plan to be defined._');
    lines.push('');
  }

  // Rollout Plan
  lines.push('## Rollout Plan');
  lines.push('');
  if (specification.rollout_plan) {
    const rollout = specification.rollout_plan;
    lines.push(`**Strategy:** ${rollout.strategy}`);
    lines.push('');
    lines.push('**Phases:**');
    lines.push('');
    rollout.phases.forEach((phase) => {
      lines.push(`- **${phase.phase_id}:** ${phase.description}`);
      if (phase.percentage !== undefined) {
        lines.push(`  - Coverage: ${phase.percentage}%`);
      }
      if (phase.duration) {
        lines.push(`  - Duration: ${phase.duration}`);
      }
    });
    lines.push('');
    if (rollout.rollback_plan) {
      lines.push(`**Rollback Plan:** ${rollout.rollback_plan}`);
      lines.push('');
    }
  } else {
    lines.push('_Rollout plan to be defined._');
    lines.push('');
  }

  // Risk Assessment
  lines.push('## Risk Assessment');
  lines.push('');
  if (specification.risks.length > 0) {
    specification.risks.forEach((risk, index) => {
      lines.push(`### Risk ${index + 1}: ${risk.description}`);
      lines.push('');
      lines.push(`- **Severity:** ${risk.severity}`);
      if (risk.mitigation) {
        lines.push(`- **Mitigation:** ${risk.mitigation}`);
      }
      if (risk.owner) {
        lines.push(`- **Owner:** ${risk.owner}`);
      }
      lines.push('');
    });
  } else {
    lines.push('_No risks identified._');
    lines.push('');
  }

  // Referenced File Globs
  lines.push('## Referenced File Globs');
  lines.push('');
  if (referencedFileGlobs.length > 0) {
    referencedFileGlobs.forEach((glob) => {
      lines.push(`- \`${glob}\``);
    });
  } else {
    lines.push('_No referenced file globs provided._');
  }
  lines.push('');

  // Referenced Files
  lines.push('## Referenced Files');
  lines.push('');
  if (referencedFiles.length > 0) {
    referencedFiles.forEach((file) => {
      lines.push(`- \`${file}\``);
    });
  } else {
    lines.push('_No specific files referenced._');
  }
  lines.push('');

  // Change Log
  lines.push('## Change Log');
  lines.push('');
  if (specification.change_log.length > 0) {
    specification.change_log.forEach((entry) => {
      lines.push(`### ${entry.version || 'Unversioned'} - ${entry.timestamp}`);
      lines.push('');
      lines.push(`**Author:** ${entry.author}`);
      lines.push('');
      lines.push(entry.description);
      lines.push('');
    });
  } else {
    lines.push('_Initial version._');
    lines.push('');
  }

  // Traceability
  lines.push('## Traceability');
  lines.push('');
  lines.push(`- **PRD Hash:** \`${prdMetadata.prdHash}\``);
  lines.push(`- **PRD Trace ID:** \`${prdMetadata.traceId || 'N/A'}\``);
  lines.push(`- **Execution Plan:** _Pending spec approval_`);
  lines.push('');

  return lines.join('\n');
}
