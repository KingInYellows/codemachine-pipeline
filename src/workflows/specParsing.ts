/**
 * Specification Parsing Utilities
 *
 * Pure functions for extracting structured data from PRD markdown, deriving
 * constraints, file globs, and detecting unknowns. Extracted from specComposer.ts.
 *
 * Implements:
 * - FR-10 (Specification Authoring): PRD section extraction and constraint derivation
 * - FR-9 (Traceability): File glob and reference tracking
 */

import * as path from 'node:path';
import type { ContextDocument } from '../core/models/ContextDocument';
import type { RepoConfig } from '../core/config/RepoConfig';

// Types

/**
 * Structured sections extracted from PRD markdown
 */
export type PRDSections = ReturnType<typeof extractPRDSections>;

// PRD Section Extraction

/**
 * Extract bullet-list items from a named markdown section.
 * Returns an empty array if the section is not found.
 */
function extractBulletSection(markdown: string, sectionPattern: string): string[] {
  const regex = new RegExp(`## ${sectionPattern}\\s+([\\s\\S]*?)(?=##|$)`, 'i');
  const match = markdown.match(regex);
  if (!match) return [];
  return match[1]
    .trim()
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.replace(/^-\s*/, '').trim());
}

/**
 * Extract structured data from PRD markdown
 */
export function extractPRDSections(prdMarkdown: string): {
  problemStatement: string;
  goals: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  risks: string[];
  openQuestions: string[];
} {
  const problemMatch = prdMarkdown.match(/## Problem Statement\s+([\s\S]*?)(?=##|$)/i);
  return {
    problemStatement: problemMatch ? problemMatch[1].trim() : '',
    goals: extractBulletSection(prdMarkdown, 'Goals'),
    nonGoals: extractBulletSection(prdMarkdown, 'Non-Goals'),
    acceptanceCriteria: extractBulletSection(prdMarkdown, 'Success Criteria & Acceptance Criteria'),
    risks: extractBulletSection(prdMarkdown, 'Risks & Mitigations'),
    openQuestions: extractBulletSection(prdMarkdown, 'Open Questions'),
  };
}

// Constraint and File Glob Extraction

/**
 * Extract technical constraints from PRD and context
 */
export function extractConstraints(
  prdSections: PRDSections,
  contextDoc: ContextDocument,
  repoConfig: RepoConfig
): string[] {
  const constraints: string[] = [];

  // Add repo-level constraints from config
  if (repoConfig.constraints?.rate_limits) {
    constraints.push(
      `Rate limiting envelopes: ${JSON.stringify(repoConfig.constraints.rate_limits)}`
    );
  }

  if (repoConfig.runtime?.max_concurrent_tasks) {
    constraints.push(`Max concurrent tasks: ${repoConfig.runtime.max_concurrent_tasks}`);
  }

  if (repoConfig.safety?.allowed_file_patterns?.length) {
    constraints.push(`Allowed file globs: ${repoConfig.safety.allowed_file_patterns.join(', ')}`);
  }

  if (repoConfig.safety?.blocked_file_patterns?.length) {
    constraints.push(`Blocked file globs: ${repoConfig.safety.blocked_file_patterns.join(', ')}`);
  }

  // Extract constraints from problem statement
  if (prdSections.problemStatement) {
    const performanceMatches = prdSections.problemStatement.match(
      /performance|latency|speed|fast/gi
    );
    if (performanceMatches && performanceMatches.length > 0) {
      constraints.push('Performance: Response time must be < 500ms for P95');
    }

    const scalabilityMatches = prdSections.problemStatement.match(/scale|concurrent|users/gi);
    if (scalabilityMatches && scalabilityMatches.length > 0) {
      constraints.push('Scalability: Must support 10,000 concurrent users');
    }
  }

  // Add file path constraints from context
  const contextFiles = Object.keys(contextDoc.files);
  if (contextFiles.length > 0) {
    constraints.push(`Implementation must reference files: ${contextFiles.slice(0, 5).join(', ')}`);
  }

  // Default constraints
  constraints.push('All changes must pass CI/CD pipeline');
  constraints.push('Test coverage must be >= 80%');
  constraints.push('No security vulnerabilities in dependencies');
  constraints.push('Backward compatibility must be maintained');

  return constraints;
}

/**
 * Derive referenced file globs from context and repo configuration
 */
export function deriveReferencedFileGlobs(
  contextDoc: ContextDocument,
  repoConfig: RepoConfig
): string[] {
  const globs = new Set<string>();

  if (Array.isArray(repoConfig.project?.context_paths)) {
    repoConfig.project.context_paths.forEach((contextPath) => {
      const normalized = contextPath.replace(/\/+$/, '');
      if (normalized.length > 0) {
        globs.add(`${normalized}/**/*`);
      }
    });
  }

  if (Array.isArray(repoConfig.safety?.allowed_file_patterns)) {
    repoConfig.safety.allowed_file_patterns.forEach((pattern) => globs.add(pattern));
  }

  const filePaths = Object.keys(contextDoc.files);
  filePaths.forEach((filePath) => {
    if (!filePath) {
      return;
    }

    const normalizedPath = filePath.split(path.sep).join(path.posix.sep);
    const directory = path.posix.dirname(normalizedPath);

    if (directory && directory !== '.') {
      globs.add(`${directory.replace(/\/+$/, '')}/**/*`);
    } else {
      globs.add(normalizedPath);
    }
  });

  return Array.from(globs).slice(0, 20);
}

// Unknown Detection

/**
 * Detect unknowns in specification content
 */
export function detectUnknowns(
  specContent: string,
  prdSections: PRDSections,
  additionalSource?: string
): Array<{ section: string; description: string; suggestedObjective: string }> {
  const unknowns: Array<{ section: string; description: string; suggestedObjective: string }> = [];
  const sources = [specContent];

  if (additionalSource) {
    sources.push(additionalSource);
  }

  // Check for TODO markers
  for (const source of sources) {
    const todoMatches = source.match(/TODO:?\s*(.+)/gi);
    if (todoMatches) {
      todoMatches.forEach((match) => {
        const description = match.replace(/TODO:?/i, '').trim();
        unknowns.push({
          section: 'content',
          description,
          suggestedObjective: `Research required: ${description}`,
        });
      });
    }

    // Check for TBD markers
    const tbdMatches = source.match(/TBD:?\s*(.+)/gi);
    if (tbdMatches) {
      tbdMatches.forEach((match) => {
        const description = match.replace(/TBD:?/i, '').trim();
        unknowns.push({
          section: 'content',
          description,
          suggestedObjective: `Clarification needed: ${description}`,
        });
      });
    }
  }

  // Check if open questions remain from PRD
  if (prdSections.openQuestions.length > 0) {
    prdSections.openQuestions.forEach((question) => {
      if (!question.includes('TODO')) {
        unknowns.push({
          section: 'open_questions',
          description: question,
          suggestedObjective: `Resolve open question: ${question}`,
        });
      }
    });
  }

  return unknowns;
}
