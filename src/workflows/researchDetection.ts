/**
 * Research Detection Helpers
 *
 * Extracted from researchCoordinator.ts — contains all unknown-detection
 * logic: pattern matching, text scanning, metadata extraction, and
 * context-file heuristic scanning.
 *
 * Implements FR-6, FR-7 detection requirements.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ResearchSource } from '../core/models/ResearchTask';
import type { ContextDocument } from '../core/models/ContextDocument';

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Manual unknown input accepted by detection helpers
 */
interface ManualUnknownObject {
  /** Optional title override */
  title?: string;
  /** Objective to queue */
  objective: string;
  /** Custom sources */
  sources?: ResearchSource[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type ManualUnknownInput = string | ManualUnknownObject;

export interface UnknownDetectionHint {
  title: string;
  objectives: string[];
  sources: ResearchSource[];
  metadata?: Record<string, unknown>;
}

export type UnknownOriginType = 'prompt' | 'spec' | 'context_file' | 'manual' | 'metadata';

export interface DetectionPattern {
  id: string;
  label: string;
  regex: RegExp;
  reason: string;
}

export interface UnknownOrigin {
  type: UnknownOriginType;
  label: string;
  source: ResearchSource;
  filePath?: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_CONTEXT_FILE_SCAN_LIMIT = 12;
export const DEFAULT_MAX_UNKNOWN_PER_SOURCE = 5;
export const DEFAULT_MAX_UNKNOWN_PER_FILE = 3;

export const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
]);

export const DETECTION_PATTERNS: DetectionPattern[] = [
  {
    id: 'tbd',
    label: 'TBD placeholder',
    regex: /\bTBD\b/i,
    reason: 'Line contains TBD marker',
  },
  {
    id: 'todo',
    label: 'TODO marker',
    regex: /\bTODO\b/i,
    reason: 'Line contains TODO marker',
  },
  {
    id: 'fixme',
    label: 'FIXME marker',
    regex: /\bFIXME\b/i,
    reason: 'Line contains FIXME marker',
  },
  {
    id: 'unknown',
    label: 'Unknown reference',
    regex: /\bunknown\b/i,
    reason: 'Line references unknown information',
  },
  {
    id: 'question',
    label: 'Open question',
    regex: /\?\?\?|\?\s*\)/,
    reason: 'Line ends with unresolved question marks',
  },
  {
    id: 'clarify',
    label: 'Clarification request',
    regex: /\bclarify\b|\bneed(?:s)? to (?:confirm|know)\b|\bmissing\b.*\bdetails\b/i,
    reason: 'Line asks for clarification or missing details',
  },
];

// ============================================================================
// Detection Helper Functions
// ============================================================================

/**
 * Determine if file path likely contains text content
 */
export function isLikelyTextFile(relativePath: string): boolean {
  const ext = path.extname(relativePath).toLowerCase();
  if (!ext) {
    const normalized = relativePath.toLowerCase();
    return (
      normalized.includes('readme') ||
      normalized.includes('license') ||
      normalized.includes('changelog') ||
      normalized.endsWith('spec') ||
      normalized.endsWith('plan')
    );
  }
  return TEXT_FILE_EXTENSIONS.has(ext);
}

/**
 * Ensure provided source matches ResearchSource shape
 */
export function isResearchSource(value: unknown): value is ResearchSource {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === 'string' && typeof candidate.identifier === 'string';
}

/**
 * Type guard for manual unknown objects
 */
export function isManualUnknownObject(value: ManualUnknownInput): value is ManualUnknownObject {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalize unknown snippet (strip markdown bullets, TODO prefixes, etc.)
 */
export function normalizeUnknownSnippet(line: string): string {
  let normalized = line
    .replace(/^[-*#\d.)\s]+/, '')
    .replace(/`/g, '')
    .trim();

  normalized = normalized.replace(/^(?:TODO|TBD|FIXME)\s*:?/i, '').trim();
  normalized = normalized.replace(/^\W+/, '').trim();

  if (!normalized) {
    return 'Unspecified research gap';
  }

  if (normalized.length > 240) {
    return `${normalized.slice(0, 237)}...`;
  }
  return normalized;
}

/**
 * Truncate snippet for titles
 */
export function truncateSnippet(value: string, maxLength = 80): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

/**
 * Build descriptive title for unknown detection
 */
export function buildDetectionTitle(origin: UnknownOrigin, snippet: string): string {
  const prefixMap: Record<UnknownOriginType, string> = {
    prompt: 'Clarify prompt detail',
    spec: 'Clarify spec requirement',
    context_file: 'Resolve context note',
    manual: 'Manual research task',
    metadata: 'Metadata research task',
  };

  const prefix = prefixMap[origin.type] ?? 'Clarify unknown';
  return `${prefix}: ${truncateSnippet(snippet)}`;
}

/**
 * Resolve repository path safely
 */
export function resolveRepoPath(repoRoot: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(repoRoot);
  const absolutePath = path.resolve(normalizedRoot, relativePath);

  if (absolutePath === normalizedRoot || absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return absolutePath;
  }

  return null;
}

/**
 * Read text file relative to repo root
 */
export async function readContextFile(repoRoot: string, relativePath: string): Promise<string | null> {
  const absolutePath = resolveRepoPath(repoRoot, relativePath);
  if (!absolutePath) {
    return null;
  }

  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return content.toString();
  } catch {
    return null;
  }
}

/**
 * Convert metadata unknown entries into detection hints
 */
export function extractUnknownsFromMetadata(
  metadata?: Record<string, unknown> | Readonly<Record<string, unknown>>
): UnknownDetectionHint[] {
  if (!metadata) {
    return [];
  }

  const rawUnknowns = metadata.research_unknowns ?? metadata.unknowns;

  if (!Array.isArray(rawUnknowns)) {
    return [];
  }

  const hints: UnknownDetectionHint[] = [];
  rawUnknowns.forEach((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) {
      const snippet = entry.trim();
      const origin: UnknownOrigin = {
        type: 'metadata',
        label: `metadata[${index}]`,
        source: {
          type: 'documentation',
          identifier: 'context-metadata',
          description: 'ContextDocument metadata',
        },
      };

      hints.push({
        title: buildDetectionTitle(origin, snippet),
        objectives: [snippet],
        sources: [origin.source],
        metadata: {
          detection: {
            origin: 'metadata',
            source: origin.label,
            index,
          },
        },
      });
      return;
    }

    if (entry && typeof entry === 'object') {
      const candidate = entry as Record<string, unknown>;
      const objective = typeof candidate.objective === 'string' ? candidate.objective : undefined;
      const objectives = Array.isArray(candidate.objectives)
        ? candidate.objectives.filter((item): item is string => typeof item === 'string')
        : undefined;

      const resolvedObjectives =
        objectives && objectives.length > 0 ? objectives : objective ? [objective] : undefined;

      if (!resolvedObjectives || resolvedObjectives.length === 0) {
        return;
      }

      const origin: UnknownOrigin = {
        type: 'metadata',
        label:
          candidate.label && typeof candidate.label === 'string'
            ? candidate.label
            : `metadata[${index}]`,
        source: {
          type: 'documentation',
          identifier: 'context-metadata',
          description: 'ContextDocument metadata',
        },
      };

      const providedSources = Array.isArray(candidate.sources)
        ? candidate.sources.filter(isResearchSource)
        : undefined;

      hints.push({
        title:
          typeof candidate.title === 'string'
            ? candidate.title
            : buildDetectionTitle(origin, resolvedObjectives[0]),
        objectives: resolvedObjectives,
        sources: providedSources && providedSources.length > 0 ? providedSources : [origin.source],
        metadata: {
          detection: {
            origin: 'metadata',
            source: origin.label,
            index,
          },
        },
      });
    }
  });

  return hints;
}

/**
 * Convert manual unknown definitions into detection hints
 */
export function manualUnknownsToHints(manual?: ManualUnknownInput[]): UnknownDetectionHint[] {
  if (!manual || manual.length === 0) {
    return [];
  }

  const hints: UnknownDetectionHint[] = [];
  manual.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const snippet = entry.trim();
      if (!snippet) {
        return;
      }

      const source: ResearchSource = {
        type: 'other',
        identifier: 'manual-input',
        description: 'User supplied unknown',
      };
      const origin: UnknownOrigin = {
        type: 'manual',
        label: `manual[${index}]`,
        source,
      };

      hints.push({
        title: buildDetectionTitle(origin, snippet),
        objectives: [snippet],
        sources: [source],
        metadata: {
          detection: {
            origin: 'manual',
            index,
          },
        },
      });
      return;
    }

    if (isManualUnknownObject(entry)) {
      const objective = typeof entry.objective === 'string' ? entry.objective.trim() : '';

      if (!objective) {
        return;
      }

      const providedSources = Array.isArray(entry.sources)
        ? entry.sources.filter(isResearchSource)
        : undefined;

      const fallbackSource: ResearchSource = {
        type: 'other',
        identifier: 'manual-input',
      };

      hints.push({
        title:
          entry.title ??
          buildDetectionTitle(
            {
              type: 'manual',
              label: `manual[${index}]`,
              source: fallbackSource,
            },
            objective
          ),
        objectives: [objective],
        sources: providedSources && providedSources.length > 0 ? providedSources : [fallbackSource],
        metadata: entry.metadata ?? {
          detection: {
            origin: 'manual',
            index,
          },
        },
      });
    }
  });

  return hints;
}

/**
 * Extract unknown hints from raw text (prompt, spec, or context files)
 */
export function extractUnknownsFromText(
  text: string,
  origin: UnknownOrigin,
  limit: number
): UnknownDetectionHint[] {
  const hints: UnknownDetectionHint[] = [];
  const lines = text.split(/\r?\n/);
  const dedupe = new Set<string>();

  for (let index = 0; index < lines.length && hints.length < limit; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    const pattern = DETECTION_PATTERNS.find((candidate) => candidate.regex.test(trimmed));
    if (!pattern) {
      continue;
    }

    const snippet = normalizeUnknownSnippet(trimmed);
    const objective = snippet.endsWith('?') ? snippet : `Clarify requirement: ${snippet}`;
    const dedupeKey = `${origin.type}:${origin.source.identifier}:${objective.toLowerCase()}`;

    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    const detectionMetadata: Record<string, unknown> = {
      origin: origin.type,
      reason: pattern.reason,
      snippet,
      source: origin.label,
      pattern: pattern.id,
      line: index + 1,
    };

    if (origin.filePath) {
      detectionMetadata.file_path = origin.filePath;
    }

    hints.push({
      title: buildDetectionTitle(origin, snippet),
      objectives: [objective],
      sources: [origin.source],
      metadata: {
        detection: detectionMetadata,
      },
    });
  }

  return hints;
}

/**
 * Scan context files for TODO/TBD markers
 */
export async function collectContextFileHints(
  repoRoot: string,
  contextDoc: ContextDocument,
  maxFiles: number
): Promise<UnknownDetectionHint[]> {
  const fileEntries = Object.values(contextDoc.files);
  if (fileEntries.length === 0) {
    return [];
  }

  const sorted = fileEntries
    .filter((record) => isLikelyTextFile(record.path))
    .sort((a, b) => {
      const aWeight = a.token_count ?? a.size ?? 0;
      const bWeight = b.token_count ?? b.size ?? 0;
      return bWeight - aWeight;
    })
    .slice(0, Math.max(1, maxFiles));

  const hints: UnknownDetectionHint[] = [];
  for (const record of sorted) {
    const content = await readContextFile(repoRoot, record.path);
    if (!content) {
      continue;
    }

    const origin: UnknownOrigin = {
      type: 'context_file',
      label: record.path,
      filePath: record.path,
      source: {
        type: 'codebase',
        identifier: record.path,
        description: 'Context file referenced in run manifest',
      },
    };

    const extracted = extractUnknownsFromText(content, origin, DEFAULT_MAX_UNKNOWN_PER_FILE);
    hints.push(...extracted);
  }

  return hints;
}
